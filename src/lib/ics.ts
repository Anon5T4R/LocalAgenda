// Import/export iCalendar (.ics). Texto puro — fica no webview (Rust só move
// bytes), coerente com a suíte. Cobre o caso comum (VEVENT com recorrência e
// exceções); feeds exóticos caem no melhor esforço.

import type { AgendaEvent } from "./types";
import { parseLocal, pad2, toIso } from "./datetime";
import { t } from "./i18n";

function esc(s: string): string {
  return (s || "")
    .replace(/\\/g, "\\\\")
    .replace(/\n/g, "\\n")
    .replace(/,/g, "\\,")
    .replace(/;/g, "\\;");
}

function unesc(s: string): string {
  return s
    .replace(/\\n/gi, "\n")
    .replace(/\\,/g, ",")
    .replace(/\\;/g, ";")
    .replace(/\\\\/g, "\\");
}

/** Date → "YYYYMMDDTHHMMSS" (flutuante, sem Z: hora de parede local). */
function icsStamp(iso: string, allDay: boolean): string {
  const d = parseLocal(iso);
  const base = `${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}`;
  if (allDay) return base;
  return `${base}T${pad2(d.getHours())}${pad2(d.getMinutes())}00`;
}

function utcStampNow(): string {
  const d = new Date();
  return (
    `${d.getUTCFullYear()}${pad2(d.getUTCMonth() + 1)}${pad2(d.getUTCDate())}` +
    `T${pad2(d.getUTCHours())}${pad2(d.getUTCMinutes())}${pad2(d.getUTCSeconds())}Z`
  );
}

/** Exporta eventos como um VCALENDAR. */
export function exportIcs(events: AgendaEvent[]): string {
  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Anon5T4R//LocalAgenda//PT-BR",
    "CALSCALE:GREGORIAN",
  ];
  const stamp = utcStampNow();
  for (const ev of events) {
    const exception = !!ev.seriesId && !!ev.recurrenceId;
    lines.push("BEGIN:VEVENT");
    // Exceção compartilha o UID da série e se distingue pelo RECURRENCE-ID —
    // é assim que o RFC 5545 amarra as duas; UID próprio viraria evento solto.
    lines.push(`UID:${exception ? ev.seriesId : ev.id}@localagenda`);
    lines.push(`DTSTAMP:${stamp}`);
    if (exception) {
      lines.push(
        ev.allDay
          ? `RECURRENCE-ID;VALUE=DATE:${icsStamp(ev.recurrenceId, true)}`
          : `RECURRENCE-ID:${icsStamp(ev.recurrenceId, false)}`,
      );
    }
    if (ev.allDay) {
      lines.push(`DTSTART;VALUE=DATE:${icsStamp(ev.start, true)}`);
      lines.push(`DTEND;VALUE=DATE:${icsStamp(ev.end, true)}`);
    } else {
      lines.push(`DTSTART:${icsStamp(ev.start, false)}`);
      lines.push(`DTEND:${icsStamp(ev.end, false)}`);
    }
    lines.push(`SUMMARY:${esc(ev.title)}`);
    if (ev.description) lines.push(`DESCRIPTION:${esc(ev.description)}`);
    if (ev.location) lines.push(`LOCATION:${esc(ev.location)}`);
    if (ev.rrule) lines.push(`RRULE:${ev.rrule}`);
    if (ev.exdates.length) {
      const ex = ev.exdates.map((x) => icsStamp(x, ev.allDay)).join(",");
      lines.push(ev.allDay ? `EXDATE;VALUE=DATE:${ex}` : `EXDATE:${ex}`);
    }
    lines.push("END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  return lines.join("\r\n") + "\r\n";
}

/** "YYYYMMDD[THHMMSS[Z]]" → { iso, allDay }. Z vira hora local. */
function parseIcsDate(raw: string): { iso: string; allDay: boolean } {
  const v = raw.trim();
  if (!v.includes("T")) {
    // Data pura → dia inteiro.
    const y = v.slice(0, 4);
    const mo = v.slice(4, 6);
    const da = v.slice(6, 8);
    return { iso: `${y}-${mo}-${da}`, allDay: true };
  }
  const [datePart, timePartRaw] = v.split("T");
  const y = +datePart.slice(0, 4);
  const mo = +datePart.slice(4, 6);
  const da = +datePart.slice(6, 8);
  const isUtc = timePartRaw.endsWith("Z");
  const t = timePartRaw.replace("Z", "");
  const h = +t.slice(0, 2);
  const mi = +t.slice(2, 4);
  let d: Date;
  if (isUtc) {
    d = new Date(Date.UTC(y, mo - 1, da, h, mi));
  } else {
    d = new Date(y, mo - 1, da, h, mi);
  }
  return { iso: toIso(d, false), allDay: false };
}

/** Remove os parâmetros de uma chave ("DTSTART;VALUE=DATE" → "DTSTART"). */
function propName(key: string): string {
  return key.split(";")[0].toUpperCase();
}

/**
 * Evento vindo do .ics. `uid` sobrevive à parseada só pra religar as exceções à
 * série depois que o chamador tiver atribuído os ids locais — no arquivo elas
 * se conhecem por UID, aqui por `seriesId`.
 */
export type ParsedIcsEvent = Partial<AgendaEvent> & { uid?: string };

/** Parseia um .ics em eventos (parciais — sem id/calendarId, o chamador define). */
export function parseIcs(text: string): ParsedIcsEvent[] {
  // Desdobra linhas continuadas (começam com espaço/tab).
  const rawLines = text.replace(/\r\n/g, "\n").split("\n");
  const lines: string[] = [];
  for (const line of rawLines) {
    if ((line.startsWith(" ") || line.startsWith("\t")) && lines.length) {
      lines[lines.length - 1] += line.slice(1);
    } else {
      lines.push(line);
    }
  }

  const events: ParsedIcsEvent[] = [];
  let cur: ParsedIcsEvent | null = null;
  for (const line of lines) {
    if (line === "BEGIN:VEVENT") {
      cur = { exdates: [], reminders: [], allDay: false, description: "", location: "", rrule: "" };
      continue;
    }
    if (line === "END:VEVENT") {
      if (cur && cur.start) {
        if (!cur.end) cur.end = cur.start;
        if (!cur.title) cur.title = t("event.untitled");
        events.push(cur);
      }
      cur = null;
      continue;
    }
    if (!cur) continue;
    const idx = line.indexOf(":");
    if (idx < 0) continue;
    const key = line.slice(0, idx);
    const val = line.slice(idx + 1);
    switch (propName(key)) {
      case "SUMMARY":
        cur.title = unesc(val);
        break;
      case "DESCRIPTION":
        cur.description = unesc(val);
        break;
      case "LOCATION":
        cur.location = unesc(val);
        break;
      case "DTSTART": {
        const p = parseIcsDate(val);
        cur.start = p.iso;
        cur.allDay = p.allDay;
        break;
      }
      case "DTEND": {
        const p = parseIcsDate(val);
        cur.end = p.iso;
        break;
      }
      case "RRULE":
        cur.rrule = val.trim();
        break;
      case "UID":
        cur.uid = val.trim();
        break;
      case "RECURRENCE-ID":
        cur.recurrenceId = parseIcsDate(val).iso;
        break;
      case "EXDATE": {
        const allDay = key.toUpperCase().includes("VALUE=DATE");
        for (const piece of val.split(",")) {
          cur.exdates!.push(parseIcsDate(piece).iso);
        }
        void allDay;
        break;
      }
    }
  }
  return events;
}
