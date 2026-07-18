// Matemática e presets do Timer (módulo Relógio), isolados aqui pra serem
// testáveis sem GUI. O PORQUÊ de existir este arquivo: os bugs clássicos de
// timer são "assumir minutos < 60" e "estourar em contagem longa". O modelo
// deste app é SEGUNDOS TOTAIS do começo ao fim — nunca (min, seg) separados —
// e o estado guarda um instante-alvo (timerEndsAt), então várias horas contam
// certo sem drift. Estas funções são a única fonte da conversão e da exibição.

import { pad2 } from "./datetime";

/**
 * Teto de sanidade: 99h. Não é limitação de produto — é pra um custom absurdo
 * (ou um overflow digitado) não virar um alvo lá no futuro que estoura a UI/
 * matemática. 99h cobre qualquer uso real de um PIM com folga.
 */
export const MAX_TIMER_SECONDS = 99 * 3600;

/** Presets em MINUTOS (linha "minutos"). Cobrem o dia a dia curto/pomodoro. */
export const TIMER_PRESETS_MIN: number[] = [1, 5, 10, 15, 25, 30, 45];
/** Presets em HORAS (linha "horas"). O pedido do João: contagens longas. */
export const TIMER_PRESETS_HOUR: number[] = [1, 2, 3, 4, 8];

/**
 * h:m:s → segundos totais. Clampa cada campo pra não-negativo e soma DIRETO
 * (h*3600 + m*60 + s) — de propósito não assume m<60/s<60: se alguém passar
 * m=90 a conta ainda fica certa (5400s), o que blinda contra o bug de overflow.
 */
export function hmsToSeconds(h: number, m: number, s: number): number {
  const clamp = (n: number) => (Number.isFinite(n) && n > 0 ? Math.floor(n) : 0);
  return clamp(h) * 3600 + clamp(m) * 60 + clamp(s);
}

/** Segundos totais → {h,m,s}. Usado pra preencher os campos do custom. */
export function secondsToHms(total: number): { h: number; m: number; s: number } {
  const t = Math.max(0, Math.floor(total));
  return { h: Math.floor(t / 3600), m: Math.floor((t % 3600) / 60), s: t % 60 };
}

/** Um total pode iniciar o timer? Rejeita 0/negativo e o que passa do teto. */
export function isValidTimer(total: number): boolean {
  return Number.isFinite(total) && total > 0 && total <= MAX_TIMER_SECONDS;
}

/**
 * Exibição do relógio regressivo, legível pra horas: "2:05:30" quando há horas,
 * "05:30" quando não — nunca "125:30" (o bug de mostrar minutos acumulados).
 */
export function fmtTimer(total: number): string {
  const t = Math.max(0, Math.floor(total));
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = t % 60;
  return h > 0 ? `${h}:${pad2(m)}:${pad2(s)}` : `${pad2(m)}:${pad2(s)}`;
}
