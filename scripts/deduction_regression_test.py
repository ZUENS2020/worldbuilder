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
    _event_dedupe_corpus,
    _norm_name,
    _register_pending_events,
    _tick_made_progress,
    _TENSION_FLOOR,
    _SETTLED_GOAL_PREFIX,
)
from app.services.memory import _score_memories, _top_k_ids  # noqa: E402
from app.graph.engine import graph_engine  # noqa: E402
from app.models.models import Entity, Relation  # noqa: E402


class _FakeMem:
    """Lightweight stand-in for an AgentMemory row (retrieval is a pure function
    over .id / .tick / .salience / .content / .participants)."""
    def __init__(self, mid, tick, salience, content, participants=None):
        self.id = mid
        self.tick = tick
        self.salience = salience
        self.content = content
        self.participants = participants or []


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
    # Live tension (weight above floor) → a candidate is surfaced.
    rel = Relation(id="r1", source_id="ga", target_id="gb", type="enemy",
                   weight=0.7, properties={}, project_id=pid)
    graph_engine.add_relation(rel)
    out = _scan_goal_conflicts(pid)
    assert out and out[0].get("participants") == ["甲", "乙"]
    for eid in list(graph_engine.project_entities.get(pid, set())):
        graph_engine.remove_entity(eid)


def test_scan_goal_conflicts_below_floor():
    """A grudge that has cooled below the tension floor no longer seeds conflict."""
    pid = "__test_goals_floor__"
    for eid in list(graph_engine.project_entities.get(pid, set())):
        graph_engine.remove_entity(eid)
    a = Entity(id="fa", name="甲", type="character",
               properties={"goal": "夺下主席席位"}, project_id=pid)
    b = Entity(id="fb", name="乙", type="character",
               properties={"goal": "阻止甲上位"}, project_id=pid)
    graph_engine.add_entity(a)
    graph_engine.add_entity(b)
    rel = Relation(id="rf", source_id="fa", target_id="fb", type="enemy",
                   weight=_TENSION_FLOOR - 0.1, properties={}, project_id=pid)
    graph_engine.add_relation(rel)
    assert _scan_goal_conflicts(pid) == []
    for eid in list(graph_engine.project_entities.get(pid, set())):
        graph_engine.remove_entity(eid)


def test_settled_goal_not_reseeded():
    """A participant whose goal is已了结 (achieved/defeated) is skipped — winners
    don't keep fighting fights they've already won."""
    pid = "__test_goals_settled__"
    for eid in list(graph_engine.project_entities.get(pid, set())):
        graph_engine.remove_entity(eid)
    a = Entity(id="sa", name="甲", type="character",
               properties={"goal": f"{_SETTLED_GOAL_PREFIX}夺下主席席位",
                           "goal_status": "achieved"}, project_id=pid)
    b = Entity(id="sb", name="乙", type="character",
               properties={"goal": "阻止甲上位"}, project_id=pid)
    graph_engine.add_entity(a)
    graph_engine.add_entity(b)
    rel = Relation(id="rs", source_id="sa", target_id="sb", type="enemy",
                   weight=0.8, properties={}, project_id=pid)
    graph_engine.add_relation(rel)
    assert _scan_goal_conflicts(pid) == []
    for eid in list(graph_engine.project_entities.get(pid, set())):
        graph_engine.remove_entity(eid)


def test_progress_detection():
    """Real advance → progress; mere busywork (mood swing, belief sync, jitter) → not."""
    # No-progress ticks
    assert not _tick_made_progress([])
    assert not _tick_made_progress([
        {"op": "update_entity", "entity": "甲", "properties": {"mood": "焦虑"}},
    ])
    assert not _tick_made_progress([
        {"op": "update_relation", "source": "甲", "target": "乙", "weight": 0.52,
         "weight_delta": 0.02},
    ])
    # weight delta exactly at the floor is jitter, not progress.
    assert not _tick_made_progress([
        {"op": "update_relation", "source": "甲", "target": "乙", "weight": 0.55,
         "weight_delta": 0.05},
    ])
    # Goal *text* churn (belief layer re-deriving the same maneuver) is the
    # spinning signature — must NOT count as progress.
    assert not _tick_made_progress([
        {"op": "update_entity", "entity": "甲",
         "properties": {"goal": "从乙口中套取路线，夺回信纸"}},
        {"op": "update_entity", "entity": "乙",
         "properties": {"goal": "蒙混过关，记住信纸特征"}},
        {"op": "update_relation", "source": "甲", "target": "乙", "weight": 0.4,
         "weight_delta": 0.05},
    ])
    # Progress ticks
    assert _tick_made_progress([
        {"op": "resolve_event", "name": "遗嘱宣读", "tick": 6, "outcome": "x"},
    ])
    assert _tick_made_progress([
        {"op": "create_event", "name": "警方登岛", "tick": 7},
    ])
    assert _tick_made_progress([
        {"op": "register_pending_event", "name": "新博弈"},
    ])
    assert _tick_made_progress([
        {"op": "update_relation", "source": "甲", "target": "乙", "weight": 0.3,
         "weight_delta": -0.25},
    ])
    assert _tick_made_progress([
        {"op": "update_entity", "entity": "甲", "properties": {"status": "失势"}},
    ])


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


def test_event_dedupe_corpus_orders_by_tick():
    pid = "dedupe-corpus-test"
    _reset_graph_for(pid)
    old = Entity(
        id="ev-old", name="旧案", type="event", project_id=pid,
        properties={"status": "resolved", "description": "a",
                    "_sim": {"sim_id": "s1", "tick": 2, "resolved_tick": 2}},
    )
    new = Entity(
        id="ev-new", name="新悬", type="event", project_id=pid,
        properties={"status": "pending", "stakes": "b",
                    "_sim": {"sim_id": "s1", "registered_tick": 9}},
    )
    for e in (old, new):
        graph_engine.add_entity(e)
    corpus = _event_dedupe_corpus(pid, "s1", limit=10)
    assert len(corpus) == 2
    assert corpus[0]["name"] == "新悬"
    assert corpus[1]["name"] == "旧案"
    _reset_graph_for(pid)


def test_relevant_old_beats_irrelevant_recent():
    """A久远 memory mentioning the focal partner outranks the latest闲聊 that
    doesn't — recency alone would have buried it."""
    # Chronological order (oldest first), as get_memory_block loads them.
    episodics = [
        _FakeMem("old_rel", tick=1, salience=0.5, content="与东海帝王在天皇赏上结下死仇"),
        _FakeMem("mid", tick=5, salience=0.5, content="在食堂吃了草料"),
        _FakeMem("new_irrel", tick=9, salience=0.5, content="今天天气不错，散了散步"),
    ]
    focal_terms = ["东海帝王", "天皇赏"]
    scores = _score_memories(episodics, focal_terms, [], None)
    assert scores["old_rel"] > scores["new_irrel"]
    # Top-1 must surface the relevant-but-old memory.
    assert _top_k_ids(scores, 1) == {"old_rel"}


def test_participant_match_boost():
    """Two memories with identical text/recency; the one whose participants
    include the focal partner scores higher."""
    episodics = [
        _FakeMem("with_partner", tick=2, salience=0.5, content="一次寻常的交谈", participants=["东海帝王"]),
        _FakeMem("with_other", tick=2, salience=0.5, content="一次寻常的交谈", participants=["特别周"]),
    ]
    scores = _score_memories(episodics, [], ["东海帝王"], None)
    assert scores["with_partner"] > scores["with_other"]


def test_high_salience_surfaces():
    """When recency and relevance are equal, the high-salience aftermath memory
    outranks low-salience chatter."""
    episodics = [
        _FakeMem("aftermath", tick=3, salience=0.9, content="比赛结束"),
        _FakeMem("chatter", tick=3, salience=0.2, content="比赛结束"),
    ]
    scores = _score_memories(episodics, [], [], None)
    assert scores["aftermath"] > scores["chatter"]


def test_recency_only_fallback():
    """relevance_w=importance_w=0 reduces to pure recency ordering (old behavior)."""
    episodics = [
        _FakeMem("a", tick=1, salience=0.9, content="提到东海帝王"),
        _FakeMem("b", tick=2, salience=0.1, content="无关闲聊"),
        _FakeMem("c", tick=3, salience=0.1, content="无关闲聊"),
    ]
    w = {"recency_w": 1.0, "relevance_w": 0.0, "importance_w": 0.0, "recency_decay": 0.99}
    scores = _score_memories(episodics, ["东海帝王"], ["东海帝王"], w)
    # Newest (c) wins despite a being relevant + high-salience; b > a too.
    assert scores["c"] > scores["b"] > scores["a"]
    assert _top_k_ids(scores, 2) == {"b", "c"}


def main() -> int:
    test_ripe_by_oracle_signal()
    test_oracle_ripe_blocked_before_due()
    test_ripe_by_due_tick()
    test_ripe_by_max_age()
    test_sequence_order_gate()
    test_autonomous_no_sequence_gate()
    test_mechanical_resolve_fallback()
    test_scan_goal_conflicts()
    test_scan_goal_conflicts_below_floor()
    test_settled_goal_not_reseeded()
    test_progress_detection()
    test_preset_event_has_no_owner()
    test_norm_name_folds_width()
    test_promote_dormant_event_in_place()
    test_event_dedupe_corpus_orders_by_tick()
    test_relevant_old_beats_irrelevant_recent()
    test_participant_match_boost()
    test_high_salience_surfaces()
    test_recency_only_fallback()
    print("OK deduction_regression_test")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
