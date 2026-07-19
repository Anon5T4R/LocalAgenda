import { describe, expect, it } from "vitest";
import {
  buildRRuleString,
  EMPTY_RECUR,
  expandAll,
  expandEvent,
  indexOverrides,
  parseRRuleToUI,
} from "../recur";
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
    seriesId: "",
    recurrenceId: "",
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

// --- exceções de série (RECURRENCE-ID) ---------------------------------------
//
// A série é "toda quarta 9h, 3 vezes": 15, 22 e 29 de julho de 2026.
// A janela cobre julho inteiro em todos os casos.

const JUL = [new Date(2026, 6, 1), new Date(2026, 7, 1)] as const;

/** Série-mãe usada por todos os casos abaixo. */
const series = () => ev({ id: "s1", title: "Reunião", rrule: "FREQ=WEEKLY;BYDAY=WE;COUNT=3" });

/** Exceção que substitui a ocorrência de `recurrenceId`, começando em `start`. */
const exception = (recurrenceId: string, start: string, extra: Partial<AgendaEvent> = {}) =>
  ev({
    id: "x1",
    seriesId: "s1",
    rrule: "",
    recurrenceId,
    start,
    end: start.replace(/T\d\d:/, "T" + String(+start.slice(11, 13) + 1).padStart(2, "0") + ":"),
    ...extra,
  });

const days = (occ: { start: Date }[]) => occ.map((o) => o.start.getDate());

describe("exceções de série", () => {
  it("a ocorrência movida aparece UMA vez, no lugar novo", () => {
    // 22/jul 9h foi arrastada pra 24/jul 15h.
    const occ = expandAll([series(), exception("2026-07-22T09:00", "2026-07-24T15:00")], ...JUL);
    // 22 sumiu (a série calou), 24 apareceu (a exceção). Nunca os dois.
    expect(days(occ)).toEqual([15, 24, 29]);
    expect(days(occ).filter((d) => d === 22)).toHaveLength(0);
    const moved = occ.find((o) => o.start.getDate() === 24)!;
    expect(moved.start.getHours()).toBe(15);
    expect(moved.isException).toBe(true);
  });

  it("a exceção sobrevive ao round-trip de persistência (só campos serializáveis)", () => {
    // Prova que nada da supressão depende de estado em memória: reidrata os
    // eventos de JSON (o que o SQLite devolve) e expande de novo.
    const stored = JSON.parse(
      JSON.stringify([series(), exception("2026-07-22T09:00", "2026-07-24T15:00")]),
    ) as AgendaEvent[];
    expect(days(expandAll(stored, ...JUL))).toEqual([15, 24, 29]);
  });

  it("apagar a exceção some só com ela (a série não ressuscita o horário velho)", () => {
    // É o que `removeOccurrence` grava: exceção fora + origem em exdates.
    const s = { ...series(), exdates: ["2026-07-22T09:00"] };
    expect(days(expandAll([s], ...JUL))).toEqual([15, 29]);
  });

  it("editar a SÉRIE depois não desfaz a exceção — a exceção ganha", () => {
    // Série renomeada e movida pras 8h; a exceção mantém título e horário.
    const s = {
      ...series(),
      title: "Reunião (novo nome)",
      start: "2026-07-15T08:00",
      end: "2026-07-15T09:00",
    };
    const x = exception("2026-07-22T09:00", "2026-07-24T15:00", { title: "Reunião especial" });
    const occ = expandAll([s, x], ...JUL);
    const ex = occ.find((o) => o.isException)!;
    expect(ex.event.title).toBe("Reunião especial");
    expect(ex.start.getHours()).toBe(15);
    // E as ocorrências normais seguem a série nova (8h), sem duplicar a exceção.
    expect(occ.filter((o) => o.isException)).toHaveLength(1);
    expect(occ.filter((o) => !o.isException).every((o) => o.start.getHours() === 8)).toBe(true);
  });

  it("cancelada e substituída não se somam: exdate + exceção mostra uma só", () => {
    // Estado defensivo (import estranho): a expansão não pode duplicar nem sumir.
    const s = { ...series(), exdates: ["2026-07-22T09:00"] };
    const occ = expandAll([s, exception("2026-07-22T09:00", "2026-07-24T15:00")], ...JUL);
    expect(days(occ)).toEqual([15, 24, 29]);
  });

  it("a exceção guarda a origem como occKey, não o horário novo", () => {
    // Sem isso, reeditar a exceção movida geraria uma segunda exceção.
    const occ = expandAll([series(), exception("2026-07-22T09:00", "2026-07-24T15:00")], ...JUL);
    expect(occ.find((o) => o.isException)!.occKey).toBe("2026-07-22T09:00");
  });

  it("expandEvent sem o índice não suprime — por isso expandAll existe", () => {
    // Documenta a armadilha: quem expande um evento solto TEM que passar o
    // índice, senão a série devolve a ocorrência que já tem exceção.
    const solo = expandEvent(series(), ...JUL);
    expect(days(solo)).toEqual([15, 22, 29]);
    const comIndice = expandEvent(
      series(),
      ...JUL,
      indexOverrides([exception("2026-07-22T09:00", "2026-07-24T15:00")]).get("s1"),
    );
    expect(days(comIndice)).toEqual([15, 29]);
  });

  it("indexOverrides agrupa por série e ignora eventos normais", () => {
    const idx = indexOverrides([
      series(),
      exception("2026-07-22T09:00", "2026-07-24T15:00"),
      ev({ id: "outro" }),
    ]);
    expect(idx.get("s1")).toEqual(new Set(["2026-07-22T09:00"]));
    expect(idx.has("outro")).toBe(false);
  });

  it("exceção de dia inteiro também cala a ocorrência certa", () => {
    const s = ev({
      id: "s1",
      allDay: true,
      start: "2026-07-15",
      end: "2026-07-15",
      rrule: "FREQ=DAILY;COUNT=3",
    });
    const x = ev({
      id: "x1",
      allDay: true,
      seriesId: "s1",
      recurrenceId: "2026-07-16",
      start: "2026-07-20",
      end: "2026-07-20",
    });
    expect(days(expandAll([s, x], ...JUL))).toEqual([15, 17, 20]);
  });
});
