"""AI service using OpenRouter-compatible API for transforms, conflict detection, and generation.

Supports:
- Per-project model/key/endpoint configuration (Project.settings)
- SSE streaming for long-form generation
- Fallback to env vars when project settings are absent
"""

import httpx
import os
import json
import re
from typing import AsyncGenerator

from dotenv import load_dotenv

load_dotenv()

# Defaults (env fallback)
_ENV_KEY = os.getenv("OPENROUTER_API_KEY")
_ENV_ENDPOINT = os.getenv("AI_ENDPOINT", "https://openrouter.ai/api/v1")
_ENV_MODEL = os.getenv("AI_MODEL", "deepseek/deepseek-v4-flash")


def _resolve_config(project_settings: dict | None = None) -> dict:
    """Resolve AI config: project settings take priority, env vars fallback."""
    s = project_settings or {}
    return {
        "api_key": s.get("ai_api_key") or _ENV_KEY,
        "endpoint": s.get("ai_endpoint") or _ENV_ENDPOINT,
        "model": s.get("ai_model") or _ENV_MODEL,
    }


def _strip_json(text: str) -> str:
    """Remove markdown code fences and extract raw JSON."""
    text = text.strip()
    if text.startswith("```"):
        parts = text.split("```")
        if len(parts) >= 3:
            inner = parts[1]
            if inner.startswith("json"):
                inner = inner[4:]
            return inner.strip()
    return text


# ── Non-streaming call ──────────────────────────────────────────

async def call_ai(
    messages: list[dict],
    *,
    config: dict | None = None,
    temperature: float = 0.7,
    max_tokens: int = 2048,
) -> str:
    """Call AI API and return the full response text."""
    c = _resolve_config(config)
    if not c["api_key"]:
        raise RuntimeError("AI API key not configured. Set it in Project settings or .env.")
    headers = {
        "Authorization": f"Bearer {c['api_key']}",
        "Content-Type": "application/json",
        "HTTP-Referer": "https://worldbuilder.app",
        "X-Title": "WorldBuilder",
    }
    payload = {
        "model": c["model"],
        "messages": messages,
        "temperature": temperature,
        "max_tokens": max_tokens,
    }
    async with httpx.AsyncClient(timeout=90.0) as client:
        resp = await client.post(f"{c['endpoint']}/chat/completions", headers=headers, json=payload)
        resp.raise_for_status()
        data = resp.json()
        return data["choices"][0]["message"]["content"]


# ── Streaming call (SSE) ────────────────────────────────────────

async def stream_ai(
    messages: list[dict],
    *,
    config: dict | None = None,
    temperature: float = 0.7,
    max_tokens: int = 2048,
) -> AsyncGenerator[str, None]:
    """Stream AI response as incremental text chunks (SSE)."""
    c = _resolve_config(config)
    if not c["api_key"]:
        raise RuntimeError("AI API key not configured.")
    headers = {
        "Authorization": f"Bearer {c['api_key']}",
        "Content-Type": "application/json",
        "HTTP-Referer": "https://worldbuilder.app",
        "X-Title": "WorldBuilder",
    }
    payload = {
        "model": c["model"],
        "messages": messages,
        "temperature": temperature,
        "max_tokens": max_tokens,
        "stream": True,
    }
    async with httpx.AsyncClient(timeout=120.0) as client:
        async with client.stream("POST", f"{c['endpoint']}/chat/completions", headers=headers, json=payload) as resp:
            resp.raise_for_status()
            async for line in resp.aiter_lines():
                # SSE format: lines starting with "data: "
                if not line.startswith("data: "):
                    continue
                data = line[6:]
                if data == "[DONE]":
                    break
                try:
                    chunk = json.loads(data)
                    delta = chunk.get("choices", [{}])[0].get("delta", {})
                    text = delta.get("content", "")
                    if text:
                        yield text
                except json.JSONDecodeError:
                    continue


# ── AI Transform functions ──────────────────────────────────────

async def ai_infer_relations(
    entity_name: str,
    entity_type: str,
    entity_props: dict,
    known_relations: list[dict],
    existing_entity_names: set[str],
    existing_relation_keys: set[str],
    project_context: str = "",
    *,
    config: dict | None = None,
) -> dict:
    """Ask AI to infer potential relations. Returns candidates (not persisted).

    Quality improvements (M2d):
    - AI outputs target entity *type*
    - Confidence < 0.4 filtered out
    - Duplicates against existing entity names and relation keys removed
    """
    known_text = ""
    for r in known_relations:
        known_text += f"- {r.get('source_name', '?')} --[{r['type']}]--> {r.get('target_name', '?')}\n"

    prompt = f"""你是一个小说世界观分析专家。根据以下实体信息，推断它可能存在的潜在关系。

实体：{entity_name}（类型：{entity_type}）
属性：{json.dumps(entity_props, ensure_ascii=False, indent=2)}
已知关系：
{known_text or '（暂无已知关系）'}
已有实体名列表（推断目标如果已存在请复用）：{json.dumps(list(existing_entity_names), ensure_ascii=False)}
项目背景：{project_context or '（未提供）'}

请推断3-5个潜在关系，以JSON格式返回：
{{
  "inferred_relations": [
    {{
      "target_name": "目标实体名",
      "target_type": "character/location/event/item/faction",
      "relation_type": "关系类型",
      "description": "推断理由",
      "confidence": 0.8
    }}
  ]
}}

注意：
- 关系类型从以下选择：ally, enemy, lover, family, rival, mentor, subordinate, member_of, located_at, participated, caused, followed_by, holds
- 如果推断的目标实体已存在于已有实体名列表中，请直接复用该名称（不要改名）
- target_type 必须是上述五种之一，根据目标实体的角色推断
- confidence 范围 0-1，低于0.4的关系不要输出"""

    messages = [
        {"role": "system", "content": "你是一个小说世界观分析专家，擅长发现人物之间的隐藏关联。只返回JSON，不要其他文字。"},
        {"role": "user", "content": prompt},
    ]

    try:
        result = await call_ai(messages, config=config, temperature=0.6)
        parsed = json.loads(_strip_json(result))
        candidates = parsed.get("inferred_relations", [])

        # ── M2d quality filters ──
        filtered = []
        seen = set()
        for c in candidates:
            # Confidence filter
            conf = c.get("confidence", 0.5)
            if conf < 0.4:
                continue
            # Deduplicate by target_name + relation_type
            key = f"{c.get('target_name', '')}::{c.get('relation_type', '')}"
            if key in seen:
                continue
            seen.add(key)
            # Skip if exact relation already exists
            rel_key = f"{entity_name}::{c.get('relation_type', '')}::{c.get('target_name', '')}"
            if rel_key in existing_relation_keys:
                continue
            filtered.append(c)

        return {"inferred_relations": filtered}
    except (json.JSONDecodeError, KeyError, httpx.HTTPError) as e:
        return {"inferred_relations": [], "error": str(e)}


async def ai_detect_conflicts(
    entity_name: str,
    entity_props: dict,
    relations: list[dict],
    *,
    config: dict | None = None,
) -> list[dict]:
    """Ask AI to detect logical contradictions."""
    rel_text = ""
    for r in relations:
        rel_text += f"- {r.get('source_name', '?')} --[{r['type']}]--> {r.get('target_name', '?')}  {r.get('properties', {}).get('description', '')}\n"

    prompt = f"""分析以下小说实体是否存在逻辑矛盾：

实体：{entity_name}
属性：{json.dumps(entity_props, ensure_ascii=False, indent=2)}
相关关系：
{rel_text or '（暂无关系）'}

请检查：
1. 关系之间是否矛盾（如同时是敌人和盟友且无合理解释）
2. 属性与关系是否矛盾（如性格善良但有很多敌对关系）
3. 行为模式是否一致

以JSON格式返回：
{{
  "conflicts": [
    {{
      "type": "contradiction_type",
      "description": "矛盾描述",
      "severity": "high/medium/low",
      "suggestion": "修改建议"
    }}
  ]
}}"""

    messages = [
        {"role": "system", "content": "你是小说逻辑审查专家，擅长发现角色设定中的矛盾。只返回JSON。"},
        {"role": "user", "content": prompt},
    ]
    try:
        result = await call_ai(messages, config=config, temperature=0.3)
        parsed = json.loads(_strip_json(result))
        return parsed.get("conflicts", [])
    except (json.JSONDecodeError, KeyError, httpx.HTTPError) as e:
        return [{"type": "ai_error", "description": str(e), "severity": "low", "suggestion": ""}]


async def ai_generate_backstory(
    entity_name: str,
    entity_type: str,
    entity_props: dict,
    relations: list[dict],
    *,
    config: dict | None = None,
) -> str:
    """Generate backstory (non-streaming, used by Transform)."""
    rel_text = ""
    for r in relations:
        rel_text += f"- {r.get('source_name', '?')} --[{r['type']}]--> {r.get('target_name', '?')}\n"

    prompt = f"""为以下小说实体生成背景故事：

实体：{entity_name}（类型：{entity_type}）
已有属性：{json.dumps(entity_props, ensure_ascii=False, indent=2)}
已知关系：
{rel_text or '（暂无关系）'}

要求：
- 与已有属性和关系保持一致
- 200-400字
- 有细节有画面感"""

    messages = [
        {"role": "system", "content": "你是一位资深小说创作顾问，擅长构建有深度的角色背景。"},
        {"role": "user", "content": prompt},
    ]
    return await call_ai(messages, config=config, temperature=0.8, max_tokens=1024)


# ── Streaming generation (M4 uses this) ─────────────────────────

async def ai_generate_scene_stream(
    context_text: str,
    scene_description: str,
    *,
    config: dict | None = None,
) -> AsyncGenerator[str, None]:
    """Stream a scene/chapter prose using graph context."""
    prompt = f"""你是一位专业的小说续写助手。请根据以下世界观上下文，写一段场景正文。

世界观上下文：
{context_text}

场景描述：{scene_description}

要求：
- 严格遵循上下文中的人物关系和性格设定，不得OOC
- 500-1000字
- 有对话、动作、环境描写
- 风格与上下文一致"""

    messages = [
        {"role": "system", "content": "你是专业的小说续写助手。你写的文字必须严格遵循给定的世界观上下文，不得偏离人物设定。"},
        {"role": "user", "content": prompt},
    ]
    async for chunk in stream_ai(messages, config=config, temperature=0.8, max_tokens=2048):
        yield chunk


async def ai_generate_outline_stream(
    context_text: str,
    *,
    config: dict | None = None,
) -> AsyncGenerator[str, None]:
    """Stream a story outline using the full graph context."""
    prompt = f"""你是一位小说大纲策划专家。请根据以下世界观信息，生成一份故事大纲。

世界观上下文：
{context_text}

要求：
- 3-5幕结构
- 每幕标注关键转折点和涉及的人物
- 标注伏笔和呼应
- 500字左右"""

    messages = [
        {"role": "system", "content": "你是小说大纲策划专家，擅长从复杂人物关系中发现戏剧冲突。"},
        {"role": "user", "content": prompt},
    ]
    async for chunk in stream_ai(messages, config=config, temperature=0.7, max_tokens=1024):
        yield chunk
