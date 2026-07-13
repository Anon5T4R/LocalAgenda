// Hora de parede LOCAL, sem fuso (decisão do plano). Nunca use `new Date(iso)`
// direto num "YYYY-MM-DD" (o JS interpreta como UTC e escorrega um dia); use
// sempre `parseLocal`.

const MONTHS = [
  "janeiro", "fevereiro", "março", "abril", "maio", "junho",
  "julho", "agosto", "setembro", "outubro", "novembro", "dezembro",
];
const MONTHS_SHORT = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
const WEEKDAYS = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"];
const WEEKDAYS_SHORT = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

export const monthName = (m: number) => MONTHS[m];
export const monthShort = (m: number) => MONTHS_SHORT[m];
export const weekdayName = (d: number) => WEEKDAYS[d];
export const weekdayShort = (d: number) => WEEKDAYS_SHORT[d];

export const pad2 = (n: number) => String(n).padStart(2, "0");

/** "YYYY-MM-DDTHH:MM" ou "YYYY-MM-DD" → Date local. */
export function parseLocal(iso: string): Date {
  if (!iso) return new Date(NaN);
  const [d, t] = iso.split("T");
  const [y, mo, da] = d.split("-").map(Number);
  if (t) {
    const [h, mi] = t.split(":").map(Number);
    return new Date(y, (mo || 1) - 1, da || 1, h || 0, mi || 0, 0, 0);
  }
  return new Date(y, (mo || 1) - 1, da || 1, 0, 0, 0, 0);
}

/** Date → string de parede. `allDay` guarda só a data (sem hora). */
export function toIso(date: Date, allDay = false): string {
  const base = `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
  return allDay ? base : `${base}T${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}

export const dateKey = (date: Date) =>
  `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;

export function startOfDay(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

export function addDays(date: Date, n: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + n);
  return d;
}

export function addMinutes(date: Date, n: number): Date {
  return new Date(date.getTime() + n * 60_000);
}

export function startOfWeek(date: Date, firstDay = 0): Date {
  const d = startOfDay(date);
  const diff = (d.getDay() - firstDay + 7) % 7;
  return addDays(d, -diff);
}

export function startOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

export function endOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0);
}

export const sameDay = (a: Date, b: Date) =>
  a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

export const isToday = (d: Date) => sameDay(d, new Date());

export const fmtTime = (date: Date) => `${pad2(date.getHours())}:${pad2(date.getMinutes())}`;

/** "15:00" só se houver minutos; senão "15h". */
export function fmtTimeCompact(date: Date): string {
  return date.getMinutes() === 0 ? `${date.getHours()}h` : fmtTime(date);
}

export const minutesBetween = (a: Date, b: Date) => Math.round((b.getTime() - a.getTime()) / 60_000);

/** Rótulo do dia: "Ter, 15 jul". */
export function fmtDayLabel(date: Date): string {
  return `${weekdayShort(date.getDay())}, ${date.getDate()} ${monthShort(date.getMonth())}`;
}

/** Rótulo longo: "Terça, 15 de julho de 2026". */
export function fmtDayLong(date: Date): string {
  return `${weekdayName(date.getDay())}, ${date.getDate()} de ${monthName(date.getMonth())} de ${date.getFullYear()}`;
}

/** Agora, arredondado pra cima no próximo múltiplo de 30 min. */
export function nextSlot(): Date {
  const d = new Date();
  d.setSeconds(0, 0);
  const m = d.getMinutes();
  d.setMinutes(m < 30 ? 30 : 60);
  return d;
}

/** Grade de 6 semanas (42 dias) que cobre o mês de `date`. */
export function monthGrid(date: Date, firstDay = 0): Date[] {
  const first = startOfWeek(startOfMonth(date), firstDay);
  return Array.from({ length: 42 }, (_, i) => addDays(first, i));
}

/** "HH:MM" de hoje → Date de hoje nesse horário. */
export function todayAt(hhmm: string): Date {
  const [h, m] = hhmm.split(":").map(Number);
  const d = new Date();
  d.setHours(h || 0, m || 0, 0, 0);
  return d;
}
