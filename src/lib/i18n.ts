import { useSyncExternalStore } from "react";

/**
 * i18n leve da UI (mesmo padrão do LocalData/LocalPDF/LocalDraw). `pt` é a fonte
 * da verdade das chaves; `en`/`es` como `Record<MessageKey, string>` fazem o
 * compilador recusar chave faltando ou sobrando. Locale num store externo (não
 * React) pra `t()` rodar fora de componente (toasts do App, lembretes, prompt
 * da IA…). O App remonta na troca (key={locale} no main.tsx).
 *
 * `localeTag()` dá a tag BCP-47 — é o que datetime.ts usa no `Intl.DateTimeFormat`
 * pra nomes de mês/dia e rótulos de data localizados automaticamente.
 *
 * Inclui os prompts da IA (`ai.prompt.*`) — assim a IA responde no idioma da UI.
 * O CONTRATO JSON (chaves do objeto de evento) fica intacto nas 3 línguas; só a
 * prosa e as instruções mudam.
 */

export type Locale = "pt" | "en" | "es";

export const LOCALE_LABELS: Record<Locale, string> = {
  pt: "Português",
  en: "English",
  es: "Español",
};

/** Tag BCP-47 por locale (Intl de datas/horas). */
const LOCALE_TAGS: Record<Locale, string> = {
  pt: "pt-BR",
  en: "en-US",
  es: "es-ES",
};

const LOCALE_KEY = "localagenda.locale";

const pt = {
  // --- comuns ---
  "common.add": "Add",
  "common.save": "Salvar",
  "common.cancel": "Cancelar",
  "common.close": "Fechar",
  "common.delete": "Excluir",
  "common.duplicate": "Duplicar",
  "common.optional": "Opcional",
  "lang.title": "Idioma",

  "event.untitled": "(sem título)",
  "event.allDay": "Dia todo",

  // --- App / carregamento + toasts globais ---
  "app.loading": "Carregando…",
  "app.imported.title": "Importado",
  "app.imported.body": "{n} evento(s) do arquivo .ics",
  "app.timer.title": "⏲️ Timer",
  "app.timer.body": "Tempo esgotado!",

  // --- TopBar ---
  "tb.today": "Hoje",
  "tb.prev": "Anterior",
  "tb.next": "Próximo",
  "tb.search": "Buscar…",
  "tb.view.month": "Mês",
  "tb.view.week": "Semana",
  "tb.view.day": "Dia",
  "tb.view.agenda": "Agenda",
  "tb.clockTitle": "Relógio (alarmes, timer, cronômetro)",
  "tb.aiTitle": "IA",
  "tb.settingsTitle": "Configurações",

  // --- Sidebar ---
  "side.newEvent": "＋ Novo evento",
  "side.calendars": "Calendários",
  "side.manageCalendars": "＋ Gerenciar calendários",

  // --- AgendaView ---
  "agenda.emptyLine1": "Nada nos próximos {n} dias.",
  "agenda.emptyLine2": "Que tal um tempo livre? 🌤️",

  // --- MonthView ---
  "month.more": "+{n} mais",

  // --- WeekView ---
  "week.allDayGutter": "dia todo",

  // --- TasksPanel ---
  "tasks.title": "Tarefas",
  "tasks.newDetailed": "Nova tarefa detalhada",
  "tasks.quickAdd": "Adicionar tarefa…",
  "tasks.empty": "Nenhuma tarefa ainda.",
  "tasks.bucket.overdue": "Atrasadas",
  "tasks.bucket.today": "Hoje",
  "tasks.bucket.soon": "Em breve",
  "tasks.bucket.noDue": "Sem prazo",
  "tasks.bucket.done": "Concluídas",

  // --- prioridades (tarefas) ---
  "prio.none": "Sem prioridade",
  "prio.low": "Baixa",
  "prio.med": "Média",
  "prio.high": "Alta",

  // --- lembretes (opções e rótulos) ---
  "rem.atTime": "No horário",
  "rem.min5": "5 minutos antes",
  "rem.min10": "10 minutos antes",
  "rem.min30": "30 minutos antes",
  "rem.hour1": "1 hora antes",
  "rem.hour2": "2 horas antes",
  "rem.day1": "1 dia antes",
  "rem.fallback": "{n} min antes",

  // --- recorrência (rótulos do <select> de frequência) ---
  "freq.none": "Não repete",
  "freq.daily": "Diariamente",
  "freq.weekly": "Semanalmente",
  "freq.monthly": "Mensalmente",
  "freq.yearly": "Anualmente",
  // frequências no tom "Todo dia" (usado no editor de tarefa)
  "freqEvery.daily": "Todo dia",
  "freqEvery.weekly": "Toda semana",
  "freqEvery.monthly": "Todo mês",
  "freqEvery.yearly": "Todo ano",

  // --- describeRRule (recur.ts) — frases COMPLETAS por idioma ---
  "recur.never": "Não repete",
  "recur.every.daily": "Todo dia",
  "recur.every.weekly": "Toda semana",
  "recur.every.monthly": "Todo mês",
  "recur.every.yearly": "Todo ano",
  "recur.everyN.daily": "A cada {n} dias",
  "recur.everyN.weekly": "A cada {n} semanas",
  "recur.everyN.monthly": "A cada {n} meses",
  "recur.everyN.yearly": "A cada {n} anos",
  "recur.days": " ({days})",
  "recur.count": ", {n}×",
  "recur.until": ", até {date}",

  // --- EventModal ---
  "em.editTitle": "Editar evento",
  "em.newTitle": "Novo evento",
  "em.titlePlaceholder": "Título do evento",
  "em.allDay": "Dia inteiro",
  "em.start": "Início",
  "em.end": "Fim",
  "em.applyTo": "Aplicar alterações a",
  "em.scopeThis": "Somente esta ocorrência",
  "em.scopeSeries": "Toda a série",
  "em.repeat": "Repetição",
  "em.interval": "A cada",
  "em.ends": "Termina",
  "em.endNever": "Nunca",
  "em.endCount": "Após N vezes",
  "em.endUntil": "Em uma data",
  "em.times": "Vezes",
  "em.until": "Até",
  "em.reminders": "Lembretes",
  "em.addReminder": "Adicionar",
  "em.location": "Local",
  "em.description": "Descrição",
  "em.duplicateTitle": "Criar uma cópia",

  // --- TaskModal ---
  "tm.editTitle": "Editar tarefa",
  "tm.newTitle": "Nova tarefa",
  "tm.titlePlaceholder": "O que precisa ser feito?",
  "tm.priority": "Prioridade",
  "tm.hasDue": "Tem prazo",
  "tm.addTime": "＋ horário",
  "tm.removeTime": "Remover horário",
  "tm.repeat": "Repetição",
  "tm.reminders": "Lembretes",
  "tm.addReminder": "Adicionar",
  "tm.notes": "Notas",
  "tm.subtask": "＋ Subtarefa",

  // --- ClockModal ---
  "clock.title": "⏰ Relógio",
  "clock.tab.alarms": "Alarmes",
  "clock.tab.timer": "Timer",
  "clock.tab.stopwatch": "Cronômetro",
  "clock.alarm.labelPlaceholder": "Rótulo (opcional)",
  "clock.alarm.noDaysHint": "Sem dias marcados = todo dia.",
  "clock.alarm.none": "Nenhum alarme.",
  "clock.alarm.everyDay": "Todo dia",
  "clock.alarm.enable": "Ativar",
  "clock.alarm.disable": "Desativar",
  "clock.alarm.delete": "Excluir",
  "clock.timer.unitMin": "min",
  "clock.timer.unitSec": "seg",
  "clock.timer.set": "Definir",
  "clock.timer.pause": "⏸ Pausar",
  "clock.timer.start": "▶ Iniciar",
  "clock.timer.reset": "↺ Zerar",
  "clock.sw.pause": "⏸ Pausar",
  "clock.sw.lap": "🚩 Volta",
  "clock.sw.resume": "▶ Continuar",
  "clock.sw.start": "▶ Iniciar",
  "clock.sw.reset": "↺ Zerar",
  "clock.sw.lapN": "Volta {n}",

  // --- Toasts ---
  "toast.stop": "⏹ Parar",
  "toast.snooze": "Adiar:",
  "toast.snooze5": "5 min",
  "toast.snooze10": "10 min",
  "toast.snooze30": "30 min",
  "toast.snooze60": "1 h",

  // --- SettingsModal ---
  "set.title": "Configurações",
  "set.theme": "Tema",
  "set.theme.system": "Sistema",
  "set.theme.light": "Claro",
  "set.theme.dark": "Escuro",
  "set.firstDay": "Primeiro dia da semana",
  "set.firstDay.sunday": "Domingo",
  "set.firstDay.monday": "Segunda",
  "set.defaultDuration": "Duração padrão do evento",
  "set.dur.30": "30 minutos",
  "set.dur.60": "1 hora",
  "set.dur.90": "1h30",
  "set.dur.120": "2 horas",
  "set.dailySummary": "Resumo do dia por notificação",
  "set.at": "Às",
  "set.sound": "Som nas notificações e alarmes",
  "set.volume": "Volume",
  "set.testSound": "▶ Testar",
  "set.closeToTray": "Fechar minimiza para a bandeja (o app segue disparando lembretes)",
  "set.autostart": "Iniciar junto com o logon",
  "set.autostartHint":
    "Abre em segundo plano (direto na bandeja) ao entrar no Windows, pra os alarmes e lembretes funcionarem sem você precisar abrir o app.",
  "set.calendars": "Calendários",
  "set.newCalendar": "Novo calendário",
  "set.addCalendar": "＋ Adicionar calendário",
  "set.deleteCalendar": "Excluir calendário",
  "set.data": "Dados",
  "set.importIcs": "⬇ Importar .ics",
  "set.exportIcs": "⬆ Exportar .ics",
  "set.backup": "💾 Backup",
  "set.restore": "♻ Restaurar",
  "set.foot": "LocalAgenda · suíte Local/Taylor · 100% offline",
  "set.busy.importing": "Importando…",
  "set.busy.imported": "{n} evento(s) importado(s).",
  "set.busy.importFail": "Falha ao importar: {e}",
  "set.busy.exported": "Exportado.",
  "set.busy.backupSaved": "Backup salvo.",
  "set.busy.restoring": "Restaurando…",
  "set.busy.restored": "Backup restaurado.",

  // --- AiPanel ---
  "ai.title": "✨ Assistente",
  "ai.devOnly": "A IA local só funciona no app instalado.",
  "ai.model": "Modelo GGUF",
  "ai.chooseFolder": "📁 Escolher pasta de modelos",
  "ai.change": "Trocar",
  "ai.noGguf": "Nenhum .gguf nesta pasta.",
  "ai.starting": "Iniciando…",
  "ai.use": "Usar",
  "ai.stop": "Parar",
  "ai.ready": "Modelo pronto (porta {port})",
  "ai.idle": "IA parada",
  "ai.nlLabel": "Criar evento em linguagem natural",
  "ai.nlPlaceholder": "ex.: dentista quinta 15h, lembrar 1h antes",
  "ai.nlRun": "Interpretar e revisar",
  "ai.summaryLabel": "Resumo da semana",
  "ai.summaryRun": "🗓️ Resumir minha semana",
  "ai.working.parse": "Interpretando…",
  "ai.working.summary": "Resumindo…",
  "ai.err.parse": "Não consegui: {e}",
  "ai.err.summary": "Falha: {e}",
  "ai.emptyReply": "(sem resposta)",
  // linhas montadas pra alimentar o resumo da IA
  "ai.line.allDay": "dia todo",
  "ai.line.task": "Tarefa até {date}: {title}",

  // --- ai.ts (prompts + erros) ---
  // Prompt de linguagem natural → evento. As CHAVES do JSON ficam intactas.
  "ai.prompt.parseEvent": [
    "Você converte um pedido em português num evento de agenda.",
    "Agora são {now}, {time} ({nowIso}).",
    "Responda SOMENTE com um objeto JSON, sem texto ao redor, com as chaves:",
    '{"title": string, "start": "YYYY-MM-DDTHH:MM", "end": "YYYY-MM-DDTHH:MM", "allDay": boolean, "location": string, "description": string, "rrule": string, "reminders": number[]}',
    "- Use hora local de parede (sem fuso).",
    "- Se não houver hora, allDay=true e start/end no formato YYYY-MM-DD.",
    "- Se a duração não for dita, o evento dura 1 hora.",
    "- reminders são minutos antes do início (ex.: 60 para 1h antes). [] se nenhum.",
    '- rrule é uma RRULE RFC5545 sem DTSTART (ex.: "FREQ=WEEKLY;BYDAY=TH") ou "" se não repetir.',
    "- Resolva dias da semana e expressões relativas para a próxima data futura.",
  ].join("\n"),
  "ai.prompt.weekSummary":
    "Você é um assistente de agenda. Faça um resumo curto e útil (em português, 3-6 frases) " +
    "da semana do usuário a partir da lista de compromissos e tarefas. Destaque dias cheios, " +
    "conflitos de horário e prazos próximos. Não invente itens que não estão na lista.",
  "ai.summary.emptyWeek": "(semana sem compromissos)",
  "ai.err.status": "IA respondeu {status}",
  "ai.err.noJson": "a IA não devolveu JSON",
  "ai.err.noTitle": "a IA não entendeu o título",
  "ai.err.badStart": "data/hora de início inválida",

  // --- reminders.ts (corpo das notificações) ---
  "notif.offset.now": "agora",
  "notif.offset.days": "{n} dia(s) antes",
  "notif.offset.hours": "{n} h antes",
  "notif.offset.min": "{n} min antes",
  "notif.when.allDay": "hoje (dia inteiro)",
  "notif.when.at": "às {time}",
  "notif.body.starts": "Começa {when}",
  "notif.body.startsRem": "Começa {when} — lembrete {off}",
  "notif.count.events": "{n} evento(s)",
  "notif.count.tasks": "{n} tarefa(s)",
  "notif.summary.both": "{e} e {t} para hoje.",
  "notif.summary.events": "{e} para hoje.",
  "notif.summary.tasks": "{t} para hoje.",
  "notif.event.fallback": "Evento",
  "notif.task.title": "Tarefa: {title}",
  "notif.alarm.labeled": "⏰ {label}",
  "notif.alarm.plain": "⏰ Alarme",
  "notif.alarm.body": "Alarme das {time}",
  "notif.summary.title": "Sua agenda de hoje",
} as const;

export type MessageKey = keyof typeof pt;

const en: Record<MessageKey, string> = {
  "common.add": "Add",
  "common.save": "Save",
  "common.cancel": "Cancel",
  "common.close": "Close",
  "common.delete": "Delete",
  "common.duplicate": "Duplicate",
  "common.optional": "Optional",
  "lang.title": "Language",

  "event.untitled": "(no title)",
  "event.allDay": "All day",

  "app.loading": "Loading…",
  "app.imported.title": "Imported",
  "app.imported.body": "{n} event(s) from the .ics file",
  "app.timer.title": "⏲️ Timer",
  "app.timer.body": "Time's up!",

  "tb.today": "Today",
  "tb.prev": "Previous",
  "tb.next": "Next",
  "tb.search": "Search…",
  "tb.view.month": "Month",
  "tb.view.week": "Week",
  "tb.view.day": "Day",
  "tb.view.agenda": "Agenda",
  "tb.clockTitle": "Clock (alarms, timer, stopwatch)",
  "tb.aiTitle": "AI",
  "tb.settingsTitle": "Settings",

  "side.newEvent": "＋ New event",
  "side.calendars": "Calendars",
  "side.manageCalendars": "＋ Manage calendars",

  "agenda.emptyLine1": "Nothing in the next {n} days.",
  "agenda.emptyLine2": "How about some free time? 🌤️",

  "month.more": "+{n} more",

  "week.allDayGutter": "all day",

  "tasks.title": "Tasks",
  "tasks.newDetailed": "New detailed task",
  "tasks.quickAdd": "Add task…",
  "tasks.empty": "No tasks yet.",
  "tasks.bucket.overdue": "Overdue",
  "tasks.bucket.today": "Today",
  "tasks.bucket.soon": "Soon",
  "tasks.bucket.noDue": "No due date",
  "tasks.bucket.done": "Done",

  "prio.none": "No priority",
  "prio.low": "Low",
  "prio.med": "Medium",
  "prio.high": "High",

  "rem.atTime": "At the time",
  "rem.min5": "5 minutes before",
  "rem.min10": "10 minutes before",
  "rem.min30": "30 minutes before",
  "rem.hour1": "1 hour before",
  "rem.hour2": "2 hours before",
  "rem.day1": "1 day before",
  "rem.fallback": "{n} min before",

  "freq.none": "Doesn't repeat",
  "freq.daily": "Daily",
  "freq.weekly": "Weekly",
  "freq.monthly": "Monthly",
  "freq.yearly": "Yearly",
  "freqEvery.daily": "Every day",
  "freqEvery.weekly": "Every week",
  "freqEvery.monthly": "Every month",
  "freqEvery.yearly": "Every year",

  "recur.never": "Doesn't repeat",
  "recur.every.daily": "Every day",
  "recur.every.weekly": "Every week",
  "recur.every.monthly": "Every month",
  "recur.every.yearly": "Every year",
  "recur.everyN.daily": "Every {n} days",
  "recur.everyN.weekly": "Every {n} weeks",
  "recur.everyN.monthly": "Every {n} months",
  "recur.everyN.yearly": "Every {n} years",
  "recur.days": " ({days})",
  "recur.count": ", {n}×",
  "recur.until": ", until {date}",

  "em.editTitle": "Edit event",
  "em.newTitle": "New event",
  "em.titlePlaceholder": "Event title",
  "em.allDay": "All day",
  "em.start": "Start",
  "em.end": "End",
  "em.applyTo": "Apply changes to",
  "em.scopeThis": "This occurrence only",
  "em.scopeSeries": "The whole series",
  "em.repeat": "Repeat",
  "em.interval": "Every",
  "em.ends": "Ends",
  "em.endNever": "Never",
  "em.endCount": "After N times",
  "em.endUntil": "On a date",
  "em.times": "Times",
  "em.until": "Until",
  "em.reminders": "Reminders",
  "em.addReminder": "Add",
  "em.location": "Location",
  "em.description": "Description",
  "em.duplicateTitle": "Create a copy",

  "tm.editTitle": "Edit task",
  "tm.newTitle": "New task",
  "tm.titlePlaceholder": "What needs to be done?",
  "tm.priority": "Priority",
  "tm.hasDue": "Has a due date",
  "tm.addTime": "＋ time",
  "tm.removeTime": "Remove time",
  "tm.repeat": "Repeat",
  "tm.reminders": "Reminders",
  "tm.addReminder": "Add",
  "tm.notes": "Notes",
  "tm.subtask": "＋ Subtask",

  "clock.title": "⏰ Clock",
  "clock.tab.alarms": "Alarms",
  "clock.tab.timer": "Timer",
  "clock.tab.stopwatch": "Stopwatch",
  "clock.alarm.labelPlaceholder": "Label (optional)",
  "clock.alarm.noDaysHint": "No days selected = every day.",
  "clock.alarm.none": "No alarms.",
  "clock.alarm.everyDay": "Every day",
  "clock.alarm.enable": "Enable",
  "clock.alarm.disable": "Disable",
  "clock.alarm.delete": "Delete",
  "clock.timer.unitMin": "min",
  "clock.timer.unitSec": "sec",
  "clock.timer.set": "Set",
  "clock.timer.pause": "⏸ Pause",
  "clock.timer.start": "▶ Start",
  "clock.timer.reset": "↺ Reset",
  "clock.sw.pause": "⏸ Pause",
  "clock.sw.lap": "🚩 Lap",
  "clock.sw.resume": "▶ Resume",
  "clock.sw.start": "▶ Start",
  "clock.sw.reset": "↺ Reset",
  "clock.sw.lapN": "Lap {n}",

  "toast.stop": "⏹ Stop",
  "toast.snooze": "Snooze:",
  "toast.snooze5": "5 min",
  "toast.snooze10": "10 min",
  "toast.snooze30": "30 min",
  "toast.snooze60": "1 h",

  "set.title": "Settings",
  "set.theme": "Theme",
  "set.theme.system": "System",
  "set.theme.light": "Light",
  "set.theme.dark": "Dark",
  "set.firstDay": "First day of the week",
  "set.firstDay.sunday": "Sunday",
  "set.firstDay.monday": "Monday",
  "set.defaultDuration": "Default event duration",
  "set.dur.30": "30 minutes",
  "set.dur.60": "1 hour",
  "set.dur.90": "1h30",
  "set.dur.120": "2 hours",
  "set.dailySummary": "Daily summary notification",
  "set.at": "At",
  "set.sound": "Sound on notifications and alarms",
  "set.volume": "Volume",
  "set.testSound": "▶ Test",
  "set.closeToTray": "Closing minimizes to the tray (the app keeps firing reminders)",
  "set.autostart": "Start on login",
  "set.autostartHint":
    "Opens in the background (straight to the tray) when you sign in to Windows, so alarms and reminders work without you opening the app.",
  "set.calendars": "Calendars",
  "set.newCalendar": "New calendar",
  "set.addCalendar": "＋ Add calendar",
  "set.deleteCalendar": "Delete calendar",
  "set.data": "Data",
  "set.importIcs": "⬇ Import .ics",
  "set.exportIcs": "⬆ Export .ics",
  "set.backup": "💾 Backup",
  "set.restore": "♻ Restore",
  "set.foot": "LocalAgenda · Local/Taylor suite · 100% offline",
  "set.busy.importing": "Importing…",
  "set.busy.imported": "{n} event(s) imported.",
  "set.busy.importFail": "Import failed: {e}",
  "set.busy.exported": "Exported.",
  "set.busy.backupSaved": "Backup saved.",
  "set.busy.restoring": "Restoring…",
  "set.busy.restored": "Backup restored.",

  "ai.title": "✨ Assistant",
  "ai.devOnly": "Local AI only works in the installed app.",
  "ai.model": "GGUF model",
  "ai.chooseFolder": "📁 Choose models folder",
  "ai.change": "Change",
  "ai.noGguf": "No .gguf in this folder.",
  "ai.starting": "Starting…",
  "ai.use": "Use",
  "ai.stop": "Stop",
  "ai.ready": "Model ready (port {port})",
  "ai.idle": "AI stopped",
  "ai.nlLabel": "Create an event in natural language",
  "ai.nlPlaceholder": "e.g. dentist Thursday 3pm, remind me 1h before",
  "ai.nlRun": "Interpret and review",
  "ai.summaryLabel": "Week summary",
  "ai.summaryRun": "🗓️ Summarize my week",
  "ai.working.parse": "Interpreting…",
  "ai.working.summary": "Summarizing…",
  "ai.err.parse": "Couldn't do it: {e}",
  "ai.err.summary": "Failed: {e}",
  "ai.emptyReply": "(no reply)",
  "ai.line.allDay": "all day",
  "ai.line.task": "Task due {date}: {title}",

  "ai.prompt.parseEvent": [
    "You turn an English request into a calendar event.",
    "It is now {now}, {time} ({nowIso}).",
    "Reply ONLY with a JSON object, no surrounding text, with the keys:",
    '{"title": string, "start": "YYYY-MM-DDTHH:MM", "end": "YYYY-MM-DDTHH:MM", "allDay": boolean, "location": string, "description": string, "rrule": string, "reminders": number[]}',
    "- Use local wall-clock time (no timezone).",
    "- If there is no time, allDay=true and start/end in the format YYYY-MM-DD.",
    "- If the duration isn't stated, the event lasts 1 hour.",
    "- reminders are minutes before the start (e.g. 60 for 1h before). [] if none.",
    '- rrule is an RFC5545 RRULE without DTSTART (e.g. "FREQ=WEEKLY;BYDAY=TH") or "" if it doesn\'t repeat.',
    "- Resolve weekdays and relative expressions to the next future date.",
  ].join("\n"),
  "ai.prompt.weekSummary":
    "You are a calendar assistant. Write a short, useful summary (in English, 3-6 sentences) " +
    "of the user's week from the list of appointments and tasks. Highlight busy days, " +
    "time conflicts and upcoming deadlines. Don't invent items that aren't in the list.",
  "ai.summary.emptyWeek": "(week with no appointments)",
  "ai.err.status": "the AI replied {status}",
  "ai.err.noJson": "the AI didn't return JSON",
  "ai.err.noTitle": "the AI didn't understand the title",
  "ai.err.badStart": "invalid start date/time",

  "notif.offset.now": "now",
  "notif.offset.days": "{n} day(s) before",
  "notif.offset.hours": "{n} h before",
  "notif.offset.min": "{n} min before",
  "notif.when.allDay": "today (all day)",
  "notif.when.at": "at {time}",
  "notif.body.starts": "Starts {when}",
  "notif.body.startsRem": "Starts {when} — reminder {off}",
  "notif.count.events": "{n} event(s)",
  "notif.count.tasks": "{n} task(s)",
  "notif.summary.both": "{e} and {t} today.",
  "notif.summary.events": "{e} today.",
  "notif.summary.tasks": "{t} today.",
  "notif.event.fallback": "Event",
  "notif.task.title": "Task: {title}",
  "notif.alarm.labeled": "⏰ {label}",
  "notif.alarm.plain": "⏰ Alarm",
  "notif.alarm.body": "{time} alarm",
  "notif.summary.title": "Your schedule today",
};

const es: Record<MessageKey, string> = {
  "common.add": "Añadir",
  "common.save": "Guardar",
  "common.cancel": "Cancelar",
  "common.close": "Cerrar",
  "common.delete": "Eliminar",
  "common.duplicate": "Duplicar",
  "common.optional": "Opcional",
  "lang.title": "Idioma",

  "event.untitled": "(sin título)",
  "event.allDay": "Todo el día",

  "app.loading": "Cargando…",
  "app.imported.title": "Importado",
  "app.imported.body": "{n} evento(s) del archivo .ics",
  "app.timer.title": "⏲️ Temporizador",
  "app.timer.body": "¡Se acabó el tiempo!",

  "tb.today": "Hoy",
  "tb.prev": "Anterior",
  "tb.next": "Siguiente",
  "tb.search": "Buscar…",
  "tb.view.month": "Mes",
  "tb.view.week": "Semana",
  "tb.view.day": "Día",
  "tb.view.agenda": "Agenda",
  "tb.clockTitle": "Reloj (alarmas, temporizador, cronómetro)",
  "tb.aiTitle": "IA",
  "tb.settingsTitle": "Configuración",

  "side.newEvent": "＋ Nuevo evento",
  "side.calendars": "Calendarios",
  "side.manageCalendars": "＋ Gestionar calendarios",

  "agenda.emptyLine1": "Nada en los próximos {n} días.",
  "agenda.emptyLine2": "¿Qué tal un tiempo libre? 🌤️",

  "month.more": "+{n} más",

  "week.allDayGutter": "todo el día",

  "tasks.title": "Tareas",
  "tasks.newDetailed": "Nueva tarea detallada",
  "tasks.quickAdd": "Añadir tarea…",
  "tasks.empty": "Aún no hay tareas.",
  "tasks.bucket.overdue": "Atrasadas",
  "tasks.bucket.today": "Hoy",
  "tasks.bucket.soon": "Pronto",
  "tasks.bucket.noDue": "Sin fecha",
  "tasks.bucket.done": "Completadas",

  "prio.none": "Sin prioridad",
  "prio.low": "Baja",
  "prio.med": "Media",
  "prio.high": "Alta",

  "rem.atTime": "A la hora",
  "rem.min5": "5 minutos antes",
  "rem.min10": "10 minutos antes",
  "rem.min30": "30 minutos antes",
  "rem.hour1": "1 hora antes",
  "rem.hour2": "2 horas antes",
  "rem.day1": "1 día antes",
  "rem.fallback": "{n} min antes",

  "freq.none": "No se repite",
  "freq.daily": "Diariamente",
  "freq.weekly": "Semanalmente",
  "freq.monthly": "Mensualmente",
  "freq.yearly": "Anualmente",
  "freqEvery.daily": "Todos los días",
  "freqEvery.weekly": "Todas las semanas",
  "freqEvery.monthly": "Todos los meses",
  "freqEvery.yearly": "Todos los años",

  "recur.never": "No se repite",
  "recur.every.daily": "Todos los días",
  "recur.every.weekly": "Todas las semanas",
  "recur.every.monthly": "Todos los meses",
  "recur.every.yearly": "Todos los años",
  "recur.everyN.daily": "Cada {n} días",
  "recur.everyN.weekly": "Cada {n} semanas",
  "recur.everyN.monthly": "Cada {n} meses",
  "recur.everyN.yearly": "Cada {n} años",
  "recur.days": " ({days})",
  "recur.count": ", {n}×",
  "recur.until": ", hasta {date}",

  "em.editTitle": "Editar evento",
  "em.newTitle": "Nuevo evento",
  "em.titlePlaceholder": "Título del evento",
  "em.allDay": "Todo el día",
  "em.start": "Inicio",
  "em.end": "Fin",
  "em.applyTo": "Aplicar cambios a",
  "em.scopeThis": "Solo esta ocurrencia",
  "em.scopeSeries": "Toda la serie",
  "em.repeat": "Repetición",
  "em.interval": "Cada",
  "em.ends": "Termina",
  "em.endNever": "Nunca",
  "em.endCount": "Tras N veces",
  "em.endUntil": "En una fecha",
  "em.times": "Veces",
  "em.until": "Hasta",
  "em.reminders": "Recordatorios",
  "em.addReminder": "Añadir",
  "em.location": "Lugar",
  "em.description": "Descripción",
  "em.duplicateTitle": "Crear una copia",

  "tm.editTitle": "Editar tarea",
  "tm.newTitle": "Nueva tarea",
  "tm.titlePlaceholder": "¿Qué hay que hacer?",
  "tm.priority": "Prioridad",
  "tm.hasDue": "Tiene fecha límite",
  "tm.addTime": "＋ hora",
  "tm.removeTime": "Quitar hora",
  "tm.repeat": "Repetición",
  "tm.reminders": "Recordatorios",
  "tm.addReminder": "Añadir",
  "tm.notes": "Notas",
  "tm.subtask": "＋ Subtarea",

  "clock.title": "⏰ Reloj",
  "clock.tab.alarms": "Alarmas",
  "clock.tab.timer": "Temporizador",
  "clock.tab.stopwatch": "Cronómetro",
  "clock.alarm.labelPlaceholder": "Etiqueta (opcional)",
  "clock.alarm.noDaysHint": "Sin días marcados = todos los días.",
  "clock.alarm.none": "Ninguna alarma.",
  "clock.alarm.everyDay": "Todos los días",
  "clock.alarm.enable": "Activar",
  "clock.alarm.disable": "Desactivar",
  "clock.alarm.delete": "Eliminar",
  "clock.timer.unitMin": "min",
  "clock.timer.unitSec": "seg",
  "clock.timer.set": "Definir",
  "clock.timer.pause": "⏸ Pausar",
  "clock.timer.start": "▶ Iniciar",
  "clock.timer.reset": "↺ Reiniciar",
  "clock.sw.pause": "⏸ Pausar",
  "clock.sw.lap": "🚩 Vuelta",
  "clock.sw.resume": "▶ Continuar",
  "clock.sw.start": "▶ Iniciar",
  "clock.sw.reset": "↺ Reiniciar",
  "clock.sw.lapN": "Vuelta {n}",

  "toast.stop": "⏹ Parar",
  "toast.snooze": "Posponer:",
  "toast.snooze5": "5 min",
  "toast.snooze10": "10 min",
  "toast.snooze30": "30 min",
  "toast.snooze60": "1 h",

  "set.title": "Configuración",
  "set.theme": "Tema",
  "set.theme.system": "Sistema",
  "set.theme.light": "Claro",
  "set.theme.dark": "Oscuro",
  "set.firstDay": "Primer día de la semana",
  "set.firstDay.sunday": "Domingo",
  "set.firstDay.monday": "Lunes",
  "set.defaultDuration": "Duración predeterminada del evento",
  "set.dur.30": "30 minutos",
  "set.dur.60": "1 hora",
  "set.dur.90": "1h30",
  "set.dur.120": "2 horas",
  "set.dailySummary": "Resumen del día por notificación",
  "set.at": "A las",
  "set.sound": "Sonido en notificaciones y alarmas",
  "set.volume": "Volumen",
  "set.testSound": "▶ Probar",
  "set.closeToTray": "Cerrar minimiza a la bandeja (la app sigue disparando recordatorios)",
  "set.autostart": "Iniciar al iniciar sesión",
  "set.autostartHint":
    "Se abre en segundo plano (directo a la bandeja) al entrar en Windows, para que las alarmas y recordatorios funcionen sin que abras la app.",
  "set.calendars": "Calendarios",
  "set.newCalendar": "Nuevo calendario",
  "set.addCalendar": "＋ Añadir calendario",
  "set.deleteCalendar": "Eliminar calendario",
  "set.data": "Datos",
  "set.importIcs": "⬇ Importar .ics",
  "set.exportIcs": "⬆ Exportar .ics",
  "set.backup": "💾 Copia de seguridad",
  "set.restore": "♻ Restaurar",
  "set.foot": "LocalAgenda · suite Local/Taylor · 100% sin conexión",
  "set.busy.importing": "Importando…",
  "set.busy.imported": "{n} evento(s) importado(s).",
  "set.busy.importFail": "Error al importar: {e}",
  "set.busy.exported": "Exportado.",
  "set.busy.backupSaved": "Copia guardada.",
  "set.busy.restoring": "Restaurando…",
  "set.busy.restored": "Copia restaurada.",

  "ai.title": "✨ Asistente",
  "ai.devOnly": "La IA local solo funciona en la app instalada.",
  "ai.model": "Modelo GGUF",
  "ai.chooseFolder": "📁 Elegir carpeta de modelos",
  "ai.change": "Cambiar",
  "ai.noGguf": "Ningún .gguf en esta carpeta.",
  "ai.starting": "Iniciando…",
  "ai.use": "Usar",
  "ai.stop": "Parar",
  "ai.ready": "Modelo listo (puerto {port})",
  "ai.idle": "IA detenida",
  "ai.nlLabel": "Crear un evento en lenguaje natural",
  "ai.nlPlaceholder": "ej.: dentista jueves 15h, avisar 1h antes",
  "ai.nlRun": "Interpretar y revisar",
  "ai.summaryLabel": "Resumen de la semana",
  "ai.summaryRun": "🗓️ Resumir mi semana",
  "ai.working.parse": "Interpretando…",
  "ai.working.summary": "Resumiendo…",
  "ai.err.parse": "No pude: {e}",
  "ai.err.summary": "Error: {e}",
  "ai.emptyReply": "(sin respuesta)",
  "ai.line.allDay": "todo el día",
  "ai.line.task": "Tarea para {date}: {title}",

  "ai.prompt.parseEvent": [
    "Conviertes una petición en español en un evento de agenda.",
    "Ahora son las {now}, {time} ({nowIso}).",
    "Responde SOLO con un objeto JSON, sin texto alrededor, con las claves:",
    '{"title": string, "start": "YYYY-MM-DDTHH:MM", "end": "YYYY-MM-DDTHH:MM", "allDay": boolean, "location": string, "description": string, "rrule": string, "reminders": number[]}',
    "- Usa hora local de pared (sin zona horaria).",
    "- Si no hay hora, allDay=true y start/end en formato YYYY-MM-DD.",
    "- Si no se indica la duración, el evento dura 1 hora.",
    "- reminders son minutos antes del inicio (ej.: 60 para 1h antes). [] si ninguno.",
    '- rrule es una RRULE RFC5545 sin DTSTART (ej.: "FREQ=WEEKLY;BYDAY=TH") o "" si no se repite.',
    "- Resuelve días de la semana y expresiones relativas a la próxima fecha futura.",
  ].join("\n"),
  "ai.prompt.weekSummary":
    "Eres un asistente de agenda. Haz un resumen corto y útil (en español, 3-6 frases) " +
    "de la semana del usuario a partir de la lista de compromisos y tareas. Destaca días llenos, " +
    "conflictos de horario y plazos próximos. No inventes elementos que no estén en la lista.",
  "ai.summary.emptyWeek": "(semana sin compromisos)",
  "ai.err.status": "la IA respondió {status}",
  "ai.err.noJson": "la IA no devolvió JSON",
  "ai.err.noTitle": "la IA no entendió el título",
  "ai.err.badStart": "fecha/hora de inicio inválida",

  "notif.offset.now": "ahora",
  "notif.offset.days": "{n} día(s) antes",
  "notif.offset.hours": "{n} h antes",
  "notif.offset.min": "{n} min antes",
  "notif.when.allDay": "hoy (todo el día)",
  "notif.when.at": "a las {time}",
  "notif.body.starts": "Empieza {when}",
  "notif.body.startsRem": "Empieza {when} — recordatorio {off}",
  "notif.count.events": "{n} evento(s)",
  "notif.count.tasks": "{n} tarea(s)",
  "notif.summary.both": "{e} y {t} para hoy.",
  "notif.summary.events": "{e} para hoy.",
  "notif.summary.tasks": "{t} para hoy.",
  "notif.event.fallback": "Evento",
  "notif.task.title": "Tarea: {title}",
  "notif.alarm.labeled": "⏰ {label}",
  "notif.alarm.plain": "⏰ Alarma",
  "notif.alarm.body": "Alarma de las {time}",
  "notif.summary.title": "Tu agenda de hoy",
};

const DICTS: Record<Locale, Record<MessageKey, string>> = { pt, en, es };

/** Palpite de locale pelo idioma do sistema (só no 1º uso). */
export function detectLocale(): Locale {
  const l = (typeof navigator !== "undefined" ? navigator.language : "pt").toLowerCase();
  if (l.startsWith("en")) return "en";
  if (l.startsWith("es")) return "es";
  return "pt";
}

function loadLocale(): Locale {
  const v = typeof localStorage !== "undefined" ? localStorage.getItem(LOCALE_KEY) : null;
  return v === "pt" || v === "en" || v === "es" ? v : detectLocale();
}

let current: Locale = loadLocale();
const listeners = new Set<() => void>();

export function getLocale(): Locale {
  return current;
}

export function setLocale(locale: Locale) {
  if (locale === current) return;
  current = locale;
  try {
    localStorage.setItem(LOCALE_KEY, locale);
  } catch {
    /* localStorage indisponível */
  }
  for (const l of listeners) l();
}

/** Tag BCP-47 do locale atual — usada pelo Intl em datetime.ts. */
export function localeTag(): string {
  return LOCALE_TAGS[current];
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

/** Inscreve o componente nas trocas de locale. */
export function useLocale(): Locale {
  return useSyncExternalStore(subscribe, getLocale);
}

/** Traduz uma chave, interpolando placeholders `{param}`. */
export function t(key: MessageKey, params?: Record<string, string | number>): string {
  let msg: string = DICTS[current][key] ?? pt[key] ?? key;
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      msg = msg.split(`{${k}}`).join(String(v));
    }
  }
  return msg;
}
