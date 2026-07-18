import { useEffect, useRef, useState } from "react";
import { fmtDayLong, pad2, weekdayShort } from "../lib/datetime";
import { t } from "../lib/i18n";
import { fmtTimer, hmsToSeconds, isValidTimer, TIMER_PRESETS_HOUR, TIMER_PRESETS_MIN } from "../lib/timer";
import type { Alarm } from "../lib/types";
import { useClock } from "../state/clock";
import { useStore } from "../state/store";
import { useUi } from "../state/ui";

type Tab = "alarms" | "timer" | "stopwatch";
// Iniciais dos dias (dom…sáb) no idioma da UI. Chamada em render → reativa.
const weekdayInitials = (): string[] =>
  Array.from({ length: 7 }, (_, i) => weekdayShort(i).charAt(0).toUpperCase());

/** Re-render a cada `ms` — pro relógio/timer/cronômetro andarem. */
function useTicker(ms: number) {
  const [, force] = useState(0);
  useEffect(() => {
    const iv = setInterval(() => force((n) => n + 1), ms);
    return () => clearInterval(iv);
  }, [ms]);
}

export function ClockModal() {
  const close = () => useUi.getState().setClock(false);
  const [tab, setTab] = useState<Tab>("alarms");
  useTicker(250);
  const now = new Date();

  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="modal">
        <div className="modal-head">
          <h3>{t("clock.title")}</h3>
          <button className="icon-btn" onClick={close}>
            ✕
          </button>
        </div>
        <div className="modal-body">
          <div className="clock-now">
            <div className="clock-time">
              {pad2(now.getHours())}:{pad2(now.getMinutes())}
              <span className="clock-sec">:{pad2(now.getSeconds())}</span>
            </div>
            <div className="clock-date">{fmtDayLong(now)}</div>
          </div>

          <div className="seg" style={{ alignSelf: "center" }}>
            <button className={tab === "alarms" ? "active" : ""} onClick={() => setTab("alarms")}>
              {t("clock.tab.alarms")}
            </button>
            <button className={tab === "timer" ? "active" : ""} onClick={() => setTab("timer")}>
              {t("clock.tab.timer")}
            </button>
            <button className={tab === "stopwatch" ? "active" : ""} onClick={() => setTab("stopwatch")}>
              {t("clock.tab.stopwatch")}
            </button>
          </div>

          {tab === "alarms" && <AlarmsTab />}
          {tab === "timer" && <TimerTab />}
          {tab === "stopwatch" && <StopwatchTab />}
        </div>
      </div>
    </div>
  );
}

// ---------------- Alarmes ----------------

function AlarmsTab() {
  const { alarms, saveAlarm, removeAlarm, toggleAlarm } = useStore();
  const [time, setTime] = useState("07:00");
  const [label, setLabel] = useState("");
  const [days, setDays] = useState<number[]>([]);

  const add = () => {
    if (!time) return;
    void saveAlarm({ time, label: label.trim(), days });
    setLabel("");
    setDays([]);
  };

  return (
    <div className="clock-panel">
      <div className="alarm-add">
        <input type="time" value={time} onChange={(e) => setTime(e.target.value)} style={{ width: 110 }} />
        <input placeholder={t("clock.alarm.labelPlaceholder")} value={label} onChange={(e) => setLabel(e.target.value)} style={{ flex: 1 }} />
        <button className="btn primary" onClick={add}>
          {t("common.add")}
        </button>
      </div>
      <div className="wd-toggle" style={{ justifyContent: "center" }}>
        {weekdayInitials().map((d, i) => (
          <button
            key={i}
            className={days.includes(i) ? "on" : ""}
            onClick={() => setDays(days.includes(i) ? days.filter((x) => x !== i) : [...days, i])}
          >
            {d}
          </button>
        ))}
      </div>
      <div className="hint" style={{ textAlign: "center" }}>{t("clock.alarm.noDaysHint")}</div>

      <div className="alarm-list">
        {alarms.length === 0 && <div className="empty-hint" style={{ textAlign: "center" }}>{t("clock.alarm.none")}</div>}
        {alarms.map((a) => (
          <AlarmRow key={a.id} a={a} onToggle={toggleAlarm} onDelete={removeAlarm} />
        ))}
      </div>
    </div>
  );
}

function AlarmRow({ a, onToggle, onDelete }: { a: Alarm; onToggle(id: string): void; onDelete(id: string): void }) {
  return (
    <div className={"alarm-row" + (a.enabled ? "" : " off")}>
      <div className="alarm-time">{a.time}</div>
      <div className="alarm-info">
        {a.label && <div className="alarm-label">{a.label}</div>}
        <div className="alarm-days">
          {a.days.length
            ? a.days.slice().sort().map((d) => weekdayInitials()[d]).join(" ")
            : t("clock.alarm.everyDay")}
        </div>
      </div>
      <button
        className={"switch" + (a.enabled ? " on" : "")}
        onClick={() => onToggle(a.id)}
        title={a.enabled ? t("clock.alarm.disable") : t("clock.alarm.enable")}
      >
        <span className="knob" />
      </button>
      <button className="icon-btn" onClick={() => onDelete(a.id)} title={t("clock.alarm.delete")}>
        🗑
      </button>
    </div>
  );
}

// ---------------- Timer ----------------
// Presets e matemática vêm de lib/timer.ts (testados sem GUI). Aqui só a UI:
// duas linhas de presets (minutos / horas) pra não virar parede de botões, e um
// custom em hh:mm:ss pra qualquer valor — inclusive várias horas.

function TimerTab() {
  const clock = useClock();
  const remaining = clock.timerRemaining();
  const [hrs, setHrs] = useState("0");
  const [min, setMin] = useState("5");
  const [sec, setSec] = useState("0");

  const applyCustom = () => {
    // hh:mm:ss → segundos totais (o modelo do app é sempre segundos, nunca min).
    const total = hmsToSeconds(parseInt(hrs, 10) || 0, parseInt(min, 10) || 0, parseInt(sec, 10) || 0);
    if (isValidTimer(total)) clock.setTimerTotal(total);
  };

  const progress = clock.timerTotal > 0 ? 1 - remaining / clock.timerTotal : 0;

  return (
    <div className="clock-panel">
      <div className="big-time" style={{ color: remaining === 0 && clock.timerRunning ? "var(--danger)" : undefined }}>
        {fmtTimer(remaining)}
      </div>
      <div className="progress-bar">
        <div className="progress-fill" style={{ width: `${Math.min(100, progress * 100)}%` }} />
      </div>

      {!clock.timerRunning && (
        <>
          <div className="preset-group">
            <span className="preset-label">{t("clock.timer.groupMin")}</span>
            <div className="preset-row">
              {TIMER_PRESETS_MIN.map((m) => (
                <button key={`m${m}`} className="btn" onClick={() => clock.startTimer(m * 60)}>
                  {m} {t("clock.timer.unitMin")}
                </button>
              ))}
            </div>
          </div>
          <div className="preset-group">
            <span className="preset-label">{t("clock.timer.groupHour")}</span>
            <div className="preset-row">
              {TIMER_PRESETS_HOUR.map((h) => (
                <button key={`h${h}`} className="btn" onClick={() => clock.startTimer(h * 3600)}>
                  {h} {t("clock.timer.unitHour")}
                </button>
              ))}
            </div>
          </div>
          <div className="inline" style={{ justifyContent: "center", gap: 6, flexWrap: "wrap" }}>
            <input type="number" min={0} max={99} value={hrs} onChange={(e) => setHrs(e.target.value)} style={{ width: 56 }} />
            <span className="hint">{t("clock.timer.unitHour")}</span>
            <input type="number" min={0} max={59} value={min} onChange={(e) => setMin(e.target.value)} style={{ width: 56 }} />
            <span className="hint">{t("clock.timer.unitMin")}</span>
            <input type="number" min={0} max={59} value={sec} onChange={(e) => setSec(e.target.value)} style={{ width: 56 }} />
            <span className="hint">{t("clock.timer.unitSec")}</span>
            <button className="btn" onClick={applyCustom}>
              {t("clock.timer.set")}
            </button>
          </div>
        </>
      )}

      <div className="clock-controls">
        {clock.timerRunning ? (
          <button className="btn" onClick={() => clock.pauseTimer()}>
            {t("clock.timer.pause")}
          </button>
        ) : (
          <button className="btn primary" onClick={() => clock.startTimer()} disabled={remaining === 0}>
            {t("clock.timer.start")}
          </button>
        )}
        <button className="btn" onClick={() => clock.resetTimer()}>
          {t("clock.timer.reset")}
        </button>
      </div>
    </div>
  );
}

// ---------------- Cronômetro ----------------

function fmtSW(ms: number): string {
  const cs = Math.floor((ms % 1000) / 10);
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const base = h > 0 ? `${h}:${pad2(m)}:${pad2(s)}` : `${pad2(m)}:${pad2(s)}`;
  return `${base}.${pad2(cs)}`;
}

function StopwatchTab() {
  const clock = useClock();
  const elapsed = clock.swElapsed();
  const lapsRef = useRef<HTMLDivElement>(null);

  return (
    <div className="clock-panel">
      <div className="big-time mono">{fmtSW(elapsed)}</div>
      <div className="clock-controls">
        {clock.swRunning ? (
          <>
            <button className="btn" onClick={() => clock.swPause()}>
              {t("clock.sw.pause")}
            </button>
            <button className="btn" onClick={() => clock.swLap()}>
              {t("clock.sw.lap")}
            </button>
          </>
        ) : (
          <>
            <button className="btn primary" onClick={() => clock.swStart()}>
              {elapsed > 0 ? t("clock.sw.resume") : t("clock.sw.start")}
            </button>
            <button className="btn" onClick={() => clock.swReset()} disabled={elapsed === 0 && clock.laps.length === 0}>
              {t("clock.sw.reset")}
            </button>
          </>
        )}
      </div>
      {clock.laps.length > 0 && (
        <div className="laps" ref={lapsRef}>
          {clock.laps
            .map((l, i) => ({ l, i }))
            .reverse()
            .map(({ l, i }) => (
              <div key={i} className="lap-row">
                <span className="lap-n">{t("clock.sw.lapN", { n: i + 1 })}</span>
                <span className="mono">{fmtSW(l)}</span>
                <span className="mono lap-split">
                  +{fmtSW(l - (i > 0 ? clock.laps[i - 1] : 0))}
                </span>
              </div>
            ))}
        </div>
      )}
    </div>
  );
}
