"""SQLAlchemy models for Entity, Relation, and Project."""

from sqlalchemy import Column, String, Float, Text, DateTime, JSON, ForeignKey, Integer
from sqlalchemy.orm import relationship
from datetime import datetime, timezone
from app.database import Base


class Project(Base):
    __tablename__ = "projects"

    id = Column(String, primary_key=True)
    name = Column(String, nullable=False)
    description = Column(Text, default="")
    settings = Column(JSON, default=dict)  # ai_endpoint, ai_api_key, ai_model
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))
    updated_at = Column(DateTime, default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc))

    entities = relationship("Entity", back_populates="project", cascade="all, delete-orphan")
    relations = relationship("Relation", back_populates="project", cascade="all, delete-orphan")


class Entity(Base):
    __tablename__ = "entities"

    id = Column(String, primary_key=True)
    name = Column(String, nullable=False, index=True)
    type = Column(String, nullable=False)  # character, location, event, item, faction
    properties = Column(JSON, default=dict)
    project_id = Column(String, ForeignKey("projects.id"), nullable=False, index=True)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))
    updated_at = Column(DateTime, default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc))

    project = relationship("Project", back_populates="entities")


class Relation(Base):
    __tablename__ = "relations"

    id = Column(String, primary_key=True)
    source_id = Column(String, ForeignKey("entities.id", ondelete="CASCADE"), nullable=False, index=True)
    target_id = Column(String, ForeignKey("entities.id", ondelete="CASCADE"), nullable=False, index=True)
    type = Column(String, nullable=False)  # ally, enemy, lover, family, member_of, located_at, participated, custom
    properties = Column(JSON, default=dict)
    weight = Column(Float, default=0.5)
    project_id = Column(String, ForeignKey("projects.id"), nullable=False, index=True)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))

    project = relationship("Project", back_populates="relations")


# ── Simulation tables (agent-based relationship-evolution simulator) ──

class Simulation(Base):
    """One active simulation per project. Holds the tick loop's runtime config."""
    __tablename__ = "simulations"

    id = Column(String, primary_key=True)
    project_id = Column(String, ForeignKey("projects.id", ondelete="CASCADE"), nullable=False, index=True)
    name = Column(String, default="")
    status = Column(String, default="idle")  # idle | running | paused
    driver_mode = Column(String, default="hybrid")  # hybrid | full_llm
    current_tick = Column(Integer, default=0)
    # config keys: tick_interval_sec, max_encounters_per_tick, allow_new_entities,
    # temperature, scheduler_strategy, memory_recent_k, memory_compact_threshold,
    # nudge_strategy, nudge_every_n_ticks, nudge_targets_per_tick, nudge_intensity,
    # conflict_strategy, max_ticks, stability_window
    config = Column(JSON, default=dict)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))
    updated_at = Column(DateTime, default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc))


class SimTick(Base):
    """One row per tick — full snapshot for replay/scrubbing. tick 0 = initial."""
    __tablename__ = "sim_ticks"

    id = Column(String, primary_key=True)
    simulation_id = Column(String, ForeignKey("simulations.id", ondelete="CASCADE"), nullable=False, index=True)
    project_id = Column(String, ForeignKey("projects.id", ondelete="CASCADE"), nullable=False, index=True)
    tick = Column(Integer, nullable=False, index=True)
    interactions = Column(JSON, default=list)   # list of {participants, narrative}
    mutations = Column(JSON, default=list)       # list of applied canonical mutations
    snapshot = Column(JSON, default=dict)        # relations + mutable props + beliefs + memory cursors
    metrics = Column(JSON, default=dict)         # llm_calls, tokens_in/out, latency_ms, encounters, nudges, mutation_count
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))


class WorldEntry(Base):
    """World Book / lorebook entry — graph-anchored hard retrieval (no RAG)."""
    __tablename__ = "world_entries"

    id = Column(String, primary_key=True)
    project_id = Column(String, ForeignKey("projects.id", ondelete="CASCADE"), nullable=False, index=True)
    title = Column(String, default="")
    content = Column(Text, default="")          # markdown
    scope = Column(String, default="global")     # global | entity
    entity_ids = Column(JSON, default=list)      # attachment targets when scope == entity
    keys = Column(JSON, default=list)            # optional keywords (ST lorebook compat)
    priority = Column(Integer, default=0)
    enabled = Column(Integer, default=1)
    properties = Column(JSON, default=dict)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))
    updated_at = Column(DateTime, default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc))


class Belief(Base):
    """One agent's belief about one subject — a per-agent copy of the world that
    can be stale or wrong vs canonical truth."""
    __tablename__ = "beliefs"

    id = Column(String, primary_key=True)
    project_id = Column(String, ForeignKey("projects.id", ondelete="CASCADE"), nullable=False, index=True)
    observer_id = Column(String, ForeignKey("entities.id", ondelete="CASCADE"), nullable=False, index=True)
    subject_id = Column(String, ForeignKey("entities.id", ondelete="CASCADE"), nullable=False, index=True)
    believed_properties = Column(JSON, default=dict)
    believed_relations = Column(JSON, default=list)
    as_of_tick = Column(Integer, default=0)
    confidence = Column(Float, default=1.0)


class AgentMemory(Base):
    """Per-agent episodic memory stream (append-only, never physically deleted).
    Compaction folds old episodics into a summary row via properties.compacted_into."""
    __tablename__ = "agent_memories"

    id = Column(String, primary_key=True)
    project_id = Column(String, ForeignKey("projects.id", ondelete="CASCADE"), nullable=False, index=True)
    simulation_id = Column(String, ForeignKey("simulations.id", ondelete="CASCADE"), nullable=False, index=True)
    entity_id = Column(String, ForeignKey("entities.id", ondelete="CASCADE"), nullable=False, index=True)
    tick = Column(Integer, nullable=False, index=True)
    kind = Column(String, default="episodic")    # episodic | summary
    content = Column(Text, default="")
    participants = Column(JSON, default=list)
    salience = Column(Float, default=0.5)
    properties = Column(JSON, default=dict)      # e.g. {compacted_into: <summary_id>}
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))
