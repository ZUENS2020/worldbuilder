# WorldBuilder ST Plugin — Manual Test Checklist

## Setup

- [ ] Backend running (`uvicorn app.main:app --reload`, port 8000)
- [ ] Plugin copied to SillyTavern `extensions/worldbuilder-context`
- [ ] Import test graph: `cd scripts && python3 seed_sim_test.py`

## Phase 1 — Visibility

- [ ] Set context_mode = `visibility`, character card = 小夏
- [ ] Chat triggers injection without 小夏 `secret` in block
- [ ] Set context_mode = `truth` — author view includes public props (not private secret unless self)
- [ ] Project dropdown lists「模拟器测试」
- [ ] Status shows entity count from `/api/health`
- [ ] Wrong character card name shows mapping warning

## Phase 2 — Belief

- [ ] context_mode = `belief`, observer = 林远
- [ ] Injection header says「信念上下文」
- [ ] After sim tick changes relations, belief text may differ from truth (BeliefPanel)

## Phase 3 — Memory

- [ ] Create simulation in WB, step 2+ ticks
- [ ] Enable `inject_memory`, bind simulation in plugin
- [ ] ST prompt includes「近期经历」block

## Phase 4 — Writeback

- [ ] Enable writeback + simulation in ST plugin
- [ ] Chat 2 rounds → WB「ST 回写」shows 2 pending rows with full messages
- [ ] `manual`: apply selected → memory API has rows, graph unchanged (mechanical)
- [ ] `every_n_rounds=2`: 2nd enqueue auto-applies
- [ ] `auto_llm`: each round applies + tick increments
- [ ] Preview does not mutate DB until Apply

## Phase 5 — UX

- [ ] `macro_only` does not auto-inject on prompt ready
- [ ] `before_scenario` / `after_char` positions work
- [ ] Last injection preview expands in settings
