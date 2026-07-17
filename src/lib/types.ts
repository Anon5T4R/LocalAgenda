// Espelho dos modelos do Rust (db.rs), camelCase.

export interface Calendar {
  id: string;
  name: string;
  color: string;
  visible: boolean;
  sort: number;
}

export interface AgendaEvent {
  id: string;
  calendarId: string;
  title: string;
  description: string;
  location: string;
  /** Hora de parede local: "YYYY-MM-DDTHH:MM" ou "YYYY-MM-DD" (dia inteiro). */
  start: string;
  end: string;
  allDay: boolean;
  /** RRULE RFC 5545 sem DTSTART; "" = evento único. */
  rrule: string;
  /** Ocorrências excluídas (início ISO de cada uma). */
  exdates: string[];
  /** Lembretes: minutos antes do início. */
  reminders: number[];
  createdAt: number;
  updatedAt: number;
}

export interface Task {
  id: string;
  title: string;
  notes: string;
  /** Prazo ISO local (ou data pura); "" = sem prazo. */
  due: string;
  /** 0 nenhuma · 1 baixa · 2 média · 3 alta. */
  priority: number;
  rrule: string;
  reminders: number[];
  parentId: string;
  /** Epoch-ms de conclusão; null = aberta. */
  doneAt: number | null;
  sort: number;
  createdAt: number;
  updatedAt: number;
}

export interface Alarm {
  id: string;
  /** "HH:MM" local. */
  time: string;
  label: string;
  /** Dias da semana (0=domingo…6=sábado); vazio = todo dia. */
  days: number[];
  enabled: boolean;
  sort: number;
}

export interface Reminder {
  id: string;
  kind: "event" | "task" | "summary" | "alarm";
  refId: string;
  occ: string;
  title: string;
  body: string;
  fireAt: number;
  fired: boolean;
}

/** Temas nomeados (paletas fixas) além de claro/escuro/sistema. */
export const NAMED_THEMES = ["nature", "darkblue", "calmgreen", "pastelpink", "punkprincess"] as const;

export type Theme = "light" | "dark" | "system" | (typeof NAMED_THEMES)[number];

export interface Settings {
  theme: Theme;
  /** Fechar a janela minimiza pra bandeja em vez de encerrar. */
  closeToTray: boolean;
  /** Domingo=0 … Sábado=6. Padrão: domingo. */
  firstDayOfWeek: number;
  /** Duração padrão de um evento novo, em minutos. */
  defaultDurationMin: number;
  /** Resumo do dia por notificação. */
  dailySummary: boolean;
  /** Horário do resumo do dia, "HH:MM". */
  dailySummaryTime: string;
  /** Pasta dos modelos GGUF (IA). */
  modelDir: string;
  /** Camadas na GPU pro llama (0 = só CPU). */
  nGpuLayers: number;
  /** Som nas notificações/alarmes. */
  soundEnabled: boolean;
  /** Volume do som (0..1). */
  soundVolume: number;
}

export const DEFAULT_SETTINGS: Settings = {
  theme: "system",
  closeToTray: true,
  firstDayOfWeek: 0,
  defaultDurationMin: 60,
  dailySummary: false,
  dailySummaryTime: "08:00",
  modelDir: "",
  nGpuLayers: 0,
  soundEnabled: true,
  soundVolume: 0.7,
};

export const CALENDAR_COLORS = [
  "#2563eb",
  "#16a34a",
  "#db2777",
  "#f59e0b",
  "#7c3aed",
  "#dc2626",
  "#0891b2",
  "#65a30d",
  "#ea580c",
  "#4b5563",
];

export const PRIORITY_LABELS = ["—", "Baixa", "Média", "Alta"];
export const PRIORITY_COLORS = ["#9ca3af", "#0891b2", "#f59e0b", "#dc2626"];
