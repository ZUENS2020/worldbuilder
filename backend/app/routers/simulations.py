"""Simulation API routes — P1: create/get + manual single-step + tick & memory reads."""

import uuid

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.models import Simulation, SimTick, AgentMemory, Project
from app.services.simulation import run_tick, DEFAULT_CONFIG

router = APIRouter(prefix="/api/projects/{project_id}/simulations", tags=["simulations"])


# ── schemas ──────────────────────────────────────────────────────

class SimulationCreate(BaseModel):
    name: str = ""
    driver_mode: str = "hybrid"     # hybrid | full_llm
    config: dict | None = None


class SimulationOut(BaseModel):
    id: str
    project_id: str
    name: str
    status: str
    driver_mode: str
    current_tick: int
    config: dict

    model_config = {"from_attributes": True}


def _serialize_tick(t: SimTick) -> dict:
    return {
        "id": t.id, "tick": t.tick,
        "interactions": t.interactions, "mutations": t.mutations,
        "snapshot": t.snapshot, "metrics": t.metrics,
    }


# ── CRUD ─────────────────────────────────────────────────────────

@router.post("", response_model=SimulationOut)
async def create_simulation(project_id: str, data: SimulationCreate, db: AsyncSession = Depends(get_db)):
    project = await db.get(Project, project_id)
    if not project:
        raise HTTPException(404, "Project not found")
    config = {**DEFAULT_CONFIG, **(data.config or {})}
    sim = Simulation(
        id=str(uuid.uuid4()),
        project_id=project_id,
        name=data.name or "模拟",
        status="idle",
        driver_mode=data.driver_mode,
        current_tick=0,
        config=config,
    )
    db.add(sim)
    await db.commit()
    await db.refresh(sim)
    return sim


@router.get("", response_model=list[SimulationOut])
async def list_simulations(project_id: str, db: AsyncSession = Depends(get_db)):
    rows = (await db.execute(
        select(Simulation).where(Simulation.project_id == project_id)
        .order_by(Simulation.created_at.desc())
    )).scalars().all()
    return rows


@router.get("/{sim_id}", response_model=SimulationOut)
async def get_simulation(project_id: str, sim_id: str, db: AsyncSession = Depends(get_db)):
    sim = await db.get(Simulation, sim_id)
    if not sim or sim.project_id != project_id:
        raise HTTPException(404, "Simulation not found")
    return sim


# ── stepping ─────────────────────────────────────────────────────

@router.post("/{sim_id}/step")
async def step_simulation(project_id: str, sim_id: str, db: AsyncSession = Depends(get_db)):
    sim = await db.get(Simulation, sim_id)
    if not sim or sim.project_id != project_id:
        raise HTTPException(404, "Simulation not found")
    simtick = await run_tick(db, sim)
    return {"simulation": SimulationOut.model_validate(sim).model_dump(), "tick": _serialize_tick(simtick)}


# ── reads ────────────────────────────────────────────────────────

@router.get("/{sim_id}/ticks")
async def list_ticks(
    project_id: str, sim_id: str,
    from_: int = Query(0, alias="from"), to: int | None = None,
    db: AsyncSession = Depends(get_db),
):
    stmt = select(SimTick).where(SimTick.simulation_id == sim_id).where(SimTick.tick >= from_)
    if to is not None:
        stmt = stmt.where(SimTick.tick <= to)
    rows = (await db.execute(stmt.order_by(SimTick.tick))).scalars().all()
    return [_serialize_tick(t) for t in rows]


@router.get("/{sim_id}/ticks/{tick}")
async def get_tick(project_id: str, sim_id: str, tick: int, db: AsyncSession = Depends(get_db)):
    row = (await db.execute(
        select(SimTick).where(SimTick.simulation_id == sim_id).where(SimTick.tick == tick)
    )).scalar_one_or_none()
    if not row:
        raise HTTPException(404, "Tick not found")
    return _serialize_tick(row)


@router.get("/{sim_id}/memory")
async def get_memory(
    project_id: str, sim_id: str, entity: str = Query(...),
    db: AsyncSession = Depends(get_db),
):
    """Raw memory stream for one agent (debug / inspector). Includes compacted rows."""
    rows = (await db.execute(
        select(AgentMemory)
        .where(AgentMemory.simulation_id == sim_id)
        .where(AgentMemory.entity_id == entity)
        .order_by(AgentMemory.tick, AgentMemory.created_at)
    )).scalars().all()
    return [
        {
            "id": m.id, "tick": m.tick, "kind": m.kind, "content": m.content,
            "participants": m.participants, "salience": m.salience,
            "compacted_into": (m.properties or {}).get("compacted_into"),
        }
        for m in rows
    ]
