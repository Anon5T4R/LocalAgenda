import { useState } from "react";
import { toIso } from "../lib/datetime";
import { buildRRuleString, EMPTY_RECUR, parseRRuleToUI, type Freq } from "../lib/recur";
import { PRIORITY_LABELS } from "../lib/types";
import { useStore } from "../state/store";
import { useUi } from "../state/ui";

const REMINDER_OPTIONS: [number, string][] = [
  [0, "No horário"],
  [10, "10 minutos antes"],
  [30, "30 minutos antes"],
  [60, "1 hora antes"],
  [1440, "1 dia antes"],
];
const reminderLabel = (m: number) => REMINDER_OPTIONS.find(([v]) => v === m)?.[1] ?? `${m} min antes`;

const FREQS: [Freq, string][] = [
  ["", "Não repete"],
  ["DAILY", "Todo dia"],
  ["WEEKLY", "Toda semana"],
  ["MONTHLY", "Todo mês"],
  ["YEARLY", "Todo ano"],
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
      title: title.trim() || "(sem título)",
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
          <h3>{isEdit ? "Editar tarefa" : "Nova tarefa"}</h3>
          <button className="icon-btn" onClick={close}>
            ✕
          </button>
        </div>
        <div className="modal-body">
          <input
            className="title-input"
            placeholder="O que precisa ser feito?"
            value={title}
            autoFocus
            onChange={(e) => setTitle(e.target.value)}
          />

          <div className="field">
            <label>Prioridade</label>
            <select value={priority} onChange={(e) => setPriority(+e.target.value)}>
              {PRIORITY_LABELS.map((l, i) => (
                <option key={i} value={i}>
                  {i === 0 ? "Sem prioridade" : l}
                </option>
              ))}
            </select>
          </div>

          <div className="field">
            <label className="inline" style={{ cursor: "pointer" }}>
              <input type="checkbox" checked={hasDue} onChange={(e) => setHasDue(e.target.checked)} style={{ width: "auto" }} />
              Tem prazo
            </label>
            {hasDue && (
              <div className="row" style={{ marginTop: 6 }}>
                <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
                {hasTime ? (
                  <input type="time" value={dueTime} onChange={(e) => setDueTime(e.target.value)} />
                ) : (
                  <button className="btn" onClick={() => setHasTime(true)}>
                    ＋ horário
                  </button>
                )}
                {hasTime && (
                  <button className="icon-btn" title="Remover horário" onClick={() => setHasTime(false)}>
                    ✕
                  </button>
                )}
              </div>
            )}
          </div>

          {hasDue && (
            <div className="field">
              <label>Repetição</label>
              <div className="row">
                <select value={recur.freq} onChange={(e) => setRecur({ ...recur, freq: e.target.value as Freq })}>
                  {FREQS.map(([v, l]) => (
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
              <label>Lembretes</label>
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
                  {REMINDER_OPTIONS.map(([v, l]) => (
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
                  Adicionar
                </button>
              </div>
            </div>
          )}

          <div className="field">
            <label>Notas</label>
            <textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Opcional" />
          </div>
        </div>

        <div className="modal-foot">
          {isEdit && (
            <>
              <button className="btn ghost" onClick={() => draft.id && (useUi.getState().openTask({ parentId: draft.id, due: "" }))}>
                ＋ Subtarefa
              </button>
              <button
                className="btn danger"
                onClick={() => {
                  if (draft.id) void removeTask(draft.id);
                  close();
                }}
              >
                Excluir
              </button>
            </>
          )}
          <div className="spacer" />
          <button className="btn" onClick={close}>
            Cancelar
          </button>
          <button className="btn primary" onClick={save}>
            Salvar
          </button>
        </div>
      </div>
    </div>
  );
}
