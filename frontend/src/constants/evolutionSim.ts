/** Preset simulation config for the 「演进测试」 project (mirrors scripts/evolution_test_data.py). */
export const EVOLUTION_SIM_CONFIG: Record<string, unknown> = {
  max_encounters_per_tick: 4,
  scheduler_strategy: 'weighted',
  scheduler_mix_conflict: true,
  generate_events: true,
  event_min_significance: 0.45,
  event_dedupe: true,
  tick_interval_sec: 8,
  nudge_strategy: 'weighted',
  nudge_every_n_ticks: 2,
  nudge_targets_per_tick: 2,
  nudge_intensity: 0.55,
  // 推演: outcomes derive from world state; pending_max_age prevents eternal pending.
  pending_max_age: 8,
};
