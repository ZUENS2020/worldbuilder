"""Belief layer API — seed + ST belief-context."""

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.models import Project, WorldEntry
from app.schemas import GraphContext
from app.graph.hop_settings import resolve_graph_hops
from app.graph.engine import graph_engine
from app.services import belief

router = APIRouter(prefix="/api/projects/{project_id}/beliefs", tags=["beliefs"])


def _resolve_entity(project_id: str, token: str) -> str | None:
    token = (token or "").strip()
    if not token:
        return None
    if token in graph_engine.entities:
        e = graph_engine.entities[token]
        return token if e.project_id == project_id else None
    for eid, e in graph_engine.entities.items():
        if e.name == token and e.project_id == project_id:
            return eid
    return None


@router.post("/seed")
async def seed_beliefs(project_id: str, db: AsyncSession = Depends(get_db)):
    """Idempotent: initialize belief rows from current visibility-filtered truth."""
    project = await db.get(Project, project_id)
    if not project:
        raise HTTPException(404, "Project not found")
    created = await belief.seed_beliefs_for_project(db, project_id)
    await db.commit()
    return {"created": created}


@router.get("/context", response_model=GraphContext)
async def get_belief_context(
    project_id: str,
    observer: str = Query(..., description="Observer entity name or ID"),
    characters: str = Query(..., description="Comma-separated in-scene character names or IDs"),
    hop: int = Query(None, ge=1, le=5),
    simulation: str = Query(None, description="Simulation ID for sim-scoped beliefs"),
    db: AsyncSession = Depends(get_db),
):
    """Belief-filtered scene context for ST plugin (observer's subjective world copy)."""
    project = await db.get(Project, project_id)
    if not project:
        raise HTTPException(404, "Project not found")

    observer_id = _resolve_entity(project_id, observer)
    if not observer_id:
        raise HTTPException(400, f"Unknown observer: {observer}")

    char_list = [c.strip() for c in characters.split(",") if c.strip()]
    entity_ids = list(dict.fromkeys(
        eid for c in char_list if (eid := _resolve_entity(project_id, c))
    ))
    if not entity_ids:
        raise HTTPException(400, "No valid characters resolved")

    hops = resolve_graph_hops(project.settings if project else {})
    context_hop = hop if hop is not None else hops["context_injection"]

    we_result = await db.execute(
        select(WorldEntry).where(
            WorldEntry.project_id == project_id, WorldEntry.enabled == 1
        )
    )
    world_entries = we_result.scalars().all()

    result = await belief.build_scene_belief_context(
        db, project_id, observer_id, entity_ids,
        simulation_id=simulation,
        context_hop=context_hop, world_entries=world_entries,
    )
    return GraphContext(**result)
