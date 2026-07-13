import { listen } from "@tauri-apps/api/event";
import { useEffect } from "react";
import { AgendaView } from "./components/AgendaView";
import { AiPanel } from "./components/AiPanel";
import { EventModal } from "./components/EventModal";
import { MonthView } from "./components/MonthView";
import { SettingsModal } from "./components/SettingsModal";
import { Sidebar } from "./components/Sidebar";
import { TasksPanel } from "./components/TasksPanel";
import { TaskModal } from "./components/TaskModal";
import { Toasts } from "./components/Toasts";
import { TopBar } from "./components/TopBar";
import { WeekView } from "./components/WeekView";
import { getStartupFile, inTauri, readFileBase64 } from "./lib/backend";
import { addDays, startOfWeek } from "./lib/datetime";
import { parseIcs } from "./lib/ics";
import type { Reminder } from "./lib/types";
import { useStore } from "./state/store";
import { useUi } from "./state/ui";

function b64ToText(b64: string): string {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder("utf-8").decode(bytes);
}

export default function App() {
  const { loaded, load, view, cursor, settings, go, goToday, setView } = useStore();
  const ui = useUi();

  // Carrega o banco na inicialização.
  useEffect(() => {
    void load();
  }, [load]);

  // Tema (claro/escuro/sistema).
  useEffect(() => {
    const apply = () => {
      const dark =
        settings.theme === "dark" ||
        (settings.theme === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
      document.documentElement.dataset.theme = dark ? "dark" : "light";
    };
    apply();
    if (settings.theme === "system") {
      const mq = window.matchMedia("(prefers-color-scheme: dark)");
      mq.addEventListener("change", apply);
      return () => mq.removeEventListener("change", apply);
    }
  }, [settings.theme]);

  // Lembretes disparados pelo Rust → toast in-app (com adiar).
  useEffect(() => {
    if (!inTauri()) return;
    const un = listen<Reminder>("reminder-fired", (e) => {
      const r = e.payload;
      useUi.getState().pushToast({
        id: crypto.randomUUID(),
        title: r.title,
        body: r.body,
        reminderId: r.kind === "summary" ? undefined : r.id,
        kind: r.kind,
      });
    });
    return () => {
      void un.then((f) => f());
    };
  }, []);

  // Abrir um .ics (arg de linha de comando ou "abrir com" numa 2ª instância).
  useEffect(() => {
    if (!inTauri()) return;
    const importPath = async (path: string) => {
      try {
        const text = b64ToText(await readFileBase64(path));
        const parsed = parseIcs(text);
        const calId = useStore.getState().calendars[0]?.id ?? "";
        for (const p of parsed) await useStore.getState().saveEvent({ ...p, calendarId: calId });
        if (parsed.length) {
          useUi.getState().pushToast({
            id: crypto.randomUUID(),
            title: "Importado",
            body: `${parsed.length} evento(s) do arquivo .ics`,
            kind: "summary",
          });
          setView("agenda");
        }
      } catch (err) {
        console.error("falha ao importar .ics", err);
      }
    };
    void getStartupFile().then((p) => {
      if (p && p.toLowerCase().endsWith(".ics")) void importPath(p);
    });
    const un = listen<string>("open-file", (e) => {
      if (e.payload.toLowerCase().endsWith(".ics")) void importPath(e.payload);
    });
    return () => {
      void un.then((f) => f());
    };
  }, [setView]);

  // Atalhos de teclado.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable)) return;
      const st = useUi.getState();
      if (st.eventDraft || st.taskDraft || st.showSettings || st.showAi) return;
      switch (e.key) {
        case "ArrowLeft":
          go(-1);
          break;
        case "ArrowRight":
          go(1);
          break;
        case "t":
        case "T":
          goToday();
          break;
        case "m":
          setView("month");
          break;
        case "w":
          setView("week");
          break;
        case "d":
          setView("day");
          break;
        case "a":
          setView("agenda");
          break;
        case "n":
          useUi.getState().openEvent({ start: "", end: "" });
          break;
        default:
          return;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [go, goToday, setView]);

  if (!loaded) return <div className="loading">Carregando…</div>;

  const weekDays = Array.from({ length: 7 }, (_, i) => addDays(startOfWeek(cursor, settings.firstDayOfWeek), i));

  return (
    <div className="app">
      <TopBar />
      <div className="body-row">
        <Sidebar />
        <main className="main">
          {view === "month" && <MonthView />}
          {view === "week" && <WeekView days={weekDays} />}
          {view === "day" && <WeekView days={[cursor]} />}
          {view === "agenda" && <AgendaView />}
        </main>
        <TasksPanel />
      </div>

      {ui.eventDraft && <EventModal />}
      {ui.taskDraft && <TaskModal />}
      {ui.showSettings && <SettingsModal />}
      {ui.showAi && <AiPanel />}
      <Toasts />
    </div>
  );
}
