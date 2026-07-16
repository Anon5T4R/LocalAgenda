import { useMemo } from "react";
import { addDays, dateKey, fmtTime, isToday, monthShort, startOfDay, weekdayName } from "../lib/datetime";
import { t } from "../lib/i18n";
import { expandAll, type Occurrence } from "../lib/recur";
import { calendarColorMap, useStore, visibleEvents } from "../state/store";
import { useUi } from "../state/ui";

const SPAN_DAYS = 30;

export function AgendaView() {
  const { cursor, events, calendars, search } = useStore();
  const openEvent = useUi((s) => s.openEvent);
  const colors = calendarColorMap(calendars);

  const groups = useMemo(() => {
    const from = startOfDay(cursor);
    const to = addDays(from, SPAN_DAYS);
    const occ = expandAll(visibleEvents({ events, calendars, search }), from, to);
    const map = new Map<string, Occurrence[]>();
    for (const o of occ) {
      const k = dateKey(o.start.getTime() < from.getTime() ? from : o.start);
      if (!map.has(k)) map.set(k, []);
      map.get(k)!.push(o);
    }
    return Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [cursor, events, calendars, search]);

  if (!groups.length) {
    return (
      <div className="agenda">
        <div className="agenda-empty">
          {t("agenda.emptyLine1", { n: SPAN_DAYS })}
          <br />
          {t("agenda.emptyLine2")}
        </div>
      </div>
    );
  }

  return (
    <div className="agenda">
      {groups.map(([key, items]) => {
        const d = items[0] ? startOfDay(items[0].start) : new Date(key);
        return (
          <div key={key} className={"agenda-day" + (isToday(d) ? " today" : "")}>
            <div className="date">
              <div className="dnum">{d.getDate()}</div>
              <div className="dwd">
                {weekdayName(d.getDay()).slice(0, 3)} · {monthShort(d.getMonth())}
              </div>
            </div>
            <div className="agenda-items">
              {items.map((o, i) => (
                <div key={o.event.id + i} className="agenda-item" onClick={() => openEvent({ ...o.event }, o.occKey)}>
                  <span className="cdot" style={{ background: colors[o.event.calendarId] ?? "#2563eb" }} />
                  <span className="atime">
                    {o.event.allDay ? t("event.allDay") : `${fmtTime(o.start)} – ${fmtTime(o.end)}`}
                  </span>
                  <span className="atitle">{o.event.title || t("event.untitled")}</span>
                  {o.event.rrule && <span className="arico">↻</span>}
                  {o.event.location && <span className="arico">· {o.event.location}</span>}
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
