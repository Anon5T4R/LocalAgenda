import { open, save } from "@tauri-apps/plugin-dialog";
import { useEffect, useState } from "react";
import { autostartGet, autostartSet, dbExport, dbImport, inTauri, readFileBase64, writeTextFile } from "../lib/backend";
import { exportIcs, parseIcs } from "../lib/ics";
import { playChime } from "../lib/sound";
import { CALENDAR_COLORS, type Calendar } from "../lib/types";
import { useStore } from "../state/store";
import { useUi } from "../state/ui";

function b64ToText(b64: string): string {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder("utf-8").decode(bytes);
}

export function SettingsModal() {
  const close = () => useUi.getState().setSettings(false);
  const { settings, updateSettings, calendars, events, saveCalendar, removeCalendar, load } = useStore();
  const [autostart, setAutostart] = useState(false);
  const [busy, setBusy] = useState("");

  useEffect(() => {
    if (inTauri()) autostartGet().then(setAutostart).catch(() => {});
  }, []);

  const toggleAutostart = async (v: boolean) => {
    setAutostart(v);
    try {
      await autostartSet(v);
    } catch {
      setAutostart(!v);
    }
  };

  const importIcs = async () => {
    const path = await open({ filters: [{ name: "iCalendar", extensions: ["ics"] }] });
    if (typeof path !== "string") return;
    setBusy("Importando…");
    try {
      const text = b64ToText(await readFileBase64(path));
      const parsed = parseIcs(text);
      const calId = calendars[0]?.id ?? "";
      for (const p of parsed) await useStore.getState().saveEvent({ ...p, calendarId: calId });
      setBusy(`${parsed.length} evento(s) importado(s).`);
    } catch (e) {
      setBusy("Falha ao importar: " + (e as Error).message);
    }
  };

  const exportIcsFile = async () => {
    const path = await save({ defaultPath: "agenda.ics", filters: [{ name: "iCalendar", extensions: ["ics"] }] });
    if (typeof path !== "string") return;
    await writeTextFile(path, exportIcs(events));
    setBusy("Exportado.");
  };

  const backupExport = async () => {
    const path = await save({ defaultPath: "localagenda-backup.db", filters: [{ name: "Backup", extensions: ["db"] }] });
    if (typeof path !== "string") return;
    await dbExport(path);
    setBusy("Backup salvo.");
  };

  const backupImport = async () => {
    const path = await open({ filters: [{ name: "Backup", extensions: ["db"] }] });
    if (typeof path !== "string") return;
    setBusy("Restaurando…");
    await dbImport(path);
    await load();
    setBusy("Backup restaurado.");
  };

  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="modal wide">
        <div className="modal-head">
          <h3>Configurações</h3>
          <button className="icon-btn" onClick={close}>
            ✕
          </button>
        </div>
        <div className="modal-body">
          {/* Geral */}
          <div className="field">
            <label>Tema</label>
            <select value={settings.theme} onChange={(e) => updateSettings({ theme: e.target.value as any })}>
              <option value="system">Sistema</option>
              <option value="light">Claro</option>
              <option value="dark">Escuro</option>
            </select>
          </div>
          <div className="row">
            <div className="field">
              <label>Primeiro dia da semana</label>
              <select value={settings.firstDayOfWeek} onChange={(e) => updateSettings({ firstDayOfWeek: +e.target.value })}>
                <option value={0}>Domingo</option>
                <option value={1}>Segunda</option>
              </select>
            </div>
            <div className="field">
              <label>Duração padrão do evento</label>
              <select value={settings.defaultDurationMin} onChange={(e) => updateSettings({ defaultDurationMin: +e.target.value })}>
                <option value={30}>30 minutos</option>
                <option value={60}>1 hora</option>
                <option value={90}>1h30</option>
                <option value={120}>2 horas</option>
              </select>
            </div>
          </div>

          {/* Notificações */}
          <div className="field">
            <label className="inline" style={{ cursor: "pointer" }}>
              <input
                type="checkbox"
                checked={settings.dailySummary}
                onChange={(e) => updateSettings({ dailySummary: e.target.checked })}
                style={{ width: "auto" }}
              />
              Resumo do dia por notificação
            </label>
            {settings.dailySummary && (
              <div className="inline" style={{ marginTop: 6 }}>
                <span className="hint">Às</span>
                <input
                  type="time"
                  value={settings.dailySummaryTime}
                  onChange={(e) => updateSettings({ dailySummaryTime: e.target.value })}
                  style={{ width: 120 }}
                />
              </div>
            )}
          </div>

          <div className="field">
            <label className="inline" style={{ cursor: "pointer" }}>
              <input
                type="checkbox"
                checked={settings.soundEnabled}
                onChange={(e) => updateSettings({ soundEnabled: e.target.checked })}
                style={{ width: "auto" }}
              />
              Som nas notificações e alarmes
            </label>
            {settings.soundEnabled && (
              <div className="inline" style={{ marginTop: 6, gap: 10 }}>
                <span className="hint">Volume</span>
                <input
                  type="range"
                  min={0}
                  max={100}
                  value={Math.round(settings.soundVolume * 100)}
                  onChange={(e) => updateSettings({ soundVolume: +e.target.value / 100 })}
                  style={{ flex: 1 }}
                />
                <button className="btn ghost" onClick={() => playChime(settings.soundVolume)}>
                  ▶ Testar
                </button>
              </div>
            )}
          </div>

          {/* Sistema */}
          <div className="field">
            <label className="inline" style={{ cursor: "pointer" }}>
              <input
                type="checkbox"
                checked={settings.closeToTray}
                onChange={(e) => updateSettings({ closeToTray: e.target.checked })}
                style={{ width: "auto" }}
              />
              Fechar minimiza para a bandeja (o app segue disparando lembretes)
            </label>
          </div>
          {inTauri() && (
            <div className="field">
              <label className="inline" style={{ cursor: "pointer" }}>
                <input type="checkbox" checked={autostart} onChange={(e) => toggleAutostart(e.target.checked)} style={{ width: "auto" }} />
                Iniciar junto com o logon
              </label>
              <div className="hint">
                Abre em segundo plano (direto na bandeja) ao entrar no Windows, pra os alarmes e
                lembretes funcionarem sem você precisar abrir o app.
              </div>
            </div>
          )}

          {/* Calendários */}
          <div className="field">
            <label>Calendários</label>
            <div className="cal-list">
              {calendars.map((c) => (
                <CalEditRow key={c.id} cal={c} onSave={saveCalendar} onDelete={removeCalendar} canDelete={calendars.length > 1} />
              ))}
            </div>
            <button
              className="btn ghost"
              style={{ marginTop: 6, justifyContent: "flex-start" }}
              onClick={() => saveCalendar({ name: "Novo calendário", color: CALENDAR_COLORS[calendars.length % CALENDAR_COLORS.length] })}
            >
              ＋ Adicionar calendário
            </button>
          </div>

          {/* Dados */}
          {inTauri() && (
            <div className="field">
              <label>Dados</label>
              <div className="inline" style={{ flexWrap: "wrap", gap: 8 }}>
                <button className="btn" onClick={importIcs}>
                  ⬇ Importar .ics
                </button>
                <button className="btn" onClick={exportIcsFile}>
                  ⬆ Exportar .ics
                </button>
                <button className="btn" onClick={backupExport}>
                  💾 Backup
                </button>
                <button className="btn" onClick={backupImport}>
                  ♻ Restaurar
                </button>
              </div>
              {busy && <div className="hint" style={{ marginTop: 6 }}>{busy}</div>}
            </div>
          )}
        </div>
        <div className="modal-foot">
          <div className="hint" style={{ flex: 1 }}>LocalAgenda · suíte Local/Taylor · 100% offline</div>
          <button className="btn primary" onClick={close}>
            Fechar
          </button>
        </div>
      </div>
    </div>
  );
}

function CalEditRow({
  cal,
  onSave,
  onDelete,
  canDelete,
}: {
  cal: Calendar;
  onSave(c: Partial<Calendar>): void;
  onDelete(id: string): void;
  canDelete: boolean;
}) {
  const [name, setName] = useState(cal.name);
  const [open, setOpen] = useState(false);
  return (
    <div className="inline" style={{ gap: 8, padding: "3px 0" }}>
      <span className="dot" style={{ background: cal.color, position: "relative", cursor: "pointer" }} onClick={() => setOpen((o) => !o)} />
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        onBlur={() => name !== cal.name && onSave({ ...cal, name })}
        style={{ flex: 1 }}
      />
      {canDelete && (
        <button className="icon-btn" title="Excluir calendário" onClick={() => onDelete(cal.id)}>
          🗑
        </button>
      )}
      {open && (
        <div className="color-swatches" style={{ position: "absolute", marginTop: 40, background: "var(--surface)", padding: 8, borderRadius: 10, boxShadow: "var(--shadow)", zIndex: 10 }}>
          {CALENDAR_COLORS.map((col) => (
            <span
              key={col}
              className={"sw" + (col === cal.color ? " sel" : "")}
              style={{ background: col }}
              onClick={() => {
                onSave({ ...cal, color: col });
                setOpen(false);
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}
