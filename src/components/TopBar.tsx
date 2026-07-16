import { addDays, fmtDateLong, fmtMonthYear, monthShort, startOfWeek } from "../lib/datetime";
import { t } from "../lib/i18n";
import { useStore, type ViewKind } from "../state/store";
import { useUi } from "../state/ui";

const VIEWS: { key: ViewKind; labelKey: "tb.view.month" | "tb.view.week" | "tb.view.day" | "tb.view.agenda" }[] = [
  { key: "month", labelKey: "tb.view.month" },
  { key: "week", labelKey: "tb.view.week" },
  { key: "day", labelKey: "tb.view.day" },
  { key: "agenda", labelKey: "tb.view.agenda" },
];

export function TopBar() {
  const { view, cursor, setView, go, goToday, search, setSearch, settings } = useStore();
  const setAi = useUi((s) => s.setAi);
  const setSettingsOpen = useUi((s) => s.setSettings);

  return (
    <header className="topbar">
      <div className="brand">
        <span className="logo">📅</span>
        LocalAgenda
      </div>

      <div className="nav-group" style={{ marginLeft: 8 }}>
        <button className="btn" onClick={goToday}>
          {t("tb.today")}
        </button>
        <button className="icon-btn" onClick={() => go(-1)} title={t("tb.prev")}>
          ‹
        </button>
        <button className="icon-btn" onClick={() => go(1)} title={t("tb.next")}>
          ›
        </button>
      </div>

      <div className="title">{titleFor(view, cursor, settings.firstDayOfWeek)}</div>

      <div className="spacer" />

      <div className="search">
        <span className="mag">⌕</span>
        <input
          placeholder={t("tb.search")}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      <div className="seg">
        {VIEWS.map((v) => (
          <button key={v.key} className={view === v.key ? "active" : ""} onClick={() => setView(v.key)}>
            {t(v.labelKey)}
          </button>
        ))}
      </div>

      <button className="icon-btn" title={t("tb.clockTitle")} onClick={() => useUi.getState().setClock(true)}>
        ⏰
      </button>
      <button className="icon-btn" title={t("tb.aiTitle")} onClick={() => setAi(true)}>
        ✨
      </button>
      <button className="icon-btn" title={t("tb.settingsTitle")} onClick={() => setSettingsOpen(true)}>
        ⚙
      </button>
    </header>
  );
}

function titleFor(view: ViewKind, cursor: Date, firstDay: number): string {
  if (view === "month") return fmtMonthYear(cursor);
  if (view === "day") return fmtDateLong(cursor);
  if (view === "week" || view === "agenda") {
    const s = startOfWeek(cursor, firstDay);
    const e = addDays(s, 6);
    if (s.getMonth() === e.getMonth())
      return `${s.getDate()}–${e.getDate()} ${monthShort(s.getMonth())} ${s.getFullYear()}`;
    return `${s.getDate()} ${monthShort(s.getMonth())} – ${e.getDate()} ${monthShort(e.getMonth())} ${e.getFullYear()}`;
  }
  return "";
}
