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
        "narrative_language": s.get("narrative_language") or "",
    }


# Directive appended to the system prompt so the deduction engine emits its
# human-readable output (narratives, summaries, event names, intuitions) in the
# chosen language. JSON keys / enum values stay as specified — only the natural-
# language *values* are localized. Empty narrative_language = no directive, i.e.
# the prompts' own language (Chinese) is preserved (backward compatible).
_LANG_DIRECTIVE = {
    "en": (
        "\n\nLANGUAGE: Write ALL natural-language output — every narrative, "
        "summary, description, event/entity name, and intuition text — in fluent "
        "English. Keep all JSON field keys and any enum/type values exactly as "
        "specified; translate only the human-readable content values."
    ),
    "zh": (
        "\n\n语言：所有自然语言输出——叙事、摘要、描述、事件/实体名称、预感正文"
        "——一律使用中文。JSON 字段键名与枚举/类型值保持原样，仅翻译可读内容值。"
    ),
}


def _apply_language_directive(messages: list[dict], lang: str) -> list[dict]:
    """Append the language directive to the (first) system message, or prepend a
    new system message if none exists. Returns a new list; input is not mutated."""
    directive = _LANG_DIRECTIVE.get(lang)
    if not directive:
        return messages
    out = [dict(m) for m in messages]
    for m in out:
        if m.get("role") == "system":
            m["content"] = (m.get("content") or "") + directive
            return out
    return [{"role": "system", "content": directive.strip()}, *out]


def _strip_json(text: str | None) -> str:
    """Remove markdown code fences and extract raw JSON."""
    text = (text or "").strip()
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
    messages = _apply_language_directive(messages, c["narrative_language"])
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
        content = data["choices"][0]["message"]["content"]
        return content if isinstance(content, str) else (content or "")


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
    """Actor pass: simulate one encounter from the initiator's belief view.

    Agents act from their goals, personality, memory, and current situation —
    not to produce drama, but to advance what their circumstances make plausible.

    Returns {"narrative": str, "intents": [{"actor": name, "summary": str}]}.
    """
    mem_text = ""
    for name in participants:
        block = ((memory_blocks or {}).get(name) or "").strip()
        if block:
            mem_text += f"\n—— {name} 的记忆 ——\n{block}\n"
    nudge_text = ""
    for name in participants:
        imp = ((nudges or {}).get(name) or "").strip()
        if imp:
            nudge_text += f"\n（{name} 心中忽然升起一个模糊的预感：{imp}）\n"

    prompt = f"""你是关系演化模拟器的「演员」——模拟 agent 在一场遭遇中的行为，不是编剧。

【世界背景】
{scene_context or '（无额外背景）'}

【参与者】{("、".join(participants))}
{mem_text or ''}{nudge_text or ''}

规则：
- 人物依据自身目标、性格、记忆与【既定事实】/【当前态势】行动；行为强度由动机与处境因果决定，不为制造转折而硬转，也不为求稳而原地空转。
- 若某事在【既定事实】中已发生，须以其后果为前提行动，不得当作未发生而重演前夜。
- 若有【当前态势】中的悬决事件，行为应与之相关；若只剩既定事实，行为应服务于角色当前目标、为可观察的未来之事铺路。
- 每条 intent 须指向可观察的推进（改变关系、争取资源、布局尚未发生之事等），避免空泛寒暄。

请演绎本次遭遇，并给出每位参与者的意图。

只返回 JSON：
{{
  "narrative": "一段简洁的第三人称叙事，150字以内",
  "intents": [
    {{"actor": "参与者名", "summary": "他这次互动想达成/改变什么（一句话，尽量具体）"}}
  ]
}}"""
    messages = [
        {"role": "system", "content": "你是关系演化模拟器的演员，依据 agent 目标与处境模拟具体遭遇。只返回JSON。"},
        {"role": "user", "content": prompt},
    ]
    try:
        result = await call_ai(messages, config=config, temperature=temperature, max_tokens=1024)
        parsed = json.loads(_strip_json(result))
        return {
            "narrative": (parsed.get("narrative") or "").strip(),
            "intents": parsed.get("intents") or [],
        }
    except (json.JSONDecodeError, KeyError, httpx.HTTPError) as e:
        return {"narrative": "", "intents": [], "error": str(e)}


async def ai_adjudicate(
    tick_scenes: list[dict],
    entity_catalog: list[dict],
    *,
    allow_new_entities: bool = False,
    generate_events: bool = False,
    directive: str = "",
    pending_events: list[dict] | None = None,
    character_goals: list[dict] | None = None,
    recent_events: list[dict] | None = None,
    config: dict | None = None,
    temperature: float = 0.4,
) -> dict:
    """Oracle pass: merge this tick's scenes into one consistent canonical world
    update. This is a simulation adjudicator, not a story director.

    `pending_events` lists unresolved futures ({name, stakes}). Report names in
    `ripe_events` only when scenes make them causally ready. Register new futures
    via `register_pending_event` when agents orbit outcomes not yet settled.

    Returns {"mutations", "new_entities", "events", "ripe_events"}.
    Mutation ops:
      - update_relation: {op, source, target, type?, weight_delta?, weight?, description?}
      - create_relation: {op, source, target, type, weight, description?}
      - update_entity:   {op, entity, properties:{mood?,goal?,...}}
      - create_entity:   {op, name, type, properties}   (only if allow_new_entities)
      - register_pending_event: {op, name, stakes, participants:[...], due_tick?}
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
        '\n- 事件结晶（create_event / events）：仅记录**本 tick 已经实际发生**、值得留痕的事实'
        '（秘密被揭露、交易达成、冲突爆发、重要决定落地等）。'
        '「决意」「计划」「对峙」「威胁」不等于已发生——那些应 register_pending_event，不要结晶为 events。'
        'name 简短，summary 一句话，participants 亲历者，significance 0~1。'
        if generate_events else ''
    )
    event_schema = (
        ',\n  "events": [\n    {"name": "事件名", "summary": "一句话概述", '
        '"participants": ["亲历者1", "亲历者2"], "significance": 0.7}\n  ]'
        if generate_events else ''
    )

    # Pending-event awareness: tell the Oracle what the world is orbiting, ask it
    # to flag which are now causally ripe, and let it register new ones. This is
    # how "推演" stays causal — ripeness is a judgement on the scenes, not a clock.
    pending = pending_events or []
    if pending:
        pend_lines = "\n".join(
            f"  · {p.get('name')}（赌注：{p.get('stakes') or '未明'}）" for p in pending
        )
        pending_block = (
            "\n\n【当前悬而未决的事件（世界正围绕它们打转，尚未发生）】\n" + pend_lines
        )
        pending_rule = (
            "\n- 成熟度判定：逐一判断上述悬决事件，本 tick 场景是否已让它的**前提条件因果成熟**"
            "（当事人就位、触发动作已出现、关键铺垫已够）。把已成熟的事件名放进 ripe_events。"
            "**决意、计划、对峙、威胁、讨论 ≠ 事件已发生**——不得仅因多人谈论某事就标 ripe。"
            "成熟与否只看因果，不看时间压力或叙事需要。"
        )
        ripe_schema = ',\n  "ripe_events": ["已因果成熟、可以结算的悬决事件名"]'
    else:
        pending_block = ""
        pending_rule = ""
        ripe_schema = ""
    register_rule = (
        "\n- 登记悬决事件（register_pending_event）：若多方围绕**一件尚未发生的未来之事**"
        "（对决、选举、举证、逃亡、交易、复仇等）布局、定计划、下赌注，用 register_pending_event 登记"
        "（name、stakes 博弈什么、participants 当事人、due_tick 可选）。"
        "**pending 队列为空时更要主动登记**——把角色当前 goal 与冲突凝结成下一批待发生之事。"
        "即使该未来之事已作为实体出现在【已有实体】里，只要尚未发生，也要用一致 name 登记。"
        "不要把本 tick 已发生的事登记为悬决；也不要把同一件事既结晶为 events 又登记为悬决。"
    )

    goals_block = ""
    if character_goals:
        goal_lines = "\n".join(
            f"  · {g.get('name')}：{g.get('goal') or '（无明确目标）'}" for g in character_goals
        )
        goals_block = f"\n\n【各角色当前目标】\n{goal_lines}"

    recent_block = ""
    if recent_events:
        recent_lines = "\n".join(
            f"  · [{e.get('status', '?')}] {e.get('name')} — "
            f"{(e.get('summary') or e.get('stakes') or e.get('description') or '')[:80]}"
            for e in recent_events[:25]
        )
        recent_block = (
            "\n\n【近期已发生/悬决中的事件（勿重复结晶或登记同题之变体）】\n" + recent_lines
        )

    weight_rule = (
        "关系强度 weight 取值 0~1。weight_delta 是增量（可正可负）。"
        "变更幅度由当前关系强度、双方处境与意图的因果分量决定："
        "力量对比与情理支持多大变化就给多大，不为制造转折而放大，也不为求稳而抹平。"
        "关系 type 仅在场景里确实发生对应变化时修改。"
    )

    directive_block = (
        f"\n\n【本 tick 的强制指令——必须在变更中体现】\n{(directive or '').strip()}\n"
        if (directive or "").strip() else ""
    )

    prompt = f"""你是关系演化模拟器的「全知裁决者」(Oracle)——模拟世界的因果结算，不是编剧。
本 tick 若干场遭遇，请解算成一套无矛盾的世界变更（canonical mutations）。

【已有实体】{catalog_text}
{goals_block}{recent_block}

【本 tick 发生的场景与意图】
{scenes_text}{pending_block}{directive_block}

裁决规则：
- 把所有意图作为整体考虑，矛盾意图按合理性/关系强度/处境统一裁决，只产出一套不冲突的变更。
- {weight_rule}
- 内部状态（mood / goal）写进 update_entity 的 properties；goal 应反映角色在结算后的真实取向。
- {new_entity_rule}
- 信息可见度：涉及谁能知道某条信息时，用 set_prop_visibility 落成具体实体名单。
- 没有实质变化的场景可以不产出 mutation。{register_rule}{pending_rule}{event_rule}

只返回 JSON：
{{
  "mutations": [
    {{"op": "update_relation", "source": "名", "target": "名", "weight_delta": 0.1, "type": "可选新类型", "description": "可选"}},
    {{"op": "create_relation", "source": "名", "target": "名", "type": "ally", "weight": 0.6, "description": "可选"}},
    {{"op": "update_entity", "entity": "名", "properties": {{"mood": "喜悦", "goal": "..."}}}},
    {{"op": "set_prop_visibility", "entity": "信息所属者名", "key": "secret", "level": "entities", "entities": ["可知者1", "可知者2"]}},
    {{"op": "register_pending_event", "name": "学生会选举", "stakes": "主席之位归属", "participants": ["甲", "乙"], "due_tick": null}}
  ],
  "new_entities": [
    {{"op": "create_entity", "name": "新名", "type": "character", "properties": {{}}}}
  ]{event_schema}{ripe_schema}
}}

关系类型可选：ally, enemy, lover, family, rival, mentor, subordinate, member_of, located_at, participated, caused, followed_by, holds, owns, custom。"""
    messages = [
        {"role": "system", "content": "你是关系演化模拟器的全知裁决者，依据因果解算世界变更并判断悬决事件是否成熟。只返回JSON。"},
        {"role": "user", "content": prompt},
    ]
    try:
        result = await call_ai(messages, config=config, temperature=temperature, max_tokens=2048)
        parsed = json.loads(_strip_json(result))
        return {
            "mutations": parsed.get("mutations", []),
            "new_entities": parsed.get("new_entities", []) if allow_new_entities else [],
            "events": parsed.get("events", []) if generate_events else [],
            "ripe_events": parsed.get("ripe_events", []) or [],
        }
    except (json.JSONDecodeError, KeyError, httpx.HTTPError) as e:
        return {"mutations": [], "new_entities": [], "events": [], "ripe_events": [], "error": str(e)}


def _norm_event_name(name: str) -> str:
    import unicodedata
    return unicodedata.normalize("NFKC", name or "").strip().lower()


async def ai_filter_event_duplicates(
    candidates: list[dict],
    existing: list[dict],
    *,
    config: dict | None = None,
    temperature: float = 0.1,
) -> list[dict]:
    """LLM semantic dedupe: drop candidates that rephrase an existing event/pending.

    Each candidate: {name, summary?|stakes?|description?, kind?: crystallize|pending}
    Each existing:   {name, status, summary?|stakes?|description?, tick?}
  On LLM failure, falls back to exact normalized name matching against existing."""
    if not candidates:
        return []
    if not existing:
        return list(candidates)

    cand_lines: list[str] = []
    for i, c in enumerate(candidates):
        kind = c.get("kind") or "event"
        name = (c.get("name") or "").strip()
        detail = (c.get("summary") or c.get("stakes") or c.get("description") or "").strip()
        cand_lines.append(f"  {i}. [{kind}] {name} — {detail[:120]}")

    exist_lines: list[str] = []
    for e in existing[:60]:
        st = e.get("status") or "?"
        name = (e.get("name") or "").strip()
        detail = (e.get("summary") or e.get("stakes") or e.get("description") or "").strip()
        tick = e.get("tick", "")
        tick_s = f"t{tick}" if tick not in ("", None) else ""
        exist_lines.append(f"  · [{st}] {name} {tick_s} — {detail[:120]}")

    prompt = f"""你是事件去重裁判。判断「候选」是否只是在复述「已有事件」中**已发生（resolved）或已在悬决（pending）**的同一实质冲突，应剔除重复项。

判定为重复（剔除）：
- 仅换标题/措辞，同一对峙或博弈（如反复「逼问用药记录」「当众确认遗嘱真伪」「周伯逼陈律表态」）
- 候选 pending 但已有 resolved/pending 覆盖同一赌注与当事人
- 候选 crystallize 本 tick 动作，但主题与近期 resolved 完全相同且无新事实

判定为不重复（保留）：
- 明确新阶段、新信息、新后果（如「警方登岛」「人质被带走」「新证据来源被确认」）
- 同一主线上的**下一阶段**（前一事件已结算且本候选推进到不同结果）

去重从严：当候选与已有事件涉及**同一批当事人、同一主题**，且看不出明确的新事实/新结果时，一律判为重复剔除。"X引开Y""再次逼问""又一次对峙"这类同义重复必须折叠到首个事件，不要逐次结晶。只有确实推进到新结果时才保留。

【已有事件】
{chr(10).join(exist_lines)}

【候选（0-based 编号）】
{chr(10).join(cand_lines)}

只返回 JSON：{{"keep_indices": [0, 2, ...]}} — 应保留的候选编号。"""

    messages = [
        {"role": "system", "content": "你是事件语义去重裁判。只返回 JSON。"},
        {"role": "user", "content": prompt},
    ]
    try:
        result = await call_ai(messages, config=config, temperature=temperature, max_tokens=512)
        parsed = json.loads(_strip_json(result))
        indices = parsed.get("keep_indices")
        if not isinstance(indices, list):
            raise ValueError("missing keep_indices")
        keep = {int(i) for i in indices if isinstance(i, (int, float)) and 0 <= int(i) < len(candidates)}
        return [c for i, c in enumerate(candidates) if i in keep]
    except (json.JSONDecodeError, KeyError, ValueError, httpx.HTTPError):
        existing_names = {_norm_event_name(e.get("name", "")) for e in existing}
        return [
            c for c in candidates
            if _norm_event_name(c.get("name", "")) not in existing_names
        ]


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


async def ai_generate_nudge(
    target_name: str,
    world_blurb: str,
    *,
    intensity: float = 0.5,
    config: dict | None = None,
    temperature: float = 0.9,
) -> str:
    """Oracle heuristic-perturbation pass (plan decision 12 / step 0).

    The omniscient Oracle periodically delivers a fuzzy "intuition / hunch" to a
    target agent — modelling real-world intuition, inspiration, coincidence, and
    randomness so pure logical inference doesn't run the world dead. The Oracle
    sees the whole world but MUST output only a vague impulse, never a directly
    actionable truth — so it can't pollute the information asymmetry (it lands as
    a low-salience "预感" memory the agent may act on).

    Returns a short impulse string (≤40 chars), or "" on failure / if nothing fits.
    """
    strength = (
        "强烈而清晰" if intensity >= 0.75 else
        "若有若无、几乎抓不住" if intensity <= 0.35 else "模糊但挥之不去"
    )
    prompt = f"""你是关系演化模拟器的「天意 / 缪斯」(全知 Oracle)。请给角色「{target_name}」投递一个{strength}的**直觉 / 预感 / 冲动**，模拟现实里的灵感、巧合与随机性，让 TA 这一刻产生某种想做点什么的念头。

【你所知的世界片段（仅供你参考，不要原样泄露给角色）】
{world_blurb or '（无）'}

铁则：
- 只能是**模糊的情绪/冲动/预感**，绝不能包含任何具体、可直接坐实的真相或信息（不能告诉 TA 谁做了什么、某个秘密是什么）。
- 不替角色做决定，只给一个朝向（想接近谁、想远离、想确认某事、隐隐的不安/期待等）。
- 一句话，40字以内，第二人称或无主语，像心里忽然冒出的念头。

只返回这句预感正文，不要引号、不要解释、不要JSON。"""
    messages = [
        {"role": "system", "content": "你是全知的天意/缪斯，只向角色投递模糊的直觉冲动，绝不泄露具体真相。只返回一句预感正文。"},
        {"role": "user", "content": prompt},
    ]
    try:
        text = (await call_ai(messages, config=config, temperature=temperature, max_tokens=128) or "").strip()
        # Strip stray quotes/fences a model might add.
        text = text.strip('「」"\'` ').split("\n")[0].strip()
        return text[:60]
    except (httpx.HTTPError, KeyError) as e:
        return ""


async def ai_resolve_event(
    event_name: str,
    stakes: str,
    world_state: str,
    recent_context: str,
    *,
    config: dict | None = None,
    temperature: float = 0.5,
) -> dict:
    """Resolution pass — derive a pending event's outcome from world state only.

    Returns {"outcome": str, "consequences": [mutation, ...]}.
    """
    consequence_rule = (
        "consequences 的幅度由参与者力量对比、关系与处境的因果分量决定："
        "关系变化用 update_relation/create_relation，地位/角色/目标/情绪写进 update_entity。"
        "不为制造转折而放大，也不为求稳而抹平；但 outcome 须明确改变世界状态。"
    )

    prompt = f"""你是关系演化模拟器的「推演结算器」。一个悬而未决的事件条件已成熟，必须发生并给出结果。
请**仅依据当前世界状态因果推演**——谁占上风、谁握筹码、关系与处境如何，结果便如何。**没有导演编排结局**。

【要结算的事件】{event_name}
【此事在博弈什么】{stakes or '（未明确，请据状态合理判断）'}

【相关世界状态】
{world_state or '（无更多信息）'}

【近期相关剧情】
{recent_context or '（无）'}

推演规则：
- 结果由上述状态推导出的最可能结局；可有偶然性，但不得违背力量对比与情理。
- outcome：一句**事实记录**，点明发生了什么、各方结局如何（将作为既定事实写入世界与记忆）。
- {consequence_rule}
- 结算后当事人面对的是余波，不应仍停在事件前夜。
- participant_goal_status：判断每个参与者「围绕此事的目标」是否随结算了结——
  `achieved`（已达成）/ `defeated`（已落空、不可能再实现）/ `ongoing`（尚未了结，仍会继续追求）。
  赢家与认输者多为 achieved/defeated；只有目标确实悬而未决的才是 ongoing。
  已了结者将停止追逐此目标，不要让其永远纠缠同一场博弈。

只返回 JSON：
{{
  "outcome": "一句事实记录",
  "consequences": [
    {{"op": "update_entity", "entity": "名", "properties": {{"goal": "...", "mood": "..."}}}},
    {{"op": "update_relation", "source": "名", "target": "名", "weight_delta": -0.2, "type": "可选新类型"}}
  ],
  "participant_goal_status": {{"参与者名": "achieved|defeated|ongoing"}}
}}

关系类型可选：ally, enemy, lover, family, rival, mentor, subordinate, member_of, located_at, participated, caused, followed_by, holds, owns, custom。"""
    messages = [
        {"role": "system", "content": "你是推演结算器，仅依据世界状态因果地推演出悬决事件的结果并落成具体世界变更。绝不从外部编排结局。只返回JSON。"},
        {"role": "user", "content": prompt},
    ]
    try:
        result = await call_ai(messages, config=config, temperature=temperature, max_tokens=1024)
        parsed = json.loads(_strip_json(result))
        goal_status = parsed.get("participant_goal_status")
        if not isinstance(goal_status, dict):
            goal_status = {}
        return {
            "outcome": (parsed.get("outcome") or "").strip(),
            "consequences": parsed.get("consequences") or [],
            "participant_goal_status": goal_status,
        }
    except (json.JSONDecodeError, KeyError, httpx.HTTPError) as e:
        return {"outcome": "", "consequences": [], "participant_goal_status": {}, "error": str(e)}


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
        return (await call_ai(messages, config=config, temperature=0.3, max_tokens=512) or "").strip()
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
