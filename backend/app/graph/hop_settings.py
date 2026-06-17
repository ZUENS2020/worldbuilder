"""Per-project graph hop (BFS depth) configuration.

Stored in Project.settings.graph_hops. All values are clamped to [MIN_HOP, MAX_HOP].
"""

from typing import TypedDict

MIN_HOP = 1
MAX_HOP = 5

_LEGACY_WRITING_CONTEXT = "writing_context"


class GraphHopSettings(TypedDict):
    transform_expand: int   # Transform 图谱展开（直接关系查询范围）
    transform_enemy: int    # 「查找敌对阵营」搜索深度
    ai_context: int       # AI 推断 / 矛盾检测 / 背景生成 的关系上下文
    context_injection: int  # ST 插件 / 外部对话上下文注入
    isolate_subgraph: int # 探索模式「只看子图」深度


DEFAULT_GRAPH_HOPS: GraphHopSettings = {
    "transform_expand": 1,
    "transform_enemy": 2,
    "ai_context": 1,
    "context_injection": 2,
    "isolate_subgraph": 2,
}


def _clamp_hop(value: object, default: int) -> int:
    try:
        n = int(value)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return default
    return max(MIN_HOP, min(MAX_HOP, n))


def resolve_graph_hops(project_settings: dict | None) -> GraphHopSettings:
    """Merge project.settings.graph_hops with defaults."""
    merged: dict[str, int] = dict(DEFAULT_GRAPH_HOPS)
    raw = (project_settings or {}).get("graph_hops")
    if isinstance(raw, dict):
        if _LEGACY_WRITING_CONTEXT in raw and "context_injection" not in raw:
            raw = {**raw, "context_injection": raw[_LEGACY_WRITING_CONTEXT]}
        for key in DEFAULT_GRAPH_HOPS:
            if key in raw:
                merged[key] = _clamp_hop(raw[key], merged[key])
    return merged  # type: ignore[return-value]
