import { create } from "zustand";
import {
  alarmDelete,
  alarmSave,
  alarmsList,
  calendarDelete,
  calendarSave,
  calendarsList,
  dbImport,
  eventDelete,
  eventSave,
  eventsList,
  inTauri,
  settingsGet,
  settingsSet,
  syncExternalChanged,
  syncNow,
  taskDelete,
  taskSave,
  tasksList,
} from "../lib/backend";
import { addDays } from "../lib/datetime";
import { nextOccurrenceAfter } from "../lib/recur";
import { syncReminders } from "../lib/reminders";
import {
  DEFAULT_SETTINGS,
  type Alarm,
  type AgendaEvent,
  type Calendar,
  type Settings,
  type Task,
} from "../lib/types";

export type ViewKind = "month" | "week" | "day" | "agenda";

function addMonths(date: Date, n: number): Date {
  return new Date(date.getFullYear(), date.getMonth() + n, 1);
}

function normalizeEvent(p: Partial<AgendaEvent>): AgendaEvent {
  return {
    id: p.id ?? "",
    calendarId: p.calendarId ?? "",
    title: p.title ?? "",
    description: p.description ?? "",
    location: p.location ?? "",
    start: p.start ?? "",
    end: p.end ?? "",
    allDay: p.allDay ?? false,
    rrule: p.rrule ?? "",
    exdates: p.exdates ?? [],
    seriesId: p.seriesId ?? "",
    recurrenceId: p.recurrenceId ?? "",
    reminders: p.reminders ?? [],
    createdAt: p.createdAt ?? 0,
    updatedAt: p.updatedAt ?? 0,
  };
}

function normalizeTask(p: Partial<Task>): Task {
  return {
    id: p.id ?? "",
    title: p.title ?? "",
    notes: p.notes ?? "",
    due: p.due ?? "",
    priority: p.priority ?? 0,
    rrule: p.rrule ?? "",
    reminders: p.reminders ?? [],
    parentId: p.parentId ?? "",
    doneAt: p.doneAt ?? null,
    sort: p.sort ?? 0,
    createdAt: p.createdAt ?? 0,
    updatedAt: p.updatedAt ?? 0,
  };
}

interface StoreState {
  loaded: boolean;
  calendars: Calendar[];
  events: AgendaEvent[];
  tasks: Task[];
  alarms: Alarm[];
  settings: Settings;

  view: ViewKind;
  cursor: Date;
  search: string;

  load(): Promise<void>;
  saveAlarm(a: Partial<Alarm>): Promise<void>;
  removeAlarm(id: string): Promise<void>;
  toggleAlarm(id: string): Promise<void>;
  setView(v: ViewKind): void;
  setCursor(d: Date): void;
  go(delta: number): void;
  goToday(): void;
  setSearch(s: string): void;

  saveCalendar(c: Partial<Calendar>): Promise<void>;
  removeCalendar(id: string): Promise<void>;
  toggleCalendar(id: string): Promise<void>;

  saveEvent(e: Partial<AgendaEvent>): Promise<AgendaEvent | null>;
  removeEvent(id: string): Promise<void>;
  excludeOccurrence(ev: AgendaEvent, occKey: string): Promise<void>;
  saveOccurrence(series: AgendaEvent, occKey: string, fields: Partial<AgendaEvent>): Promise<void>;
  removeOccurrence(ev: AgendaEvent, occKey: string): Promise<void>;

  saveTask(t: Partial<Task>): Promise<void>;
  removeTask(id: string): Promise<void>;
  toggleTask(id: string): Promise<void>;

  updateSettings(patch: Partial<Settings>): Promise<void>;
  refreshReminders(): Promise<void>;

  /**
   * `true` = o arquivo de sync mudou fora do app com alterações locais
   * pendentes — o flush parou de sobrescrever até o usuário decidir no
   * diálogo ("Recarregar do disco" / "Sobrescrever").
   */
  externalChange: boolean;
  /** Flush do autosave: confere mudança externa e, se ok, copia pro sync_path. */
  flushSyncSave(): Promise<void>;
  /** "Recarregar do disco": importa o arquivo de sync por cima do local. */
  reloadFromDisk(): Promise<void>;
  /** "Sobrescrever": mantém o local e grava por cima do arquivo de sync. */
  forceSave(): Promise<void>;
}

export const useStore = create<StoreState>((set, get) => ({
  loaded: false,
  calendars: [],
  events: [],
  tasks: [],
  alarms: [],
  settings: { ...DEFAULT_SETTINGS },

  view: "month",
  cursor: new Date(),
  search: "",
  externalChange: false,

  async load() {
    if (!inTauri()) {
      set({ loaded: true });
      return;
    }
    try {
      const [calendars, events, tasks, alarms, rawSettings] = await Promise.all([
        calendarsList(),
        eventsList(),
        tasksList(),
        alarmsList(),
        settingsGet(),
      ]);
      const settings = { ...DEFAULT_SETTINGS, ...rawSettings } as Settings;
      set({ calendars, events, tasks, alarms, settings, loaded: true });
      void get().refreshReminders();
    } catch (e) {
      console.error("falha ao carregar", e);
      set({ loaded: true });
    }
  },

  setView: (view) => set({ view }),
  setCursor: (cursor) => set({ cursor }),
  goToday: () => set({ cursor: new Date() }),
  setSearch: (search) => set({ search }),

  go(delta) {
    const { view, cursor } = get();
    if (view === "month") set({ cursor: addMonths(cursor, delta) });
    else if (view === "week" || view === "agenda") set({ cursor: addDays(cursor, delta * 7) });
    else set({ cursor: addDays(cursor, delta) });
  },

  async saveCalendar(c) {
    const cal: Calendar = {
      id: c.id ?? "",
      name: c.name ?? "Calendário",
      color: c.color ?? "#2563eb",
      visible: c.visible ?? true,
      sort: c.sort ?? get().calendars.length,
    };
    const saved = await calendarSave(cal);
    const rest = get().calendars.filter((x) => x.id !== saved.id);
    set({ calendars: [...rest, saved].sort((a, b) => a.sort - b.sort) });
    scheduleAutosave();
  },

  async removeCalendar(id) {
    await calendarDelete(id);
    set({
      calendars: get().calendars.filter((c) => c.id !== id),
      events: get().events.filter((e) => e.calendarId !== id),
    });
    scheduleAutosave();
    void get().refreshReminders();
  },

  async toggleCalendar(id) {
    const cal = get().calendars.find((c) => c.id === id);
    if (!cal) return;
    await get().saveCalendar({ ...cal, visible: !cal.visible });
  },

  async saveEvent(e) {
    const ev = normalizeEvent(e);
    if (!ev.calendarId) ev.calendarId = get().calendars[0]?.id ?? "";
    const saved = await eventSave(ev);
    const rest = get().events.filter((x) => x.id !== saved.id);
    set({ events: [...rest, saved] });
    scheduleAutosave();
    void get().refreshReminders();
    return saved;
  },

  async removeEvent(id) {
    // O Rust apaga em cascata (série + suas exceções); espelhamos aqui pra
    // não deixar exceção órfã na memória até o próximo load.
    await eventDelete(id);
    set({ events: get().events.filter((e) => e.id !== id && e.seriesId !== id) });
    scheduleAutosave();
    void get().refreshReminders();
  },

  /** Cancela uma ocorrência da série (EXDATE). Se ela era uma exceção, a
   *  exceção morre junto — cancelada e substituída são estados exclusivos. */
  async excludeOccurrence(ev, occKey) {
    const series = get().events.find((x) => x.id === (ev.seriesId || ev.id)) ?? ev;
    const override = get().events.find(
      (x) => x.seriesId === series.id && x.recurrenceId === occKey,
    );
    if (override) await get().removeEvent(override.id);
    if (series.exdates.includes(occKey)) return;
    await get().saveEvent({ ...series, exdates: [...series.exdates, occKey] });
  },

  /**
   * Grava a edição de UMA ocorrência de série como exceção (RECURRENCE-ID).
   * Cria na primeira vez e atualiza nas seguintes — reeditar a mesma terça não
   * pode gerar uma segunda exceção pro mesmo `occKey`.
   */
  async saveOccurrence(series, occKey, fields) {
    const existing = get().events.find(
      (x) => x.seriesId === series.id && x.recurrenceId === occKey,
    );
    await get().saveEvent({
      ...fields,
      id: existing?.id ?? "",
      createdAt: existing?.createdAt ?? 0,
      // A exceção nunca carrega regra própria: quem repete é a série.
      rrule: "",
      exdates: [],
      seriesId: series.id,
      recurrenceId: occKey,
    });
    // Se a ocorrência estava cancelada, editá-la a traz de volta como exceção
    // (senão a série continuaria calando e a exceção nova sumiria).
    if (series.exdates.includes(occKey)) {
      await get().saveEvent({ ...series, exdates: series.exdates.filter((d) => d !== occKey) });
    }
  },

  /**
   * Apaga UMA ocorrência, seja ela normal ou já excepcional. A exceção some e a
   * origem entra em `exdates` — sem isso a série ressuscitaria a ocorrência no
   * horário velho assim que a exceção saísse do índice.
   */
  async removeOccurrence(ev, occKey) {
    if (ev.seriesId && ev.recurrenceId) {
      const series = get().events.find((x) => x.id === ev.seriesId);
      await get().removeEvent(ev.id);
      if (series && !series.exdates.includes(ev.recurrenceId)) {
        await get().saveEvent({ ...series, exdates: [...series.exdates, ev.recurrenceId] });
      }
      return;
    }
    await get().excludeOccurrence(ev, occKey);
  },

  async saveTask(t) {
    const task = normalizeTask(t);
    if (task.sort === 0) task.sort = get().tasks.length;
    const saved = await taskSave(task);
    const rest = get().tasks.filter((x) => x.id !== saved.id);
    set({ tasks: [...rest, saved] });
    scheduleAutosave();
    void get().refreshReminders();
  },

  async removeTask(id) {
    await taskDelete(id);
    set({ tasks: get().tasks.filter((t) => t.id !== id && t.parentId !== id) });
    scheduleAutosave();
    void get().refreshReminders();
  },

  async toggleTask(id) {
    const t = get().tasks.find((x) => x.id === id);
    if (!t) return;
    const completing = !t.doneAt;
    // Tarefa recorrente sendo concluída: rola pro próximo prazo em vez de fechar.
    if (completing && t.rrule && t.due) {
      const from = new Date(new Date(t.due).getTime());
      const next = nextOccurrenceAfter(t.rrule, from, from);
      if (next) {
        const nextDue = t.due.includes("T")
          ? `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, "0")}-${String(next.getDate()).padStart(2, "0")}T${String(next.getHours()).padStart(2, "0")}:${String(next.getMinutes()).padStart(2, "0")}`
          : `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, "0")}-${String(next.getDate()).padStart(2, "0")}`;
        await get().saveTask({ ...t, due: nextDue, doneAt: null });
        return;
      }
    }
    await get().saveTask({ ...t, doneAt: completing ? Date.now() : null });
  },

  async saveAlarm(a) {
    const alarm: Alarm = {
      id: a.id ?? "",
      time: a.time ?? "07:00",
      label: a.label ?? "",
      days: a.days ?? [],
      enabled: a.enabled ?? true,
      sort: a.sort ?? get().alarms.length,
    };
    const saved = await alarmSave(alarm);
    const rest = get().alarms.filter((x) => x.id !== saved.id);
    set({ alarms: [...rest, saved].sort((x, y) => x.sort - y.sort) });
    scheduleAutosave();
    void get().refreshReminders();
  },

  async removeAlarm(id) {
    await alarmDelete(id);
    set({ alarms: get().alarms.filter((a) => a.id !== id) });
    scheduleAutosave();
    void get().refreshReminders();
  },

  async toggleAlarm(id) {
    const a = get().alarms.find((x) => x.id === id);
    if (!a) return;
    await get().saveAlarm({ ...a, enabled: !a.enabled });
  },

  async updateSettings(patch) {
    const settings = { ...get().settings, ...patch };
    set({ settings });
    scheduleAutosave();
    if (inTauri()) {
      await settingsSet(settings);
      void get().refreshReminders();
    }
  },

  async refreshReminders() {
    if (!inTauri()) return;
    const { events, tasks, settings, alarms } = get();
    try {
      await syncReminders(events, tasks, settings, alarms);
    } catch (e) {
      console.error("falha ao sincronizar lembretes", e);
    }
  },

  async flushSyncSave() {
    if (!inTauri()) return;
    const { settings, externalChange } = get();
    if (!settings.syncPath) return;
    if (externalChange) return; // decisão pendente: não sobrescreve o arquivo
    try {
      const changed = await syncExternalChanged();
      if (changed) {
        // Alguém mexeu no arquivo fora do app com alterações locais no ar:
        // segura a cópia e deixa o usuário decidir no diálogo.
        set({ externalChange: true });
        return;
      }
      await syncNow();
    } catch (e) {
      console.error("falha ao salvar no arquivo de sync", e);
    }
  },

  async reloadFromDisk() {
    if (!inTauri()) return;
    const { settings } = get();
    if (!settings.syncPath) return;
    try {
      // O Rust troca o banco local pelo arquivo de sync (com backup .bak) e
      // registra o fingerprint dele — a próxima sync não acusa mudança à toa.
      await dbImport(settings.syncPath);
      await get().load();
      set({ externalChange: false });
    } catch (e) {
      console.error("falha ao recarregar do disco", e);
    }
  },

  async forceSave() {
    if (!inTauri()) return;
    const { settings } = get();
    if (!settings.syncPath) return;
    try {
      await syncNow();
      set({ externalChange: false });
    } catch (e) {
      console.error("falha ao sobrescrever o arquivo de sync", e);
    }
  },
}));

/** Debounce do autosave: qualquer escrita reinicia os 2s. Na hora, o flush
 *  confere se o arquivo de sync mudou fora do app — se mudou, levanta o
 *  conflito em vez de sobrescrever por cima. */
const AUTOSAVE_DELAY_MS = 2000;
let autosaveTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleAutosave(): void {
  if (!inTauri()) return;
  if (autosaveTimer) clearTimeout(autosaveTimer);
  autosaveTimer = setTimeout(() => {
    autosaveTimer = null;
    void useStore.getState().flushSyncSave();
  }, AUTOSAVE_DELAY_MS);
}

/** Mapa id→cor de calendário. */
export function calendarColorMap(calendars: Calendar[]): Record<string, string> {
  const m: Record<string, string> = {};
  for (const c of calendars) m[c.id] = c.color;
  return m;
}

/**
 * Eventos dos calendários visíveis, opcionalmente filtrados pela busca.
 *
 * Exceção de série herda a decisão da SÉRIE no calendário (ela é a mesma
 * reunião, só deslocada) e casa a busca pelo texto dela OU pelo da série —
 * quem procura o nome da série tem que achar também a terça que foi movida.
 */
export function visibleEvents(state: {
  events: AgendaEvent[];
  calendars: Calendar[];
  search: string;
}): AgendaEvent[] {
  const hidden = new Set(state.calendars.filter((c) => !c.visible).map((c) => c.id));
  const q = state.search.trim().toLowerCase();
  const byId = new Map(state.events.map((e) => [e.id, e]));
  const matches = (e: AgendaEvent) =>
    e.title.toLowerCase().includes(q) ||
    e.location.toLowerCase().includes(q) ||
    e.description.toLowerCase().includes(q);
  return state.events.filter((e) => {
    const owner = (e.seriesId && byId.get(e.seriesId)) || e;
    if (hidden.has(owner.calendarId)) return false;
    if (!q) return true;
    return matches(e) || (owner !== e && matches(owner));
  });
}
