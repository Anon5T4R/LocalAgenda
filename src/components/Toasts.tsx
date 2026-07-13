import { reminderSnooze } from "../lib/backend";
import { stopAlarmSound } from "../lib/sound";
import { useUi } from "../state/ui";

const SNOOZE: [number, string][] = [
  [5, "5 min"],
  [10, "10 min"],
  [30, "30 min"],
  [60, "1 h"],
];

export function Toasts() {
  const toasts = useUi((s) => s.toasts);
  const dismiss = useUi((s) => s.dismissToast);

  const close = (id: string) => {
    stopAlarmSound(id); // silencia o loop de alarme/timer, se houver
    dismiss(id);
  };

  if (!toasts.length) return null;
  return (
    <div className="toasts">
      {toasts.map((t) => {
        const ringing = t.kind === "alarm" || t.kind === "timer";
        const icon = t.kind === "summary" ? "🗓️" : t.kind === "alarm" ? "⏰" : t.kind === "timer" ? "⏲️" : "🔔";
        return (
          <div className={"toast" + (ringing ? " ringing" : "")} key={t.id}>
            <div className="th">
              <span>{icon}</span>
              {t.title}
              <button className="icon-btn" style={{ marginLeft: "auto", width: 24, height: 24 }} onClick={() => close(t.id)}>
                ✕
              </button>
            </div>
            <div className="tb">{t.body}</div>
            {ringing && (
              <div className="snooze">
                <button className="stop-btn" onClick={() => close(t.id)}>
                  ⏹ Parar
                </button>
              </div>
            )}
            {t.reminderId && (
              <div className="snooze">
                <span className="hint" style={{ alignSelf: "center" }}>Adiar:</span>
                {SNOOZE.map(([min, label]) => (
                  <button
                    key={min}
                    onClick={async () => {
                      try {
                        await reminderSnooze(t.reminderId!, min);
                      } catch {
                        /* ignore */
                      }
                      close(t.id);
                    }}
                  >
                    {label}
                  </button>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
