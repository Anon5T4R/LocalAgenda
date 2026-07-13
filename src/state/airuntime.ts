import { create } from "zustand";
import { inTauri, listModels, llmStatus, startLlm, stopLlm, type ModelInfo } from "../lib/backend";

interface AiRuntime {
  port: number; // 0 = parado
  model: string;
  starting: boolean;
  error: string;
  models: ModelInfo[];

  refresh(): Promise<void>;
  loadModels(dir: string): Promise<void>;
  start(path: string, nGpu: number): Promise<number>;
  stop(): Promise<void>;
}

export const useAi = create<AiRuntime>((set) => ({
  port: 0,
  model: "",
  starting: false,
  error: "",
  models: [],

  async refresh() {
    if (!inTauri()) return;
    try {
      const s = await llmStatus();
      set({ port: s.running ? s.port : 0, model: s.model });
    } catch {
      /* ignore */
    }
  },

  async loadModels(dir) {
    set({ error: "" });
    try {
      const models = await listModels(dir);
      set({ models });
    } catch (e) {
      set({ error: String(e), models: [] });
    }
  },

  async start(path, nGpu) {
    set({ starting: true, error: "" });
    try {
      const port = await startLlm(path, nGpu, 4096);
      set({ port, model: path, starting: false });
      return port;
    } catch (e) {
      set({ starting: false, error: String(e) });
      throw e;
    }
  },

  async stop() {
    try {
      await stopLlm();
    } catch {
      /* ignore */
    }
    set({ port: 0, model: "" });
  },
}));
