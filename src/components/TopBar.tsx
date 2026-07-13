import { addDays, monthName, monthShort, startOfWeek } from "../lib/datetime";
import { useStore, type ViewKind } from "../state/store";
import { useUi } from "../state/ui";

const VIEWS: { key: ViewKind; label: string }[] = [
  { key: "month", label: "Mês" },
  { key: "week", label: "Semana" },
  { key: "day", label: "Dia" },
  { key: "agenda", label: "Agenda" },
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
          Hoje
        </button>
        <button className="icon-btn" onClick={() => go(-1)} title="Anterior">
          ‹
        </button>
        <button className="icon-btn" onClick={() => go(1)} title="Próximo">
          ›
        </button>
      </div>

      <div className="title">{titleFor(view, cursor, settings.firstDayOfWeek)}</div>

      <div className="spacer" />

      <div className="search">
        <span className="mag">⌕</span>
        <input
          placeholder="Buscar…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      <div className="seg">
        {VIEWS.map((v) => (
          <button key={v.key} className={view === v.key ? "active" : ""} onClick={() => setView(v.key)}>
            {v.label}
          </button>
        ))}
      </div>

      <button className="icon-btn" title="Relógio (alarmes, timer, cronômetro)" onClick={() => useUi.getState().setClock(true)}>
        ⏰
      </button>
      <button className="icon-btn" title="IA" onClick={() => setAi(true)}>
        ✨
      </button>
      <button className="icon-btn" title="Configurações" onClick={() => setSettingsOpen(true)}>
        ⚙
      </button>
    </header>
  );
}

function titleFor(view: ViewKind, cursor: Date, firstDay: number): string {
  if (view === "month") return `${monthName(cursor.getMonth())} de ${cursor.getFullYear()}`;
  if (view === "day")
    return `${cursor.getDate()} de ${monthName(cursor.getMonth())} de ${cursor.getFullYear()}`;
  if (view === "week" || view === "agenda") {
    const s = startOfWeek(cursor, firstDay);
    const e = addDays(s, 6);
    if (s.getMonth() === e.getMonth())
      return `${s.getDate()}–${e.getDate()} ${monthShort(s.getMonth())} ${s.getFullYear()}`;
    return `${s.getDate()} ${monthShort(s.getMonth())} – ${e.getDate()} ${monthShort(e.getMonth())} ${e.getFullYear()}`;
  }
  return "";
}
