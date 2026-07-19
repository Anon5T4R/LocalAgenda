// Materialização de lembretes: o front expande as próximas ocorrências e grava
// as linhas concretas (com `fireAt` em epoch-ms); o tick do Rust dispara quando
// vencem. IDs determinísticos → cada ocorrência notifica no máximo uma vez.

import { remindersDispatch, remindersReplace } from "./backend";
import { addDays, dateKey, fmtTime, parseLocal, sameDay, startOfDay } from "./datetime";
import { t as tr } from "./i18n";
import { expandAll, expandEvent, indexOverrides } from "./recur";
import type { Alarm, AgendaEvent, Reminder, Settings, Task } from "./types";

const HORIZON_DAYS = 30;
const GRACE_MS = 10 * 60 * 1000; // lembretes vencidos há < 10 min ainda disparam 1×

function offsetText(min: number): string {
  if (min <= 0) return tr("notif.offset.now");
  if (min % 1440 === 0) return tr("notif.offset.days", { n: min / 1440 });
  if (min % 60 === 0) return tr("notif.offset.hours", { n: min / 60 });
  return tr("notif.offset.min", { n: min });
}

function eventBody(start: Date, min: number, allDay: boolean): string {
  const when = allDay ? tr("notif.when.allDay") : tr("notif.when.at", { time: fmtTime(start) });
  return min <= 0
    ? tr("notif.body.starts", { when })
    : tr("notif.body.startsRem", { when, off: offsetText(min) });
}

function summaryBody(events: number, tasks: number): string {
  const e = tr("notif.count.events", { n: events });
  const tk = tr("notif.count.tasks", { n: tasks });
  if (events && tasks) return tr("notif.summary.both", { e, t: tk });
  if (events) return tr("notif.summary.events", { e });
  return tr("notif.summary.tasks", { t: tk });
}

/** Calcula todas as linhas de lembrete pra janela rolante. */
export function buildReminders(
  events: AgendaEvent[],
  tasks: Task[],
  settings: Settings,
  alarms: Alarm[] = [],
): Reminder[] {
  const now = Date.now();
  const nowD = new Date();
  const horizon = addDays(startOfDay(nowD), HORIZON_DAYS);
  const items: Reminder[] = [];
  const push = (r: Reminder) => {
    if (r.fireAt >= now - GRACE_MS && r.fireAt <= horizon.getTime()) items.push(r);
  };

  // Eventos (inclui recorrentes). O índice de exceções é obrigatório aqui: sem
  // ele a ocorrência movida notificaria duas vezes (no horário velho pela série
  // e no novo pela exceção).
  const overrides = indexOverrides(events);
  for (const ev of events) {
    if (!ev.reminders.length) continue;
    const occs = expandEvent(ev, addDays(nowD, -1), horizon, overrides.get(ev.id));
    for (const o of occs) {
      for (const min of ev.reminders) {
        push({
          id: `event:${ev.id}:${o.occKey}:${min}`,
          kind: "event",
          refId: ev.id,
          occ: o.occKey,
          title: ev.title || tr("notif.event.fallback"),
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
        title: tr("notif.task.title", { title: t.title }),
        body: eventBody(due, min, allDay),
        fireAt: due.getTime() - min * 60_000,
        fired: false,
      });
    }
  }

  // Alarmes (módulo Relógio): próximos HORIZON dias, no horário e dias marcados.
  for (const al of alarms) {
    if (!al.enabled || !al.time) continue;
    const [h, m] = al.time.split(":").map(Number);
    for (let i = 0; i < HORIZON_DAYS; i++) {
      const day = addDays(startOfDay(nowD), i);
      if (al.days.length && !al.days.includes(day.getDay())) continue;
      const at = new Date(day);
      at.setHours(h || 0, m || 0, 0, 0);
      push({
        id: `alarm:${al.id}:${dateKey(day)}`,
        kind: "alarm",
        refId: al.id,
        occ: dateKey(day),
        title: al.label ? tr("notif.alarm.labeled", { label: al.label }) : tr("notif.alarm.plain"),
        body: tr("notif.alarm.body", { time: al.time }),
        fireAt: at.getTime(),
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
        title: tr("notif.summary.title"),
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
  alarms: Alarm[] = [],
): Promise<void> {
  const items = buildReminders(events, tasks, settings, alarms);
  await remindersReplace(items);
  await remindersDispatch();
}
