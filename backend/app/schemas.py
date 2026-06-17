"""Pydantic schemas for API validation."""

from pydantic import BaseModel, Field
from typing import Optional, Any
from datetime import datetime


# --- Project ---
class ProjectCreate(BaseModel):
    name: str
    description: str = ""
    settings: dict = Field(default_factory=dict)


class ProjectUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    settings: Optional[dict] = None


class ProjectOut(BaseModel):
    id: str
    name: str
    description: str
    settings: dict
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None

    model_config = {"from_attributes": True}


# --- Entity ---
class EntityCreate(BaseModel):
    name: str
    type: str = "character"
    properties: dict = Field(default_factory=dict)


class EntityUpdate(BaseModel):
    name: Optional[str] = None
    type: Optional[str] = None
    properties: Optional[dict] = None


class EntityOut(BaseModel):
    id: str
    name: str
    type: str
    properties: dict
    project_id: str
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None

    model_config = {"from_attributes": True}


# --- Relation ---
class RelationCreate(BaseModel):
    source_id: str
    target_id: str
    type: str
    properties: dict = Field(default_factory=dict)
    weight: float = 0.5


class RelationUpdate(BaseModel):
    type: Optional[str] = None
    properties: Optional[dict] = None
    weight: Optional[float] = None


class RelationOut(BaseModel):
    id: str
    source_id: str
    target_id: str
    type: str
    properties: dict
    weight: float
    project_id: str
    created_at: Optional[datetime] = None

    model_config = {"from_attributes": True}


# --- Graph query results ---
class NeighborResult(BaseModel):
    entity: EntityOut
    relations: list[RelationOut]
    hop: int


class GraphContext(BaseModel):
    """Result for ST plugin context injection."""
    system_injection: str
    active_warnings: list[str]
    token_count: int


# --- Transform ---
class TransformRequest(BaseModel):
    entity_id: str
    transform_type: str
    params: dict = Field(default_factory=dict)


class TransformResult(BaseModel):
    new_entities: list[EntityOut]
    new_relations: list[RelationOut]
    message: str = ""
    # For ai_infer preview: candidates not yet persisted
    candidates: Optional[list[dict]] = None


# --- AI Infer Candidates (M2c: preview before commit) ---
class InferCandidate(BaseModel):
    """A single AI-inferred relation candidate, not yet persisted."""
    target_name: str
    target_type: str = "character"
    relation_type: str
    description: str = ""
    confidence: float = 0.5
    exists: bool = False  # True if target entity already exists in DB


class InferPreviewResult(BaseModel):
    """Result of ai_infer: candidates for user review, NOT auto-committed."""
    candidates: list[InferCandidate]
    message: str = ""
