#!/usr/bin/env python3
"""Regression checks for sim engine: oracle fallback helpers (no DB required)."""
from __future__ import annotations


def _verdict_has_substance(verdict: dict) -> bool:
    return bool(verdict.get("mutations")) or bool(verdict.get("events")) or bool(verdict.get("new_entities"))


def _mechanical_oracle_fallback(scenes: list[dict]) -> dict:
    mutations: list[dict] = []
    seen_pairs: set[frozenset] = set()
    for s in scenes:
        names = s.get("participants") or []
        if len(names) >= 2:
            key = frozenset(names[:2])
            if key not in seen_pairs:
                seen_pairs.add(key)
                mutations.append({
                    "op": "update_relation",
                    "source": names[0], "target": names[1],
                    "weight_delta": 0.05,
                })
        for it in s.get("intents") or []:
            actor = (it.get("actor") or "").strip()
            summary = (it.get("summary") or "").strip()
            if actor and summary:
                mutations.append({
                    "op": "update_entity",
                    "entity": actor,
                    "properties": {"goal": summary[:240]},
                })
    return {"mutations": mutations, "new_entities": [], "events": []}


def test_verdict_has_substance():
    assert not _verdict_has_substance({})
    assert _verdict_has_substance({"mutations": [{"op": "update_entity"}]})
    assert _verdict_has_substance({"events": [{"name": "x"}]})


def test_mechanical_fallback():
    scenes = [{
        "participants": ["甲", "乙"],
        "intents": [{"actor": "甲", "summary": "想拉拢乙"}],
        "narrative": "甲乙交谈",
    }]
    out = _mechanical_oracle_fallback(scenes)
    assert out["mutations"]
    assert any(m["op"] == "update_relation" for m in out["mutations"])
    assert any(m["op"] == "update_entity" for m in out["mutations"])


def main() -> int:
    test_verdict_has_substance()
    test_mechanical_fallback()
    print("OK sim_engine_regression_test")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
