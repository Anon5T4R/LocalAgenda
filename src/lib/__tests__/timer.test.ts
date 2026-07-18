import { describe, expect, it } from "vitest";
import {
  fmtTimer,
  hmsToSeconds,
  isValidTimer,
  MAX_TIMER_SECONDS,
  secondsToHms,
  TIMER_PRESETS_HOUR,
  TIMER_PRESETS_MIN,
} from "../timer";

// Estes testes cravam exatamente os bugs de "assumir < 60min" e de contagem
// longa: um preset de horas TEM que dar os segundos certos, o custom hh:mm:ss
// TEM que converter certo, e a exibição TEM que mostrar horas legíveis.

describe("hmsToSeconds", () => {
  it("converte hh:mm:ss em segundos totais", () => {
    expect(hmsToSeconds(0, 0, 0)).toBe(0);
    expect(hmsToSeconds(0, 5, 0)).toBe(300); // 5 min
    expect(hmsToSeconds(0, 25, 0)).toBe(1500); // pomodoro
    expect(hmsToSeconds(1, 0, 0)).toBe(3600); // 1h
    expect(hmsToSeconds(2, 0, 0)).toBe(7200); // 2h — o caso do pedido
    expect(hmsToSeconds(2, 5, 30)).toBe(7530); // 2h 05m 30s
    expect(hmsToSeconds(8, 0, 0)).toBe(28800); // 8h
  });

  it("clampa campos negativos/inválidos pra zero (não vira lixo)", () => {
    expect(hmsToSeconds(-1, 0, 0)).toBe(0);
    expect(hmsToSeconds(1, -30, 0)).toBe(3600);
    expect(hmsToSeconds(NaN, 10, NaN)).toBe(600);
  });

  it("NÃO assume m<60/s<60 — soma direto sem quebrar (blindagem contra overflow)", () => {
    expect(hmsToSeconds(0, 90, 0)).toBe(5400); // 90 min = 1h30
    expect(hmsToSeconds(0, 0, 120)).toBe(120); // 120 s = 2 min
  });
});

describe("presets", () => {
  it("todo preset de minutos converte pra segundos = min*60", () => {
    for (const m of TIMER_PRESETS_MIN) expect(m * 60).toBe(hmsToSeconds(0, m, 0));
  });

  it("todo preset de horas converte pra segundos = h*3600", () => {
    for (const h of TIMER_PRESETS_HOUR) expect(h * 3600).toBe(hmsToSeconds(h, 0, 0));
    // âncora explícita: 2h = 7200s, 8h = 28800s
    expect(2 * 3600).toBe(7200);
    expect(8 * 3600).toBe(28800);
  });
});

describe("secondsToHms", () => {
  it("faz o caminho inverso de hmsToSeconds", () => {
    expect(secondsToHms(7530)).toEqual({ h: 2, m: 5, s: 30 });
    expect(secondsToHms(28800)).toEqual({ h: 8, m: 0, s: 0 });
    expect(secondsToHms(59)).toEqual({ h: 0, m: 0, s: 59 });
  });
});

describe("isValidTimer", () => {
  it("rejeita zero e negativo (não iniciar timer vazio)", () => {
    expect(isValidTimer(0)).toBe(false);
    expect(isValidTimer(-5)).toBe(false);
  });

  it("aceita durações reais, inclusive várias horas", () => {
    expect(isValidTimer(1)).toBe(true);
    expect(isValidTimer(7200)).toBe(true); // 2h
    expect(isValidTimer(MAX_TIMER_SECONDS)).toBe(true); // 99h no teto
  });

  it("rejeita o que passa do teto de sanidade (não estourar)", () => {
    expect(isValidTimer(MAX_TIMER_SECONDS + 1)).toBe(false);
  });
});

describe("fmtTimer", () => {
  it("mostra horas quando há horas (nunca minutos acumulados tipo 125:30)", () => {
    expect(fmtTimer(7530)).toBe("2:05:30"); // 2h 05m 30s
    expect(fmtTimer(3600)).toBe("1:00:00"); // 1h exata
    expect(fmtTimer(28800)).toBe("8:00:00"); // 8h
    expect(fmtTimer(7200)).toBe("2:00:00"); // 2h — o caso do pedido
  });

  it("mostra só mm:ss quando falta menos de 1h", () => {
    expect(fmtTimer(1500)).toBe("25:00"); // 25 min
    expect(fmtTimer(90)).toBe("01:30");
    expect(fmtTimer(0)).toBe("00:00");
  });

  it("prova a contagem longa: um timer de 3h que 'termina' bate a matemática", () => {
    // Simula o modelo do estado: alvo = agora + 3h, e o restante deriva do alvo.
    const inicio = 1_000_000_000_000; // instante-âncora qualquer (ms)
    const total = hmsToSeconds(3, 0, 0); // 10800 s
    const endsAt = inicio + total * 1000;
    // No começo: restam 3h cheias.
    const restanteInicio = Math.round((endsAt - inicio) / 1000);
    expect(restanteInicio).toBe(10800);
    expect(fmtTimer(restanteInicio)).toBe("3:00:00");
    // Passadas 2h59m59s, resta 1s (não "estoura" nem vira negativo).
    const quaseFim = inicio + (total - 1) * 1000;
    const restanteFim = Math.max(0, Math.round((endsAt - quaseFim) / 1000));
    expect(restanteFim).toBe(1);
    // No instante do alvo, o restante é 0 → é aqui que fireTimer() dispara.
    const restanteAlvo = Math.max(0, Math.round((endsAt - endsAt) / 1000));
    expect(restanteAlvo).toBe(0);
  });
});
