"""AI service using OpenRouter-compatible API for transforms and conflict detection.

Supports per-project model/key/endpoint configuration with env var fallback.
"""

import httpx
import os
import json
import re

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


# ── Simulation: Actor / Oracle / Memory ─────────────────────────

async def ai_act(
    scene_context: str,
    participants: list[str],
    memory_blocks: dict[str, str],
    *,
    nudges: dict[str, str] | None = None,
    config: dict | None = None,
    temperature: float = 0.8,
) -> dict:
    """Actor pass: roleplay one encounter between `participants` and produce a
    short narrative + each actor's intents. In P1 this is full-knowledge
    (scene_context is the omniscient view); belief-filtered views arrive in P4.

    Returns {"narrative": str, "intents": [{"actor": name, "summary": str}]}.
    """
    mem_text = ""
    for name in participants:
        block = (memory_blocks or {}).get(name, "").strip()
        if block:
            mem_text += f"\n—— {name} 的记忆 ——\n{block}\n"
    nudge_text = ""
    for name in participants:
        imp = (nudges or {}).get(name, "").strip()
        if imp:
            nudge_text += f"\n（{name} 心中忽然升起一个模糊的预感：{imp}）\n"

    prompt = f"""你是一个关系演化模拟器的「演员」。下面是一次相遇场景的世界背景与参与者记忆，请生成这次互动。

【世界背景】
{scene_context or '（无额外背景）'}

【参与者】{("、".join(participants))}
{mem_text or ''}{nudge_text or ''}

请演绎本次相遇：参与者之间发生了什么互动（对话/行动/情绪变化）。然后给出每个参与者在这次互动中的「意图」——他想改变的关系或自身状态（例如想拉近/疏远与某人的关系、产生新的目标或情绪）。

只返回 JSON：
{{
  "narrative": "一段简洁的第三人称叙事，120字以内",
  "intents": [
    {{"actor": "参与者名", "summary": "他这次互动想达成/改变什么（一句话）"}}
  ]
}}"""
    messages = [
        {"role": "system", "content": "你是关系演化模拟器的演员，擅长把人物动机演绎成具体互动。只返回JSON。"},
        {"role": "user", "content": prompt},
    ]
    try:
        result = await call_ai(messages, config=config, temperature=temperature, max_tokens=1024)
        parsed = json.loads(_strip_json(result))
        return {
            "narrative": parsed.get("narrative", "").strip(),
            "intents": parsed.get("intents", []),
        }
    except (json.JSONDecodeError, KeyError, httpx.HTTPError) as e:
        return {"narrative": "", "intents": [], "error": str(e)}


async def ai_adjudicate(
    tick_scenes: list[dict],
    entity_catalog: list[dict],
    *,
    allow_new_entities: bool = False,
    generate_events: bool = False,
    config: dict | None = None,
    temperature: float = 0.4,
) -> dict:
    """Oracle pass: take ALL of this tick's narratives + intents at once and
    resolve them into ONE consistent set of canonical mutations (conflict
    strategy = oracle_merge). Mutations reference entities by name.

    Returns {"mutations": [...], "new_entities": [...], "events": [...]}.
    Events (when generate_events) are significant happenings the Oracle judges
    worth crystallizing into an event node: {name, summary, participants, significance}.
    Mutation ops:
      - update_relation: {op, source, target, type?, weight_delta?, weight?, description?}
      - create_relation: {op, source, target, type, weight, description?}
      - update_entity:   {op, entity, properties:{mood?,goal?,...}}
      - create_entity:   {op, name, type, properties}   (only if allow_new_entities)
    """
    scenes_text = ""
    for i, s in enumerate(tick_scenes, 1):
        parts = "、".join(s.get("participants", []))
        scenes_text += f"\n场景{i}（{parts}）：{s.get('narrative', '')}\n"
        for it in s.get("intents", []):
            scenes_text += f"  · {it.get('actor', '?')} 意图：{it.get('summary', '')}\n"

    catalog_text = "、".join(
        f"{e['name']}({e.get('type','?')})" for e in entity_catalog
    )

    new_entity_rule = (
        '允许创造新实体：若叙事中出现全新的人物/地点/物品，用 create_entity 产出，'
        '由你负责命名（不得与已有实体重名）与定类型。'
        if allow_new_entities else
        '不允许创造新实体：只能在已有实体之间产生变化。'
    )

    event_rule = (
        '\n- 事件结晶：若本 tick 发生了**有叙事分量的事件**（关系发生转折、立下誓言、'
        '冲突爆发、秘密揭露、重要决定等），用 events 把它凝结成一个事件节点——'
        'name 是简短事件名，summary 是一句话概述，participants 是亲历者实体名列表，'
        'significance 是重要度 0~1（仅记录真正值得留痕的事件，琐碎寒暄不必产出）。'
        if generate_events else ''
    )
    event_schema = (
        ',\n  "events": [\n    {"name": "事件名", "summary": "一句话概述", '
        '"participants": ["亲历者1", "亲历者2"], "significance": 0.7}\n  ]'
        if generate_events else ''
    )

    prompt = f"""你是关系演化模拟器的「全知裁决者」(Oracle)。本 tick 发生了若干场相遇，请把它们整体解算成「一套」无矛盾的世界变更（canonical mutations）。

【已有实体】{catalog_text}

【本 tick 发生的场景与意图】
{scenes_text}

裁决规则：
- 把所有意图作为整体考虑，同一对关系的矛盾意图由你按合理性/当前关系强度/双方处境统一裁决，最终只产出一套不重复、不冲突的变更。
- 关系强度 weight 取值 0~1。weight_delta 是增量（可正可负，幅度建议 ±0.05~0.2）。
- 内部状态（mood 情绪 / goal 目标）写进 update_entity 的 properties。
- {new_entity_rule}
- 信息可见度落地：若某意图涉及「谁能知道某条信息」（揭示秘密给特定人、向某些人隐瞒某事），用 set_prop_visibility 把它落成确定名单——level 用 entities 时，entities 必须是**具体实体名**（你把「盟友」等群体展开成具体的人），private 表示仅自己可见，public 表示公开。
- 没有实质变化的场景可以不产出 mutation。{event_rule}

只返回 JSON：
{{
  "mutations": [
    {{"op": "update_relation", "source": "名", "target": "名", "weight_delta": 0.1, "type": "可选新类型", "description": "可选"}},
    {{"op": "create_relation", "source": "名", "target": "名", "type": "ally", "weight": 0.6, "description": "可选"}},
    {{"op": "update_entity", "entity": "名", "properties": {{"mood": "喜悦", "goal": "..."}}}},
    {{"op": "set_prop_visibility", "entity": "信息所属者名", "key": "secret", "level": "entities", "entities": ["可知者1", "可知者2"]}}
  ],
  "new_entities": [
    {{"op": "create_entity", "name": "新名", "type": "character", "properties": {{}}}}
  ]{event_schema}
}}

关系类型可选：ally, enemy, lover, family, rival, mentor, subordinate, member_of, located_at, participated, caused, followed_by, holds, owns, custom。"""
    messages = [
        {"role": "system", "content": "你是关系演化模拟器的全知裁决者，把多方意图解算成一套无矛盾的世界变更。只返回JSON。"},
        {"role": "user", "content": prompt},
    ]
    try:
        result = await call_ai(messages, config=config, temperature=temperature, max_tokens=2048)
        parsed = json.loads(_strip_json(result))
        return {
            "mutations": parsed.get("mutations", []),
            "new_entities": parsed.get("new_entities", []) if allow_new_entities else [],
            "events": parsed.get("events", []) if generate_events else [],
        }
    except (json.JSONDecodeError, KeyError, httpx.HTTPError) as e:
        return {"mutations": [], "new_entities": [], "events": [], "error": str(e)}


async def ai_resolve_visibility(
    intent: dict,
    entity_catalog: list[dict],
    *,
    subject_name: str | None = None,
    config: dict | None = None,
    temperature: float = 0.2,
) -> dict:
    """Oracle visibility-landing pass (plan decision 10b).

    An Actor may form a fuzzy disclosure/concealment intent — e.g. "let only my
    allies know my real plan", "hide my wound from enemies". This resolves that
    vague intent into a concrete, materialized whitelist against the canonical
    world: which property key it concerns, the (optional) revealed content, and
    the exact list of entity names allowed to see it.

    Returns {"prop_key": str|None, "content": str|None, "matched_entities": [name,...]}.
    Returning an empty/identity result means "no visibility change".
    """
    catalog_text = "、".join(
        f"{e['name']}({e.get('type','?')})" for e in entity_catalog
    )
    intent_text = intent.get("summary") or intent.get("content") or str(intent)
    subject_line = f"\n【信息所属者】{subject_name}" if subject_name else ""

    prompt = f"""你是关系演化模拟器的「全知可见度落地器」(Oracle)。某角色产生了一个关于「谁能知道某条信息」的模糊意图，请把它落地成一份**确定的可见名单**。
{subject_line}
【意图】{intent_text}

【世界中的实体】{catalog_text}

落地规则：
- 判断这条意图涉及信息所属者的哪一条属性（prop_key，如 goal/secret/wound/plan 等；若无明确属性则给一个贴切的英文键名）。
- 如果意图是「揭示/告知」某内容，给出 content（揭示出去的具体文本）；如果只是「隐藏」，content 留空。
- 从【世界中的实体】里挑出**确切应当能看到这条信息的实体名单**（matched_entities，用实体原名）。隐藏类意图则给出仍可见的少数人（通常是自己/盟友），其余人默认看不到。
- 名单要具体到实体名，不要用「盟友」这种群体词——你来把群体展开成具体的人。

只返回 JSON：
{{"prop_key": "goal", "content": "可选揭示内容或留空", "matched_entities": ["名1", "名2"]}}"""
    messages = [
        {"role": "system", "content": "你是全知可见度落地器，把模糊的信息披露意图解算成确定的可见实体名单。只返回JSON。"},
        {"role": "user", "content": prompt},
    ]
    try:
        result = await call_ai(messages, config=config, temperature=temperature, max_tokens=512)
        parsed = json.loads(_strip_json(result))
        return {
            "prop_key": parsed.get("prop_key"),
            "content": parsed.get("content") or None,
            "matched_entities": parsed.get("matched_entities", []) or [],
        }
    except (json.JSONDecodeError, KeyError, httpx.HTTPError) as e:
        return {"prop_key": None, "content": None, "matched_entities": [], "error": str(e)}


async def ai_reconcile_belief(
    observer_name: str,
    subject_name: str,
    believed_props: dict,
    revealed_truth: dict,
    *,
    self_goal: str | None = None,
    config: dict | None = None,
    temperature: float = 0.4,
) -> dict:
    """Oracle belief-reconciliation pass (plan decision 10c / step 3c).

    A previously-hidden truth about ``subject_name`` just became visible to
    ``observer_name`` (visibility opened). Fold the revealed facts into the
    observer's belief about that subject, and — if the revelation matters —
    re-derive the observer's own goal in light of the new knowledge.

    Returns {"belief_updates": {key: value}, "goal": str|None}. ``belief_updates``
    is merged into the observer's believed_properties about the subject; ``goal``
    (when non-empty) replaces the observer's own goal.
    """
    prompt = f"""你是关系演化模拟器的「全知信念重认知器」(Oracle)。某角色刚刚获知了关于另一个角色的、此前不知道的真相，请把新真相折进 TA 的认知，并判断 TA 的目标是否因此改变。

【观察者】{observer_name}
【观察者当前目标】{self_goal or '（未知）'}
【认知对象】{subject_name}
【观察者原本对 TA 的认知】{json.dumps(believed_props, ensure_ascii=False)}
【刚刚揭示的真相】{json.dumps(revealed_truth, ensure_ascii=False)}

请输出：
- belief_updates：要写进观察者认知里的键值（把揭示的真相合理地并入，键名沿用真相里的键）。
- goal：如果这条真相会让观察者改变目标，给出新目标（一句话）；若不影响，置为 null。

只返回 JSON：
{{"belief_updates": {{"key": "value"}}, "goal": "新目标或 null"}}"""
    messages = [
        {"role": "system", "content": "你是全知信念重认知器，把新揭示的真相折进观察者的认知并据此重定目标。只返回JSON。"},
        {"role": "user", "content": prompt},
    ]
    try:
        result = await call_ai(messages, config=config, temperature=temperature, max_tokens=512)
        parsed = json.loads(_strip_json(result))
        goal = parsed.get("goal")
        if isinstance(goal, str) and goal.strip().lower() in ("null", "none", ""):
            goal = None
        return {
            "belief_updates": parsed.get("belief_updates") or {},
            "goal": goal or None,
        }
    except (json.JSONDecodeError, KeyError, httpx.HTTPError) as e:
        # On failure, fall back to a mechanical fold so the truth still lands.
        return {"belief_updates": dict(revealed_truth or {}), "goal": None, "error": str(e)}


async def ai_summarize_memory(
    prior_summary: str,
    episodics_text: str,
    *,
    config: dict | None = None,
) -> str:
    """Memory compactor: fold a batch of old episodics (plus any prior summary)
    into one concise long-term summary. Returns plain text."""
    prompt = f"""把下面这个角色的旧经历压缩成一段简洁的长期记忆摘要，保留关键的人物、关系变化与情绪转折，去掉琐碎细节。

【已有摘要】
{prior_summary or '（无）'}

【待压缩的经历】
{episodics_text}

只返回摘要正文（150字以内），不要任何解释或JSON。"""
    messages = [
        {"role": "system", "content": "你是记忆压缩器，把经历流水浓缩成要点摘要。只返回摘要正文。"},
        {"role": "user", "content": prompt},
    ]
    try:
        return (await call_ai(messages, config=config, temperature=0.3, max_tokens=512)).strip()
    except httpx.HTTPError as e:
        # On failure, fall back to a mechanical concatenation so nothing is lost.
        return (prior_summary + "\n" + episodics_text).strip()[:500]


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
