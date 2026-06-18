"""Visibility model — information asymmetry / fog of war (plan decision 8).

Two layers, both stored as meta-fields inside ``Entity.properties`` (and skipped
from normal rendering via ``engine._SKIP_PROP_KEYS``):

- Entity-level ``_visibility``:
    {"mode": "public" | "groups" | "predicate",
     "groups": [factionId | tagId, ...],          # for mode == "groups"
     "predicate": {"key": str, "op": str, "value": any}}  # for mode == "predicate"
  An entity that is not visible to an observer is one the observer does not even
  know exists.

- Property-level ``_prop_visibility``:
    {"<key>": {"level": "public" | "private" | "entities",
               "entities": [entityId, ...]}}      # for level == "entities"
  Controls which individual properties an observer may read.

``observer_id = None`` means the omniscient (author / Oracle) view: everything is
visible. ``observer_id = A`` filters by what A is allowed to see.

Group membership = faction membership (``member_of`` relation pointing at the
faction entity) OR tag membership (the tag's ``entityIds`` contains the observer).
Tags live in ``Project.settings`` so they are not known to the in-memory graph;
callers may pass a ``tag_members`` map ``{group_id: set(entity_ids)}`` to fold
tag-based groups in. Faction membership works from the graph alone.

A relation is visible to an observer iff BOTH endpoints are visible.
"""

from typing import Optional

VIS_KEY = "_visibility"
PROP_VIS_KEY = "_prop_visibility"

# Meta-keys that must never surface as ordinary properties.
VISIBILITY_META_KEYS = {VIS_KEY, PROP_VIS_KEY}


def _vis_meta(entity) -> dict:
    return (entity.properties or {}).get(VIS_KEY) or {}


def _prop_vis_meta(entity) -> dict:
    return (entity.properties or {}).get(PROP_VIS_KEY) or {}


def belongs_to_group(observer_id: str, group_id: str, graph, tag_members: Optional[dict] = None) -> bool:
    """True if observer is a member of the group (faction member_of OR tag)."""
    if not observer_id or not group_id:
        return False
    # Faction membership: observer --[member_of]--> faction(group_id)
    for rel in graph.adjacency.get(observer_id, []):
        if rel.type == "member_of" and rel.source_id == observer_id and rel.target_id == group_id:
            return True
    # Tag membership (supplied by caller, since tags live in project settings).
    if tag_members and observer_id in tag_members.get(group_id, ()):
        return True
    return False


def _eval_predicate(observer, predicate: dict, graph) -> bool:
    """Evaluate a {key, op, value} predicate against the observer's properties."""
    if not observer or not predicate:
        return False
    key = predicate.get("key")
    op = (predicate.get("op") or "eq").lower()
    value = predicate.get("value")
    actual = (observer.properties or {}).get(key)
    if op in ("exists", "has"):
        return actual not in (None, "", [], {})
    if actual is None:
        return False
    if op == "eq":
        return str(actual) == str(value)
    if op == "ne":
        return str(actual) != str(value)
    if op == "contains":
        if isinstance(actual, (list, tuple)):
            return value in actual or str(value) in [str(x) for x in actual]
        return str(value) in str(actual)
    if op in ("gt", "lt", "gte", "lte"):
        try:
            a, b = float(actual), float(value)
        except (TypeError, ValueError):
            return False
        return {"gt": a > b, "lt": a < b, "gte": a >= b, "lte": a <= b}[op]
    return False


def entity_visible_to(entity, observer_id: Optional[str], graph, tag_members: Optional[dict] = None) -> bool:
    """Whether the observer is aware that ``entity`` exists at all."""
    if observer_id is None:            # omniscient view
        return True
    if entity.id == observer_id:       # always sees self
        return True
    meta = _vis_meta(entity)
    mode = meta.get("mode", "public")
    if mode == "public":
        return True
    if mode == "groups":
        groups = meta.get("groups") or []
        return any(belongs_to_group(observer_id, g, graph, tag_members) for g in groups)
    if mode == "predicate":
        observer = graph.entities.get(observer_id)
        return _eval_predicate(observer, meta.get("predicate") or {}, graph)
    return True


def property_visible_to(entity, key: str, observer_id: Optional[str], graph) -> bool:
    """Whether the observer may read property ``key`` on ``entity``."""
    if observer_id is None:            # omniscient
        return True
    if entity.id == observer_id:       # always reads own properties
        return True
    rule = _prop_vis_meta(entity).get(key)
    if not rule:
        return True                    # default public
    level = rule.get("level", "public")
    if level == "public":
        return True
    if level == "private":
        return False
    if level == "entities":
        return observer_id in (rule.get("entities") or [])
    return True


def filter_properties(entity, observer_id: Optional[str], graph) -> dict:
    """Return the entity's properties as seen by the observer (meta-keys stripped)."""
    props = entity.properties or {}
    out = {}
    for key, value in props.items():
        if key in VISIBILITY_META_KEYS:
            continue
        if property_visible_to(entity, key, observer_id, graph):
            out[key] = value
    return out


def view(entity, observer_id: Optional[str], graph, tag_members: Optional[dict] = None) -> Optional[dict]:
    """Observer's view of an entity, or None if the entity is invisible to them."""
    if not entity_visible_to(entity, observer_id, graph, tag_members):
        return None
    return {
        "id": entity.id,
        "name": entity.name,
        "type": entity.type,
        "properties": filter_properties(entity, observer_id, graph),
    }


def relation_visible_to(relation, observer_id: Optional[str], graph, tag_members: Optional[dict] = None) -> bool:
    """A relation is visible iff both of its endpoints are visible to the observer."""
    if observer_id is None:
        return True
    src = graph.entities.get(relation.source_id)
    tgt = graph.entities.get(relation.target_id)
    if not src or not tgt:
        return False
    return (entity_visible_to(src, observer_id, graph, tag_members)
            and entity_visible_to(tgt, observer_id, graph, tag_members))
