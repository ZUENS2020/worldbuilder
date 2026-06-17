"""Transform API routes - the core Maltego-style interaction.

M2 changes:
- ai_infer returns candidates (preview), NOT auto-committed
- All AI calls receive project settings for configurable model/key
"""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
import uuid

from app.database import get_db
from app.models.models import Entity, Relation, Project
from app.schemas import TransformRequest, TransformResult
from app.graph.engine import graph_engine
from app.graph.hop_settings import resolve_graph_hops
from app.services.ai_service import ai_infer_relations, ai_detect_conflicts, ai_generate_backstory

router = APIRouter(prefix="/api/projects/{project_id}/transforms", tags=["transforms"])

# Transform definitions by entity type
TRANSFORM_REGISTRY = {
    "character": [
        {"id": "expand_relations", "label": "展开关系人", "description": "显示该人物的所有直接关系人"},
        {"id": "expand_events", "label": "展开参与事件", "description": "显示该人物参与的所有事件"},
        {"id": "expand_locations", "label": "展开所在地点", "description": "显示该人物所在/去过的地点"},
        {"id": "ai_infer", "label": "AI 推断潜在关联", "description": "AI 分析可能存在但尚未记录的关系（先预览再入库）"},
        {"id": "find_enemies", "label": "查找敌对阵营", "description": "通过敌对关系链找到阵营对立"},
        {"id": "ai_conflict", "label": "AI 检测矛盾", "description": "AI 检测该角色设定中的逻辑矛盾"},
        {"id": "ai_backstory", "label": "AI 生成背景", "description": "AI 根据已有信息生成/扩展背景故事"},
    ],
    "location": [
        {"id": "expand_people", "label": "展开在此的人物", "description": "显示在该地点的所有人物"},
        {"id": "expand_events", "label": "展开发生的事件", "description": "显示在该地点发生的所有事件"},
        {"id": "ai_infer", "label": "AI 推断潜在关联", "description": "AI 分析该地点可能关联的实体（先预览再入库）"},
    ],
    "event": [
        {"id": "expand_participants", "label": "展开参与人物", "description": "显示参与该事件的所有人物"},
        {"id": "expand_related_events", "label": "展开关联事件", "description": "显示因果/时间关联的事件"},
        {"id": "ai_infer", "label": "AI 推断潜在关联", "description": "AI 分析该事件可能关联的实体（先预览再入库）"},
    ],
    "item": [
        {"id": "expand_holders", "label": "展开持有者", "description": "显示持有/使用该物品的人物"},
        {"id": "expand_events", "label": "展开相关事件", "description": "显示与该物品相关的事件"},
        {"id": "ai_infer", "label": "AI 推断潜在关联", "description": "AI 分析该物品可能关联的实体（先预览再入库）"},
    ],
    "faction": [
        {"id": "expand_members", "label": "展开成员", "description": "显示该阵营的所有成员"},
        {"id": "expand_allies", "label": "展开盟友阵营", "description": "显示与该阵营结盟的阵营"},
        {"id": "expand_enemies", "label": "展开敌对阵营", "description": "显示与该阵营敌对的阵营"},
        {"id": "ai_infer", "label": "AI 推断潜在关联", "description": "AI 分析该阵营可能关联的实体（先预览再入库）"},
    ],
}


async def _get_project_config(db: AsyncSession, project_id: str) -> dict:
    """Get project AI settings for configurable model/key."""
    project = await db.get(Project, project_id)
    return project.settings if project else {}


@router.get("/{entity_type}")
async def get_transforms(entity_type: str):
    transforms = TRANSFORM_REGISTRY.get(entity_type, [])
    if not transforms:
        raise HTTPException(404, f"No transforms defined for type: {entity_type}")
    return transforms


@router.post("/execute", response_model=TransformResult)
async def execute_transform(
    project_id: str,
    data: TransformRequest,
    db: AsyncSession = Depends(get_db),
):
    entity = await db.get(Entity, data.entity_id)
    if not entity or entity.project_id != project_id:
        raise HTTPException(404, "Entity not found")

    config = await _get_project_config(db, project_id)
    transform_type = data.transform_type

    # --- Graph-based transforms (no AI) ---
    if transform_type == "expand_relations":
        return await _expand_by_relation_type(db, entity, project_id, config, ["ally", "enemy", "lover", "family", "rival", "mentor", "subordinate"])
    elif transform_type == "expand_events":
        return await _expand_by_relation_type(db, entity, project_id, config, ["participated"])
    elif transform_type == "expand_locations":
        return await _expand_by_relation_type(db, entity, project_id, config, ["located_at"])
    elif transform_type == "expand_people":
        return await _expand_by_relation_type(db, entity, project_id, config, ["located_at", "member_of"])
    elif transform_type == "expand_participants":
        return await _expand_by_relation_type(db, entity, project_id, config, ["participated"])
    elif transform_type == "expand_related_events":
        return await _expand_by_relation_type(db, entity, project_id, config, ["caused", "followed_by"])
    elif transform_type == "expand_holders":
        return await _expand_by_relation_type(db, entity, project_id, config, ["holds", "owns"])
    elif transform_type == "expand_members":
        return await _expand_by_relation_type(db, entity, project_id, config, ["member_of"])
    elif transform_type == "expand_allies":
        return await _expand_by_relation_type(db, entity, project_id, config, ["ally"])
    elif transform_type == "expand_enemies":
        return await _expand_by_relation_type(db, entity, project_id, config, ["enemy"])
    elif transform_type == "find_enemies":
        return await _find_enemy_chain(db, entity, project_id, config)

    # --- AI transforms ---
    elif transform_type == "ai_infer":
        return await _ai_infer_preview(db, entity, project_id, config)
    elif transform_type == "ai_conflict":
        return await _ai_conflict(db, entity, project_id, config)
    elif transform_type == "ai_backstory":
        return await _ai_backstory(db, entity, project_id, config)

    else:
        raise HTTPException(400, f"Unknown transform: {transform_type}")


# ── Graph-based transforms ──────────────────────────────────────

async def _expand_by_relation_type(
    db: AsyncSession, entity: Entity, project_id: str, settings: dict, relation_types: list[str],
) -> TransformResult:
    hops = resolve_graph_hops(settings)
    result = graph_engine.get_neighbors(entity.id, hop=hops["transform_expand"], project_id=project_id)
    filtered_entities = []
    filtered_relations = []
    seen_entity_ids = {entity.id}

    for r in result["relations"]:
        if r.type in relation_types:
            filtered_relations.append(r)
            other_id = r.target_id if r.source_id == entity.id else r.source_id
            if other_id not in seen_entity_ids and other_id in graph_engine.entities:
                filtered_entities.append(graph_engine.entities[other_id])
                seen_entity_ids.add(other_id)

    return TransformResult(
        new_entities=filtered_entities,
        new_relations=filtered_relations,
        message=f"找到 {len(filtered_entities)} 个关联实体",
    )


async def _find_enemy_chain(
    db: AsyncSession, entity: Entity, project_id: str, settings: dict,
) -> TransformResult:
    hops = resolve_graph_hops(settings)
    result = graph_engine.get_neighbors(entity.id, hop=hops["transform_enemy"], project_id=project_id)
    enemies = set()
    for r in result["relations"]:
        if r.type == "enemy":
            enemies.add(r.target_id if r.source_id == entity.id else r.source_id)

    enemy_of_enemies = set()
    for enemy_id in enemies:
        enemy_result = graph_engine.get_neighbors(
            enemy_id, hop=hops["transform_expand"], project_id=project_id,
        )
        for r in enemy_result["relations"]:
            if r.type == "enemy":
                other_id = r.target_id if r.source_id == enemy_id else r.source_id
                if other_id != entity.id:
                    enemy_of_enemies.add(other_id)

    result_entities, seen = [], {entity.id}
    for eid in enemies | enemy_of_enemies:
        if eid in graph_engine.entities and eid not in seen:
            result_entities.append(graph_engine.entities[eid])
            seen.add(eid)

    result_relations = [r for r in result["relations"] if r.type == "enemy" and (r.source_id in seen or r.target_id in seen)]

    return TransformResult(
        new_entities=result_entities,
        new_relations=result_relations,
        message=f"找到 {len(enemies)} 个直接敌人，{len(enemy_of_enemies)} 个敌人的敌人（潜在盟友）",
    )


# ── AI transforms ───────────────────────────────────────────────

async def _ai_infer_preview(
    db: AsyncSession, entity: Entity, project_id: str, config: dict,
) -> TransformResult:
    """M2c: ai_infer returns CANDIDATES for user review — NOT auto-committed.

    Frontend shows AISuggestionReview for user to select/edit, then
    commits selected candidates via normal entity/relation create APIs.
    """
    hops = resolve_graph_hops(config)
    result = graph_engine.get_neighbors(entity.id, hop=hops["ai_context"], project_id=project_id)
    known_relations = []
    for r in result["relations"]:
        known_relations.append({
            "source_name": graph_engine.entities.get(r.source_id, Entity(name="?")).name,
            "target_name": graph_engine.entities.get(r.target_id, Entity(name="?")).name,
            "type": r.type,
            "properties": r.properties,
        })

    # Build existing entity names and relation keys for dedup
    existing_names = {e.name for e in graph_engine.get_project_entities(project_id)}
    existing_rel_keys = set()
    for r in graph_engine.get_project_relations(project_id):
        src = graph_engine.entities.get(r.source_id)
        tgt = graph_engine.entities.get(r.target_id)
        key = f"{src.name if src else r.source_id}::{r.type}::{tgt.name if tgt else r.target_id}"
        existing_rel_keys.add(key)

    ai_result = await ai_infer_relations(
        entity_name=entity.name,
        entity_type=entity.type,
        entity_props=entity.properties,
        known_relations=known_relations,
        existing_entity_names=existing_names,
        existing_relation_keys=existing_rel_keys,
        config=config,
    )

    # Return as candidates (not persisted)
    candidates = []
    for inferred in ai_result.get("inferred_relations", []):
        target_name = inferred.get("target_name", "")
        if not target_name:
            continue
        # Check if target already exists
        exists = target_name in existing_names
        candidates.append({
            "target_name": target_name,
            "target_type": inferred.get("target_type", "character"),
            "relation_type": inferred.get("relation_type", "unknown"),
            "description": inferred.get("description", ""),
            "confidence": inferred.get("confidence", 0.5),
            "exists": exists,
            "source_entity_id": entity.id,
        })

    return TransformResult(
        new_entities=[],
        new_relations=[],
        candidates=candidates,
        message=f"AI 发现 {len(candidates)} 个潜在关联（请预览后选择入库）",
    )


async def _ai_conflict(
    db: AsyncSession, entity: Entity, project_id: str, config: dict,
) -> TransformResult:
    hops = resolve_graph_hops(config)
    result = graph_engine.get_neighbors(entity.id, hop=hops["ai_context"], project_id=project_id)
    relations = []
    for r in result["relations"]:
        relations.append({
            "source_name": graph_engine.entities.get(r.source_id, Entity(name="?")).name,
            "target_name": graph_engine.entities.get(r.target_id, Entity(name="?")).name,
            "type": r.type,
            "properties": r.properties,
        })

    conflicts = await ai_detect_conflicts(
        entity_name=entity.name,
        entity_props=entity.properties,
        relations=relations,
        config=config,
    )

    return TransformResult(
        new_entities=[],
        new_relations=[],
        message=f"检测到 {len(conflicts)} 个潜在矛盾" + (
            "\n" + "\n".join(f"⚠️ {c['description']}（{c['severity']}）" for c in conflicts)
            if conflicts else "，未发现明显矛盾"
        ),
    )


async def _ai_backstory(
    db: AsyncSession, entity: Entity, project_id: str, config: dict,
) -> TransformResult:
    hops = resolve_graph_hops(config)
    result = graph_engine.get_neighbors(entity.id, hop=hops["ai_context"], project_id=project_id)
    relations = []
    for r in result["relations"]:
        relations.append({
            "source_name": graph_engine.entities.get(r.source_id, Entity(name="?")).name,
            "target_name": graph_engine.entities.get(r.target_id, Entity(name="?")).name,
            "type": r.type,
        })

    backstory = await ai_generate_backstory(
        entity_name=entity.name,
        entity_type=entity.type,
        entity_props=entity.properties,
        relations=relations,
        config=config,
    )

    entity.properties = {**entity.properties, "backstory": backstory}
    await db.commit()
    await db.refresh(entity)
    graph_engine.entities[entity.id] = entity

    return TransformResult(
        new_entities=[entity],
        new_relations=[],
        message=f"已生成背景故事（{len(backstory)}字）",
    )
