"""P5 background simulation loop + SSE fan-out.

Holds an in-process registry of running sims. Each running sim owns one asyncio
task that drives `run_tick` on a fixed interval, and a set of subscriber queues
that receive serialized tick events for Server-Sent-Events streaming.

The loop uses its OWN DB session (never the request-scoped one) so it survives
beyond the HTTP request that started it. Stop conditions (`max_ticks`,
`stability_window`) auto-pause the loop and emit a terminal `paused` event.
"""

import asyncio
import contextlib
from dataclasses import dataclass, field

from sqlalchemy.exc import OperationalError

from app.database import async_session
from app.models.models import Simulation
from app.services.simulation import run_tick, _cfg

_tick_locks: dict[str, asyncio.Lock] = {}


def _tick_lock(sim_id: str) -> asyncio.Lock:
    lock = _tick_locks.get(sim_id)
    if lock is None:
        lock = asyncio.Lock()
        _tick_locks[sim_id] = lock
    return lock


async def guarded_run_tick(session, sim: Simulation):
    """Serialize tick execution per sim — prevents duplicate tick numbers when
    the background loop and a manual step overlap, or when a long tick releases
    the DB lock mid-flight."""
    async with _tick_lock(sim.id):
        await session.refresh(sim)
        return await run_tick(session, sim)


async def _commit_with_retry(session, *, attempts: int = 8) -> None:
    """SQLite can briefly lock when a tick is writing; retry instead of 500."""
    delay = 0.05
    for i in range(attempts):
        try:
            await session.commit()
            return
        except OperationalError as exc:
            if "locked" not in str(exc).lower() and "busy" not in str(exc).lower():
                raise
            await session.rollback()
            if i == attempts - 1:
                raise
            await asyncio.sleep(delay)
            delay = min(delay * 2, 1.0)


@dataclass
class _Runner:
    task: asyncio.Task | None = None
    subscribers: set[asyncio.Queue] = field(default_factory=set)
    stable_streak: int = 0


_runners: dict[str, _Runner] = {}


def _runner(sim_id: str) -> _Runner:
    r = _runners.get(sim_id)
    if r is None:
        r = _Runner()
        _runners[sim_id] = r
    return r


def is_running(sim_id: str) -> bool:
    r = _runners.get(sim_id)
    return bool(r and r.task and not r.task.done())


async def _broadcast(sim_id: str, event: dict) -> None:
    r = _runners.get(sim_id)
    if not r:
        return
    for q in list(r.subscribers):
        with contextlib.suppress(asyncio.QueueFull):
            q.put_nowait(event)


def _serialize_tick(t) -> dict:
    return {
        "id": t.id, "tick": t.tick,
        "interactions": t.interactions, "mutations": t.mutations,
        "snapshot": t.snapshot, "metrics": t.metrics,
    }


async def _loop(sim_id: str, project_id: str) -> None:
    """Drive ticks until paused, max_ticks reached, or world stabilizes."""
    r = _runner(sim_id)
    r.stable_streak = 0
    try:
        while True:
            async with async_session() as session:
                sim = await session.get(Simulation, sim_id)
                if not sim or sim.status != "running":
                    break

                interval = max(1, int(_cfg(sim, "tick_interval_sec") or 6))
                max_ticks = int(_cfg(sim, "max_ticks") or 0)
                stability_window = int(_cfg(sim, "stability_window") or 0)

                if max_ticks and sim.current_tick >= max_ticks:
                    await _pause(session, sim, reason="max_ticks")
                    break

                simtick = await guarded_run_tick(session, sim)
                await _broadcast(sim_id, {"type": "tick", "tick": _serialize_tick(simtick)})

                # Quiescence is about *progress*, not motion: anti-drought machinery
                # keeps mutations flowing, so a tick with no real advance is what
                # signals the world has settled into a new equilibrium.
                made_progress = bool((simtick.metrics or {}).get("progress"))
                if stability_window:
                    r.stable_streak = 0 if made_progress else r.stable_streak + 1
                    if r.stable_streak >= stability_window:
                        await _pause(session, sim, reason="quiescent")
                        break

            await asyncio.sleep(interval)
    except asyncio.CancelledError:
        raise
    except Exception as exc:  # surface loop crashes to subscribers, then stop
        await _broadcast(sim_id, {"type": "error", "message": str(exc)})
        async with async_session() as session:
            sim = await session.get(Simulation, sim_id)
            if sim and sim.status == "running":
                sim.status = "paused"
                await session.commit()
        await _broadcast(sim_id, {"type": "paused", "reason": "error"})


async def _pause(session, sim: Simulation, *, reason: str) -> None:
    sim.status = "paused"
    await session.commit()
    await _broadcast(sim.id, {"type": "paused", "reason": reason, "tick": sim.current_tick})


async def play(session, sim: Simulation) -> None:
    """Mark running and (re)start the background task if not already alive."""
    sim.status = "running"
    await _commit_with_retry(session)
    if not is_running(sim.id):
        r = _runner(sim.id)
        r.task = asyncio.create_task(_loop(sim.id, sim.project_id))


async def pause(session, sim: Simulation) -> None:
    """Stop the loop first, then persist paused status (avoids SQLite lock races)."""
    r = _runners.get(sim.id)
    if r and r.task and not r.task.done():
        r.task.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await r.task
    sim.status = "paused"
    await _commit_with_retry(session)
    await _broadcast(sim.id, {"type": "paused", "reason": "manual", "tick": sim.current_tick})


async def stop_for_reset(sim_id: str) -> None:
    """Cancel any running loop so a reset can safely restore state."""
    r = _runners.get(sim_id)
    if r and r.task and not r.task.done():
        r.task.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await r.task


def subscribe(sim_id: str) -> asyncio.Queue:
    q: asyncio.Queue = asyncio.Queue(maxsize=64)
    _runner(sim_id).subscribers.add(q)
    return q


def unsubscribe(sim_id: str, q: asyncio.Queue) -> None:
    r = _runners.get(sim_id)
    if r:
        r.subscribers.discard(q)
