#!/usr/bin/env python3
"""Integration tests for ST plugin ↔ WorldBuilder (sim_test_data graph)."""
from __future__ import annotations

import json
import os
import sys
import urllib.parse
import urllib.request

API = os.environ.get("WORLDBUILDER_API", "http://localhost:8000/api")
PROJECT_NAME = "模拟器测试"


def req(method: str, path: str, body: dict | None = None):
    url = f"{API}{path}"
    data = json.dumps(body).encode() if body is not None else None
    r = urllib.request.Request(
        url, data=data, method=method,
        headers={"Content-Type": "application/json"} if data else {},
    )
    with urllib.request.urlopen(r, timeout=60) as resp:
        return json.loads(resp.read().decode())


def get(path: str, params: dict | None = None):
    if params:
        q = urllib.parse.urlencode(params)
        path = f"{path}?{q}"
    return req("GET", path)


def main() -> int:
    fails = []

    projects = req("GET", "/projects")
    proj = next((p for p in projects if p["name"] == PROJECT_NAME), None)
    if not proj:
        print("FAIL: project not found — run seed_sim_test.py")
        return 1
    pid = proj["id"]
    print(f"OK project {PROJECT_NAME} ({pid})")

    # visibility: 林远 observer should NOT see 小夏 secret
    vis = get(
        f"/projects/{pid}/entities/context",
        {"characters": "林远,小夏", "hop": "2", "observer": "林远"},
    )
    inj = vis.get("system_injection", "")
    if "封口费" in inj:
        fails.append("visibility: 林远 should not see 小夏 secret")
    else:
        print("OK visibility — 林远 does not see 小夏 secret")

    # 小夏 self sees own secret in visibility mode
    vis_self = get(
        f"/projects/{pid}/entities/context",
        {"characters": "小夏", "hop": "2", "observer": "小夏"},
    )
    if "封口费" not in vis_self.get("system_injection", ""):
        fails.append("visibility: 小夏 should see own secret")
    else:
        print("OK visibility — 小夏 sees own secret")

    # truth (omniscient): author view includes private props
    truth = get(f"/projects/{pid}/entities/context", {"characters": "林远,小夏", "hop": "2"})
    if "封口费" not in truth.get("system_injection", ""):
        fails.append("truth: omniscient author view should include private secret")
    else:
        print("OK truth — omniscient sees private secret (author view)")

    req("POST", f"/projects/{pid}/beliefs/seed")
    belief = get(
        f"/projects/{pid}/beliefs/context",
        {"observer": "林远", "characters": "林远,小夏", "hop": "2"},
    )
    if not belief.get("system_injection"):
        fails.append("belief context empty")
    else:
        print(f"OK belief context ({belief.get('token_count')} tokens)")

    sims = req("GET", f"/projects/{pid}/simulations")
    sim = sims[0] if sims else None

    # Sim-scoped beliefs: two simulations seed isolated belief rows
    sim_a = req("POST", f"/projects/{pid}/simulations", {"driver_mode": "hybrid"})
    sim_b = req("POST", f"/projects/{pid}/simulations", {"driver_mode": "hybrid"})
    map_a = get(f"/projects/{pid}/simulations/{sim_a['id']}/beliefs", {"observer": "林远"})
    map_b = get(f"/projects/{pid}/simulations/{sim_b['id']}/beliefs", {"observer": "林远"})
    if not map_a.get("subjects") or not map_b.get("subjects"):
        fails.append("sim-scoped beliefs: empty subject map after create")
    else:
        print(f"OK sim-scoped beliefs seeded (a={len(map_a['subjects'])}, b={len(map_b['subjects'])})")

    ctx_sim = get(
        f"/projects/{pid}/beliefs/context",
        {"observer": "林远", "characters": "林远,小夏", "hop": "2", "simulation": sim_a["id"]},
    )
    if not ctx_sim.get("system_injection"):
        fails.append("belief context with simulation= empty")
    else:
        print("OK belief context bound to simulation")

    if not sim:
        sim = sim_a

    sid = sim["id"]
    mem = get(f"/projects/{pid}/simulations/{sid}/memory-block", {"entity": "林远", "recent_k": "3"})
    print(f"OK memory-block ({mem.get('token_count', 0)} tokens)")

    q = req("POST", f"/projects/{pid}/simulations/{sid}/st-writeback/queue", {
        "observer": "林远",
        "partner": "小夏",
        "user_message": "林远：阿明刚才说什么？",
        "assistant_message": "小夏：他说看见可疑生客，但我不信。",
        "source_meta": {"test": True},
    })
    if q.get("status") != "pending":
        fails.append(f"writeback queue status {q.get('status')}")
    else:
        print(f"OK writeback queued r{q.get('round_index')} pending={q.get('pending_count')}")

    listed = get(f"/projects/{pid}/simulations/{sid}/st-writeback", {"status": "pending"})
    if listed.get("pending_count", 0) < 1:
        fails.append("writeback list empty")
    else:
        print(f"OK writeback list ({listed['pending_count']} pending)")

    # ST server
    try:
        urllib.request.urlopen("http://localhost:8100", timeout=3)
        print("OK SillyTavern http://localhost:8100")
    except Exception as e:
        fails.append(f"ST not reachable: {e}")

    if fails:
        print("\nFAILED:")
        for f in fails:
            print(" -", f)
        return 1
    print("\nAll integration checks passed.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
