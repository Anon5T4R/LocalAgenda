// IA local: conversa com o llama-server (OpenAI-compat em 127.0.0.1).
// Contrato da suíte: **a IA propõe, o código valida e aplica**. Aqui ela só
// devolve JSON/texto; quem cria o evento é o store, com validação em TS.

import { fmtDayLong, fmtTime, parseLocal, toIso } from "./datetime";
import type { AgendaEvent } from "./types";

interface ChatMsg {
  role: "system" | "user" | "assistant";
  content: string;
}

async function chat(port: number, messages: ChatMsg[], maxTokens = 512): Promise<string> {
  const res = await fetch(`http://127.0.0.1:${port}/v1/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      messages,
      temperature: 0.2,
      max_tokens: maxTokens,
      stream: false,
      // Desliga o "pensar" dos modelos que suportam (resposta direta).
      chat_template_kwargs: { enable_thinking: false },
    }),
  });
  if (!res.ok) throw new Error(`IA respondeu ${res.status}`);
  const data = await res.json();
  return data?.choices?.[0]?.message?.content ?? "";
}

/** Extrai o 1º bloco JSON de uma resposta (tolerante a ```json e texto solto). */
function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const raw = fenced ? fenced[1] : text;
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end < 0) throw new Error("a IA não devolveu JSON");
  return JSON.parse(raw.slice(start, end + 1));
}

export interface ParsedEvent {
  title: string;
  start: string;
  end: string;
  allDay: boolean;
  location: string;
  description: string;
  rrule: string;
  reminders: number[];
}

/**
 * Linguagem natural → evento validado. Ex.: "dentista quinta 15h, lembrar 1h antes".
 * O `now` ancora expressões relativas ("quinta", "amanhã").
 */
export async function parseEventNL(port: number, input: string): Promise<ParsedEvent> {
  const now = new Date();
  const nowIso = toIso(now, false);
  const system = [
    "Você converte um pedido em português num evento de agenda.",
    `Agora são ${fmtDayLong(now)}, ${fmtTime(now)} (${nowIso}).`,
    "Responda SOMENTE com um objeto JSON, sem texto ao redor, com as chaves:",
    '{"title": string, "start": "YYYY-MM-DDTHH:MM", "end": "YYYY-MM-DDTHH:MM", "allDay": boolean, "location": string, "description": string, "rrule": string, "reminders": number[]}',
    "- Use hora local de parede (sem fuso).",
    "- Se não houver hora, allDay=true e start/end no formato YYYY-MM-DD.",
    "- Se a duração não for dita, o evento dura 1 hora.",
    "- reminders são minutos antes do início (ex.: 60 para 1h antes). [] se nenhum.",
    '- rrule é uma RRULE RFC5545 sem DTSTART (ex.: "FREQ=WEEKLY;BYDAY=TH") ou "" se não repetir.',
    "- Resolva dias da semana e expressões relativas para a próxima data futura.",
  ].join("\n");

  const out = await chat(port, [
    { role: "system", content: system },
    { role: "user", content: input },
  ]);
  const obj = extractJson(out) as Record<string, unknown>;

  const title = String(obj.title ?? "").trim();
  if (!title) throw new Error("a IA não entendeu o título");
  const allDay = obj.allDay === true;
  let start = String(obj.start ?? "").trim();
  let end = String(obj.end ?? "").trim();
  if (isNaN(parseLocal(start).getTime())) throw new Error("data/hora de início inválida");
  if (!end || isNaN(parseLocal(end).getTime())) {
    // Sem fim válido: 1h depois (ou o mesmo dia, se allDay).
    const s = parseLocal(start);
    end = allDay ? start : toIso(new Date(s.getTime() + 60 * 60_000), false);
  }
  if (allDay) {
    start = start.split("T")[0];
    end = end.split("T")[0];
  }
  const reminders = Array.isArray(obj.reminders)
    ? obj.reminders.map((n) => Number(n)).filter((n) => Number.isFinite(n) && n >= 0)
    : [];

  return {
    title,
    start,
    end,
    allDay,
    location: String(obj.location ?? ""),
    description: String(obj.description ?? ""),
    rrule: String(obj.rrule ?? ""),
    reminders,
  };
}

/** Resumo em texto da agenda da semana a partir de uma lista já montada. */
export async function weekSummary(port: number, agendaText: string): Promise<string> {
  const system =
    "Você é um assistente de agenda. Faça um resumo curto e útil (em português, 3-6 frases) " +
    "da semana do usuário a partir da lista de compromissos e tarefas. Destaque dias cheios, " +
    "conflitos de horário e prazos próximos. Não invente itens que não estão na lista.";
  return chat(
    port,
    [
      { role: "system", content: system },
      { role: "user", content: agendaText || "(semana sem compromissos)" },
    ],
    600,
  );
}

/** Converte um ParsedEvent num evento pronto pra salvar (sem id — o store gera). */
export function parsedToEvent(p: ParsedEvent, calendarId: string): Partial<AgendaEvent> {
  return {
    calendarId,
    title: p.title,
    description: p.description,
    location: p.location,
    start: p.start,
    end: p.end,
    allDay: p.allDay,
    rrule: p.rrule,
    exdates: [],
    reminders: p.reminders,
  };
}
