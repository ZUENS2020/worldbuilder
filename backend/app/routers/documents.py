"""Document CRUD + streaming generation API routes."""

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
import uuid

from app.database import get_db
from app.models.models import Document, Project, Entity
from app.schemas import DocumentCreate, DocumentUpdate, DocumentOut, GenerateRequest
from app.graph.engine import graph_engine
from app.graph.hop_settings import resolve_graph_hops
from app.services.ai_service import (
    ai_generate_scene_stream,
    ai_continue_scene_stream,
    ai_generate_outline_stream,
)

router = APIRouter(prefix="/api/projects/{project_id}", tags=["documents"])


# ── Document CRUD ───────────────────────────────────────────────

@router.post("/documents", response_model=DocumentOut)
async def create_document(
    project_id: str,
    data: DocumentCreate,
    db: AsyncSession = Depends(get_db),
):
    doc = Document(
        id=str(uuid.uuid4()),
        project_id=project_id,
        title=data.title,
        kind=data.kind,
        content=data.content,
        refs=data.refs,
    )
    db.add(doc)
    await db.commit()
    await db.refresh(doc)
    return doc


@router.get("/documents", response_model=list[DocumentOut])
async def list_documents(
    project_id: str,
    kind: str = None,
    db: AsyncSession = Depends(get_db),
):
    stmt = select(Document).where(Document.project_id == project_id)
    if kind:
        stmt = stmt.where(Document.kind == kind)
    result = await db.execute(stmt)
    return result.scalars().all()


@router.get("/documents/{doc_id}", response_model=DocumentOut)
async def get_document(project_id: str, doc_id: str, db: AsyncSession = Depends(get_db)):
    doc = await db.get(Document, doc_id)
    if not doc or doc.project_id != project_id:
        raise HTTPException(404, "Document not found")
    return doc


@router.put("/documents/{doc_id}", response_model=DocumentOut)
async def update_document(
    project_id: str,
    doc_id: str,
    data: DocumentUpdate,
    db: AsyncSession = Depends(get_db),
):
    doc = await db.get(Document, doc_id)
    if not doc or doc.project_id != project_id:
        raise HTTPException(404, "Document not found")
    for key, value in data.model_dump(exclude_unset=True).items():
        setattr(doc, key, value)
    await db.commit()
    await db.refresh(doc)
    return doc


@router.delete("/documents/{doc_id}")
async def delete_document(project_id: str, doc_id: str, db: AsyncSession = Depends(get_db)):
    doc = await db.get(Document, doc_id)
    if not doc or doc.project_id != project_id:
        raise HTTPException(404, "Document not found")
    await db.delete(doc)
    await db.commit()
    return {"ok": True}


# ── Streaming generation ────────────────────────────────────────

@router.post("/generate/stream")
async def generate_stream(
    project_id: str,
    data: GenerateRequest,
    db: AsyncSession = Depends(get_db),
):
    """SSE streaming endpoint for text generation."""
    project = await db.get(Project, project_id)
    config = project.settings if project else {}

    # Build context from graph
    entity_ids = data.context_entity_ids + data.context_event_ids
    hops = resolve_graph_hops(config)
    context_result = graph_engine.get_context(
        entity_ids, project_id=project_id, context_hop=hops["writing_context"],
    )
    context_text = context_result["system_injection"]

    gen_kwargs = dict(
        length=data.length, style=data.style, pov=data.pov,
        language=data.language, instruction=data.instruction,
    )

    async def event_generator():
        if data.mode == "scene":
            stream = ai_generate_scene_stream(
                context_text, data.scene_description, config=config, **gen_kwargs,
            )
        elif data.mode == "continue":
            stream = ai_continue_scene_stream(
                context_text, data.prior_text, config=config, **gen_kwargs,
            )
        elif data.mode == "outline":
            stream = ai_generate_outline_stream(
                context_text, config=config,
                style=data.style, language=data.language, instruction=data.instruction,
            )
        else:
            yield "data: [DONE]\n\n"
            return
        async for chunk in stream:
            # Encode newlines so SSE line-splitting doesn't eat them
            encoded = chunk.replace("\n", "\\n")
            yield f"data: {encoded}\n\n"
        yield "data: [DONE]\n\n"

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
