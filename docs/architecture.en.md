# WorldBuilder architecture overview

[简体中文](architecture.md) · **English**

> In one line: WorldBuilder treats "writing a world bible" as an **intelligence investigation**, then uses a **causal-deduction engine** to let that world move forward on its own.
>
> This document speaks in diagrams to help you build a mental model of the whole project in ten minutes. For per-module implementation details, see [`simulation-engine.en.md`](simulation-engine.en.md) (the deduction engine) and [`import-export.en.md`](import-export.en.md) (import/export).

---

## 1. The whole picture in one diagram

WorldBuilder is not a single application, but **one knowledge-graph core + two engines + one external bridge**. The knowledge graph is the single source of truth; both engines read from it and write back to it, and the SillyTavern bridge connects all of this into roleplay dialogue.

```mermaid
graph TB
    subgraph FE["Frontend · React 19 + Vite"]
        Canvas["Relation canvas<br/>@xyflow + ELK"]
        Sim["Simulator panel<br/>interaction feed / belief-truth / writeback"]
        WB["World book · event graph · timeline"]
    end

    subgraph BE["Backend · FastAPI + SQLAlchemy (async)"]
        direction TB
        Routers["routers/<br/>projects·entities·relations<br/>simulations·beliefs·transforms"]
        subgraph Core["Knowledge graph core"]
            GraphEngine["in-memory graph engine<br/>adjacency list · N-hop · conflict detection"]
            DB[("SQLite<br/>entities/relations/beliefs/memory/snapshots")]
        end
        subgraph Engines["Two engines"]
            E1["① graph-distance context injection<br/>graph/visibility·worldbook"]
            E2["② causal-deduction simulator<br/>simulation·belief·memory·sim_runner"]
        end
    end

    AI["OpenRouter<br/>(OpenAI-compatible, configurable model)"]
    ST["SillyTavern<br/>roleplay dialogue"]

    FE <-->|REST / SSE| Routers
    Routers --> Core
    Engines --> Core
    E2 -->|Actor / Oracle / Resolve| AI
    E1 -->|inference·conflict·backstory| AI
    ST <-->|st-plugin v0.6<br/>context injection + dialogue writeback| Routers

    style Core fill:#1f2937,stroke:#60a5fa,color:#e5e7eb
    style Engines fill:#1f2937,stroke:#34d399,color:#e5e7eb
```

**Why "two engines" and not one?** They solve two different problems of the same world:

| | ① Graph-distance context injection | ② Causal-deduction simulator |
|---|---|---|
| **Question answered** | "Which settings should I feed the AI right now?" | "If I let this world run by itself, what happens?" |
| **View of time** | Static snapshot (the graph as it is now) | Dynamic advance (tick by tick) |
| **What it replaces** | The keyword bulk injection of traditional Lorebooks | A plot director / three-act script |
| **Core mechanism** | N-hop graph query + fog of war | Actor/Oracle two-stage LLM + pending settlement |
| **Entry code** | `graph/engine.py` · `graph/visibility.py` | `services/simulation.py` · `services/sim_runner.py` |

---

## 2. Data model: everything hangs on the graph

The whole system has only one set of core tables. **Entities + relations** form the graph itself; the **simulation-related tables** (Simulation/SimTick/Belief/AgentMemory) all belong to a particular simulation — they are the graph's "copy and replay" along the time dimension.

```mermaid
erDiagram
    Project ||--o{ Entity : "owns"
    Project ||--o{ Relation : "owns"
    Project ||--o{ WorldEntry : "world book"
    Project ||--o{ Simulation : "may run multiple sims"
    Entity ||--o{ Relation : "source / target"
    Simulation ||--o{ SimTick : "one snapshot per tick"
    Simulation ||--o{ Belief : "one row per character×subject"
    Simulation ||--o{ AgentMemory : "each character's memory stream"
    Simulation ||--o{ StWritebackQueue : "dialogue pending writeback"

    Entity {
        string id PK
        string name "unique anchor (ST card binds by same name)"
        string type "character|location|event|item|faction"
        json properties "goal/role/mood/visibility…"
    }
    Relation {
        string source_id FK
        string target_id FK
        string type "ally|enemy|lover|member_of…"
        float weight "relation strength; deduction mutates it"
    }
    Belief {
        string observer_id FK "who is perceiving"
        string subject_id FK "who is perceived"
        json believed_properties "possibly-stale/wrong subjective copy"
        int as_of_tick "perception cut off at which tick"
    }
    AgentMemory {
        string entity_id FK
        int tick
        string kind "episodic|summary"
        float salience "importance (for retrieval)"
        json participants "those present (for retrieval)"
    }
    SimTick {
        int tick "0=initial, for replay/reset"
        json interactions
        json mutations "irreversible mutations landed this tick"
        json metrics "progress/llm_calls/tokens…"
    }
```

Three designs worth remembering:

- **`Entity.name` is a hard anchor.** ST character cards bind to entities by matching name; import/writeback both depend on its uniqueness.
- **`Relation.weight` is the fuel of deduction.** Relation strength isn't decorative — the simulator may mutate it every tick, and it in turn decides who meets whom and whether a conflict arises.
- **`Belief` and truth are two separate datasets.** This is the physical basis of "fog of war" and "information asymmetry" — see §5.

---

## 3. Engine ①: graph-distance context injection (replaces the keyword Lorebook)

Traditional Lorebooks rely on keyword matching, injecting everything on a hit — wasting tokens and easily "bleeding concepts" so the AI drifts off-model. WorldBuilder instead **runs an N-hop graph query from the characters currently on stage**, feeding the AI only the close-by settings, and can proactively warn about contradictions before injection.

```mermaid
flowchart LR
    A["characters on stage<br/>(ST card name + @mentions)"] --> B{"GraphEngine<br/>get_context()"}
    B -->|N-hop neighbors| C["related entities + relations"]
    C --> D{"visibility filter<br/>visibility.py"}
    D -->|observer's view| E["subgraph after fog of war"]
    E --> F["world-book hard retrieval<br/>global always-on + entity-mounted"]
    F --> G["assemble precise context"]
    G --> H["inject system message"]
    C -.->|detect_conflicts| X["⚠ contradiction warning<br/>friend-foe/personality/timeline"]

    style B fill:#1e3a5f,stroke:#60a5fa,color:#e5e7eb
    style D fill:#3f2937,stroke:#f59e0b,color:#e5e7eb
```

Hop count is configurable per scenario: Transform expansion, hostile factions, AI context, ST injection, and the exploration subgraph each have an independent depth. This lowers the "injection volume" from `O(all entries)` to "a precise subset bounded by graph distance".

---

## 4. Engine ②: the causal-deduction simulator — the lifecycle of one tick

The simulator's core creed is written into every prompt: **"The director doesn't decide what happens, the world state does."** The LLM plays only two roles — **Actor** (a character acting on their own subjective beliefs) and **Oracle** (the world adjudicating the entire tick) — not a screenwriter. Every outcome is **causally deduced** from relation weights, character goals, pending events, and belief copies.

```mermaid
sequenceDiagram
    autonumber
    participant R as sim_runner<br/>(background loop)
    participant S as simulation.run_tick
    participant Sch as Scheduler
    participant Act as Actor(LLM)
    participant Ora as Oracle(LLM)
    participant Mem as memory.py
    participant DB as SQLite

    R->>S: guarded_run_tick (lock-protected)
    opt heuristic nudge
        S->>S: Nudge a vague premonition (changes perception only, not the world)
    end
    Sch->>Sch: match encounter pairs by weight/random/conflict
    loop each encounter
        S->>Mem: get_memory_block(focal=opponent+goals+pending)
        Mem-->>S: three-dim weighted memory block (§6)
        S->>Act: initiator's belief copy → narrative + intent
    end
    S->>Ora: whole-tick adjudication
    Ora-->>S: relation mutations / event crystallization / pending registration / ripe_events
    opt causally ripe
        S->>S: ai_resolve_event → irreversible consequences + goal_status
    end
    S->>S: belief sync (participants update each other's copies)
    S->>Mem: append episodic memory (compress above threshold)
    S->>S: compute progress (was there "substantive advance")
    S->>DB: persist SimTick snapshot (interactions/mutations/metrics)
    S-->>R: progress?
    R->>R: accumulate stable_streak → decide whether to fall the curtain (§7)
```

Key point: **information asymmetry**. Each encounter generates narrative only from the **initiator's belief copy**; the opponent's perception is mechanically synced only afterward — so two characters can have different memories of the same event, which is exactly the source of tension in mystery deduction.

---

## 5. Belief layer: fog of war and information asymmetry

The `Belief` table gives each character a **possibly-stale, possibly-wrong** copy of the world. There is one canonical truth, and N characters means N subjective perceptions.

```mermaid
graph LR
    subgraph Truth["canonical truth (the entities/relations themselves)"]
        T1["Lin Su swapped the real will"]
    end
    subgraph Beliefs["each character's belief copy"]
        B1["Li Yanqiu thinks:<br/>the will is locked by me ✅ (stale)"]
        B2["Cheng Wan thinks:<br/>there's a trick in the wooden box ❓"]
        B3["Zhou Bo knows:<br/>the truth (close to canonical)"]
    end
    T1 -.->|mechanically synced after relate| B1
    T1 -.->|not yet perceived| B2
    T1 -.->|experienced firsthand| B3

    style Truth fill:#14532d,stroke:#34d399,color:#e5e7eb
    style Beliefs fill:#3f2937,stroke:#f59e0b,color:#e5e7eb
```

- The **frontend "Belief / Truth" panel** can switch observers to contrast their stale perception against the canonical truth.
- The **ST plugin has three Context modes**: `visibility` (character-card-view fog) / `truth` (omniscient) / `belief` (inject the subjective copy, may be stale).
- Beliefs are updated by `belief.sync_beliefs` after an encounter, and `reconcile_belief` re-derives goals after settlement.

---

## 6. Memory retrieval: from pure recency to three-dimensional weighting (homage to Generative Agents)

In each encounter, the Actor receives their "recent experiences". The early implementation took the most recent K by time alone — old-but-highly-relevant key memories (like an old grudge with the current opponent) would be crowded out by the latest small talk. Now, when given a focal, `get_memory_block` switches to **recency · relevance · importance** three-dimensional weighted scoring (mirroring GA `new_retrieve`, default weights `gw=[0.5, 3, 2]`) and takes the top-K.

```mermaid
flowchart TB
    F["focal = opponent name + both goals' phrases<br/>+ active pending name/stakes"] --> SC
    subgraph SC["three-dim scoring (pure function _score_memories)"]
        direction LR
        R["recency<br/>decay^rank"]
        Rel["relevance<br/>substring/participant overlap<br/>(Chinese-safe, zero embedding)"]
        I["importance<br/>stored salience"]
    end
    R --> N["normalize each to [0,1]"]
    Rel --> N
    I --> N
    N --> W["weighted sum<br/>0.5·R + 3·Rel + 2·I"]
    W --> K["top-K (rendered in tick order)"]
    K --> OUT["Actor memory block"]

    style Rel fill:#1e3a5f,stroke:#60a5fa,color:#e5e7eb
```

> **Boundary (holding the engine's philosophy)**: retrieval **only reorders which events the Actor recalls — it never rewrites world state or touches goals**. Setting `memory_weighted_retrieval=False` reverts to the pure time window in one switch. Validated on real data: when a character uses an old opponent as the focal, weighted retrieval recovers a high-`salience` settlement memory that the pure time window had discarded. Details in [`simulation-engine.en.md` §3.5](simulation-engine.en.md).

---

## 7. It doesn't write an ending, but it falls a curtain: pending events + progress

The simulator neither manufactures conflict to live forever by script, nor stalls into idle spinning. Two mechanisms cooperate to achieve "stopping naturally when the world reaches a new equilibrium".

**Pending events** are the engine's causal skeleton — a state machine:

```mermaid
stateDiagram-v2
    [*] --> pending: preset anchor / character autonomous registration
    pending --> pending: ripe signal before due_tick is ignored
    pending --> resolved: Oracle judges causally ripe (ripe)<br/>→ ai_resolve_event lands irreversible consequences
    resolved --> [*]: mark goal_status<br/>achieved/defeated → goal "settled"<br/>ongoing → reassign new goal
    note right of resolved
        A winner's goal becomes [settled],
        the conflict scan skips it,
        no longer "fighting a fight already won"
    end note
```

**Progress-based curtain**: the background loop judges "was there progress", not "did anything move" (the anti-exhaustion device guarantees a change every tick; judging by "did anything move" would never stop).

```mermaid
flowchart LR
    T["run_tick"] --> P{"substantive advance this tick?<br/>new event/settlement/net weight change >0.05<br/>/state-key change"}
    P -->|yes| Z["stable_streak = 0"]
    P -->|no<br/>only goal rewrite/mood tweak/belief sync| INC["stable_streak += 1"]
    INC --> C{">= stability_window (default 4)?"}
    C -->|yes| PAUSE["⏸ curtain pause<br/>reason=quiescent<br/>frontend shows 🎬 Act curtain"]
    C -->|no| T
    Z --> T

    style PAUSE fill:#3f2937,stroke:#f59e0b,color:#e5e7eb
```

---

## 8. SillyTavern bridge: connecting the graph into dialogue

`st-plugin/` (v0.6) hooks SillyTavern at two moments: before dialogue it injects precise context, and after dialogue it queues the plot for writeback into the simulator.

```mermaid
sequenceDiagram
    participant ST as SillyTavern
    participant P as st-plugin
    participant WB as WorldBuilder API

    Note over ST,WB: Before dialogue — injection
    ST->>P: CHAT_COMPLETION_PROMPT_READY
    P->>P: extract card name + @mentions
    P->>WB: GET /entities/context or /beliefs/context
    opt a Simulation is bound
        P->>WB: GET /simulations/{id}/memory-block
    end
    WB-->>P: precise context (by Context mode)
    P->>ST: inject system message

    Note over ST,WB: After dialogue — writeback (optional)
    ST->>P: GENERATION_END
    P->>WB: POST /st-writeback/queue
    Note over WB: "ST Writeback" panel:<br/>manual review / every_n_rounds / auto_llm
```

---

## 9. Module quick reference

| Concern | Look here |
|--------|--------|
| Routes / API | `backend/app/routers/` · FastAPI docs `http://localhost:8000/docs` |
| Graph query / N-hop / conflict detection | `backend/app/graph/engine.py` |
| Fog of war / visibility filter | `backend/app/graph/visibility.py` |
| World-book hard retrieval | `backend/app/graph/worldbook.py` |
| **Deduction main flow** `run_tick` | `backend/app/services/simulation.py` |
| Background auto-evolution loop / curtain pause | `backend/app/services/sim_runner.py` |
| Belief copies / information asymmetry / goals | `backend/app/services/belief.py` |
| Memory stream / three-dim weighted retrieval / compression | `backend/app/services/memory.py` |
| Actor / Oracle / settlement LLM | `backend/app/services/ai_service.py` |
| ST dialogue writeback | `backend/app/services/st_writeback.py` |
| Data model (all tables) | `backend/app/models/models.py` |
| No-LLM regression tests | `scripts/deduction_regression_test.py` · `scripts/sim_engine_regression_test.py` |
| Sample world (recommended closed mystery) | `scripts/manor_mystery_data.py` |

---

> To dive into the deduction engine (deduction settlement, progress checking, anti-exhaustion throttles, event-crystallization convergence, the full configuration table): **[`docs/simulation-engine.en.md`](simulation-engine.en.md)**.
