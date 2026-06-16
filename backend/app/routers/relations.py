"""Relation CRUD API routes."""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
import uuid

from app.database import get_db
from app.models.models import Relation
from app.schemas import RelationCreate, RelationUpdate, RelationOut
from app.graph.engine import graph_engine

router = APIRouter(prefix="/api/projects/{project_id}/relations", tags=["relations"])


@router.post("", response_model=RelationOut)
async def create_relation(
    project_id: str,
    data: RelationCreate,
    db: AsyncSession = Depends(get_db),
):
    # Verify source and target exist
    source = await db.get(Relation, data.source_id) if False else None
    # We'll let the FK constraint handle validation
    relation = Relation(
        id=str(uuid.uuid4()),
        source_id=data.source_id,
        target_id=data.target_id,
        type=data.type,
        properties=data.properties,
        weight=data.weight,
        project_id=project_id,
    )
    db.add(relation)
    await db.commit()
    await db.refresh(relation)
    graph_engine.add_relation(relation)
    return relation


@router.get("", response_model=list[RelationOut])
async def list_relations(
    project_id: str,
    type: str = None,
    db: AsyncSession = Depends(get_db),
):
    stmt = select(Relation).where(Relation.project_id == project_id)
    if type:
        stmt = stmt.where(Relation.type == type)
    result = await db.execute(stmt)
    return result.scalars().all()


@router.get("/{relation_id}", response_model=RelationOut)
async def get_relation(project_id: str, relation_id: str, db: AsyncSession = Depends(get_db)):
    relation = await db.get(Relation, relation_id)
    if not relation or relation.project_id != project_id:
        raise HTTPException(404, "Relation not found")
    return relation


@router.put("/{relation_id}", response_model=RelationOut)
async def update_relation(
    project_id: str,
    relation_id: str,
    data: RelationUpdate,
    db: AsyncSession = Depends(get_db),
):
    relation = await db.get(Relation, relation_id)
    if not relation or relation.project_id != project_id:
        raise HTTPException(404, "Relation not found")
    for key, value in data.model_dump(exclude_unset=True).items():
        setattr(relation, key, value)
    await db.commit()
    await db.refresh(relation)
    # Update in-memory: remove old, add new
    graph_engine.remove_relation(relation.id)
    graph_engine.add_relation(relation)
    return relation


@router.delete("/{relation_id}")
async def delete_relation(project_id: str, relation_id: str, db: AsyncSession = Depends(get_db)):
    relation = await db.get(Relation, relation_id)
    if not relation or relation.project_id != project_id:
        raise HTTPException(404, "Relation not found")
    await db.delete(relation)
    await db.commit()
    graph_engine.remove_relation(relation_id)
    return {"ok": True}
