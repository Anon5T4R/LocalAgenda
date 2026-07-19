import { open } from "@tauri-apps/plugin-dialog";
import { useEffect, useState } from "react";
import { parseEventNL, parsedToEvent, weekSummary } from "../lib/ai";
import { inTauri } from "../lib/backend";
import { addDays, fmtDayLabel, fmtTime, parseLocal, startOfWeek } from "../lib/datetime";
import { t } from "../lib/i18n";
import { expandAll } from "../lib/recur";
import { useAi } from "../state/airuntime";
import { useStore, visibleEvents } from "../state/store";
import { useUi } from "../state/ui";

export function AiPanel() {
  const close = () => useUi.getState().setAi(false);
  const openEvent = useUi((s) => s.openEvent);
  const { settings, updateSettings, calendars, events, tasks, cursor } = useStore();
  const ai = useAi();
  const [nl, setNl] = useState("");
  const [out, setOut] = useState("");
  const [working, setWorking] = useState("");

  useEffect(() => {
    void ai.refresh();
    if (settings.modelDir) void ai.loadModels(settings.modelDir);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const chooseDir = async () => {
    const dir = await open({ directory: true });
    if (typeof dir !== "string") return;
    await updateSettings({ modelDir: dir });
    await ai.loadModels(dir);
  };

  const createFromNL = async () => {
    if (!nl.trim() || !ai.port) return;
    setWorking(t("ai.working.parse"));
    setOut("");
    try {
      const parsed = await parseEventNL(ai.port, nl);
      setWorking("");
      // A IA propõe; o usuário revisa e salva no editor.
      openEvent(parsedToEvent(parsed, calendars[0]?.id ?? ""));
      close();
    } catch (e) {
      setWorking("");
      setOut(t("ai.err.parse", { e: (e as Error).message }));
    }
  };

  const summarize = async () => {
    if (!ai.port) return;
    setWorking(t("ai.working.summary"));
    setOut("");
    try {
      const from = startOfWeek(cursor, settings.firstDayOfWeek);
      const to = addDays(from, 7);
      const occ = expandAll(visibleEvents({ events, calendars, search: "" }), from, to, events);
      const lines: string[] = [];
      for (const o of occ) {
        const when = o.event.allDay ? t("ai.line.allDay") : `${fmtTime(o.start)}-${fmtTime(o.end)}`;
        lines.push(`- ${fmtDayLabel(o.start)} ${when}: ${o.event.title}`);
      }
      for (const task of tasks) {
        if (task.doneAt || !task.due) continue;
        const d = parseLocal(task.due);
        if (d >= from && d < to) lines.push("- " + t("ai.line.task", { date: fmtDayLabel(d), title: task.title }));
      }
      const text = await weekSummary(ai.port, lines.join("\n"));
      setWorking("");
      setOut(text.trim() || t("ai.emptyReply"));
    } catch (e) {
      setWorking("");
      setOut(t("ai.err.summary", { e: (e as Error).message }));
    }
  };

  const running = ai.port > 0;

  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="modal">
        <div className="modal-head">
          <h3>{t("ai.title")}</h3>
          <button className="icon-btn" onClick={close}>
            ✕
          </button>
        </div>
        <div className="modal-body">
          {!inTauri() ? (
            <div className="hint">{t("ai.devOnly")}</div>
          ) : (
            <>
              <div className="ai-status">
                <span className={"dotpulse" + (running ? "" : " off")} />
                {running ? t("ai.ready", { port: ai.port }) : t("ai.idle")}
                {running && (
                  <button className="btn ghost" style={{ marginLeft: "auto" }} onClick={() => ai.stop()}>
                    {t("ai.stop")}
                  </button>
                )}
              </div>

              {!running && (
                <div className="field">
                  <label>{t("ai.model")}</label>
                  {!settings.modelDir ? (
                    <button className="btn" onClick={chooseDir}>
                      {t("ai.chooseFolder")}
                    </button>
                  ) : (
                    <>
                      <div className="inline">
                        <span className="hint" style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {settings.modelDir}
                        </span>
                        <button className="btn ghost" onClick={chooseDir}>
                          {t("ai.change")}
                        </button>
                      </div>
                      {ai.error && <div className="hint" style={{ color: "var(--danger)" }}>{ai.error}</div>}
                      {ai.models.length === 0 && <div className="hint">{t("ai.noGguf")}</div>}
                      <div className="chips-in" style={{ flexDirection: "column", alignItems: "stretch" }}>
                        {ai.models.map((m) => (
                          <div key={m.path} className="inline" style={{ justifyContent: "space-between", padding: "4px 0" }}>
                            <span className="hint">
                              {m.name} · {m.sizeGb.toFixed(1)} GB
                            </span>
                            <button className="btn" disabled={ai.starting} onClick={() => ai.start(m.path, settings.nGpuLayers)}>
                              {ai.starting ? t("ai.starting") : t("ai.use")}
                            </button>
                          </div>
                        ))}
                      </div>
                    </>
                  )}
                </div>
              )}

              {running && (
                <>
                  <div className="field">
                    <label>{t("ai.nlLabel")}</label>
                    <textarea
                      rows={2}
                      placeholder={t("ai.nlPlaceholder")}
                      value={nl}
                      onChange={(e) => setNl(e.target.value)}
                    />
                    <button className="btn primary" style={{ marginTop: 6 }} onClick={createFromNL} disabled={!!working}>
                      {t("ai.nlRun")}
                    </button>
                  </div>

                  <div className="field">
                    <label>{t("ai.summaryLabel")}</label>
                    <button className="btn" onClick={summarize} disabled={!!working}>
                      {t("ai.summaryRun")}
                    </button>
                  </div>
                </>
              )}

              {working && <div className="hint">{working}</div>}
              {out && <div className="ai-out">{out}</div>}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
