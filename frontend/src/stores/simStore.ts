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
  error: string | null;

  loadSims: () => Promise<void>;
  selectSim: (simId: string) => Promise<void>;
  createSim: (driverMode?: string) => Promise<Simulation | null>;
  step: () => Promise<void>;
  reset: () => void;
}

export const useSimStore = create<SimState>((set, get) => ({
  sims: [],
  sim: null,
  ticks: [],
  stepping: false,
  error: null,

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
      const [sim, ticks] = await Promise.all([
        api.getSimulation(projectId, simId),
        api.getTicks(projectId, simId),
      ]);
      set({ sim, ticks });
    } catch (e: any) {
      set({ error: String(e?.message || e) });
    }
  },

  createSim: async (driverMode = 'hybrid') => {
    const projectId = useAppStore.getState().project?.id;
    if (!projectId) return null;
    try {
      const sim = await api.createSimulation(projectId, { driver_mode: driverMode });
      set((s) => ({ sims: [sim, ...s.sims], sim, ticks: [] }));
      return sim;
    } catch (e: any) {
      set({ error: String(e?.message || e) });
      return null;
    }
  },

  step: async () => {
    const projectId = useAppStore.getState().project?.id;
    const sim = get().sim;
    if (!projectId || !sim || get().stepping) return;
    set({ stepping: true, error: null });
    try {
      const res = await api.stepSimulation(projectId, sim.id);
      set((s) => ({
        sim: res.simulation,
        sims: s.sims.map((x) => (x.id === res.simulation.id ? res.simulation : x)),
        ticks: [...s.ticks, res.tick],
        stepping: false,
      }));
      // A tick mutated canonical Entity/Relation rows — refresh the main graph
      // so the relations/events views reflect the evolved world.
      await useAppStore.getState().loadProjectData(projectId);
    } catch (e: any) {
      set({ stepping: false, error: String(e?.message || e) });
    }
  },

  reset: () => set({ sim: null, ticks: [], error: null }),
}));
