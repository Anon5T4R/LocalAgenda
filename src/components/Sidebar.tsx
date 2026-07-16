import { useMemo } from "react";
import { dateKey } from "../lib/datetime";
import { t } from "../lib/i18n";
import { expandAll } from "../lib/recur";
import type { Calendar } from "../lib/types";
import { useStore, visibleEvents } from "../state/store";
import { useUi } from "../state/ui";
import { MiniMonth } from "./MiniMonth";

export function Sidebar() {
  const { calendars, cursor, settings, setCursor, toggleCalendar, events } = useStore();
  const openEvent = useUi((s) => s.openEvent);

  // Dias com evento no mês visível (pontinho no mini-calendário).
  const busy = useMemo(() => {
    const from = new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1);
    const to = new Date(cursor.getFullYear(), cursor.getMonth() + 2, 1);
    const occ = expandAll(visibleEvents({ events, calendars, search: "" }), from, to);
    const set = new Set<string>();
    for (const o of occ) set.add(dateKey(o.start));
    return set;
  }, [events, calendars, cursor]);

  return (
    <aside className="sidebar">
      <button className="btn primary" onClick={() => openEvent({ start: "", end: "" })}>
        {t("side.newEvent")}
      </button>

      <div className="side-section">
        <MiniMonth
          cursor={cursor}
          firstDayOfWeek={settings.firstDayOfWeek}
          busyDays={busy}
          onPick={(d) => setCursor(d)}
          onShift={(delta) => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + delta, 1))}
        />
      </div>

      <div className="side-section">
        <h4>{t("side.calendars")}</h4>
        <div className="cal-list">
          {calendars.map((c) => (
            <CalRow key={c.id} cal={c} onToggle={() => toggleCalendar(c.id)} />
          ))}
        </div>
        <button
          className="btn ghost"
          style={{ marginTop: 6, width: "100%", justifyContent: "flex-start", color: "var(--text-dim)" }}
          onClick={() => useUi.getState().setSettings(true)}
        >
          {t("side.manageCalendars")}
        </button>
      </div>
    </aside>
  );
}

function CalRow({ cal, onToggle }: { cal: Calendar; onToggle(): void }) {
  return (
    <div className={"cal-row" + (cal.visible ? "" : " off")} onClick={onToggle}>
      <span className="dot" style={{ background: cal.visible ? cal.color : "transparent", borderColor: cal.color }} />
      <span className="name">{cal.name}</span>
    </div>
  );
}
