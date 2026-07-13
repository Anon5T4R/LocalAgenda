import { create } from "zustand";
import type { AgendaEvent, Task } from "../lib/types";

export interface ToastItem {
  id: string;
  title: string;
  body: string;
  /** id do lembrete no banco — habilita os botões de adiar (snooze). */
  reminderId?: string;
  kind?: string;
}

interface UiState {
  eventDraft: Partial<AgendaEvent> | null;
  taskDraft: Partial<Task> | null;
  showSettings: boolean;
  showAi: boolean;
  toasts: ToastItem[];

  openEvent(draft: Partial<AgendaEvent>): void;
  closeEvent(): void;
  openTask(draft: Partial<Task>): void;
  closeTask(): void;
  setSettings(v: boolean): void;
  setAi(v: boolean): void;

  pushToast(t: ToastItem): void;
  dismissToast(id: string): void;
}

export const useUi = create<UiState>((set, get) => ({
  eventDraft: null,
  taskDraft: null,
  showSettings: false,
  showAi: false,
  toasts: [],

  openEvent: (eventDraft) => set({ eventDraft }),
  closeEvent: () => set({ eventDraft: null }),
  openTask: (taskDraft) => set({ taskDraft }),
  closeTask: () => set({ taskDraft: null }),
  setSettings: (showSettings) => set({ showSettings }),
  setAi: (showAi) => set({ showAi }),

  pushToast: (t) => {
    // evita empilhar o mesmo lembrete duas vezes
    if (t.reminderId && get().toasts.some((x) => x.reminderId === t.reminderId)) return;
    set({ toasts: [...get().toasts, t] });
  },
  dismissToast: (id) => set({ toasts: get().toasts.filter((t) => t.id !== id) }),
}));
