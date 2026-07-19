// Testes do lado da ESCRITA das exceções de recorrência: a expansão (recur.ts)
// já é testada pura, aqui o que se prova é que a store grava o par
// série/exceção de um jeito que sobrevive ao banco e não duplica ocorrência.
//
// O backend é substituído por um banco falso que copia as regras do db.rs — em
// especial a CASCATA do event_delete (apagar a série leva as exceções junto).
// Sem espelhar isso, o teste passaria e o app real deixaria órfãs.

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AgendaEvent } from "../../lib/types";

/** "Banco" do teste: id → evento, como o SQLite devolveria. */
const rows = new Map<string, AgendaEvent>();
let seq = 0;

vi.mock("../../lib/backend", () => ({
  inTauri: () => true,
  calendarsList: async () => [{ id: "c1", name: "Pessoal", color: "#000", visible: true, sort: 0 }],
  calendarSave: async (cal: unknown) => cal,
  calendarDelete: async () => {},
  eventsList: async () => [...rows.values()],
  eventSave: async (ev: AgendaEvent) => {
    const saved = { ...ev, id: ev.id || `ev${++seq}` };
    rows.set(saved.id, saved);
    return saved;
  },
  // Espelha o "DELETE FROM events WHERE id=?1 OR series_id=?1" do Rust.
  eventDelete: async (id: string) => {
    for (const [k, v] of [...rows]) if (k === id || v.seriesId === id) rows.delete(k);
  },
  tasksList: async () => [],
  taskSave: async (t: unknown) => t,
  taskDelete: async () => {},
  alarmsList: async () => [],
  alarmSave: async (a: unknown) => a,
  alarmDelete: async () => {},
  settingsGet: async () => ({}),
  settingsSet: async () => {},
  remindersReplace: async () => {},
  remindersDispatch: async () => {},
}));

const { useStore } = await import("../store");
const { expandAll } = await import("../../lib/recur");

const JUL: [Date, Date] = [new Date(2026, 6, 1), new Date(2026, 7, 1)];

/** Expande o que está NO BANCO (não o que está em memória) numa janela de julho. */
const daysFromDb = () =>
  expandAll([...rows.values()], ...JUL).map((o) => o.start.getDate());

/** Simula fechar e reabrir o app: store zerada, recarregada do banco. */
async function reopen() {
  useStore.setState({ events: [], calendars: [], loaded: false });
  await useStore.getState().load();
}

const serie = () =>
  useStore.getState().events.find((e) => e.rrule)!;

beforeEach(async () => {
  rows.clear();
  seq = 0;
  useStore.setState({ events: [], calendars: [], tasks: [], alarms: [] });
  await useStore.getState().load();
  // "Toda quarta 9h, 3×" → 15, 22 e 29 de julho de 2026.
  await useStore.getState().saveEvent({
    calendarId: "c1",
    title: "Reunião",
    start: "2026-07-15T09:00",
    end: "2026-07-15T10:00",
    rrule: "FREQ=WEEKLY;BYDAY=WE;COUNT=3",
  });
});

describe("exceções de série na store", () => {
  it("mover uma ocorrência: sobrevive a reabrir o app e não duplica", async () => {
    await useStore.getState().saveOccurrence(serie(), "2026-07-22T09:00", {
      calendarId: "c1",
      title: "Reunião",
      start: "2026-07-24T15:00",
      end: "2026-07-24T16:00",
    });
    expect(daysFromDb()).toEqual([15, 24, 29]);

    await reopen();
    // O que importa: depois do round-trip pelo banco a exceção continua ligada
    // à série (senão a ocorrência voltaria a aparecer no dia 22 TAMBÉM).
    expect(daysFromDb()).toEqual([15, 24, 29]);
    const ex = [...rows.values()].find((e) => e.seriesId)!;
    expect(ex.recurrenceId).toBe("2026-07-22T09:00");
    expect(ex.rrule).toBe("");
  });

  it("reeditar a mesma ocorrência atualiza a exceção, não cria uma segunda", async () => {
    const s = serie();
    await useStore.getState().saveOccurrence(s, "2026-07-22T09:00", {
      calendarId: "c1",
      title: "v1",
      start: "2026-07-24T15:00",
      end: "2026-07-24T16:00",
    });
    await useStore.getState().saveOccurrence(serie(), "2026-07-22T09:00", {
      calendarId: "c1",
      title: "v2",
      start: "2026-07-25T11:00",
      end: "2026-07-25T12:00",
    });
    expect([...rows.values()].filter((e) => e.seriesId)).toHaveLength(1);
    expect(daysFromDb()).toEqual([15, 25, 29]);
    expect([...rows.values()].find((e) => e.seriesId)!.title).toBe("v2");
  });

  it("apagar a ocorrência excepcional some só com ela", async () => {
    await useStore.getState().saveOccurrence(serie(), "2026-07-22T09:00", {
      calendarId: "c1",
      title: "movida",
      start: "2026-07-24T15:00",
      end: "2026-07-24T16:00",
    });
    const ex = useStore.getState().events.find((e) => e.seriesId)!;
    await useStore.getState().removeOccurrence(ex, ex.recurrenceId);

    // A exceção sumiu E a série não ressuscitou o dia 22: as outras seguem.
    expect(daysFromDb()).toEqual([15, 29]);
    expect([...rows.values()].filter((e) => e.seriesId)).toHaveLength(0);
    await reopen();
    expect(daysFromDb()).toEqual([15, 29]);
  });

  it("editar a SÉRIE depois não desfaz a exceção — a exceção ganha", async () => {
    await useStore.getState().saveOccurrence(serie(), "2026-07-22T09:00", {
      calendarId: "c1",
      title: "Reunião especial",
      start: "2026-07-24T15:00",
      end: "2026-07-24T16:00",
    });
    // Renomeia a série inteira (mantendo a mesma regra e o mesmo início).
    const s = serie();
    await useStore.getState().saveEvent({ ...s, title: "Reunião renomeada" });

    await reopen();
    const occ = expandAll([...rows.values()], ...JUL);
    expect(occ.map((o) => o.start.getDate())).toEqual([15, 24, 29]);
    // A exceção manteve título e horário próprios; as normais seguiram a série.
    const ex = occ.find((o) => o.isException)!;
    expect(ex.event.title).toBe("Reunião especial");
    expect(occ.filter((o) => !o.isException).every((o) => o.event.title === "Reunião renomeada")).toBe(true);
  });

  it("apagar a série leva as exceções junto (nenhuma órfã no banco)", async () => {
    await useStore.getState().saveOccurrence(serie(), "2026-07-22T09:00", {
      calendarId: "c1",
      title: "movida",
      start: "2026-07-24T15:00",
      end: "2026-07-24T16:00",
    });
    expect(rows.size).toBe(2);
    await useStore.getState().removeEvent(serie().id);
    expect(rows.size).toBe(0);
    await reopen();
    expect(daysFromDb()).toEqual([]);
  });

  it("cancelar uma ocorrência que já era exceção não deixa as duas coisas", async () => {
    await useStore.getState().saveOccurrence(serie(), "2026-07-22T09:00", {
      calendarId: "c1",
      title: "movida",
      start: "2026-07-24T15:00",
      end: "2026-07-24T16:00",
    });
    await useStore.getState().excludeOccurrence(serie(), "2026-07-22T09:00");
    // A exceção morreu e a origem virou EXDATE: some uma só ocorrência.
    expect([...rows.values()].filter((e) => e.seriesId)).toHaveLength(0);
    expect(serie().exdates).toEqual(["2026-07-22T09:00"]);
    expect(daysFromDb()).toEqual([15, 29]);
  });

  it("editar uma ocorrência CANCELADA a traz de volta como exceção", async () => {
    await useStore.getState().excludeOccurrence(serie(), "2026-07-22T09:00");
    expect(daysFromDb()).toEqual([15, 29]);
    await useStore.getState().saveOccurrence(serie(), "2026-07-22T09:00", {
      calendarId: "c1",
      title: "remarcada",
      start: "2026-07-24T15:00",
      end: "2026-07-24T16:00",
    });
    // Sem tirar o EXDATE, a série continuaria calando e a exceção nova seria
    // gravada mas nunca desenhada.
    expect(serie().exdates).toEqual([]);
    expect(daysFromDb()).toEqual([15, 24, 29]);
  });
});
