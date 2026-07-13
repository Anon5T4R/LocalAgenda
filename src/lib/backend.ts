// Wrappers dos comandos Rust (Tauri v2: chaves camelCase no invoke).
// Fora do Tauri (dev no navegador puro) os comandos viram no-ops/tolerantes,
// pra a UI ainda renderizar.

import { invoke } from "@tauri-apps/api/core";
import type { Alarm, AgendaEvent, Calendar, Reminder, Settings, Task } from "./types";

export function inTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

function cmd<T>(name: string, args: Record<string, unknown> = {}): Promise<T> {
  if (!inTauri()) return Promise.reject(new Error(`fora do Tauri: ${name}`));
  return invoke<T>(name, args);
}

// --- arquivos / IA ---
export const getStartupFile = () => cmd<string | null>("get_startup_file");
export const readFileBase64 = (path: string) => cmd<string>("read_file_base64", { path });
export const writeTextFile = (path: string, content: string) =>
  cmd<void>("write_text_file", { path, content });

// --- calendários ---
export const calendarsList = () => cmd<Calendar[]>("calendars_list");
export const calendarSave = (cal: Calendar) => cmd<Calendar>("calendar_save", { cal });
export const calendarDelete = (id: string) => cmd<void>("calendar_delete", { id });

// --- eventos ---
export const eventsList = () => cmd<AgendaEvent[]>("events_list");
export const eventSave = (event: AgendaEvent) => cmd<AgendaEvent>("event_save", { event });
export const eventDelete = (id: string) => cmd<void>("event_delete", { id });

// --- tarefas ---
export const tasksList = () => cmd<Task[]>("tasks_list");
export const taskSave = (task: Task) => cmd<Task>("task_save", { task });
export const taskDelete = (id: string) => cmd<void>("task_delete", { id });

// --- lembretes ---
export const remindersReplace = (items: Reminder[]) => cmd<void>("reminders_replace", { items });
export const reminderSnooze = (id: string, minutes: number) =>
  cmd<void>("reminder_snooze", { id, minutes });
export const remindersDispatch = () => cmd<void>("reminders_dispatch");
export const notify = (title: string, body: string) => cmd<void>("notify", { title, body });

// --- alarmes ---
export const alarmsList = () => cmd<Alarm[]>("alarms_list");
export const alarmSave = (alarm: Alarm) => cmd<Alarm>("alarm_save", { alarm });
export const alarmDelete = (id: string) => cmd<void>("alarm_delete", { id });

// --- configurações ---
export const settingsGet = () => cmd<Partial<Settings>>("settings_get");
export const settingsSet = (value: Settings) => cmd<void>("settings_set", { value });

// --- backup ---
export const dbExport = (path: string) => cmd<void>("db_export", { path });
export const dbImport = (path: string) => cmd<void>("db_import", { path });

// --- autostart ---
export const autostartGet = () => cmd<boolean>("autostart_get");
export const autostartSet = (enabled: boolean) => cmd<void>("autostart_set", { enabled });

// --- IA (llama-server) ---
export interface ModelInfo {
  name: string;
  path: string;
  sizeGb: number;
}
export interface LlmStatus {
  running: boolean;
  port: number;
  model: string;
}
export const listModels = (dir: string) => cmd<ModelInfo[]>("list_models", { dir });
export const startLlm = (modelPath: string, nGpuLayers: number, ctxSize: number) =>
  cmd<number>("start_llm", { modelPath, nGpuLayers, ctxSize });
export const stopLlm = () => cmd<void>("stop_llm");
export const llmStatus = () => cmd<LlmStatus>("llm_status");
