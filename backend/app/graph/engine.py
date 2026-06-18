"""In-memory graph engine with adjacency list and 2-hop BFS queries.

SQLite is the source of truth for persistence. This engine loads the graph
into memory at startup and provides fast graph traversal queries.
Writes are dual-written (SQLite + memory).
"""

from collections import defaultdict, deque
from typing import Optional
from app.models.models import Entity, Relation
from app.graph import visibility, worldbook


# ── Display-label maps (mirror frontend types/index.ts) ─────────
ENTITY_TYPE_LABELS = {
    "character": "人物",
    "location": "地点",
    "event": "事件",
    "item": "物品",
    "faction": "阵营",
}

RELATION_TYPE_LABELS = {
    "ally": "盟友", "enemy": "敌对", "lover": "恋人", "family": "家族",
    "rival": "对手", "mentor": "师徒", "subordinate": "从属", "member_of": "属于",
    "located_at": "位于", "participated": "参与", "caused": "导致",
    "followed_by": "随后", "holds": "持有", "owns": "拥有",
}

# Known property keys → Chinese display labels. Unknown keys are shown as-is.
PROPERTY_KEY_LABELS = {
    "personality": "性格", "goal": "目标", "description": "描述", "desc": "描述",
    "time": "时间", "date": "日期", "location": "地点", "running_style": "跑法",
    "va": "声优", "height": "身高", "age": "年龄", "gender": "性别",
    "appearance": "外貌", "background": "背景", "occupation": "职业",
    "alias": "别名", "title": "称号", "origin": "出身", "ability": "能力",
    "weakness": "弱点", "motto": "口头禅", "outfit": "服装", "weapon": "武器",
}
# Property keys that are redundant with the entity name / internal — skip.
# Includes visibility meta-fields (_visibility, _prop_visibility) from visibility.py.
_SKIP_PROP_KEYS = {"label", "name", "_property_order", "_sim"} | visibility.VISIBILITY_META_KEYS


def _format_props(props: dict) -> list[str]:
    """Render an entity's properties as ['性格: ...', '目标: ...'] lines."""
    lines = []
    for key, value in (props or {}).items():
        if key in _SKIP_PROP_KEYS or value in (None, "", [], {}):
            continue
        label = PROPERTY_KEY_LABELS.get(key, key)
        if isinstance(value, (list, tuple)):
            value = "、".join(str(v) for v in value)
        lines.append(f"  {label}: {value}")
    return lines


class GraphEngine:
    def __init__(self):
        # entity_id -> Entity
        self.entities: dict[str, Entity] = {}
        # entity_id -> list of Relation (where entity is source OR target)
        self.adjacency: dict[str, list[Relation]] = defaultdict(list)
        # project_id -> set of entity_ids
        self.project_entities: dict[str, set[str]] = defaultdict(set)
        # project_id -> set of relation_ids
        self.project_relations: dict[str, set[str]] = defaultdict(set)

    def load_entities(self, entities: list[Entity]):
        """Load entities from DB into memory."""
        for e in entities:
            self.entities[e.id] = e
            self.project_entities[e.project_id].add(e.id)

    def load_relations(self, relations: list[Relation]):
        """Load relations from DB into memory."""
        for r in relations:
            self._add_relation_to_index(r)

    def add_entity(self, entity: Entity):
        """Add entity to memory index."""
        self.entities[entity.id] = entity
        self.project_entities[entity.project_id].add(entity.id)

    def remove_entity(self, entity_id: str):
        """Remove entity and all its relations from memory."""
        entity = self.entities.pop(entity_id, None)
        if entity:
            self.project_entities[entity.project_id].discard(entity_id)
        # Remove all relations involving this entity
        rels_to_remove = []
        for rid in list(self.adjacency.get(entity_id, [])):
            rels_to_remove.append(rid)
        # Also check reverse
        for eid, rels in self.adjacency.items():
            for r in rels:
                if r.target_id == entity_id or r.source_id == entity_id:
                    rels_to_remove.append(r)
        for r in rels_to_remove:
            self.remove_relation(r.id)

    def add_relation(self, relation: Relation):
        """Add relation to memory index."""
        self._add_relation_to_index(relation)

    def remove_relation(self, relation_id: str):
        """Remove relation from memory index."""
        for eid in list(self.adjacency.keys()):
            self.adjacency[eid] = [
                r for r in self.adjacency[eid] if r.id != relation_id
            ]
        # Also clean from project index
        for pid in self.project_relations:
            self.project_relations[pid].discard(relation_id)

    def _add_relation_to_index(self, r: Relation):
        """Index a relation bidirectionally."""
        self.adjacency[r.source_id].append(r)
        self.adjacency[r.target_id].append(r)
        self.project_relations[r.project_id].add(r.id)

    def get_neighbors(self, entity_id: str, hop: int = 2, project_id: str = None) -> dict:
        """BFS traversal returning neighbors within N hops.

        Returns: {
            "entities": [EntityOut...],
            "relations": [RelationOut...],
            "hop_map": {entity_id: hop_number}
        }
        """
        if entity_id not in self.entities:
            return {"entities": [], "relations": [], "hop_map": {}}

        visited = {entity_id: 0}
        visited_relations = {}
        queue = deque([(entity_id, 0)])

        while queue:
            current_id, current_hop = queue.popleft()
            if current_hop >= hop:
                continue

            for rel in self.adjacency.get(current_id, []):
                # Filter by project if specified
                if project_id and rel.project_id != project_id:
                    continue

                visited_relations[rel.id] = rel

                # Determine the neighbor
                neighbor_id = rel.target_id if rel.source_id == current_id else rel.source_id

                if neighbor_id not in visited:
                    visited[neighbor_id] = current_hop + 1
                    queue.append((neighbor_id, current_hop + 1))

        # Build results
        result_entities = []
        for eid, h in visited.items():
            if eid in self.entities:
                result_entities.append(self.entities[eid])

        result_relations = list(visited_relations.values())

        return {
            "entities": result_entities,
            "relations": result_relations,
            "hop_map": visited,
        }

    def _entity_oneliner(self, entity: Entity, observer_id: Optional[str] = None) -> str:
        """One-line summary for a neighbor (description or personality, truncated).

        When ``observer_id`` is given, the blurb is drawn only from properties
        that observer is allowed to read (visibility model).
        """
        props = (
            visibility.filter_properties(entity, observer_id, self)
            if observer_id is not None else (entity.properties or {})
        )
        blurb = props.get("description") or props.get("desc") or props.get("personality") or ""
        if isinstance(blurb, (list, tuple)):
            blurb = "、".join(str(v) for v in blurb)
        blurb = str(blurb).replace("\n", " ").strip()
        if len(blurb) > 40:
            blurb = blurb[:40] + "…"
        type_label = ENTITY_TYPE_LABELS.get(entity.type, entity.type)
        return f"{entity.name}（{type_label}）" + (f"：{blurb}" if blurb else "")

    def get_context(
        self,
        entity_ids: list[str],
        project_id: str,
        scene: str = None,
        *,
        context_hop: int = 2,
        observer_id: Optional[str] = None,
        tag_members: Optional[dict] = None,
        world_entries: Optional[list] = None,
        worldbook_budget: int = 1200,
    ) -> dict:
        """Build rich world-context text for LLM injection.

        For each *selected* entity, emit a block with its full properties and
        the relation network around it (selected ↔ selected, and N-hop
        neighbors). Neighbors are listed as name + one-line blurb only, to keep
        the prompt focused. Returns {system_injection, active_warnings, token_count}.

        ``observer_id=None`` builds the omniscient (author/Oracle) context.
        ``observer_id=A`` filters every section through the visibility model:
        entities A cannot see are omitted, and per-property visibility is applied
        (see app/graph/visibility.py). ``tag_members`` optionally supplies
        tag-based group membership ({group_id: set(entity_ids)}).
        """
        hop = max(1, min(5, int(context_hop)))
        selected = [eid for eid in entity_ids if eid in self.entities]
        selected_set = set(selected)
        warnings = []

        def _visible(eid: str) -> bool:
            ent = self.entities.get(eid)
            return bool(ent) and visibility.entity_visible_to(ent, observer_id, self, tag_members)

        # Gather all relations touching the selected entities (within project).
        rels_by_id = {}
        neighbor_ids = set()
        for eid in selected:
            if not _visible(eid):
                continue
            result = self.get_neighbors(eid, hop=hop, project_id=project_id)
            for r in result["relations"]:
                if visibility.relation_visible_to(r, observer_id, self, tag_members):
                    rels_by_id[r.id] = r
            for nid, h in result["hop_map"].items():
                if nid not in selected_set and _visible(nid):
                    neighbor_ids.add(nid)

        lines = []

        # ── Section 0: World Book (graph-anchored lore, P3) ──
        if world_entries:
            in_scene = {eid for eid in selected if _visible(eid)} | neighbor_ids
            wb = worldbook.build_injection(
                world_entries, in_scene,
                observer_id=observer_id, token_budget=worldbook_budget,
            )
            if wb:
                lines.append(wb)
                lines.append("")

        # ── Section 1: selected entities with (visibility-filtered) properties ──
        for eid in selected:
            entity = self.entities[eid]
            if not _visible(eid):
                continue
            type_label = ENTITY_TYPE_LABELS.get(entity.type, entity.type)
            lines.append(f"【{entity.name}（{type_label}）】")
            props = visibility.filter_properties(entity, observer_id, self)
            prop_lines = _format_props(props)
            if prop_lines:
                lines.extend(prop_lines)
            lines.append("")  # blank line between blocks

        # ── Section 2: relation network ──
        rel_lines = []
        for rel in rels_by_id.values():
            src = self.entities.get(rel.source_id)
            tgt = self.entities.get(rel.target_id)
            if not src or not tgt:
                continue
            # Only show relations that touch at least one selected entity.
            if rel.source_id not in selected_set and rel.target_id not in selected_set:
                continue
            rel_label = RELATION_TYPE_LABELS.get(rel.type, rel.type)
            desc = (rel.properties or {}).get("description", "")
            line = f"{src.name} --[{rel_label}]--> {tgt.name}"
            if desc:
                line += f"（{desc}）"
            rel_lines.append(line)

            if rel.type in ("enemy", "rival") and rel.weight > 0.7:
                warnings.append(
                    f"{src.name}与{tgt.name}当前关系：{rel_label}（强度{rel.weight:.0%}）"
                )
        if rel_lines:
            lines.append("【关系网】")
            lines.extend(rel_lines)
            lines.append("")

        # ── Section 3: related neighbors (name + blurb only) ──
        neighbor_lines = [
            self._entity_oneliner(self.entities[nid], observer_id=observer_id)
            for nid in neighbor_ids if nid in self.entities
        ]
        if neighbor_lines:
            lines.append("【相关角色/事物】")
            lines.extend(neighbor_lines)

        system_injection = "\n".join(lines).strip()

        return {
            "system_injection": system_injection,
            "active_warnings": warnings,
            "token_count": len(system_injection) // 2,  # rough estimate
        }

    def detect_conflicts(self, entity_id: str) -> list[dict]:
        """Detect logical contradictions in an entity's relationships.

        E.g., A says they hate B (enemy relation) but also has a 'helped' event.
        """
        conflicts = []
        entity = self.entities.get(entity_id)
        if not entity:
            return conflicts

        entity_rels = self.adjacency.get(entity_id, [])

        # Group relations by target
        target_relations = defaultdict(list)
        for r in entity_rels:
            other_id = r.target_id if r.source_id == entity_id else r.source_id
            target_relations[other_id].append(r)

        # Check for contradictory relation types
        contradiction_pairs = {
            ("enemy", "ally"), ("enemy", "lover"), ("enemy", "family"),
            ("rival", "ally"), ("rival", "lover"),
        }

        for other_id, rels in target_relations.items():
            rel_types = {r.type for r in rels}
            for a, b in contradiction_pairs:
                if a in rel_types and b in rel_types:
                    other = self.entities.get(other_id)
                    other_name = other.name if other else other_id
                    conflicts.append({
                        "type": "contradictory_relations",
                        "entity_id": entity_id,
                        "other_id": other_id,
                        "message": f"{entity.name}与{other_name}同时存在'{a}'和'{b}'关系",
                        "severity": "high",
                    })

        # Check for contradictory properties
        props = entity.properties or {}
        personality = props.get("personality", "")
        if personality:
            for other_id, rels in target_relations.items():
                for r in rels:
                    if r.type == "enemy" and "善良" in personality:
                        other = self.entities.get(other_id)
                        other_name = other.name if other else other_id
                        conflicts.append({
                            "type": "personality_conflict",
                            "entity_id": entity_id,
                            "other_id": other_id,
                            "message": f"{entity.name}性格标记'善良'，但与{other_name}为敌对关系",
                            "severity": "medium",
                        })
                        break

        return conflicts

    def get_project_entities(self, project_id: str) -> list[Entity]:
        """Get all entities for a project."""
        eids = self.project_entities.get(project_id, set())
        return [self.entities[eid] for eid in eids if eid in self.entities]

    def get_project_relations(self, project_id: str) -> list[Relation]:
        """Get all relations for a project (deduplicated)."""
        rids = self.project_relations.get(project_id, set())
        seen = set()
        result = []
        for eid in self.project_entities.get(project_id, set()):
            for r in self.adjacency.get(eid, []):
                if r.id not in seen:
                    seen.add(r.id)
                    result.append(r)
        return result


# Global singleton
graph_engine = GraphEngine()
