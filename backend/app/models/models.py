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
