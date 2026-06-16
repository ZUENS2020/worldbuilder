"""In-memory graph engine with adjacency list and 2-hop BFS queries.

SQLite is the source of truth for persistence. This engine loads the graph
into memory at startup and provides fast graph traversal queries.
Writes are dual-written (SQLite + memory).
"""

from collections import defaultdict, deque
from typing import Optional
from app.models.models import Entity, Relation


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

    def get_context(self, entity_ids: list[str], project_id: str, scene: str = None) -> dict:
        """Build context for ST plugin injection.

        For each entity, get 2-hop neighbors and build a text summary
        of relationships and active warnings.
        """
        all_entities = {}
        all_relations = {}
        warnings = []

        for eid in entity_ids:
            result = self.get_neighbors(eid, hop=2, project_id=project_id)
            for e in result["entities"]:
                all_entities[e.id] = e
            for r in result["relations"]:
                all_relations[r.id] = r

        # Build system injection text
        lines = []
        for eid in entity_ids:
            entity = self.entities.get(eid)
            if not entity:
                continue

            entity_rels = [r for r in all_relations.values()
                           if r.source_id == eid or r.target_id == eid]

            if entity.type == "character":
                lines.append(f"【{entity.name}】")
                # Group relations by type
                for rel in entity_rels:
                    other_id = rel.target_id if rel.source_id == eid else rel.source_id
                    other = self.entities.get(other_id)
                    if other:
                        direction = "→" if rel.source_id == eid else "←"
                        desc = rel.properties.get("description", "")
                        lines.append(f"  {direction} {rel.type}: {other.name}" +
                                     (f" ({desc})" if desc else ""))

                        # Detect potential conflicts
                        if rel.type in ("enemy", "rival") and rel.weight > 0.7:
                            warnings.append(f"{entity.name}与{other.name}当前关系：{rel.type}（强度{rel.weight:.0%}）")

            elif entity.type == "location":
                lines.append(f"【地点：{entity.name}】")
                people_here = [self.entities[r.source_id if r.target_id == eid else r.target_id]
                               for r in entity_rels if r.type == "located_at"]
                for p in people_here:
                    if p:
                        lines.append(f"  在场：{p.name}")

        system_injection = "\n".join(lines)

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
