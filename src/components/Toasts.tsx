import { reminderSnooze } from "../lib/backend";
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

  if (!toasts.length) return null;
  return (
    <div className="toasts">
      {toasts.map((t) => (
        <div className="toast" key={t.id}>
          <div className="th">
            <span>{t.kind === "summary" ? "🗓️" : "🔔"}</span>
            {t.title}
            <button className="icon-btn" style={{ marginLeft: "auto", width: 24, height: 24 }} onClick={() => dismiss(t.id)}>
              ✕
            </button>
          </div>
          <div className="tb">{t.body}</div>
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
                    dismiss(t.id);
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
