import { useEffect, useMemo, useRef } from "react";
import { addDays, dateKey, fmtTime, isToday, pad2, startOfDay, toIso, weekdayShort } from "../lib/datetime";
import { t } from "../lib/i18n";
import { expandAll, type Occurrence } from "../lib/recur";
import { calendarColorMap, useStore, visibleEvents } from "../state/store";
import { useUi } from "../state/ui";

const HOUR_H = 48;
const DAY_H = HOUR_H * 24;

interface Props {
  days: Date[];
}

interface Placed {
  occ: Occurrence;
  left: number;
  width: number;
  top: number;
  height: number;
}

export function WeekView({ days }: Props) {
  const { events, calendars, search } = useStore();
  const openEvent = useUi((s) => s.openEvent);
  const colors = calendarColorMap(calendars);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = 7 * HOUR_H;
  }, []);

  const range = useMemo(() => {
    const from = startOfDay(days[0]);
    const to = addDays(startOfDay(days[days.length - 1]), 1);
    const occ = expandAll(visibleEvents({ events, calendars, search }), from, to);
    const timed = new Map<string, Placed[]>();
    const allday = new Map<string, Occurrence[]>();
    for (const day of days) {
      const k = dateKey(day);
      const dayStart = startOfDay(day).getTime();
      const dayEnd = dayStart + 86_400_000;
      const dayTimed: Occurrence[] = [];
      for (const o of occ) {
        const s = o.start.getTime();
        const e = Math.max(o.end.getTime(), s + 60_000);
        if (e <= dayStart || s >= dayEnd) continue;
        if (o.event.allDay || e - s >= 86_400_000) {
          if (!allday.has(k)) allday.set(k, []);
          allday.get(k)!.push(o);
        } else {
          dayTimed.push(o);
        }
      }
      timed.set(k, layout(dayTimed, dayStart, dayEnd));
    }
    return { timed, allday };
  }, [days, events, calendars, search]);

  const gridCols = `56px repeat(${days.length}, 1fr)`;

  return (
    <div className="timegrid-wrap">
      <div className="tg-head" style={{ gridTemplateColumns: gridCols }}>
        <div className="gutter" />
        {days.map((d) => (
          <div key={d.getTime()} className={"col" + (isToday(d) ? " today" : "")}>
            <div className="wd">{weekdayShort(d.getDay())}</div>
            <div className="dn">{d.getDate()}</div>
          </div>
        ))}
      </div>

      <div className="tg-allday" style={{ gridTemplateColumns: gridCols }}>
        <div className="gutter">{t("week.allDayGutter")}</div>
        {days.map((d) => (
          <div key={d.getTime()} className="col">
            {(range.allday.get(dateKey(d)) ?? []).map((o, i) => (
              <div
                key={o.event.id + i}
                className="chip allday"
                style={{ background: colors[o.event.calendarId] ?? "#2563eb" }}
                onClick={() => openEvent({ ...o.event }, o.occKey)}
                title={o.event.title}
              >
                {o.event.title || t("event.untitled")}
              </div>
            ))}
          </div>
        ))}
      </div>

      <div className="tg-scroll" ref={scrollRef}>
        <div className="tg-body" style={{ gridTemplateColumns: gridCols, height: DAY_H }}>
          <div className="tg-gutter">
            {Array.from({ length: 24 }, (_, h) => (
              <div key={h} className="hr">
                {h === 0 ? "" : `${pad2(h)}:00`}
              </div>
            ))}
          </div>
          {days.map((day) => (
            <div
              key={day.getTime()}
              className="tg-col"
              onDoubleClick={(e) => {
                const rect = e.currentTarget.getBoundingClientRect();
                const y = e.clientY - rect.top;
                let min = Math.round((y / HOUR_H) * 60 / 30) * 30;
                min = Math.max(0, Math.min(23 * 60 + 30, min));
                const s = new Date(day);
                s.setHours(Math.floor(min / 60), min % 60, 0, 0);
                const en = new Date(s.getTime() + 60 * 60_000);
                openEvent({ start: toIso(s), end: toIso(en), allDay: false });
              }}
            >
              {Array.from({ length: 24 }, (_, h) => (
                <div key={h} className="hr-line" />
              ))}
              {isToday(day) && <NowLine />}
              {(range.timed.get(dateKey(day)) ?? []).map((p, i) => (
                <div
                  key={p.occ.event.id + i}
                  className="tevent"
                  style={{
                    top: p.top,
                    height: Math.max(18, p.height),
                    left: `calc(${p.left * 100}% + 3px)`,
                    width: `calc(${p.width * 100}% - 6px)`,
                    background: colors[p.occ.event.calendarId] ?? "#2563eb",
                  }}
                  onClick={() => openEvent({ ...p.occ.event }, p.occ.occKey)}
                  title={p.occ.event.title}
                >
                  <div className="tt">
                    {p.occ.event.rrule ? "↻ " : ""}
                    {p.occ.event.title || t("event.untitled")}
                  </div>
                  {p.height > 32 && (
                    <div className="th">
                      {fmtTime(p.occ.start)}–{fmtTime(p.occ.end)}
                    </div>
                  )}
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function NowLine() {
  const now = new Date();
  const top = (now.getHours() * 60 + now.getMinutes()) * (HOUR_H / 60);
  return <div className="tg-now" style={{ top }} />;
}

/** Empacota eventos do dia em faixas (lanes) pra sobreposições lado a lado. */
function layout(occs: Occurrence[], dayStart: number, dayEnd: number): Placed[] {
  const sorted = occs.slice().sort((a, b) => a.start.getTime() - b.start.getTime());
  const result: Placed[] = [];
  let cluster: Occurrence[] = [];
  let clusterEnd = -Infinity;

  const flush = () => {
    if (!cluster.length) return;
    const laneEnds: number[] = [];
    const placed = cluster.map((o) => {
      let lane = laneEnds.findIndex((end) => end <= o.start.getTime());
      if (lane === -1) {
        lane = laneEnds.length;
        laneEnds.push(o.end.getTime());
      } else {
        laneEnds[lane] = o.end.getTime();
      }
      return { o, lane };
    });
    const n = laneEnds.length;
    for (const { o, lane } of placed) {
      const s = Math.max(o.start.getTime(), dayStart);
      const e = Math.min(Math.max(o.end.getTime(), s + 60_000), dayEnd);
      const top = ((s - dayStart) / 60_000) * (HOUR_H / 60);
      const height = ((e - s) / 60_000) * (HOUR_H / 60);
      result.push({ occ: o, left: lane / n, width: 1 / n, top, height });
    }
    cluster = [];
    clusterEnd = -Infinity;
  };

  for (const o of sorted) {
    if (cluster.length && o.start.getTime() >= clusterEnd) flush();
    cluster.push(o);
    clusterEnd = Math.max(clusterEnd, Math.max(o.end.getTime(), o.start.getTime() + 60_000));
  }
  flush();
  return result;
}
