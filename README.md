# LocalAgenda

Calendário, tarefas e lembretes **100% offline** — o "Outlook sem e-mail" da suíte **Local/Taylor**. Sem conta, sem nuvem, sem telemetria: seus dados ficam num único banco SQLite na sua máquina.

## Recursos

- **Visões:** mês, semana (grade horária), dia e agenda (lista). Arrastar pra criar/mover/redimensionar evento.
- **Tarefas:** painel lateral com prazo, prioridade, subtarefas e recorrência simples; concluir com um clique.
- **Recorrência completa (RFC 5545):** diária/semanal/mensal/anual, intervalo, dias da semana, término por data ou contagem, e exceção "só esta ocorrência" — a mesma semântica do Google Calendar/Outlook (via [rrule.js](https://github.com/jkbrzt/rrule)).
- **Lembretes com notificação de desktop:** N minutos antes; a app minimiza pra bandeja e continua disparando os lembretes mesmo "fechada". **Adiar (snooze)** direto na notificação.
- **Notificações inteligentes:** resumo da agenda do dia (opcional, no horário que você escolher) e lembrete só uma vez por ocorrência (nada de spam).
- **Múltiplos calendários** com cores e alternância de visibilidade.
- **Import/export `.ics`** (iCalendar) — troca com qualquer outro app de calendário.
- **IA local (opcional):** escreva *"dentista quinta 15h, lembrar 1h antes"* e a app cria o evento; resumo da semana em texto. Roda com llama.cpp / modelos GGUF, tudo em `127.0.0.1` — **a IA propõe, o código valida e aplica**.
- **Bandeja + autostart opcional**, tema claro/escuro, atalhos de teclado.

## IA (opcional)

Aponte para uma pasta com modelos `.gguf` no painel de IA. Nada de modelo vai no instalador; nada sai da máquina. O `llama-server` sobe só em `127.0.0.1` (porta 8104+).

## Desenvolvimento

```bash
npm install
npm run tauri dev
```

Porta de dev do Vite: **1442** (HMR 1443). Antes de buildar, os binários do llama.cpp são baixados por `scripts/fetch-llama.{ps1,sh}` (não versionados).

Release = bump de versão nos 3 arquivos (`package.json`, `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml`) + tag `vX.Y.Z` + push. O GitHub Actions builda Windows (NSIS) + Linux (AppImage) e publica sozinho.

## Licença

MIT — parte da suíte **Local/Taylor** (conta [Anon5T4R](https://github.com/Anon5T4R)).
