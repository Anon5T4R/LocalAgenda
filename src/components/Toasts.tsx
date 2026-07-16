import { reminderSnooze } from "../lib/backend";
import { t as tr } from "../lib/i18n";
import { stopAlarmSound } from "../lib/sound";
import { useUi } from "../state/ui";

const snoozeOptions = (): [number, string][] => [
  [5, tr("toast.snooze5")],
  [10, tr("toast.snooze10")],
  [30, tr("toast.snooze30")],
  [60, tr("toast.snooze60")],
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
                  {tr("toast.stop")}
                </button>
              </div>
            )}
            {t.reminderId && (
              <div className="snooze">
                <span className="hint" style={{ alignSelf: "center" }}>{tr("toast.snooze")}</span>
                {snoozeOptions().map(([min, label]) => (
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
