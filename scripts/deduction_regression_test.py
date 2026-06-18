#!/usr/bin/env python3
"""Regression checks for the 推演 (causal forward-deduction) engine.

Validates the pure ripeness / resolution-selection logic that decides WHEN a
pending event resolves — without needing a DB or live LLM.

Run: cd scripts && python3 deduction_regression_test.py
"""
from __future__ import annotations

import asyncio
import os
import sys

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "backend")))
from app.services.simulation import (  # noqa: E402
    _pending_is_ripe,
    _pending_sequence_gate,
    _oracle_ripe_allowed,
    _mechanical_resolve_fallback,
    _scan_goal_conflicts,
    _event_sim_meta,
    _norm_name,
    _register_pending_events,
)
from app.graph.engine import graph_engine  # noqa: E402
from app.models.models import Entity, Relation  # noqa: E402


class _FakeEvent:
    def __init__(self, name: str, properties: dict):
        self.name = name
        self.properties = properties


def test_ripe_by_oracle_signal():
    """Sim-registered events without due_tick can ripen via Oracle signal."""
    e = _FakeEvent("学生会选举", {"status": "pending", "_sim": {"registered_tick": 1}})
    assert _pending_is_ripe(e, tick=3, ripe_names={"学生会选举"}, max_age=8)
    assert not _pending_is_ripe(e, tick=3, ripe_names=set(), max_age=8)


def test_oracle_ripe_blocked_before_due():
    """Preset with due_tick: Oracle cannot ripe before deadline."""
    e = _FakeEvent("真遗嘱浮现", {"status": "pending", "due_tick": 10})
    assert not _oracle_ripe_allowed(e, tick=1)
    assert not _pending_is_ripe(e, tick=1, ripe_names={"真遗嘱浮现"}, max_age=0)
    assert _pending_is_ripe(e, tick=10, ripe_names=set(), max_age=0)


def test_ripe_by_due_tick():
    e = _FakeEvent("选票舞弊疑云", {"status": "pending", "due_tick": 7})
    assert not _pending_is_ripe(e, tick=6, ripe_names=set(), max_age=0)
    assert _pending_is_ripe(e, tick=7, ripe_names=set(), max_age=0)
    assert _pending_is_ripe(e, tick=9, ripe_names=set(), max_age=0)


def test_ripe_by_max_age():
    e = _FakeEvent("旧账", {"status": "pending", "_sim": {"registered_tick": 2}})
    assert not _pending_is_ripe(e, tick=6, ripe_names=set(), max_age=8)
    assert _pending_is_ripe(e, tick=10, ripe_names=set(), max_age=8)
    assert not _pending_is_ripe(e, tick=100, ripe_names=set(), max_age=0)


def test_sequence_order_gate():
  pending = [
      _FakeEvent("遗嘱宣读", {"status": "pending", "sequence_order": 1}),
      _FakeEvent("真遗嘱浮现", {"status": "pending", "sequence_order": 2}),
      _FakeEvent("后门开启", {"status": "pending"}),
  ]
  allowed = _pending_sequence_gate(pending)
  assert allowed == {"遗嘱宣读", "后门开启"}
  assert "真遗嘱浮现" not in allowed


def test_autonomous_no_sequence_gate():
    pending = [
        _FakeEvent("学生会选举", {"status": "pending", "_sim": {"registered_tick": 1}}),
        _FakeEvent("旧仓库行动", {"status": "pending", "_sim": {"registered_tick": 2}}),
    ]
    assert _pending_sequence_gate(pending) == {"学生会选举", "旧仓库行动"}


def test_mechanical_resolve_fallback():
    e = _FakeEvent("遗嘱宣读", {"status": "pending", "stakes": "继承归属", "due_tick": 6})
    res = _mechanical_resolve_fallback(e, "world", tick=6)
    assert res.get("outcome")
    assert "遗嘱宣读" in res["outcome"]


def test_scan_goal_conflicts():
    pid = "__test_goals__"
    for eid in list(graph_engine.project_entities.get(pid, set())):
        graph_engine.remove_entity(eid)
    a = Entity(id="ga", name="甲", type="character",
               properties={"goal": "夺下主席席位"}, project_id=pid)
    b = Entity(id="gb", name="乙", type="character",
               properties={"goal": "阻止甲上位"}, project_id=pid)
    graph_engine.add_entity(a)
    graph_engine.add_entity(b)
    rel = Relation(id="r1", source_id="ga", target_id="gb", type="enemy",
                   weight=0.3, properties={}, project_id=pid)
    graph_engine.add_relation(rel)
    out = _scan_goal_conflicts(pid)
    assert out and out[0].get("participants") == ["甲", "乙"]
    for eid in list(graph_engine.project_entities.get(pid, set())):
        graph_engine.remove_entity(eid)


def test_preset_event_has_no_owner():
    e = _FakeEvent("明日学生会选举", {"status": "pending", "due_tick": 9})
    assert _event_sim_meta(e) == {}
    assert _pending_is_ripe(e, tick=9, ripe_names=set(), max_age=8)


def test_norm_name_folds_width():
    assert _norm_name("天皇赏（春）·王者对决") == _norm_name("天皇赏(春)·王者对决")


class _FakeDB:
    def __init__(self, by_id: dict):
        self._by_id = by_id

    def add(self, obj):
        oid = getattr(obj, "id", None)
        if oid:
            self._by_id[oid] = obj

    async def flush(self):
        pass

    async def get(self, _model, oid):
        return self._by_id.get(oid)


class _FakeSim:
    def __init__(self, sid: str, pid: str):
        self.id = sid
        self.project_id = pid


def _reset_graph_for(pid: str):
    for eid in list(graph_engine.project_entities.get(pid, set())):
        graph_engine.remove_entity(eid)


def test_promote_dormant_event_in_place():
    pid = "__test_promote__"
    _reset_graph_for(pid)
    dormant = Entity(id="ev1", name="天皇赏(春)·王者对决", type="event",
                     properties={"description": "下月长距离决战", "time": "下月"},
                     project_id=pid)
    a = Entity(id="c1", name="特别周", type="character", properties={}, project_id=pid)
    b = Entity(id="c2", name="东海帝王", type="character", properties={}, project_id=pid)
    for e in (dormant, a, b):
        graph_engine.add_entity(e)
    db = _FakeDB({"ev1": dormant, "c1": a, "c2": b})
    sim = _FakeSim("simX", pid)
    regs = [{"name": "天皇赏（春）·王者对决", "stakes": "谁是长距离王者",
             "participants": ["特别周", "东海帝王"], "due_tick": 5}]
    applied = asyncio.run(_register_pending_events(db, sim, regs, tick=2))
    events = [graph_engine.entities[eid] for eid in graph_engine.project_entities[pid]
              if graph_engine.entities[eid].type == "event"]
    assert len(events) == 1
    assert dormant.properties["status"] == "pending"
    assert applied and applied[0].get("promoted") is True
    _reset_graph_for(pid)


def main() -> int:
    test_ripe_by_oracle_signal()
    test_oracle_ripe_blocked_before_due()
    test_ripe_by_due_tick()
    test_ripe_by_max_age()
    test_sequence_order_gate()
    test_autonomous_no_sequence_gate()
    test_mechanical_resolve_fallback()
    test_scan_goal_conflicts()
    test_preset_event_has_no_owner()
    test_norm_name_folds_width()
    test_promote_dormant_event_in_place()
    print("OK deduction_regression_test")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
