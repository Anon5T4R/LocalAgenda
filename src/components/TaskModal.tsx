import { useState } from "react";
import { toIso } from "../lib/datetime";
import { t } from "../lib/i18n";
import { buildRRuleString, EMPTY_RECUR, parseRRuleToUI, type Freq } from "../lib/recur";
import { useStore } from "../state/store";
import { useUi } from "../state/ui";

// Resolvidos em tempo de render (reativos ao locale no remount).
const reminderOptions = (): [number, string][] => [
  [0, t("rem.atTime")],
  [10, t("rem.min10")],
  [30, t("rem.min30")],
  [60, t("rem.hour1")],
  [1440, t("rem.day1")],
];
const reminderLabel = (m: number) => reminderOptions().find(([v]) => v === m)?.[1] ?? t("rem.fallback", { n: m });

const freqOptions = (): [Freq, string][] => [
  ["", t("freq.none")],
  ["DAILY", t("freqEvery.daily")],
  ["WEEKLY", t("freqEvery.weekly")],
  ["MONTHLY", t("freqEvery.monthly")],
  ["YEARLY", t("freqEvery.yearly")],
];
const priorityOptions = (): [number, string][] => [
  [0, t("prio.none")],
  [1, t("prio.low")],
  [2, t("prio.med")],
  [3, t("prio.high")],
];

export function TaskModal() {
  const draft = useUi((s) => s.taskDraft)!;
  const close = useUi((s) => s.closeTask);
  const { saveTask, removeTask } = useStore();
  const isEdit = !!draft.id;

  const dueHasTime = (draft.due ?? "").includes("T");
  const [title, setTitle] = useState(draft.title ?? "");
  const [notes, setNotes] = useState(draft.notes ?? "");
  const [hasDue, setHasDue] = useState(!!draft.due);
  const [hasTime, setHasTime] = useState(dueHasTime);
  const [dueDate, setDueDate] = useState((draft.due ?? "").split("T")[0] || toIso(new Date(), true));
  const [dueTime, setDueTime] = useState(dueHasTime ? draft.due!.split("T")[1] : "09:00");
  const [priority, setPriority] = useState(draft.priority ?? 0);
  const [reminders, setReminders] = useState<number[]>(draft.reminders ?? []);
  const [recur, setRecur] = useState(draft.rrule ? parseRRuleToUI(draft.rrule) : { ...EMPTY_RECUR });
  const [remSel, setRemSel] = useState("60");

  const save = () => {
    const due = hasDue ? (hasTime ? `${dueDate}T${dueTime}` : dueDate) : "";
    void saveTask({
      id: draft.id,
      parentId: draft.parentId ?? "",
      title: title.trim() || t("event.untitled"),
      notes,
      due,
      priority,
      reminders: hasDue ? reminders : [],
      rrule: buildRRuleString(recur),
      doneAt: draft.doneAt ?? null,
      sort: draft.sort,
      createdAt: draft.createdAt,
    });
    close();
  };

  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="modal">
        <div className="modal-head">
          <h3>{isEdit ? t("tm.editTitle") : t("tm.newTitle")}</h3>
          <button className="icon-btn" onClick={close}>
            ✕
          </button>
        </div>
        <div className="modal-body">
          <input
            className="title-input"
            placeholder={t("tm.titlePlaceholder")}
            value={title}
            autoFocus
            onChange={(e) => setTitle(e.target.value)}
          />

          <div className="field">
            <label>{t("tm.priority")}</label>
            <select value={priority} onChange={(e) => setPriority(+e.target.value)}>
              {priorityOptions().map(([i, l]) => (
                <option key={i} value={i}>
                  {l}
                </option>
              ))}
            </select>
          </div>

          <div className="field">
            <label className="inline" style={{ cursor: "pointer" }}>
              <input type="checkbox" checked={hasDue} onChange={(e) => setHasDue(e.target.checked)} style={{ width: "auto" }} />
              {t("tm.hasDue")}
            </label>
            {hasDue && (
              <div className="row" style={{ marginTop: 6 }}>
                <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
                {hasTime ? (
                  <input type="time" value={dueTime} onChange={(e) => setDueTime(e.target.value)} />
                ) : (
                  <button className="btn" onClick={() => setHasTime(true)}>
                    {t("tm.addTime")}
                  </button>
                )}
                {hasTime && (
                  <button className="icon-btn" title={t("tm.removeTime")} onClick={() => setHasTime(false)}>
                    ✕
                  </button>
                )}
              </div>
            )}
          </div>

          {hasDue && (
            <div className="field">
              <label>{t("tm.repeat")}</label>
              <div className="row">
                <select value={recur.freq} onChange={(e) => setRecur({ ...recur, freq: e.target.value as Freq })}>
                  {freqOptions().map(([v, l]) => (
                    <option key={v} value={v}>
                      {l}
                    </option>
                  ))}
                </select>
                {recur.freq && (
                  <input
                    type="number"
                    min={1}
                    value={recur.interval}
                    onChange={(e) => setRecur({ ...recur, interval: Math.max(1, +e.target.value || 1) })}
                  />
                )}
              </div>
            </div>
          )}

          {hasDue && (
            <div className="field">
              <label>{t("tm.reminders")}</label>
              <div className="chips-in">
                {reminders.map((m) => (
                  <span key={m} className="pill">
                    🔔 {reminderLabel(m)}
                    <button onClick={() => setReminders(reminders.filter((x) => x !== m))}>✕</button>
                  </span>
                ))}
              </div>
              <div className="inline" style={{ marginTop: 6 }}>
                <select value={remSel} onChange={(e) => setRemSel(e.target.value)} style={{ flex: 1 }}>
                  {reminderOptions().map(([v, l]) => (
                    <option key={v} value={v}>
                      {l}
                    </option>
                  ))}
                </select>
                <button
                  className="btn"
                  onClick={() => {
                    const m = Number(remSel);
                    if (!reminders.includes(m)) setReminders([...reminders, m].sort((a, b) => a - b));
                  }}
                >
                  {t("tm.addReminder")}
                </button>
              </div>
            </div>
          )}

          <div className="field">
            <label>{t("tm.notes")}</label>
            <textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder={t("common.optional")} />
          </div>
        </div>

        <div className="modal-foot">
          {isEdit && (
            <>
              <button className="btn ghost" onClick={() => draft.id && (useUi.getState().openTask({ parentId: draft.id, due: "" }))}>
                {t("tm.subtask")}
              </button>
              <button
                className="btn danger"
                onClick={() => {
                  if (draft.id) void removeTask(draft.id);
                  close();
                }}
              >
                {t("common.delete")}
              </button>
            </>
          )}
          <div className="spacer" />
          <button className="btn" onClick={close}>
            {t("common.cancel")}
          </button>
          <button className="btn primary" onClick={save}>
            {t("common.save")}
          </button>
        </div>
      </div>
    </div>
  );
}
