// Recorrência via rrule.js (RFC 5545 — mesma semântica de Google/Outlook).
//
// Gotcha do rrule.js: ele opera nos campos UTC das datas. Como o LocalAgenda é
// "hora de parede local, sem fuso", usamos o truque padrão do rrule.js: espelhar
// a hora local em UTC (mesmos números), rodar a recorrência, e desespelhar de
// volta. Assim DST e offset não escorregam nada.

import { RRule } from "rrule";
import type { AgendaEvent } from "./types";
import { fmtDateShort, parseLocal, toIso, weekdayShort } from "./datetime";
import { t, type MessageKey } from "./i18n";

export interface Occurrence {
  event: AgendaEvent;
  start: Date;
  end: Date;
  /** ISO do início desta ocorrência — casa com `event.exdates`. */
  occKey: string;
}

function toUtcMirror(local: Date): Date {
  return new Date(
    Date.UTC(
      local.getFullYear(),
      local.getMonth(),
      local.getDate(),
      local.getHours(),
      local.getMinutes(),
      0,
    ),
  );
}

function fromUtcMirror(utc: Date): Date {
  return new Date(
    utc.getUTCFullYear(),
    utc.getUTCMonth(),
    utc.getUTCDate(),
    utc.getUTCHours(),
    utc.getUTCMinutes(),
    0,
  );
}

const WEEKDAY_CODES = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];

function mk(event: AgendaEvent, start: Date, durMs: number): Occurrence {
  return {
    event,
    start,
    end: new Date(start.getTime() + durMs),
    occKey: toIso(start, event.allDay),
  };
}

/** Todas as ocorrências de um evento que tocam [rangeStart, rangeEnd). */
export function expandEvent(ev: AgendaEvent, rangeStart: Date, rangeEnd: Date): Occurrence[] {
  const start0 = parseLocal(ev.start);
  const end0 = parseLocal(ev.end);
  if (isNaN(start0.getTime())) return [];
  const durMs = Math.max(0, end0.getTime() - start0.getTime());

  if (!ev.rrule) {
    if (end0 > rangeStart && start0 < rangeEnd) return [mk(ev, start0, durMs)];
    return [];
  }

  let dates: Date[];
  try {
    const opts = RRule.parseString(ev.rrule);
    const rule = new RRule({ ...opts, dtstart: toUtcMirror(start0) });
    // Estende o piso pela duração pra pegar um evento que começou antes da
    // janela mas ainda está rolando.
    const lo = toUtcMirror(new Date(rangeStart.getTime() - durMs));
    const hi = toUtcMirror(rangeEnd);
    dates = rule.between(lo, hi, true);
  } catch {
    // RRULE inválida: cai pra evento único (não perde o compromisso).
    if (end0 > rangeStart && start0 < rangeEnd) return [mk(ev, start0, durMs)];
    return [];
  }

  const exset = new Set(ev.exdates);
  const out: Occurrence[] = [];
  for (const u of dates) {
    const s = fromUtcMirror(u);
    const occKey = toIso(s, ev.allDay);
    if (exset.has(occKey)) continue;
    const e = new Date(s.getTime() + durMs);
    if (e <= rangeStart || s >= rangeEnd) continue;
    out.push({ event: ev, start: s, end: e, occKey });
  }
  return out;
}

/** Expande vários eventos numa janela e ordena por início. */
export function expandAll(events: AgendaEvent[], rangeStart: Date, rangeEnd: Date): Occurrence[] {
  const out: Occurrence[] = [];
  for (const ev of events) out.push(...expandEvent(ev, rangeStart, rangeEnd));
  out.sort((a, b) => a.start.getTime() - b.start.getTime());
  return out;
}

// --- construção/edição da RRULE pela UI ---

export type Freq = "" | "DAILY" | "WEEKLY" | "MONTHLY" | "YEARLY";

export interface RecurUI {
  freq: Freq;
  interval: number;
  /** JS 0=domingo … 6=sábado (só WEEKLY). */
  byweekday: number[];
  endType: "never" | "count" | "until";
  count: number;
  /** "YYYY-MM-DD" (só quando endType="until"). */
  until: string;
}

export const EMPTY_RECUR: RecurUI = {
  freq: "",
  interval: 1,
  byweekday: [],
  endType: "never",
  count: 10,
  until: "",
};

/** UI → string RRULE RFC (sem DTSTART); "" quando não recorre. */
export function buildRRuleString(ui: RecurUI): string {
  if (!ui.freq) return "";
  const parts = [`FREQ=${ui.freq}`];
  if (ui.interval > 1) parts.push(`INTERVAL=${ui.interval}`);
  if (ui.freq === "WEEKLY" && ui.byweekday.length) {
    parts.push(`BYDAY=${ui.byweekday.map((d) => WEEKDAY_CODES[d]).join(",")}`);
  }
  if (ui.endType === "count" && ui.count > 0) {
    parts.push(`COUNT=${ui.count}`);
  } else if (ui.endType === "until" && ui.until) {
    // UNTIL espelhado em UTC (fim do dia local) pra casar com o dtstart espelhado.
    const d = parseLocal(ui.until);
    const m = toUtcMirror(new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59));
    const y = m.getUTCFullYear();
    const mo = String(m.getUTCMonth() + 1).padStart(2, "0");
    const da = String(m.getUTCDate()).padStart(2, "0");
    parts.push(`UNTIL=${y}${mo}${da}T235900Z`);
  }
  return parts.join(";");
}

/** string RRULE → estado da UI (pra reabrir um evento recorrente no editor). */
export function parseRRuleToUI(rrule: string): RecurUI {
  if (!rrule) return { ...EMPTY_RECUR };
  const ui: RecurUI = { ...EMPTY_RECUR };
  for (const part of rrule.split(";")) {
    const [k, v] = part.split("=");
    if (!v) continue;
    switch (k.toUpperCase()) {
      case "FREQ":
        ui.freq = v.toUpperCase() as Freq;
        break;
      case "INTERVAL":
        ui.interval = Math.max(1, parseInt(v, 10) || 1);
        break;
      case "BYDAY":
        ui.byweekday = v
          .split(",")
          .map((c) => WEEKDAY_CODES.indexOf(c.toUpperCase()))
          .filter((i) => i >= 0);
        break;
      case "COUNT":
        ui.endType = "count";
        ui.count = parseInt(v, 10) || 10;
        break;
      case "UNTIL": {
        ui.endType = "until";
        const y = v.slice(0, 4);
        const mo = v.slice(4, 6);
        const da = v.slice(6, 8);
        ui.until = `${y}-${mo}-${da}`;
        break;
      }
    }
  }
  return ui;
}

// Chaves de frase por frequência (frase COMPLETA por idioma — a concordância
// varia demais pra concatenar palavra a palavra).
const FREQ_EVERY: Record<string, MessageKey> = {
  DAILY: "recur.every.daily",
  WEEKLY: "recur.every.weekly",
  MONTHLY: "recur.every.monthly",
  YEARLY: "recur.every.yearly",
};
const FREQ_EVERY_N: Record<string, MessageKey> = {
  DAILY: "recur.everyN.daily",
  WEEKLY: "recur.everyN.weekly",
  MONTHLY: "recur.everyN.monthly",
  YEARLY: "recur.everyN.yearly",
};

/** Texto humano da recorrência no idioma da UI (mostra no editor e nos cards). */
export function describeRRule(rrule: string): string {
  if (!rrule) return t("recur.never");
  const ui = parseRRuleToUI(rrule);
  if (!ui.freq) return t("recur.never");
  let base =
    ui.interval > 1
      ? t(FREQ_EVERY_N[ui.freq], { n: ui.interval })
      : t(FREQ_EVERY[ui.freq]);
  if (ui.freq === "WEEKLY" && ui.byweekday.length) {
    const days = ui.byweekday
      .slice()
      .sort((a, b) => a - b)
      .map((d) => weekdayShort(d))
      .join(", ");
    base += t("recur.days", { days });
  }
  if (ui.endType === "count") {
    base += t("recur.count", { n: ui.count });
  } else if (ui.endType === "until" && ui.until) {
    base += t("recur.until", { date: fmtDateShort(parseLocal(ui.until)) });
  }
  return base;
}

/** Próxima ocorrência de uma RRULE a partir de agora (pra recorrência de tarefa). */
export function nextOccurrenceAfter(rrule: string, from: Date, after: Date): Date | null {
  if (!rrule) return null;
  try {
    const opts = RRule.parseString(rrule);
    const rule = new RRule({ ...opts, dtstart: toUtcMirror(from) });
    const next = rule.after(toUtcMirror(after), false);
    return next ? fromUtcMirror(next) : null;
  } catch {
    return null;
  }
}
