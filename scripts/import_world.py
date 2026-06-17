#!/usr/bin/env python3
"""Import any WorldBuilder data module into a project.

Usage:
  python3 import_world.py sanguo_data
  WORLDBUILDER_API=http://localhost:8090/api python3 import_world.py sanguo_data

Data module must export: PROJECT, ENTITIES, RELATIONS
"""

from __future__ import annotations

import importlib
import json
import os
import sys
import urllib.error
import urllib.request

API_BASE = os.environ.get("WORLDBUILDER_API", "http://localhost:8000/api")


def request(method: str, path: str, body: dict | None = None) -> dict | list:
    url = f"{API_BASE}{path}"
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(
        url,
        data=data,
        method=method,
        headers={"Content-Type": "application/json"} if data else {},
    )
    try:
        with urllib.request.urlopen(req, timeout=120) as resp:
            raw = resp.read().decode()
            return json.loads(raw) if raw else {}
    except urllib.error.HTTPError as e:
        detail = e.read().decode()
        raise RuntimeError(f"{method} {path} failed ({e.code}): {detail}") from e


def validate_keys(entities: dict, relations: list) -> None:
    keys = set(entities)
    for item in relations:
        for k in item[:2]:
            if k not in keys:
                raise KeyError(f"RELATIONS references unknown key: {k!r}")


def import_module(module_name: str) -> None:
    mod = importlib.import_module(module_name)
    project = mod.PROJECT
    entities = mod.ENTITIES
    relations = mod.RELATIONS
    validate_keys(entities, relations)

    request("GET", "/health")

    projects = request("GET", "/projects")
    for p in projects:
        if p["name"] == project["name"]:
            print(f"Removing existing project: {p['name']} ({p['id']})")
            request("DELETE", f"/projects/{p['id']}")

    created_project = request("POST", "/projects", project)
    pid = created_project["id"]
    print(f"Created project: {created_project['name']} ({pid})")

    key_to_id: dict[str, str] = {}
    for key, ent in entities.items():
        row = request(
            "POST",
            f"/projects/{pid}/entities",
            {
                "name": ent["name"],
                "type": ent["type"],
                "properties": ent.get("properties", {}),
            },
        )
        key_to_id[key] = row["id"]

    print(f"Created {len(key_to_id)} entities")

    rel_count = 0
    skipped = 0
    for item in relations:
        src_key, dst_key, rel_type = item[0], item[1], item[2]
        weight = item[3] if len(item) > 3 else 0.5
        props = item[4] if len(item) > 4 else {}
        src_id = key_to_id.get(src_key)
        dst_id = key_to_id.get(dst_key)
        if not src_id or not dst_id:
            skipped += 1
            continue
        request(
            "POST",
            f"/projects/{pid}/relations",
            {
                "source_id": src_id,
                "target_id": dst_id,
                "type": rel_type,
                "weight": weight,
                "properties": props,
            },
        )
        rel_count += 1

    print(f"Created {rel_count} relations ({skipped} skipped)")
    print(f"\nDone! Project ID: {pid}")


def main() -> None:
    if len(sys.argv) != 2:
        print("Usage: python3 import_world.py <data_module>", file=sys.stderr)
        print("Example: python3 import_world.py sanguo_data", file=sys.stderr)
        raise SystemExit(1)
    try:
        import_module(sys.argv[1])
    except Exception as e:
        print(f"Error: {e}", file=sys.stderr)
        if "Connection refused" in str(e) or "API not reachable" in str(e):
            print("Start backend: cd backend && uvicorn app.main:app --reload", file=sys.stderr)
        raise SystemExit(1) from e


if __name__ == "__main__":
    main()
