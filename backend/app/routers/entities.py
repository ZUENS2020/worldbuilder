"""Entity CRUD + graph query API routes."""

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
import uuid

from app.database import get_db
from app.models.models import Entity, Project
from app.schemas import EntityCreate, EntityUpdate, EntityOut, NeighborResult, GraphContext
from app.graph.engine import graph_engine
from app.graph.hop_settings import resolve_graph_hops

router = APIRouter(prefix="/api/projects/{project_id}/entities", tags=["entities"])


@router.post("", response_model=EntityOut)
async def create_entity(
    project_id: str,
    data: EntityCreate,
    db: AsyncSession = Depends(get_db),
):
    entity = Entity(
        id=str(uuid.uuid4()),
        name=data.name,
        type=data.type,
        properties=data.properties,
        project_id=project_id,
    )
    db.add(entity)
    await db.commit()
    await db.refresh(entity)
    graph_engine.add_entity(entity)
    return entity


@router.get("", response_model=list[EntityOut])
async def list_entities(
    project_id: str,
    type: str = Query(None),
    db: AsyncSession = Depends(get_db),
):
    stmt = select(Entity).where(Entity.project_id == project_id)
    if type:
        stmt = stmt.where(Entity.type == type)
    result = await db.execute(stmt)
    return result.scalars().all()


# IMPORTANT: /context must be defined BEFORE /{entity_id} to avoid path parameter capture
@router.get("/context", response_model=GraphContext)
async def get_context(
    project_id: str,
    characters: str = Query(..., description="Comma-separated character names or IDs"),
    scene: str = Query(None),
    hop: int = Query(None, ge=1, le=5, description="Override context hop depth (default from project settings)"),
    db: AsyncSession = Depends(get_db),
):
    """Get graph context for ST plugin injection."""
    project = await db.get(Project, project_id)
    hops = resolve_graph_hops(project.settings if project else {})
    context_hop = hop if hop is not None else hops["context_injection"]

    char_list = [c.strip() for c in characters.split(",")]
    entity_ids = []
    for c in char_list:
        if c in graph_engine.entities:
            entity_ids.append(c)
        else:
            for eid, e in graph_engine.entities.items():
                if e.name == c and e.project_id == project_id:
                    entity_ids.append(eid)
                    break

    result = graph_engine.get_context(
        entity_ids, project_id=project_id, scene=scene, context_hop=context_hop,
    )
    return GraphContext(**result)


@router.get("/{entity_id}", response_model=EntityOut)
async def get_entity(project_id: str, entity_id: str, db: AsyncSession = Depends(get_db)):
    entity = await db.get(Entity, entity_id)
    if not entity or entity.project_id != project_id:
        raise HTTPException(404, "Entity not found")
    return entity


@router.put("/{entity_id}", response_model=EntityOut)
async def update_entity(
    project_id: str,
    entity_id: str,
    data: EntityUpdate,
    db: AsyncSession = Depends(get_db),
):
    entity = await db.get(Entity, entity_id)
    if not entity or entity.project_id != project_id:
        raise HTTPException(404, "Entity not found")
    for key, value in data.model_dump(exclude_unset=True).items():
        setattr(entity, key, value)
    await db.commit()
    await db.refresh(entity)
    graph_engine.entities[entity.id] = entity
    return entity


@router.delete("/{entity_id}")
async def delete_entity(project_id: str, entity_id: str, db: AsyncSession = Depends(get_db)):
    entity = await db.get(Entity, entity_id)
    if not entity or entity.project_id != project_id:
        raise HTTPException(404, "Entity not found")
    await db.delete(entity)
    await db.commit()
    graph_engine.remove_entity(entity_id)
    return {"ok": True}


@router.get("/{entity_id}/neighbors", response_model=dict)
async def get_neighbors(
    project_id: str,
    entity_id: str,
    hop: int = Query(2, ge=1, le=5),
):
    """Get N-hop neighbors of an entity (from in-memory graph)."""
    result = graph_engine.get_neighbors(entity_id, hop=hop, project_id=project_id)
    return {
        "entities": [
            {
                "id": e.id, "name": e.name, "type": e.type,
                "properties": e.properties, "project_id": e.project_id,
                "created_at": e.created_at.isoformat() if e.created_at else None,
                "updated_at": e.updated_at.isoformat() if e.updated_at else None,
            }
            for e in result["entities"]
        ],
        "relations": [
            {
                "id": r.id, "source_id": r.source_id, "target_id": r.target_id,
                "type": r.type, "properties": r.properties, "weight": r.weight,
                "project_id": r.project_id,
            }
            for r in result["relations"]
        ],
        "hop_map": result["hop_map"],
    }
