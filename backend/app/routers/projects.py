"""Project CRUD API routes."""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
import copy
import uuid

from app.database import get_db
from app.models.models import Project, Entity, Relation, WorldEntry
from app.graph.engine import graph_engine
from app.schemas import ProjectCreate, ProjectUpdate, ProjectOut

router = APIRouter(prefix="/api/projects", tags=["projects"])


def _remap_ids(obj, id_map: dict):
    """Deep-copy a JSON-like structure, replacing any string that is a key in
    id_map with its mapped value. Entity ids are UUIDs, so accidental matches
    are effectively impossible. Keeps visibility whitelists / tag entityIds /
    faction-group references valid in the duplicated project."""
    if isinstance(obj, str):
        return id_map.get(obj, obj)
    if isinstance(obj, list):
        return [_remap_ids(v, id_map) for v in obj]
    if isinstance(obj, dict):
        return {k: _remap_ids(v, id_map) for k, v in obj.items()}
    return obj


@router.post("", response_model=ProjectOut)
async def create_project(data: ProjectCreate, db: AsyncSession = Depends(get_db)):
    project = Project(
        id=str(uuid.uuid4()),
        name=data.name,
        description=data.description,
        settings=data.settings or {},
    )
    db.add(project)
    await db.commit()
    await db.refresh(project)
    return project


@router.get("", response_model=list[ProjectOut])
async def list_projects(db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Project))
    return result.scalars().all()


@router.get("/{project_id}", response_model=ProjectOut)
async def get_project(project_id: str, db: AsyncSession = Depends(get_db)):
    project = await db.get(Project, project_id)
    if not project:
        raise HTTPException(404, "Project not found")
    return project


@router.put("/{project_id}", response_model=ProjectOut)
async def update_project(project_id: str, data: ProjectUpdate, db: AsyncSession = Depends(get_db)):
    project = await db.get(Project, project_id)
    if not project:
        raise HTTPException(404, "Project not found")
    for key, value in data.model_dump(exclude_unset=True).items():
        setattr(project, key, value)
    await db.commit()
    await db.refresh(project)
    return project


@router.post("/{project_id}/duplicate", response_model=ProjectOut)
async def duplicate_project(project_id: str, db: AsyncSession = Depends(get_db)):
    """Deep-copy a project into a fresh sandbox (new ids, remapped references).

    Entities, relations and world entries are cloned. Entity-id references inside
    properties / settings / world-entry attachments are remapped so the copy is
    self-consistent. The new graph is loaded into the in-memory engine.
    """
    src = await db.get(Project, project_id)
    if not src:
        raise HTTPException(404, "Project not found")

    new_pid = str(uuid.uuid4())

    entities = (await db.execute(select(Entity).where(Entity.project_id == project_id))).scalars().all()
    relations = (await db.execute(select(Relation).where(Relation.project_id == project_id))).scalars().all()
    world_entries = (await db.execute(select(WorldEntry).where(WorldEntry.project_id == project_id))).scalars().all()

    # entity id remap built first so every reference can be rewritten
    id_map = {e.id: str(uuid.uuid4()) for e in entities}

    new_project = Project(
        id=new_pid,
        name=f"{src.name}（副本）",
        description=src.description,
        settings=_remap_ids(copy.deepcopy(src.settings or {}), id_map),
    )
    db.add(new_project)

    new_entities = []
    for e in entities:
        ne = Entity(
            id=id_map[e.id],
            name=e.name,
            type=e.type,
            properties=_remap_ids(copy.deepcopy(e.properties or {}), id_map),
            project_id=new_pid,
        )
        db.add(ne)
        new_entities.append(ne)

    new_relations = []
    for r in relations:
        nr = Relation(
            id=str(uuid.uuid4()),
            source_id=id_map.get(r.source_id, r.source_id),
            target_id=id_map.get(r.target_id, r.target_id),
            type=r.type,
            properties=_remap_ids(copy.deepcopy(r.properties or {}), id_map),
            weight=r.weight,
            project_id=new_pid,
        )
        db.add(nr)
        new_relations.append(nr)

    for w in world_entries:
        db.add(WorldEntry(
            id=str(uuid.uuid4()),
            project_id=new_pid,
            title=w.title,
            content=w.content,
            scope=w.scope,
            entity_ids=_remap_ids(copy.deepcopy(w.entity_ids or []), id_map),
            keys=copy.deepcopy(w.keys or []),
            priority=w.priority,
            enabled=w.enabled,
            properties=_remap_ids(copy.deepcopy(w.properties or {}), id_map),
        ))

    await db.commit()
    await db.refresh(new_project)

    # mirror into in-memory graph engine
    graph_engine.load_entities(new_entities)
    graph_engine.load_relations(new_relations)

    return new_project


@router.delete("/{project_id}")
async def delete_project(project_id: str, db: AsyncSession = Depends(get_db)):
    project = await db.get(Project, project_id)
    if not project:
        raise HTTPException(404, "Project not found")
    await db.delete(project)
    await db.commit()
    return {"ok": True}
