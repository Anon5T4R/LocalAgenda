//! Núcleo do LocalAgenda: um único banco SQLite em `app_data` (agenda não é um
//! "arquivo que se abre" — é o PIM pessoal da máquina). SQLite legítimo, abre em
//! qualquer ferramenta.
//!
//! Regra de ouro (vale também pra IA): **nenhum SQL cru vem de fora**. Os
//! comandos recebem structs tipadas e executam queries parametrizadas daqui.
//!
//! Fusos: por decisão do plano, **tudo em hora local, sem TZ**. Datas/horas de
//! evento e tarefa são strings de parede ("YYYY-MM-DDTHH:MM" ou "YYYY-MM-DD" pro
//! dia inteiro). A expansão de recorrência e o cálculo do instante do lembrete
//! ficam no front (rrule.js + Date local); aqui o lembrete já chega como
//! `fire_at` em epoch-ms, que o tick do lib.rs compara com o relógio.

use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{Manager, State};

/// Estado do banco (Arc pra o tick de lembretes compartilhar a mesma conexão).
#[derive(Clone, Default)]
pub struct Db(pub Arc<Mutex<Option<Connection>>>);

const SCHEMA_VERSION: i64 = 1;

pub fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

/// ID curto e estável (usado só pra semear o calendário padrão; o resto dos IDs
/// vem do front via `crypto.randomUUID`). Monotônico: nanos + contador.
fn gen_id(prefix: &str) -> String {
    static COUNTER: AtomicU64 = AtomicU64::new(0);
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos() as u64)
        .unwrap_or(0);
    let c = COUNTER.fetch_add(1, Ordering::Relaxed);
    format!("{}_{:x}{:x}", prefix, nanos, c)
}

// ----------------------------------------------------------------------------
// Modelos (serializados em camelCase pro front)
// ----------------------------------------------------------------------------

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Calendar {
    pub id: String,
    pub name: String,
    pub color: String,
    #[serde(default = "default_true")]
    pub visible: bool,
    #[serde(default)]
    pub sort: i64,
}

fn default_true() -> bool {
    true
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Event {
    pub id: String,
    pub calendar_id: String,
    pub title: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub location: String,
    pub start: String,
    pub end: String,
    #[serde(default)]
    pub all_day: bool,
    /// RRULE RFC 5545 (sem DTSTART); "" = evento único.
    #[serde(default)]
    pub rrule: String,
    /// Ocorrências excluídas (início ISO de cada uma) — "só esta ocorrência".
    #[serde(default)]
    pub exdates: Vec<String>,
    /// Lembretes: minutos antes do início.
    #[serde(default)]
    pub reminders: Vec<i64>,
    #[serde(default)]
    pub created_at: i64,
    #[serde(default)]
    pub updated_at: i64,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Task {
    pub id: String,
    pub title: String,
    #[serde(default)]
    pub notes: String,
    /// Prazo (ISO local ou data pura); "" = sem prazo.
    #[serde(default)]
    pub due: String,
    /// 0 nenhuma · 1 baixa · 2 média · 3 alta.
    #[serde(default)]
    pub priority: i64,
    #[serde(default)]
    pub rrule: String,
    #[serde(default)]
    pub reminders: Vec<i64>,
    /// Subtarefa: id da tarefa-mãe; "" = raiz.
    #[serde(default)]
    pub parent_id: String,
    /// Epoch-ms de conclusão; None = aberta.
    #[serde(default)]
    pub done_at: Option<i64>,
    #[serde(default)]
    pub sort: i64,
    #[serde(default)]
    pub created_at: i64,
    #[serde(default)]
    pub updated_at: i64,
}

/// Lembrete materializado pelo front (uma linha por ocorrência × offset). O tick
/// dispara quando `fire_at <= agora`. `kind`: "event" | "task" | "summary".
#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Reminder {
    pub id: String,
    pub kind: String,
    #[serde(default)]
    pub ref_id: String,
    #[serde(default)]
    pub occ: String,
    pub title: String,
    #[serde(default)]
    pub body: String,
    pub fire_at: i64,
    #[serde(default)]
    pub fired: bool,
}

// ----------------------------------------------------------------------------
// Abertura / schema
// ----------------------------------------------------------------------------

fn db_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("sem pasta de dados: {}", e))?;
    std::fs::create_dir_all(&dir).map_err(|e| format!("falha ao criar '{}': {}", dir.display(), e))?;
    Ok(dir.join("agenda.db"))
}

fn init_schema(conn: &Connection) -> Result<(), String> {
    conn.execute_batch(
        r#"
        PRAGMA journal_mode = WAL;
        PRAGMA foreign_keys = ON;

        CREATE TABLE IF NOT EXISTS meta (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS calendars (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            color TEXT NOT NULL,
            visible INTEGER NOT NULL DEFAULT 1,
            sort INTEGER NOT NULL DEFAULT 0
        );
        CREATE TABLE IF NOT EXISTS events (
            id TEXT PRIMARY KEY,
            calendar_id TEXT NOT NULL,
            title TEXT NOT NULL,
            description TEXT NOT NULL DEFAULT '',
            location TEXT NOT NULL DEFAULT '',
            start TEXT NOT NULL,
            "end" TEXT NOT NULL,
            all_day INTEGER NOT NULL DEFAULT 0,
            rrule TEXT NOT NULL DEFAULT '',
            exdates TEXT NOT NULL DEFAULT '[]',
            reminders TEXT NOT NULL DEFAULT '[]',
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS tasks (
            id TEXT PRIMARY KEY,
            title TEXT NOT NULL,
            notes TEXT NOT NULL DEFAULT '',
            due TEXT NOT NULL DEFAULT '',
            priority INTEGER NOT NULL DEFAULT 0,
            rrule TEXT NOT NULL DEFAULT '',
            reminders TEXT NOT NULL DEFAULT '[]',
            parent_id TEXT NOT NULL DEFAULT '',
            done_at INTEGER,
            sort INTEGER NOT NULL DEFAULT 0,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS reminders (
            id TEXT PRIMARY KEY,
            kind TEXT NOT NULL,
            ref_id TEXT NOT NULL DEFAULT '',
            occ TEXT NOT NULL DEFAULT '',
            title TEXT NOT NULL,
            body TEXT NOT NULL DEFAULT '',
            fire_at INTEGER NOT NULL,
            fired INTEGER NOT NULL DEFAULT 0
        );
        CREATE INDEX IF NOT EXISTS idx_events_cal ON events(calendar_id);
        CREATE INDEX IF NOT EXISTS idx_reminders_due ON reminders(fired, fire_at);
        "#,
    )
    .map_err(|e| format!("falha ao criar schema: {}", e))?;

    // schema_version + calendário padrão na 1ª execução.
    let ver: Option<String> = conn
        .query_row("SELECT value FROM meta WHERE key='schema_version'", [], |r| r.get(0))
        .optional()
        .map_err(|e| e.to_string())?;
    if ver.is_none() {
        conn.execute(
            "INSERT INTO meta(key, value) VALUES('schema_version', ?1)",
            params![SCHEMA_VERSION.to_string()],
        )
        .map_err(|e| e.to_string())?;
    }
    let cal_count: i64 = conn
        .query_row("SELECT COUNT(*) FROM calendars", [], |r| r.get(0))
        .map_err(|e| e.to_string())?;
    if cal_count == 0 {
        conn.execute(
            "INSERT INTO calendars(id, name, color, visible, sort) VALUES(?1, ?2, ?3, 1, 0)",
            params![gen_id("cal"), "Pessoal", "#2563eb"],
        )
        .map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Abre (ou cria) o banco em app_data e o instala no estado. Chamado no setup.
pub fn open(app: &tauri::AppHandle, db: &Db) -> Result<(), String> {
    let path = db_path(app)?;
    let conn = Connection::open(&path).map_err(|e| format!("falha ao abrir banco: {}", e))?;
    init_schema(&conn)?;
    *db.0.lock().map_err(|_| "estado do banco corrompido")? = Some(conn);
    Ok(())
}

/// Executa `f` com a conexão travada. Erro claro se o banco não abriu.
fn with_conn<T>(db: &Db, f: impl FnOnce(&Connection) -> Result<T, String>) -> Result<T, String> {
    let guard = db.0.lock().map_err(|_| "estado do banco corrompido")?;
    let conn = guard.as_ref().ok_or("banco não inicializado")?;
    f(conn)
}

// ----------------------------------------------------------------------------
// Calendários
// ----------------------------------------------------------------------------

fn row_to_calendar(r: &rusqlite::Row) -> rusqlite::Result<Calendar> {
    Ok(Calendar {
        id: r.get(0)?,
        name: r.get(1)?,
        color: r.get(2)?,
        visible: r.get::<_, i64>(3)? != 0,
        sort: r.get(4)?,
    })
}

#[tauri::command(async)]
pub fn calendars_list(db: State<'_, Db>) -> Result<Vec<Calendar>, String> {
    with_conn(&db, |conn| {
        let mut stmt = conn
            .prepare("SELECT id, name, color, visible, sort FROM calendars ORDER BY sort, name")
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], row_to_calendar)
            .map_err(|e| e.to_string())?;
        rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
    })
}

#[tauri::command(async)]
pub fn calendar_save(db: State<'_, Db>, cal: Calendar) -> Result<Calendar, String> {
    let mut cal = cal;
    if cal.id.is_empty() {
        cal.id = gen_id("cal");
    }
    with_conn(&db, |conn| {
        conn.execute(
            "INSERT INTO calendars(id, name, color, visible, sort) VALUES(?1, ?2, ?3, ?4, ?5)
             ON CONFLICT(id) DO UPDATE SET name=?2, color=?3, visible=?4, sort=?5",
            params![cal.id, cal.name, cal.color, cal.visible as i64, cal.sort],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    })?;
    Ok(cal)
}

#[tauri::command(async)]
pub fn calendar_delete(db: State<'_, Db>, id: String) -> Result<(), String> {
    with_conn(&db, |conn| {
        // Não deixa o usuário ficar sem nenhum calendário.
        let total: i64 = conn
            .query_row("SELECT COUNT(*) FROM calendars", [], |r| r.get(0))
            .map_err(|e| e.to_string())?;
        if total <= 1 {
            return Err("é preciso manter ao menos um calendário".into());
        }
        conn.execute("DELETE FROM events WHERE calendar_id=?1", params![id])
            .map_err(|e| e.to_string())?;
        conn.execute("DELETE FROM calendars WHERE id=?1", params![id])
            .map_err(|e| e.to_string())?;
        Ok(())
    })
}

// ----------------------------------------------------------------------------
// Eventos
// ----------------------------------------------------------------------------

fn row_to_event(r: &rusqlite::Row) -> rusqlite::Result<Event> {
    let exdates: String = r.get(9)?;
    let reminders: String = r.get(10)?;
    Ok(Event {
        id: r.get(0)?,
        calendar_id: r.get(1)?,
        title: r.get(2)?,
        description: r.get(3)?,
        location: r.get(4)?,
        start: r.get(5)?,
        end: r.get(6)?,
        all_day: r.get::<_, i64>(7)? != 0,
        rrule: r.get(8)?,
        exdates: serde_json::from_str(&exdates).unwrap_or_default(),
        reminders: serde_json::from_str(&reminders).unwrap_or_default(),
        created_at: r.get(11)?,
        updated_at: r.get(12)?,
    })
}

const EVENT_COLS: &str = "id, calendar_id, title, description, location, start, \"end\", all_day, rrule, exdates, reminders, created_at, updated_at";

#[tauri::command(async)]
pub fn events_list(db: State<'_, Db>) -> Result<Vec<Event>, String> {
    with_conn(&db, |conn| {
        let mut stmt = conn
            .prepare(&format!("SELECT {} FROM events", EVENT_COLS))
            .map_err(|e| e.to_string())?;
        let rows = stmt.query_map([], row_to_event).map_err(|e| e.to_string())?;
        rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
    })
}

#[tauri::command(async)]
pub fn event_save(db: State<'_, Db>, event: Event) -> Result<Event, String> {
    let mut ev = event;
    if ev.id.is_empty() {
        ev.id = gen_id("ev");
    }
    let now = now_ms();
    if ev.created_at == 0 {
        ev.created_at = now;
    }
    ev.updated_at = now;
    let exdates = serde_json::to_string(&ev.exdates).unwrap_or_else(|_| "[]".into());
    let reminders = serde_json::to_string(&ev.reminders).unwrap_or_else(|_| "[]".into());
    with_conn(&db, |conn| {
        conn.execute(
            "INSERT INTO events(id, calendar_id, title, description, location, start, \"end\", all_day, rrule, exdates, reminders, created_at, updated_at)
             VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13)
             ON CONFLICT(id) DO UPDATE SET calendar_id=?2, title=?3, description=?4, location=?5, start=?6, \"end\"=?7, all_day=?8, rrule=?9, exdates=?10, reminders=?11, updated_at=?13",
            params![
                ev.id, ev.calendar_id, ev.title, ev.description, ev.location, ev.start, ev.end,
                ev.all_day as i64, ev.rrule, exdates, reminders, ev.created_at, ev.updated_at
            ],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    })?;
    Ok(ev)
}

#[tauri::command(async)]
pub fn event_delete(db: State<'_, Db>, id: String) -> Result<(), String> {
    with_conn(&db, |conn| {
        conn.execute("DELETE FROM events WHERE id=?1", params![id])
            .map_err(|e| e.to_string())?;
        conn.execute("DELETE FROM reminders WHERE kind='event' AND ref_id=?1", params![id])
            .map_err(|e| e.to_string())?;
        Ok(())
    })
}

// ----------------------------------------------------------------------------
// Tarefas
// ----------------------------------------------------------------------------

fn row_to_task(r: &rusqlite::Row) -> rusqlite::Result<Task> {
    let reminders: String = r.get(6)?;
    Ok(Task {
        id: r.get(0)?,
        title: r.get(1)?,
        notes: r.get(2)?,
        due: r.get(3)?,
        priority: r.get(4)?,
        rrule: r.get(5)?,
        reminders: serde_json::from_str(&reminders).unwrap_or_default(),
        parent_id: r.get(7)?,
        done_at: r.get(8)?,
        sort: r.get(9)?,
        created_at: r.get(10)?,
        updated_at: r.get(11)?,
    })
}

const TASK_COLS: &str =
    "id, title, notes, due, priority, rrule, reminders, parent_id, done_at, sort, created_at, updated_at";

#[tauri::command(async)]
pub fn tasks_list(db: State<'_, Db>) -> Result<Vec<Task>, String> {
    with_conn(&db, |conn| {
        let mut stmt = conn
            .prepare(&format!("SELECT {} FROM tasks ORDER BY sort, created_at", TASK_COLS))
            .map_err(|e| e.to_string())?;
        let rows = stmt.query_map([], row_to_task).map_err(|e| e.to_string())?;
        rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
    })
}

#[tauri::command(async)]
pub fn task_save(db: State<'_, Db>, task: Task) -> Result<Task, String> {
    let mut t = task;
    if t.id.is_empty() {
        t.id = gen_id("task");
    }
    let now = now_ms();
    if t.created_at == 0 {
        t.created_at = now;
    }
    t.updated_at = now;
    let reminders = serde_json::to_string(&t.reminders).unwrap_or_else(|_| "[]".into());
    with_conn(&db, |conn| {
        conn.execute(
            "INSERT INTO tasks(id, title, notes, due, priority, rrule, reminders, parent_id, done_at, sort, created_at, updated_at)
             VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12)
             ON CONFLICT(id) DO UPDATE SET title=?2, notes=?3, due=?4, priority=?5, rrule=?6, reminders=?7, parent_id=?8, done_at=?9, sort=?10, updated_at=?12",
            params![
                t.id, t.title, t.notes, t.due, t.priority, t.rrule, reminders, t.parent_id,
                t.done_at, t.sort, t.created_at, t.updated_at
            ],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    })?;
    Ok(t)
}

#[tauri::command(async)]
pub fn task_delete(db: State<'_, Db>, id: String) -> Result<(), String> {
    with_conn(&db, |conn| {
        // Subtarefas vão junto.
        conn.execute("DELETE FROM tasks WHERE id=?1 OR parent_id=?1", params![id])
            .map_err(|e| e.to_string())?;
        conn.execute("DELETE FROM reminders WHERE kind='task' AND ref_id=?1", params![id])
            .map_err(|e| e.to_string())?;
        Ok(())
    })
}

// ----------------------------------------------------------------------------
// Lembretes (materializados pelo front; disparados pelo tick do lib.rs)
// ----------------------------------------------------------------------------

/// Substitui os lembretes AINDA NÃO disparados pelos que o front calculou
/// (janela rolante). Os já disparados (fired=1) ficam intactos e, como os IDs
/// são determinísticos (`kind:refId:occ:min`), o `INSERT OR IGNORE` impede que
/// um lembrete já mostrado reapareça — cada ocorrência notifica no máximo 1×.
#[tauri::command(async)]
pub fn reminders_replace(db: State<'_, Db>, items: Vec<Reminder>) -> Result<(), String> {
    with_conn(&db, |conn| {
        conn.execute("DELETE FROM reminders WHERE fired=0", [])
            .map_err(|e| e.to_string())?;
        for r in &items {
            let id = if r.id.is_empty() { gen_id("rem") } else { r.id.clone() };
            conn.execute(
                "INSERT OR IGNORE INTO reminders(id, kind, ref_id, occ, title, body, fire_at, fired)
                 VALUES(?1,?2,?3,?4,?5,?6,?7,0)",
                params![id, r.kind, r.ref_id, r.occ, r.title, r.body, r.fire_at],
            )
            .map_err(|e| e.to_string())?;
        }
        Ok(())
    })
}

/// Adia um lembrete: volta a `fired=0` com novo horário (agora + minutos).
#[tauri::command(async)]
pub fn reminder_snooze(db: State<'_, Db>, id: String, minutes: i64) -> Result<(), String> {
    let fire_at = now_ms() + minutes * 60_000;
    with_conn(&db, |conn| {
        conn.execute(
            "UPDATE reminders SET fire_at=?1, fired=0 WHERE id=?2",
            params![fire_at, id],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    })
}

/// Colhe os lembretes vencidos (fired=0 e fire_at<=agora) e os marca disparados,
/// tudo na mesma trava. Usado pelo tick — o disparo da notificação é no lib.rs.
pub fn take_due_reminders(db: &Db, now: i64) -> Vec<Reminder> {
    let out = with_conn(db, |conn| {
        let mut stmt = conn
            .prepare(
                "SELECT id, kind, ref_id, occ, title, body, fire_at FROM reminders
                 WHERE fired=0 AND fire_at<=?1 ORDER BY fire_at",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(params![now], |r| {
                Ok(Reminder {
                    id: r.get(0)?,
                    kind: r.get(1)?,
                    ref_id: r.get(2)?,
                    occ: r.get(3)?,
                    title: r.get(4)?,
                    body: r.get(5)?,
                    fire_at: r.get(6)?,
                    fired: false,
                })
            })
            .map_err(|e| e.to_string())?;
        let items: Vec<Reminder> = rows.filter_map(|r| r.ok()).collect();
        for r in &items {
            let _ = conn.execute("UPDATE reminders SET fired=1 WHERE id=?1", params![r.id]);
        }
        Ok(items)
    });
    out.unwrap_or_default()
}

// ----------------------------------------------------------------------------
// Configurações (blob JSON em meta)
// ----------------------------------------------------------------------------

#[tauri::command(async)]
pub fn settings_get(db: State<'_, Db>) -> Result<serde_json::Value, String> {
    with_conn(&db, |conn| {
        let raw: Option<String> = conn
            .query_row("SELECT value FROM meta WHERE key='settings'", [], |r| r.get(0))
            .optional()
            .map_err(|e| e.to_string())?;
        Ok(raw
            .and_then(|s| serde_json::from_str(&s).ok())
            .unwrap_or_else(|| serde_json::json!({})))
    })
}

/// Lê um booleano das configurações (blob JSON), com padrão. Usado pelo lib.rs
/// (ex.: "fechar minimiza pra bandeja?") sem passar pela camada de comando.
pub fn setting_bool(db: &Db, key: &str, default: bool) -> bool {
    with_conn(db, |conn| {
        let raw: Option<String> = conn
            .query_row("SELECT value FROM meta WHERE key='settings'", [], |r| r.get(0))
            .optional()
            .map_err(|e| e.to_string())?;
        let v: serde_json::Value = raw
            .and_then(|s| serde_json::from_str(&s).ok())
            .unwrap_or_else(|| serde_json::json!({}));
        Ok(v.get(key).and_then(|b| b.as_bool()).unwrap_or(default))
    })
    .unwrap_or(default)
}

#[tauri::command(async)]
pub fn settings_set(db: State<'_, Db>, value: serde_json::Value) -> Result<(), String> {
    let raw = value.to_string();
    with_conn(&db, |conn| {
        conn.execute(
            "INSERT INTO meta(key, value) VALUES('settings', ?1)
             ON CONFLICT(key) DO UPDATE SET value=?1",
            params![raw],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    })
}

// ----------------------------------------------------------------------------
// Backup / restauração da base inteira
// ----------------------------------------------------------------------------

/// Copia o banco (com checkpoint do WAL) pro caminho escolhido — backup.
#[tauri::command(async)]
pub fn db_export(app: tauri::AppHandle, db: State<'_, Db>, path: String) -> Result<(), String> {
    with_conn(&db, |conn| {
        let _ = conn.execute_batch("PRAGMA wal_checkpoint(TRUNCATE);");
        Ok(())
    })?;
    let src = db_path(&app)?;
    std::fs::copy(&src, &path).map_err(|e| format!("falha ao exportar: {}", e))?;
    Ok(())
}

/// Substitui o banco atual por um arquivo escolhido e reabre. Backup do atual
/// é feito antes, ao lado do original (agenda.db.bak).
#[tauri::command(async)]
pub fn db_import(app: tauri::AppHandle, db: State<'_, Db>, path: String) -> Result<(), String> {
    // Valida que é um SQLite legível antes de sobrescrever.
    {
        let probe = Connection::open(&path).map_err(|e| format!("arquivo inválido: {}", e))?;
        probe
            .query_row("SELECT COUNT(*) FROM calendars", [], |r| r.get::<_, i64>(0))
            .map_err(|_| "o arquivo não parece uma base do LocalAgenda".to_string())?;
    }
    let dest = db_path(&app)?;
    // Fecha a conexão atual antes de sobrescrever o arquivo (Windows trava aberto).
    {
        let mut guard = db.0.lock().map_err(|_| "estado do banco corrompido")?;
        *guard = None;
    }
    let bak = dest.with_extension("db.bak");
    let _ = std::fs::copy(&dest, &bak);
    std::fs::copy(&path, &dest).map_err(|e| format!("falha ao importar: {}", e))?;
    open(&app, &db)?;
    Ok(())
}
