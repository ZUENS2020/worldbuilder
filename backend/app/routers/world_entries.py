"""World Book API routes — CRUD for WorldEntry (lorebook) entries.

Entries are injected into LLM context by app/graph/worldbook.py: global entries
are always on; entity-scoped entries fire only when an attached entity is in
scene. See the /context endpoint in entities.py for the wiring.
"""

import uuid

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.models import WorldEntry, Project

router = APIRouter(prefix="/api/projects/{project_id}/world-entries", tags=["world-entries"])


# ── schemas ──────────────────────────────────────────────────────

class WorldEntryCreate(BaseModel):
    title: str = ""
    content: str = ""
    scope: str = "global"          # global | entity
    entity_ids: list[str] = []
    keys: list[str] = []
    priority: int = 0
    enabled: int = 1
    properties: dict = {}


class WorldEntryUpdate(BaseModel):
    title: str | None = None
    content: str | None = None
    scope: str | None = None
    entity_ids: list[str] | None = None
    keys: list[str] | None = None
    priority: int | None = None
    enabled: int | None = None
    properties: dict | None = None


class WorldEntryOut(BaseModel):
    id: str
    project_id: str
    title: str
    content: str
    scope: str
    entity_ids: list[str]
    keys: list[str]
    priority: int
    enabled: int
    properties: dict

    model_config = {"from_attributes": True}


# ── CRUD ─────────────────────────────────────────────────────────

@router.get("", response_model=list[WorldEntryOut])
async def list_world_entries(project_id: str, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(WorldEntry)
        .where(WorldEntry.project_id == project_id)
        .order_by(WorldEntry.priority.desc(), WorldEntry.created_at)
    )
    return result.scalars().all()


@router.post("", response_model=WorldEntryOut)
async def create_world_entry(project_id: str, data: WorldEntryCreate, db: AsyncSession = Depends(get_db)):
    project = await db.get(Project, project_id)
    if not project:
        raise HTTPException(404, "Project not found")
    entry = WorldEntry(
        id=str(uuid.uuid4()),
        project_id=project_id,
        title=data.title,
        content=data.content,
        scope=data.scope,
        entity_ids=data.entity_ids,
        keys=data.keys,
        priority=data.priority,
        enabled=data.enabled,
        properties=data.properties,
    )
    db.add(entry)
    await db.commit()
    await db.refresh(entry)
    return entry


@router.put("/{entry_id}", response_model=WorldEntryOut)
async def update_world_entry(
    project_id: str, entry_id: str, data: WorldEntryUpdate, db: AsyncSession = Depends(get_db)
):
    entry = await db.get(WorldEntry, entry_id)
    if not entry or entry.project_id != project_id:
        raise HTTPException(404, "World entry not found")
    for field, value in data.model_dump(exclude_unset=True).items():
        setattr(entry, field, value)
    await db.commit()
    await db.refresh(entry)
    return entry


@router.delete("/{entry_id}")
async def delete_world_entry(project_id: str, entry_id: str, db: AsyncSession = Depends(get_db)):
    entry = await db.get(WorldEntry, entry_id)
    if not entry or entry.project_id != project_id:
        raise HTTPException(404, "World entry not found")
    await db.delete(entry)
    await db.commit()
    return {"ok": True}
