import { useMemo, useState } from "react";
import { nextSlot, parseLocal, toIso } from "../lib/datetime";
import { buildRRuleString, describeRRule, EMPTY_RECUR, parseRRuleToUI, type Freq, type RecurUI } from "../lib/recur";
import type { AgendaEvent } from "../lib/types";
import { useStore } from "../state/store";
import { useUi } from "../state/ui";

const REMINDER_OPTIONS: [number, string][] = [
  [0, "No horário"],
  [5, "5 minutos antes"],
  [10, "10 minutos antes"],
  [30, "30 minutos antes"],
  [60, "1 hora antes"],
  [120, "2 horas antes"],
  [1440, "1 dia antes"],
];
const reminderLabel = (m: number) => REMINDER_OPTIONS.find(([v]) => v === m)?.[1] ?? `${m} min antes`;

const FREQS: [Freq, string][] = [
  ["", "Não repete"],
  ["DAILY", "Diariamente"],
  ["WEEKLY", "Semanalmente"],
  ["MONTHLY", "Mensalmente"],
  ["YEARLY", "Anualmente"],
];
const WD = ["D", "S", "T", "Q", "Q", "S", "S"];

function splitIso(iso: string, fallbackDate: string, fallbackTime: string) {
  if (!iso) return { date: fallbackDate, time: fallbackTime };
  const [d, t] = iso.split("T");
  return { date: d || fallbackDate, time: t || fallbackTime };
}

export function EventModal() {
  const draft = useUi((s) => s.eventDraft)!;
  const occStart = useUi((s) => s.eventOccStart);
  const close = useUi((s) => s.closeEvent);
  const { calendars, cursor, settings, saveEvent, removeEvent, excludeOccurrence } = useStore();

  const isEdit = !!draft.id;
  const recurringScope = isEdit && !!draft.rrule && !!occStart;
  const defDate = toIso(draft.start ? parseLocal(draft.start) : cursor, true);
  const defTime = draft.start && draft.start.includes("T") ? draft.start.split("T")[1] : toIso(nextSlot()).split("T")[1];

  const s0 = splitIso(draft.start ?? "", defDate, defTime);
  const dur = settings.defaultDurationMin;
  const defEnd = toIso(new Date(parseLocal(`${s0.date}T${s0.time}`).getTime() + dur * 60_000));
  const e0 = splitIso(draft.end ?? "", s0.date, defEnd.split("T")[1]);

  const [title, setTitle] = useState(draft.title ?? "");
  const [calendarId, setCalendarId] = useState(draft.calendarId || calendars[0]?.id || "");
  const [allDay, setAllDay] = useState(draft.allDay ?? false);
  const [startDate, setStartDate] = useState(s0.date);
  const [startTime, setStartTime] = useState(s0.time);
  const [endDate, setEndDate] = useState(e0.date);
  const [endTime, setEndTime] = useState(e0.time);
  const [recur, setRecur] = useState<RecurUI>(draft.rrule ? parseRRuleToUI(draft.rrule) : { ...EMPTY_RECUR });
  const [reminders, setReminders] = useState<number[]>(draft.reminders ?? []);
  const [location, setLocation] = useState(draft.location ?? "");
  const [description, setDescription] = useState(draft.description ?? "");
  const [remSel, setRemSel] = useState("60");
  const [scope, setScope] = useState<"this" | "series">("series");

  const rruleStr = useMemo(() => buildRRuleString(recur), [recur]);

  // Campos editados (sem decidir id/série).
  const fields = (): Partial<AgendaEvent> => {
    const start = allDay ? startDate : `${startDate}T${startTime}`;
    let end = allDay ? endDate : `${endDate}T${endTime}`;
    if (parseLocal(end).getTime() < parseLocal(start).getTime()) end = start;
    return {
      calendarId,
      title: title.trim() || "(sem título)",
      description,
      location,
      start,
      end,
      allDay,
      reminders,
    };
  };

  const save = async () => {
    if (recurringScope && scope === "this" && occStart) {
      // Destaca esta ocorrência: exclui da série e cria um evento avulso editado.
      await excludeOccurrence(draft as AgendaEvent, occStart);
      await saveEvent({ ...fields(), id: "", rrule: "", exdates: [] });
    } else {
      await saveEvent({
        ...fields(),
        id: draft.id,
        rrule: rruleStr,
        exdates: draft.exdates ?? [],
        createdAt: draft.createdAt,
      });
    }
    close();
  };

  const del = () => {
    if (recurringScope && scope === "this" && occStart) {
      void excludeOccurrence(draft as AgendaEvent, occStart);
    } else if (draft.id) {
      void removeEvent(draft.id);
    }
    close();
  };

  const duplicate = () => {
    void saveEvent({ ...fields(), id: "", rrule: rruleStr, exdates: [], createdAt: 0 });
    close();
  };

  const addReminder = () => {
    const m = Number(remSel);
    if (!reminders.includes(m)) setReminders([...reminders, m].sort((a, b) => a - b));
  };

  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="modal">
        <div className="modal-head">
          <h3>{isEdit ? "Editar evento" : "Novo evento"}</h3>
          <button className="icon-btn" onClick={close}>
            ✕
          </button>
        </div>
        <div className="modal-body">
          <input
            className="title-input"
            placeholder="Título do evento"
            value={title}
            autoFocus
            onChange={(e) => setTitle(e.target.value)}
          />

          <div className="inline">
            <label className="inline" style={{ cursor: "pointer" }}>
              <input type="checkbox" checked={allDay} onChange={(e) => setAllDay(e.target.checked)} style={{ width: "auto" }} />
              Dia inteiro
            </label>
            <div style={{ flex: 1 }} />
            <select value={calendarId} onChange={(e) => setCalendarId(e.target.value)} style={{ maxWidth: 160 }}>
              {calendars.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>

          <div className="field">
            <label>Início</label>
            <div className="row">
              <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
              {!allDay && <input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} />}
            </div>
          </div>
          <div className="field">
            <label>Fim</label>
            <div className="row">
              <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
              {!allDay && <input type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} />}
            </div>
          </div>

          {recurringScope && (
            <div className="recur-block">
              <label style={{ fontSize: 12, fontWeight: 600, color: "var(--text-dim)" }}>Aplicar alterações a</label>
              <div className="inline" style={{ gap: 16 }}>
                <label className="inline" style={{ cursor: "pointer", gap: 6 }}>
                  <input type="radio" checked={scope === "this"} onChange={() => setScope("this")} style={{ width: "auto" }} />
                  Somente esta ocorrência
                </label>
                <label className="inline" style={{ cursor: "pointer", gap: 6 }}>
                  <input type="radio" checked={scope === "series"} onChange={() => setScope("series")} style={{ width: "auto" }} />
                  Toda a série
                </label>
              </div>
            </div>
          )}

          <div className="recur-block" style={recurringScope && scope === "this" ? { opacity: 0.5, pointerEvents: "none" } : undefined}>
            <div className="row">
              <div className="field">
                <label>Repetição</label>
                <select value={recur.freq} onChange={(e) => setRecur({ ...recur, freq: e.target.value as Freq })}>
                  {FREQS.map(([v, l]) => (
                    <option key={v} value={v}>
                      {l}
                    </option>
                  ))}
                </select>
              </div>
              {recur.freq && (
                <div className="field">
                  <label>A cada</label>
                  <input
                    type="number"
                    min={1}
                    value={recur.interval}
                    onChange={(e) => setRecur({ ...recur, interval: Math.max(1, +e.target.value || 1) })}
                  />
                </div>
              )}
            </div>

            {recur.freq === "WEEKLY" && (
              <div className="wd-toggle">
                {WD.map((d, i) => (
                  <button
                    key={i}
                    className={recur.byweekday.includes(i) ? "on" : ""}
                    onClick={() =>
                      setRecur({
                        ...recur,
                        byweekday: recur.byweekday.includes(i)
                          ? recur.byweekday.filter((x) => x !== i)
                          : [...recur.byweekday, i],
                      })
                    }
                  >
                    {d}
                  </button>
                ))}
              </div>
            )}

            {recur.freq && (
              <div className="row">
                <div className="field">
                  <label>Termina</label>
                  <select
                    value={recur.endType}
                    onChange={(e) => setRecur({ ...recur, endType: e.target.value as RecurUI["endType"] })}
                  >
                    <option value="never">Nunca</option>
                    <option value="count">Após N vezes</option>
                    <option value="until">Em uma data</option>
                  </select>
                </div>
                {recur.endType === "count" && (
                  <div className="field">
                    <label>Vezes</label>
                    <input
                      type="number"
                      min={1}
                      value={recur.count}
                      onChange={(e) => setRecur({ ...recur, count: Math.max(1, +e.target.value || 1) })}
                    />
                  </div>
                )}
                {recur.endType === "until" && (
                  <div className="field">
                    <label>Até</label>
                    <input type="date" value={recur.until} onChange={(e) => setRecur({ ...recur, until: e.target.value })} />
                  </div>
                )}
              </div>
            )}
            {recur.freq && <div className="hint">{describeRRule(rruleStr)}</div>}
          </div>

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
              <button className="btn" onClick={addReminder}>
                Adicionar
              </button>
            </div>
          </div>

          <div className="field">
            <label>Local</label>
            <input value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Opcional" />
          </div>
          <div className="field">
            <label>Descrição</label>
            <textarea rows={3} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Opcional" />
          </div>
        </div>

        <div className="modal-foot">
          {isEdit && (
            <button className="btn danger" onClick={del}>
              Excluir
            </button>
          )}
          {isEdit && (
            <button className="btn ghost" title="Criar uma cópia" onClick={duplicate}>
              Duplicar
            </button>
          )}
          <div className="spacer" />
          <button className="btn" onClick={close}>
            Cancelar
          </button>
          <button className="btn primary" onClick={() => void save()}>
            Salvar
          </button>
        </div>
      </div>
    </div>
  );
}
