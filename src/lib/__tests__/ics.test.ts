import { describe, expect, it } from "vitest";
import { exportIcs, parseIcs } from "../ics";
import type { AgendaEvent } from "../types";

function ev(partial: Partial<AgendaEvent>): AgendaEvent {
  return {
    id: "e1",
    calendarId: "c1",
    title: "Reunião",
    description: "pauta; itens",
    location: "Sala 2",
    start: "2026-07-15T09:00",
    end: "2026-07-15T10:00",
    allDay: false,
    rrule: "",
    exdates: [],
    seriesId: "",
    recurrenceId: "",
    reminders: [],
    createdAt: 0,
    updatedAt: 0,
    ...partial,
  };
}

describe("exportIcs / parseIcs", () => {
  it("faz round-trip de um evento com hora", () => {
    const ics = exportIcs([ev({})]);
    expect(ics).toContain("BEGIN:VEVENT");
    expect(ics).toContain("SUMMARY:Reunião");
    const back = parseIcs(ics);
    expect(back).toHaveLength(1);
    expect(back[0].title).toBe("Reunião");
    expect(back[0].start).toBe("2026-07-15T09:00");
    expect(back[0].end).toBe("2026-07-15T10:00");
    expect(back[0].allDay).toBe(false);
    expect(back[0].location).toBe("Sala 2");
  });

  it("preserva recorrência", () => {
    const ics = exportIcs([ev({ rrule: "FREQ=WEEKLY;BYDAY=WE" })]);
    const back = parseIcs(ics);
    expect(back[0].rrule).toBe("FREQ=WEEKLY;BYDAY=WE");
  });

  it("lê evento de dia inteiro", () => {
    const ics =
      "BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nUID:x\r\nDTSTART;VALUE=DATE:20260715\r\nDTEND;VALUE=DATE:20260716\r\nSUMMARY:Feriado\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n";
    const back = parseIcs(ics);
    expect(back).toHaveLength(1);
    expect(back[0].allDay).toBe(true);
    expect(back[0].start).toBe("2026-07-15");
    expect(back[0].title).toBe("Feriado");
  });

  it("desescapa vírgula e ponto-e-vírgula", () => {
    const back = parseIcs(exportIcs([ev({})]));
    expect(back[0].description).toBe("pauta; itens");
  });

  it("exceção de série sai com RECURRENCE-ID e o UID da série", () => {
    const serie = ev({ id: "s1", rrule: "FREQ=WEEKLY;BYDAY=WE" });
    const excecao = ev({
      id: "x1",
      seriesId: "s1",
      recurrenceId: "2026-07-22T09:00",
      start: "2026-07-24T15:00",
      end: "2026-07-24T16:00",
      title: "Reunião especial",
    });
    const ics = exportIcs([serie, excecao]);
    expect(ics).toContain("RECURRENCE-ID:20260722T090000");
    // Mesmo UID nos dois VEVENT: é o que amarra exceção e série no RFC 5545.
    expect(ics.match(/UID:s1@localagenda/g)).toHaveLength(2);

    const back = parseIcs(ics);
    expect(back).toHaveLength(2);
    const lida = back.find((e) => e.recurrenceId)!;
    expect(lida.uid).toBe("s1@localagenda");
    expect(lida.recurrenceId).toBe("2026-07-22T09:00");
    // O horário para onde foi movida sobrevive separado da origem.
    expect(lida.start).toBe("2026-07-24T15:00");
    expect(lida.title).toBe("Reunião especial");
  });

  it("evento normal não ganha RECURRENCE-ID", () => {
    expect(exportIcs([ev({})])).not.toContain("RECURRENCE-ID");
  });
});
