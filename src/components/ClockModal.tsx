import { useEffect, useRef, useState } from "react";
import { fmtDayLong, pad2 } from "../lib/datetime";
import type { Alarm } from "../lib/types";
import { useClock } from "../state/clock";
import { useStore } from "../state/store";
import { useUi } from "../state/ui";

type Tab = "alarms" | "timer" | "stopwatch";
const WD = ["D", "S", "T", "Q", "Q", "S", "S"];

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
          <h3>⏰ Relógio</h3>
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
              Alarmes
            </button>
            <button className={tab === "timer" ? "active" : ""} onClick={() => setTab("timer")}>
              Timer
            </button>
            <button className={tab === "stopwatch" ? "active" : ""} onClick={() => setTab("stopwatch")}>
              Cronômetro
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
        <input placeholder="Rótulo (opcional)" value={label} onChange={(e) => setLabel(e.target.value)} style={{ flex: 1 }} />
        <button className="btn primary" onClick={add}>
          Add
        </button>
      </div>
      <div className="wd-toggle" style={{ justifyContent: "center" }}>
        {WD.map((d, i) => (
          <button
            key={i}
            className={days.includes(i) ? "on" : ""}
            onClick={() => setDays(days.includes(i) ? days.filter((x) => x !== i) : [...days, i])}
          >
            {d}
          </button>
        ))}
      </div>
      <div className="hint" style={{ textAlign: "center" }}>Sem dias marcados = todo dia.</div>

      <div className="alarm-list">
        {alarms.length === 0 && <div className="empty-hint" style={{ textAlign: "center" }}>Nenhum alarme.</div>}
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
          {a.days.length ? a.days.slice().sort().map((d) => WD[d]).join(" ") : "Todo dia"}
        </div>
      </div>
      <button
        className={"switch" + (a.enabled ? " on" : "")}
        onClick={() => onToggle(a.id)}
        title={a.enabled ? "Desativar" : "Ativar"}
      >
        <span className="knob" />
      </button>
      <button className="icon-btn" onClick={() => onDelete(a.id)} title="Excluir">
        🗑
      </button>
    </div>
  );
}

// ---------------- Timer ----------------

const PRESETS: [number, string][] = [
  [60, "1 min"],
  [180, "3 min"],
  [300, "5 min"],
  [600, "10 min"],
  [1500, "25 min"],
];

function fmtTimer(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  return h > 0 ? `${h}:${pad2(m)}:${pad2(s)}` : `${pad2(m)}:${pad2(s)}`;
}

function TimerTab() {
  const clock = useClock();
  const remaining = clock.timerRemaining();
  const [min, setMin] = useState("5");
  const [sec, setSec] = useState("0");

  const applyCustom = () => {
    const total = (parseInt(min, 10) || 0) * 60 + (parseInt(sec, 10) || 0);
    if (total > 0) clock.setTimerTotal(total);
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
          <div className="preset-row">
            {PRESETS.map(([s, l]) => (
              <button key={s} className="btn" onClick={() => clock.startTimer(s)}>
                {l}
              </button>
            ))}
          </div>
          <div className="inline" style={{ justifyContent: "center", gap: 6 }}>
            <input type="number" min={0} value={min} onChange={(e) => setMin(e.target.value)} style={{ width: 64 }} />
            <span className="hint">min</span>
            <input type="number" min={0} max={59} value={sec} onChange={(e) => setSec(e.target.value)} style={{ width: 64 }} />
            <span className="hint">seg</span>
            <button className="btn" onClick={applyCustom}>
              Definir
            </button>
          </div>
        </>
      )}

      <div className="clock-controls">
        {clock.timerRunning ? (
          <button className="btn" onClick={() => clock.pauseTimer()}>
            ⏸ Pausar
          </button>
        ) : (
          <button className="btn primary" onClick={() => clock.startTimer()} disabled={remaining === 0}>
            ▶ Iniciar
          </button>
        )}
        <button className="btn" onClick={() => clock.resetTimer()}>
          ↺ Zerar
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
              ⏸ Pausar
            </button>
            <button className="btn" onClick={() => clock.swLap()}>
              🚩 Volta
            </button>
          </>
        ) : (
          <>
            <button className="btn primary" onClick={() => clock.swStart()}>
              ▶ {elapsed > 0 ? "Continuar" : "Iniciar"}
            </button>
            <button className="btn" onClick={() => clock.swReset()} disabled={elapsed === 0 && clock.laps.length === 0}>
              ↺ Zerar
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
                <span className="lap-n">Volta {i + 1}</span>
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
