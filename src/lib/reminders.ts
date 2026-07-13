// Materialização de lembretes: o front expande as próximas ocorrências e grava
// as linhas concretas (com `fireAt` em epoch-ms); o tick do Rust dispara quando
// vencem. IDs determinísticos → cada ocorrência notifica no máximo uma vez.

import { remindersDispatch, remindersReplace } from "./backend";
import { addDays, dateKey, fmtTime, parseLocal, sameDay, startOfDay } from "./datetime";
import { expandAll, expandEvent } from "./recur";
import type { AgendaEvent, Reminder, Settings, Task } from "./types";

const HORIZON_DAYS = 30;
const GRACE_MS = 10 * 60 * 1000; // lembretes vencidos há < 10 min ainda disparam 1×

function offsetText(min: number): string {
  if (min <= 0) return "agora";
  if (min % 1440 === 0) return `${min / 1440} dia(s) antes`;
  if (min % 60 === 0) return `${min / 60} h antes`;
  return `${min} min antes`;
}

function eventBody(start: Date, min: number, allDay: boolean): string {
  const when = allDay ? "hoje (dia inteiro)" : `às ${fmtTime(start)}`;
  return min <= 0 ? `Começa ${when}` : `Começa ${when} — lembrete ${offsetText(min)}`;
}

function summaryBody(events: number, tasks: number): string {
  const e = `${events} evento${events === 1 ? "" : "s"}`;
  const t = `${tasks} tarefa${tasks === 1 ? "" : "s"}`;
  if (events && tasks) return `${e} e ${t} para hoje.`;
  if (events) return `${e} para hoje.`;
  return `${t} para hoje.`;
}

/** Calcula todas as linhas de lembrete pra janela rolante. */
export function buildReminders(events: AgendaEvent[], tasks: Task[], settings: Settings): Reminder[] {
  const now = Date.now();
  const nowD = new Date();
  const horizon = addDays(startOfDay(nowD), HORIZON_DAYS);
  const items: Reminder[] = [];
  const push = (r: Reminder) => {
    if (r.fireAt >= now - GRACE_MS && r.fireAt <= horizon.getTime()) items.push(r);
  };

  // Eventos (inclui recorrentes).
  for (const ev of events) {
    if (!ev.reminders.length) continue;
    const occs = expandEvent(ev, addDays(nowD, -1), horizon);
    for (const o of occs) {
      for (const min of ev.reminders) {
        push({
          id: `event:${ev.id}:${o.occKey}:${min}`,
          kind: "event",
          refId: ev.id,
          occ: o.occKey,
          title: ev.title || "Evento",
          body: eventBody(o.start, min, ev.allDay),
          fireAt: o.start.getTime() - min * 60_000,
          fired: false,
        });
      }
    }
  }

  // Tarefas com prazo (não concluídas).
  for (const t of tasks) {
    if (t.doneAt || !t.due || !t.reminders.length) continue;
    const due = parseLocal(t.due);
    const allDay = !t.due.includes("T");
    for (const min of t.reminders) {
      push({
        id: `task:${t.id}:${t.due}:${min}`,
        kind: "task",
        refId: t.id,
        occ: t.due,
        title: `Tarefa: ${t.title}`,
        body: eventBody(due, min, allDay),
        fireAt: due.getTime() - min * 60_000,
        fired: false,
      });
    }
  }

  // Resumo do dia (notificação inteligente): próximos 7 dias, um por dia com
  // conteúdo, no horário escolhido.
  if (settings.dailySummary) {
    const [h, m] = settings.dailySummaryTime.split(":").map(Number);
    for (let i = 0; i < 7; i++) {
      const day = addDays(startOfDay(nowD), i);
      const evCount = expandAll(events, day, addDays(day, 1)).length;
      const taskCount = tasks.filter((t) => !t.doneAt && t.due && sameDay(parseLocal(t.due), day)).length;
      if (evCount === 0 && taskCount === 0) continue;
      const at = new Date(day);
      at.setHours(h || 8, m || 0, 0, 0);
      push({
        id: `summary::${dateKey(day)}`,
        kind: "summary",
        refId: "",
        occ: dateKey(day),
        title: "Sua agenda de hoje",
        body: summaryBody(evCount, taskCount),
        fireAt: at.getTime(),
        fired: false,
      });
    }
  }

  return items;
}

/** Recalcula e grava os lembretes, depois pede um disparo imediato dos vencidos. */
export async function syncReminders(
  events: AgendaEvent[],
  tasks: Task[],
  settings: Settings,
): Promise<void> {
  const items = buildReminders(events, tasks, settings);
  await remindersReplace(items);
  await remindersDispatch();
}
