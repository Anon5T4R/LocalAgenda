import { addDays, dateKey, isToday, monthName, sameDay, startOfMonth, startOfWeek, weekdayShort } from "../lib/datetime";

interface Props {
  cursor: Date;
  firstDayOfWeek: number;
  busyDays: Set<string>;
  onPick(d: Date): void;
  onShift(delta: number): void;
}

export function MiniMonth({ cursor, firstDayOfWeek, busyDays, onPick, onShift }: Props) {
  const month = cursor.getMonth();
  const first = startOfWeek(startOfMonth(cursor), firstDayOfWeek);
  const days = Array.from({ length: 42 }, (_, i) => addDays(first, i));
  const wd = Array.from({ length: 7 }, (_, i) => weekdayShort((firstDayOfWeek + i) % 7)[0]);

  return (
    <div className="mini">
      <div className="mini-head">
        <span>
          {monthName(month)} {cursor.getFullYear()}
        </span>
        <span className="inline">
          <button className="icon-btn" style={{ width: 24, height: 24 }} onClick={() => onShift(-1)}>
            ‹
          </button>
          <button className="icon-btn" style={{ width: 24, height: 24 }} onClick={() => onShift(1)}>
            ›
          </button>
        </span>
      </div>
      <div className="mini-grid">
        {wd.map((d, i) => (
          <div key={i} className="wd">
            {d}
          </div>
        ))}
        {days.map((d) => {
          const cls = ["cell"];
          if (d.getMonth() !== month) cls.push("other");
          if (isToday(d)) cls.push("today");
          if (sameDay(d, cursor)) cls.push("sel");
          return (
            <div key={d.getTime()} className={cls.join(" ")} onClick={() => onPick(new Date(d))}>
              {d.getDate()}
              {busyDays.has(dateKey(d)) && <span className="has" />}
            </div>
          );
        })}
      </div>
    </div>
  );
}
