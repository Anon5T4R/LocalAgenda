import { describe, expect, it } from "vitest";
import { buildRRuleString, EMPTY_RECUR, expandEvent, parseRRuleToUI } from "../recur";
import type { AgendaEvent } from "../types";

function ev(partial: Partial<AgendaEvent>): AgendaEvent {
  return {
    id: "e1",
    calendarId: "c1",
    title: "Teste",
    description: "",
    location: "",
    start: "2026-07-15T09:00",
    end: "2026-07-15T10:00",
    allDay: false,
    rrule: "",
    exdates: [],
    reminders: [],
    createdAt: 0,
    updatedAt: 0,
    ...partial,
  };
}

describe("buildRRuleString / parseRRuleToUI", () => {
  it("monta uma RRULE semanal com dias e contagem", () => {
    const s = buildRRuleString({
      ...EMPTY_RECUR,
      freq: "WEEKLY",
      interval: 2,
      byweekday: [1, 3],
      endType: "count",
      count: 5,
    });
    expect(s).toBe("FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE;COUNT=5");
  });

  it("faz round-trip pela UI", () => {
    const ui = parseRRuleToUI("FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE;COUNT=5");
    expect(ui.freq).toBe("WEEKLY");
    expect(ui.interval).toBe(2);
    expect(ui.byweekday).toEqual([1, 3]);
    expect(ui.endType).toBe("count");
    expect(ui.count).toBe(5);
  });

  it("string vazia quando não repete", () => {
    expect(buildRRuleString({ ...EMPTY_RECUR, freq: "" })).toBe("");
  });
});

describe("expandEvent", () => {
  it("evento único aparece uma vez na janela", () => {
    const occ = expandEvent(ev({}), new Date(2026, 6, 14), new Date(2026, 6, 20));
    expect(occ).toHaveLength(1);
    expect(occ[0].start.getHours()).toBe(9);
  });

  it("recorrência diária com COUNT respeita o total", () => {
    const occ = expandEvent(
      ev({ rrule: "FREQ=DAILY;COUNT=3" }),
      new Date(2026, 6, 15),
      new Date(2026, 6, 25),
    );
    expect(occ).toHaveLength(3);
    expect(occ.map((o) => o.start.getDate())).toEqual([15, 16, 17]);
    // hora de parede preservada (sem escorregar por fuso)
    for (const o of occ) expect(o.start.getHours()).toBe(9);
  });

  it("exdate remove a ocorrência exata", () => {
    const occ = expandEvent(
      ev({ rrule: "FREQ=DAILY;COUNT=3", exdates: ["2026-07-16T09:00"] }),
      new Date(2026, 6, 15),
      new Date(2026, 6, 25),
    );
    expect(occ.map((o) => o.start.getDate())).toEqual([15, 17]);
  });

  it("semanal por dia da semana", () => {
    const occ = expandEvent(
      ev({ rrule: "FREQ=WEEKLY;BYDAY=WE" }),
      new Date(2026, 6, 15),
      new Date(2026, 6, 29),
    );
    // 15/jul e 22/jul são quartas
    expect(occ.map((o) => o.start.getDate())).toEqual([15, 22]);
  });

  it("janela vazia não retorna nada", () => {
    const occ = expandEvent(ev({}), new Date(2026, 0, 1), new Date(2026, 0, 2));
    expect(occ).toHaveLength(0);
  });
});
