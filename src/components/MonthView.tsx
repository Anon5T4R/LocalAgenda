import { useMemo } from "react";
import { addDays, dateKey, fmtTimeCompact, isToday, monthGrid, startOfDay, toIso, weekdayName } from "../lib/datetime";
import { expandAll, type Occurrence } from "../lib/recur";
import { calendarColorMap, useStore, visibleEvents } from "../state/store";
import { useUi } from "../state/ui";

const MAX_CHIPS = 3;

export function MonthView() {
  const { cursor, settings, events, calendars, search, setView, setCursor } = useStore();
  const openEvent = useUi((s) => s.openEvent);
  const colors = calendarColorMap(calendars);

  const grid = useMemo(() => monthGrid(cursor, settings.firstDayOfWeek), [cursor, settings.firstDayOfWeek]);

  const byDay = useMemo(() => {
    const from = grid[0];
    const to = addDays(grid[grid.length - 1], 1);
    const occ = expandAll(visibleEvents({ events, calendars, search }), from, to);
    const map = new Map<string, Occurrence[]>();
    for (const o of occ) {
      let d = startOfDay(o.start);
      const last = startOfDay(o.end.getTime() > o.start.getTime() ? new Date(o.end.getTime() - 1) : o.end);
      let guard = 0;
      while (d <= last && guard++ < 60) {
        const k = dateKey(d);
        if (!map.has(k)) map.set(k, []);
        map.get(k)!.push(o);
        d = addDays(d, 1);
      }
    }
    return map;
  }, [grid, events, calendars, search]);

  const weeks = Array.from({ length: 6 }, (_, w) => grid.slice(w * 7, w * 7 + 7));

  return (
    <>
      <div className="view-head">
        {grid.slice(0, 7).map((d) => (
          <div key={d.getTime()} className="wd">
            {weekdayName(d.getDay())}
          </div>
        ))}
      </div>
      <div className="month">
        {weeks.map((week, wi) => (
          <div className="month-week" key={wi}>
            {week.map((day) => {
              const items = (byDay.get(dateKey(day)) ?? []).sort(sortOcc);
              const shown = items.slice(0, MAX_CHIPS);
              const extra = items.length - shown.length;
              return (
                <div
                  key={day.getTime()}
                  className={
                    "mcell" +
                    (day.getMonth() !== cursor.getMonth() ? " other" : "") +
                    (isToday(day) ? " today" : "")
                  }
                  onDoubleClick={() =>
                    openEvent({ start: `${toIso(day, true)}T09:00`, end: `${toIso(day, true)}T10:00`, allDay: false })
                  }
                >
                  <span className="daynum">{day.getDate()}</span>
                  {shown.map((o, i) => (
                    <Chip key={o.event.id + i} occ={o} color={colors[o.event.calendarId]} onOpen={openEvent} />
                  ))}
                  {extra > 0 && (
                    <span
                      className="more"
                      onClick={(e) => {
                        e.stopPropagation();
                        setCursor(new Date(day));
                        setView("day");
                      }}
                    >
                      +{extra} mais
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </>
  );
}

function sortOcc(a: Occurrence, b: Occurrence): number {
  if (a.event.allDay !== b.event.allDay) return a.event.allDay ? -1 : 1;
  return a.start.getTime() - b.start.getTime();
}

function Chip({
  occ,
  color,
  onOpen,
}: {
  occ: Occurrence;
  color?: string;
  onOpen(draft: any, occStart?: string): void;
}) {
  const c = color ?? "#2563eb";
  const open = (e: React.MouseEvent) => {
    e.stopPropagation();
    onOpen({ ...occ.event }, occ.occKey);
  };
  if (occ.event.allDay) {
    return (
      <div className="chip allday" style={{ background: c }} onClick={open} title={occ.event.title}>
        {occ.event.rrule && <span className="rico">↻</span>}
        {occ.event.title || "(sem título)"}
      </div>
    );
  }
  return (
    <div className="chip timed" onClick={open} title={occ.event.title}>
      <span className="cdot" style={{ background: c }} />
      <span className="ctime">{fmtTimeCompact(occ.start)}</span>
      <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{occ.event.title || "(sem título)"}</span>
    </div>
  );
}
