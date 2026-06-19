import { create } from 'zustand';
import { api } from '../services/api';
import { useAppStore } from './appStore';

export interface SimTick {
  id: string;
  tick: number;
  interactions: any;
  mutations: any;
  snapshot: any;
  metrics: any;
}

export interface Simulation {
  id: string;
  project_id: string;
  name: string;
  status: string;
  driver_mode: string;
  current_tick: number;
  config: Record<string, any>;
}

interface SimState {
  sims: Simulation[];
  sim: Simulation | null;
  ticks: SimTick[];        // accumulated narrative feed (tick 1..n)
  stepping: boolean;
  isPlaying: boolean;      // background loop active (P5)
  scrubTick: number | null; // timeline scrub position; null = live/latest
  error: string | null;
  pauseNotice: { reason: string; tick: number } | null; // 落幕提示 (quiescent / max_ticks)
  writebackItems: any[];
  writebackPreview: any | null;

  loadSims: () => Promise<void>;
  selectSim: (simId: string) => Promise<void>;
  createSim: (driverMode?: string, config?: Record<string, any>) => Promise<Simulation | null>;
  step: () => Promise<void>;
  play: () => Promise<void>;
  pause: () => Promise<void>;
  resetSim: () => Promise<void>;
  setScrubTick: (tick: number | null) => void;
  patchConfig: (body: { driver_mode?: string; config?: Record<string, any> }) => Promise<void>;
  _subscribe: () => void;
  reset: () => void;
  loadWritebackQueue: (status?: string) => Promise<void>;
  previewWriteback: (ids: string[], depth: string) => Promise<void>;
  applyWriteback: (ids: string[], depth?: string) => Promise<void>;
  updateWritebackConfig: (patch: Record<string, unknown>) => Promise<void>;
}

// SSE connection is kept outside the store (not serializable).
let _es: EventSource | null = null;

function _closeStream() {
  if (_es) {
    _es.close();
    _es = null;
  }
}

/** Merge a tick into the feed — one row per tick number; newer payload wins. */
function _upsertTick(ticks: SimTick[], incoming: SimTick): SimTick[] {
  const next = ticks.filter((t) => t.tick !== incoming.tick && t.id !== incoming.id);
  next.push(incoming);
  return next.sort((a, b) => a.tick - b.tick);
}

/** Collapse duplicate tick numbers from API (legacy race rows). */
function _dedupeTicksByNumber(ticks: SimTick[]): SimTick[] {
  const byTick = new Map<number, SimTick>();
  for (const t of ticks) byTick.set(t.tick, t);
  return [...byTick.values()].sort((a, b) => a.tick - b.tick);
}

async function _syncTicksFromServer(projectId: string, simId: string) {
  try {
    const all = await api.getTicks(projectId, simId);
    const ticks = _dedupeTicksByNumber(all.filter((t: SimTick) => t.tick > 0));
    useSimStore.setState((s) => {
      const sim = s.sim
        ? { ...s.sim, current_tick: ticks.length ? ticks[ticks.length - 1].tick : s.sim.current_tick }
        : s.sim;
      return { ticks, sim, sims: sim ? s.sims.map((x) => (x.id === sim.id ? sim : x)) : s.sims };
    });
  } catch {
    /* best-effort reconcile */
  }
}

export const useSimStore = create<SimState>((set, get) => ({
  sims: [],
  sim: null,
  ticks: [],
  stepping: false,
  isPlaying: false,
  scrubTick: null,
  error: null,
  pauseNotice: null,
  writebackItems: [],
  writebackPreview: null,

  loadSims: async () => {
    const projectId = useAppStore.getState().project?.id;
    if (!projectId) return;
    try {
      const sims = await api.listSimulations(projectId);
      set({ sims });
      // Auto-select the most recent if none chosen yet.
      if (!get().sim && sims.length > 0) {
        await get().selectSim(sims[0].id);
      }
    } catch (e: any) {
      set({ error: String(e?.message || e) });
    }
  },

  selectSim: async (simId) => {
    const projectId = useAppStore.getState().project?.id;
    if (!projectId) return;
    try {
      _closeStream();
      const [sim, ticks] = await Promise.all([
        api.getSimulation(projectId, simId),
        api.getTicks(projectId, simId),
      ]);
      // Skip the tick-0 baseline row in the narrative feed.
      set({ sim, ticks: _dedupeTicksByNumber(ticks.filter((t) => t.tick > 0)), scrubTick: null, isPlaying: sim.status === 'running' });
      if (sim.status === 'running') get()._subscribe();
    } catch (e: any) {
      set({ error: String(e?.message || e) });
    }
  },

  createSim: async (driverMode = 'hybrid', config) => {
    const projectId = useAppStore.getState().project?.id;
    if (!projectId) return null;
    try {
      const sim = await api.createSimulation(projectId, { driver_mode: driverMode, config });
      set((s) => ({ sims: [sim, ...s.sims], sim, ticks: [], scrubTick: null, isPlaying: false }));
      return sim;
    } catch (e: any) {
      set({ error: String(e?.message || e) });
      return null;
    }
  },

  step: async () => {
    const projectId = useAppStore.getState().project?.id;
    const sim = get().sim;
    if (!projectId || !sim || get().stepping || get().isPlaying || sim.status === 'running') return;
    set({ stepping: true, error: null, pauseNotice: null });
    try {
      const res = await api.stepSimulation(projectId, sim.id);
      set((s) => ({
        sim: res.simulation,
        sims: s.sims.map((x) => (x.id === res.simulation.id ? res.simulation : x)),
        ticks: _upsertTick(s.ticks, res.tick),
        stepping: false,
      }));
      // A tick mutated canonical Entity/Relation rows — refresh the main graph
      // so the relations/events views reflect the evolved world.
      await useAppStore.getState().loadProjectData(projectId);
    } catch (e: any) {
      set({ stepping: false, error: String(e?.message || e) });
    }
  },

  play: async () => {
    const projectId = useAppStore.getState().project?.id;
    const sim = get().sim;
    if (!projectId || !sim || get().isPlaying) return;
    set({ error: null, isPlaying: true, scrubTick: null, pauseNotice: null });
    // Subscribe before the loop starts so the first tick is not missed.
    get()._subscribe();
    try {
      const res = await api.playSimulation(projectId, sim.id);
      set((s) => ({
        sim: res.simulation,
        sims: s.sims.map((x) => (x.id === res.simulation.id ? res.simulation : x)),
        isPlaying: true,
      }));
    } catch (e: any) {
      _closeStream();
      set({ isPlaying: false, error: String(e?.message || e) });
    }
  },

  pause: async () => {
    const projectId = useAppStore.getState().project?.id;
    const sim = get().sim;
    if (!projectId || !sim) return;
    try {
      const res = await api.pauseSimulation(projectId, sim.id);
      _closeStream();
      set((s) => ({
        sim: res.simulation,
        sims: s.sims.map((x) => (x.id === res.simulation.id ? res.simulation : x)),
        isPlaying: false,
      }));
      // Sync the canonical graph after the loop's accumulated mutations.
      await useAppStore.getState().loadProjectData(projectId);
    } catch (e: any) {
      set({ error: String(e?.message || e) });
    }
  },

  resetSim: async () => {
    const projectId = useAppStore.getState().project?.id;
    const sim = get().sim;
    if (!projectId || !sim) return;
    _closeStream();
    set({ error: null });
    try {
      const res = await api.resetSimulation(projectId, sim.id);
      set((s) => ({
        sim: res.simulation,
        sims: s.sims.map((x) => (x.id === res.simulation.id ? res.simulation : x)),
        ticks: [],
        scrubTick: null,
        isPlaying: false,
      }));
      // The world was restored to its tick-0 baseline — refresh the canvas.
      await useAppStore.getState().loadProjectData(projectId);
    } catch (e: any) {
      set({ error: String(e?.message || e) });
    }
  },

  setScrubTick: (tick) => set({ scrubTick: tick }),

  patchConfig: async (body) => {
    const projectId = useAppStore.getState().project?.id;
    const sim = get().sim;
    if (!projectId || !sim) return;
    try {
      const updated = await api.patchSimConfig(projectId, sim.id, body);
      set((s) => ({ sim: updated, sims: s.sims.map((x) => (x.id === updated.id ? updated : x)) }));
    } catch (e: any) {
      set({ error: String(e?.message || e) });
    }
  },

  _subscribe: () => {
    const projectId = useAppStore.getState().project?.id;
    const sim = get().sim;
    if (!projectId || !sim) return;
    _closeStream();
    const es = new EventSource(api.streamUrl(projectId, sim.id));
    _es = es;
    es.onopen = () => {
      void _syncTicksFromServer(projectId, sim.id);
    };
    es.onmessage = (ev) => {
      let msg: any;
      try { msg = JSON.parse(ev.data); } catch { return; }
      if (msg.type === 'tick' && msg.tick) {
        set((s) => {
          const ticks = _upsertTick(s.ticks, msg.tick);
          const sim = s.sim ? { ...s.sim, current_tick: msg.tick.tick } : s.sim;
          return { ticks, sim, sims: s.sims.map((x) => (sim && x.id === sim.id ? sim : x)) };
        });
        // Keep the main graph in step with the evolving world.
        useAppStore.getState().loadProjectData(projectId);
      } else if (msg.type === 'paused') {
        _closeStream();
        const notice = (msg.reason === 'quiescent' || msg.reason === 'max_ticks')
          ? { reason: msg.reason as string, tick: Number(msg.tick ?? get().sim?.current_tick ?? 0) }
          : null;
        set({ isPlaying: false, pauseNotice: notice });
        const pid = useAppStore.getState().project?.id;
        const sid = get().sim?.id;
        if (pid && sid) {
          void _syncTicksFromServer(pid, sid);
          api.getSimulation(pid, sid).then((sim) =>
            set((s) => ({ sim, sims: s.sims.map((x) => (x.id === sim.id ? sim : x)) }))
          ).catch(() => {});
        }
      } else if (msg.type === 'error') {
        set({ error: msg.message || 'simulation loop error' });
      }
    };
    es.onerror = () => {
      // EventSource auto-reconnects; onopen will reconcile ticks from the server.
    };
  },

  reset: () => {
    _closeStream();
    set({ sim: null, ticks: [], scrubTick: null, isPlaying: false, error: null, pauseNotice: null, writebackItems: [], writebackPreview: null });
  },

  loadWritebackQueue: async (status = 'pending') => {
    const projectId = useAppStore.getState().project?.id;
    const sim = get().sim;
    if (!projectId || !sim) return;
    try {
      const data = await api.listWriteback(projectId, sim.id, status);
      set({ writebackItems: data.items });
    } catch (e: any) {
      set({ error: String(e?.message || e) });
    }
  },

  previewWriteback: async (ids, depth) => {
    const projectId = useAppStore.getState().project?.id;
    const sim = get().sim;
    if (!projectId || !sim) return;
    const data = await api.previewWriteback(projectId, sim.id, ids, depth);
    set({ writebackPreview: data });
  },

  applyWriteback: async (ids, depth) => {
    const projectId = useAppStore.getState().project?.id;
    const sim = get().sim;
    if (!projectId || !sim) return;
    const res = await api.applyWriteback(projectId, sim.id, ids, depth);
    if (res.simulation) {
      set((s) => ({
        sim: res.simulation,
        sims: s.sims.map((x) => (x.id === res.simulation.id ? res.simulation : x)),
        writebackPreview: null,
      }));
    }
  },

  updateWritebackConfig: async (patch) => {
    const projectId = useAppStore.getState().project?.id;
    const sim = get().sim;
    if (!projectId || !sim) return;
    const updated = await api.patchWritebackConfig(projectId, sim.id, patch);
    set((s) => ({
      sim: updated,
      sims: s.sims.map((x) => (x.id === updated.id ? updated : x)),
    }));
  },
}));
