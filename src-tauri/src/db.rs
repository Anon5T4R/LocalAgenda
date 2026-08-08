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

/// v1 → v2: `series_id`/`recurrence_id` em `events` (exceções de recorrência).
/// v2 → v3: `snoozed` em `reminders` (o adiamento sobrevive ao replace).
const SCHEMA_VERSION: i64 = 3;

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
    /// Ocorrências CANCELADAS da série (EXDATE): início ISO de cada uma.
    #[serde(default)]
    pub exdates: Vec<String>,
    /// Exceção de série: id da série que este evento substitui ("" = não é).
    #[serde(default)]
    pub series_id: String,
    /// Chave da ocorrência ORIGINAL substituída (RECURRENCE-ID do iCal).
    /// Guardar a origem — e não o horário novo — é o que deixa a série saber
    /// qual ocorrência calar depois que a exceção foi movida de dia.
    #[serde(default)]
    pub recurrence_id: String,
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

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Alarm {
    pub id: String,
    /// "HH:MM" local.
    pub time: String,
    #[serde(default)]
    pub label: String,
    /// Dias da semana (0=domingo…6=sábado); vazio = todo dia.
    #[serde(default)]
    pub days: Vec<i64>,
    #[serde(default = "default_true")]
    pub enabled: bool,
    #[serde(default)]
    pub sort: i64,
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

/// `true` se a coluna já existe (o `CREATE TABLE IF NOT EXISTS` é no-op numa
/// base antiga, então quem decide se falta coluna é o PRAGMA — não a versão).
fn has_column(conn: &Connection, table: &str, column: &str) -> Result<bool, String> {
    let mut stmt = conn
        .prepare(&format!("PRAGMA table_info({})", table))
        .map_err(|e| e.to_string())?;
    let mut rows = stmt.query([]).map_err(|e| e.to_string())?;
    while let Some(r) = rows.next().map_err(|e| e.to_string())? {
        let name: String = r.get(1).map_err(|e| e.to_string())?;
        if name == column {
            return Ok(true);
        }
    }
    Ok(false)
}

/// Migração incremental a partir da versão gravada. Só ADD COLUMN com DEFAULT:
/// nenhum evento existente é reescrito, e como o padrão é "" todos continuam
/// sendo série/evento simples — o comportamento de quem já tem base é idêntico.
fn migrate(conn: &Connection, from: i64) -> Result<(), String> {
    if from < 2 {
        for col in ["series_id", "recurrence_id"] {
            if !has_column(conn, "events", col)? {
                conn.execute(
                    &format!("ALTER TABLE events ADD COLUMN {} TEXT NOT NULL DEFAULT ''", col),
                    [],
                )
                .map_err(|e| format!("falha ao migrar events.{}: {}", col, e))?;
            }
        }
    }
    if from < 3 {
        if !has_column(conn, "reminders", "snoozed")? {
            conn.execute(
                "ALTER TABLE reminders ADD COLUMN snoozed INTEGER NOT NULL DEFAULT 0",
                [],
            )
            .map_err(|e| format!("falha ao migrar reminders.snoozed: {}", e))?;
        }
    }
    Ok(())
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
            series_id TEXT NOT NULL DEFAULT '',
            recurrence_id TEXT NOT NULL DEFAULT '',
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
            fired INTEGER NOT NULL DEFAULT 0,
            snoozed INTEGER NOT NULL DEFAULT 0
        );
        CREATE TABLE IF NOT EXISTS alarms (
            id TEXT PRIMARY KEY,
            time TEXT NOT NULL,
            label TEXT NOT NULL DEFAULT '',
            days TEXT NOT NULL DEFAULT '[]',
            enabled INTEGER NOT NULL DEFAULT 1,
            sort INTEGER NOT NULL DEFAULT 0
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
    match ver.as_deref().and_then(|v| v.parse::<i64>().ok()) {
        // Base nova: o CREATE acima já nasceu na versão corrente.
        None => {
            conn.execute(
                "INSERT INTO meta(key, value) VALUES('schema_version', ?1)
                 ON CONFLICT(key) DO UPDATE SET value=?1",
                params![SCHEMA_VERSION.to_string()],
            )
            .map_err(|e| e.to_string())?;
        }
        Some(v) if v < SCHEMA_VERSION => {
            migrate(conn, v)?;
            conn.execute(
                "UPDATE meta SET value=?1 WHERE key='schema_version'",
                params![SCHEMA_VERSION.to_string()],
            )
            .map_err(|e| e.to_string())?;
        }
        _ => {}
    }

    // Índices de colunas NOVAS só depois da migração: numa base v1 a tabela já
    // existe sem a coluna (o CREATE IF NOT EXISTS acima não a acrescenta), e um
    // CREATE INDEX antes do ALTER faz o init inteiro falhar — o app não abriria
    // o banco de quem só atualizou de versão.
    conn.execute_batch("CREATE INDEX IF NOT EXISTS idx_events_series ON events(series_id);")
        .map_err(|e| format!("falha ao criar índice de série: {}", e))?;
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
    let reminders: String = r.get(12)?;
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
        series_id: r.get(10)?,
        recurrence_id: r.get(11)?,
        reminders: serde_json::from_str(&reminders).unwrap_or_default(),
        created_at: r.get(13)?,
        updated_at: r.get(14)?,
    })
}

const EVENT_COLS: &str = "id, calendar_id, title, description, location, start, \"end\", all_day, rrule, exdates, series_id, recurrence_id, reminders, created_at, updated_at";

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
            "INSERT INTO events(id, calendar_id, title, description, location, start, \"end\", all_day, rrule, exdates, series_id, recurrence_id, reminders, created_at, updated_at)
             VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15)
             ON CONFLICT(id) DO UPDATE SET calendar_id=?2, title=?3, description=?4, location=?5, start=?6, \"end\"=?7, all_day=?8, rrule=?9, exdates=?10, series_id=?11, recurrence_id=?12, reminders=?13, updated_at=?15",
            params![
                ev.id, ev.calendar_id, ev.title, ev.description, ev.location, ev.start, ev.end,
                ev.all_day as i64, ev.rrule, exdates, ev.series_id, ev.recurrence_id, reminders,
                ev.created_at, ev.updated_at
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
        // Apagar a série leva as exceções junto: sem isso sobraria uma cópia da
        // terça movida sem dono, visível no calendário e impossível de ligar de
        // volta a nada. Os lembretes das exceções vão no mesmo laço.
        conn.execute(
            "DELETE FROM reminders WHERE kind='event' AND ref_id IN
             (SELECT id FROM events WHERE id=?1 OR series_id=?1)",
            params![id],
        )
        .map_err(|e| e.to_string())?;
        conn.execute("DELETE FROM events WHERE id=?1 OR series_id=?1", params![id])
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
/// (janela rolante). Os já disparados (fired=1) e os ADIADOS (snoozed=1) ficam
/// intactos e, como os IDs são determinísticos (`kind:refId:occ:min`), o
/// `INSERT OR IGNORE` impede que um lembrete já mostrado reapareça — cada
/// ocorrência notifica no máximo 1×. O adiado só sai daqui quando o tick o
/// dispara (que zera o snoozed) ou quando o dono é apagado.
#[tauri::command(async)]
pub fn reminders_replace(db: State<'_, Db>, items: Vec<Reminder>) -> Result<(), String> {
    with_conn(&db, |conn| {
        conn.execute("DELETE FROM reminders WHERE fired=0 AND snoozed=0", [])
            .map_err(|e| e.to_string())?;
        for r in &items {
            let id = if r.id.is_empty() { gen_id("rem") } else { r.id.clone() };
            conn.execute(
                "INSERT OR IGNORE INTO reminders(id, kind, ref_id, occ, title, body, fire_at, fired, snoozed)
                 VALUES(?1,?2,?3,?4,?5,?6,?7,0,0)",
                params![id, r.kind, r.ref_id, r.occ, r.title, r.body, r.fire_at],
            )
            .map_err(|e| e.to_string())?;
        }
        Ok(())
    })
}

/// Núcleo do adiamento (sem o autosave): atualiza o lembrete pra `fired=0`,
/// `snoozed=1` e novo horário. Separado do comando pra o teste chamar com um
/// `Db` de memória.
fn snooze(db: &Db, id: &str, minutes: i64) -> Result<(), String> {
    let fire_at = now_ms() + minutes * 60_000;
    with_conn(db, |conn| {
        conn.execute(
            "UPDATE reminders SET fire_at=?1, fired=0, snoozed=1 WHERE id=?2",
            params![fire_at, id],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    })
}

/// Adia um lembrete: volta a `fired=0` com novo horário (agora + minutos) e
/// marca `snoozed=1` — é o que o faz sobreviver ao próximo `reminders_replace`
/// (que só apaga `fired=0 AND snoozed=0`). O tick o dispara quando o novo
/// horário chega, zerando o snoozed junto.
#[tauri::command(async)]
pub fn reminder_snooze(
    app: tauri::AppHandle,
    db: State<'_, Db>,
    id: String,
    minutes: i64,
) -> Result<(), String> {
    snooze(&db, &id, minutes)?;
    // O adiamento é uma escrita que não passa pela store (o front chama o
    // comando direto): espelha no sync_path na hora, best-effort.
    let _ = autosave(&app, &db);
    Ok(())
}

/// Colhe os lembretes vencidos (fired=0 e fire_at<=agora) e os marca disparados,
/// tudo na mesma trava. Usado pelo tick — o disparo da notificação é no lib.rs.
/// Adiados entram aqui normalmente: `snoozed=1` com `fired=0` e o novo horário
/// vencido é hora de disparar (e o snoozed é zerado junto).
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
            let _ = conn.execute(
                "UPDATE reminders SET fired=1, snoozed=0 WHERE id=?1",
                params![r.id],
            );
        }
        Ok(items)
    });
    out.unwrap_or_default()
}

// ----------------------------------------------------------------------------
// Alarmes (do módulo Relógio) — materializados em `reminders` pelo front.
// ----------------------------------------------------------------------------

fn row_to_alarm(r: &rusqlite::Row) -> rusqlite::Result<Alarm> {
    let days: String = r.get(3)?;
    Ok(Alarm {
        id: r.get(0)?,
        time: r.get(1)?,
        label: r.get(2)?,
        days: serde_json::from_str(&days).unwrap_or_default(),
        enabled: r.get::<_, i64>(4)? != 0,
        sort: r.get(5)?,
    })
}

#[tauri::command(async)]
pub fn alarms_list(db: State<'_, Db>) -> Result<Vec<Alarm>, String> {
    with_conn(&db, |conn| {
        let mut stmt = conn
            .prepare("SELECT id, time, label, days, enabled, sort FROM alarms ORDER BY sort, time")
            .map_err(|e| e.to_string())?;
        let rows = stmt.query_map([], row_to_alarm).map_err(|e| e.to_string())?;
        rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
    })
}

#[tauri::command(async)]
pub fn alarm_save(db: State<'_, Db>, alarm: Alarm) -> Result<Alarm, String> {
    let mut a = alarm;
    if a.id.is_empty() {
        a.id = gen_id("alarm");
    }
    let days = serde_json::to_string(&a.days).unwrap_or_else(|_| "[]".into());
    with_conn(&db, |conn| {
        conn.execute(
            "INSERT INTO alarms(id, time, label, days, enabled, sort) VALUES(?1,?2,?3,?4,?5,?6)
             ON CONFLICT(id) DO UPDATE SET time=?2, label=?3, days=?4, enabled=?5, sort=?6",
            params![a.id, a.time, a.label, days, a.enabled as i64, a.sort],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    })?;
    Ok(a)
}

#[tauri::command(async)]
pub fn alarm_delete(db: State<'_, Db>, id: String) -> Result<(), String> {
    with_conn(&db, |conn| {
        conn.execute("DELETE FROM alarms WHERE id=?1", params![id])
            .map_err(|e| e.to_string())?;
        conn.execute("DELETE FROM reminders WHERE kind='alarm' AND ref_id=?1", params![id])
            .map_err(|e| e.to_string())?;
        Ok(())
    })
}

// ----------------------------------------------------------------------------
// Configurações (blob JSON em meta)
// ----------------------------------------------------------------------------

/// Lê o blob de configurações inteiro (ou `{}` se nunca gravado/ilegível).
fn read_settings(conn: &Connection) -> Result<serde_json::Value, String> {
    let raw: Option<String> = conn
        .query_row("SELECT value FROM meta WHERE key='settings'", [], |r| r.get(0))
        .optional()
        .map_err(|e| e.to_string())?;
    Ok(raw
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_else(|| serde_json::json!({})))
}

#[tauri::command(async)]
pub fn settings_get(db: State<'_, Db>) -> Result<serde_json::Value, String> {
    with_conn(&db, read_settings)
}

/// Grava UMA chave no blob de configurações preservando o resto (merge). O
/// front reescreve o blob inteiro via `settings_set`; daqui só mexemos em uma
/// chave por vez (autostart, sync_path…).
fn set_setting_value(db: &Db, key: &str, value: serde_json::Value) -> Result<(), String> {
    with_conn(db, |conn| {
        let mut v = read_settings(conn)?;
        if !v.is_object() {
            v = serde_json::json!({});
        }
        v[key] = value;
        conn.execute(
            "INSERT INTO meta(key, value) VALUES('settings', ?1)
             ON CONFLICT(key) DO UPDATE SET value=?1",
            params![v.to_string()],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    })
}

/// Lê um booleano das configurações (blob JSON), com padrão. Usado pelo lib.rs
/// (ex.: "fechar minimiza pra bandeja?") sem passar pela camada de comando.
pub fn setting_bool(db: &Db, key: &str, default: bool) -> bool {
    with_conn(db, |conn| {
        Ok(read_settings(conn)?
            .get(key)
            .and_then(|b| b.as_bool())
            .unwrap_or(default))
    })
    .unwrap_or(default)
}

/// Lê um booleano das configurações sem padrão: `None` = a chave nunca foi
/// gravada. O autostart usa isso pra distinguir "o usuário desligou" de "ainda
/// não decidiu" (e, nesse caso, herdar o estado que já está no SO).
pub fn setting_bool_opt(db: &Db, key: &str) -> Option<bool> {
    with_conn(db, |conn| {
        Ok(read_settings(conn)?.get(key).and_then(|b| b.as_bool()))
    })
    .unwrap_or(None)
}

/// Lê uma string das configurações, com padrão. O syncPath (arquivo pra onde o
/// banco é copiado a cada alteração) usa isso; `None`/não-string = padrão.
pub fn setting_str(db: &Db, key: &str, default: &str) -> String {
    with_conn(db, |conn| {
        Ok(read_settings(conn)?
            .get(key)
            .and_then(|s| s.as_str())
            .map(|s| s.to_string())
            .unwrap_or_else(|| default.to_string()))
    })
    .unwrap_or_else(|_| default.to_string())
}

/// Grava um booleano no blob de configurações preservando o resto (merge).
pub fn set_setting_bool(db: &Db, key: &str, value: bool) -> Result<(), String> {
    set_setting_value(db, key, serde_json::Value::Bool(value))
}

/// Grava uma string no blob de configurações preservando o resto (merge).
fn set_setting_str(db: &Db, key: &str, value: &str) -> Result<(), String> {
    set_setting_value(db, key, serde_json::Value::String(value.to_string()))
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
// Sincronização por arquivo (sync_path) — o Android abre o MESMO .db via SAF
// ----------------------------------------------------------------------------

/// Caminho do arquivo de sync ("" = desligado).
#[tauri::command(async)]
pub fn sync_path_get(db: State<'_, Db>) -> Result<String, String> {
    Ok(setting_str(&db, "syncPath", ""))
}

/// Define o caminho do arquivo de sync, preservando as demais configurações.
#[tauri::command(async)]
pub fn sync_path_set(db: State<'_, Db>, path: String) -> Result<(), String> {
    set_setting_str(&db, "syncPath", &path)
}

/// "Impressão digital" do arquivo de sync: mtime (epoch, com subsegundo) +
/// tamanho. É o que o check de mudança externa compara — qualquer escrita de
/// fora muda o mtime; o tamanho pega o caso de reescrita "parecida".
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct SyncFingerprint {
    mtime_secs: i64,
    mtime_nanos: u32,
    len: u64,
}

fn file_fingerprint(path: &str) -> Option<SyncFingerprint> {
    let md = std::fs::metadata(path).ok()?;
    let (mtime_secs, mtime_nanos) = md
        .modified()
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| (d.as_secs() as i64, d.subsec_nanos()))
        .unwrap_or((0, 0));
    Some(SyncFingerprint {
        mtime_secs,
        mtime_nanos,
        len: md.len(),
    })
}

fn read_fp(conn: &Connection) -> Result<Option<SyncFingerprint>, String> {
    let raw: Option<String> = conn
        .query_row("SELECT value FROM meta WHERE key='sync_fp'", [], |r| r.get(0))
        .optional()
        .map_err(|e| e.to_string())?;
    let Some(raw) = raw else { return Ok(None) };
    let v: serde_json::Value = serde_json::from_str(&raw).map_err(|e| e.to_string())?;
    Ok(Some(SyncFingerprint {
        mtime_secs: v.get("mtimeSecs").and_then(|x| x.as_i64()).unwrap_or(0),
        mtime_nanos: v.get("mtimeNanos").and_then(|x| x.as_u64()).unwrap_or(0) as u32,
        len: v.get("len").and_then(|x| x.as_u64()).unwrap_or(0),
    }))
}

fn write_fp(conn: &Connection, fp: &SyncFingerprint) -> Result<(), String> {
    let raw = serde_json::json!({
        "mtimeSecs": fp.mtime_secs,
        "mtimeNanos": fp.mtime_nanos,
        "len": fp.len,
    })
    .to_string();
    conn.execute(
        "INSERT INTO meta(key, value) VALUES('sync_fp', ?1)
         ON CONFLICT(key) DO UPDATE SET value=?1",
        params![raw],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

/// `true` se o arquivo de sync mudou FORA do app desde a última cópia nossa.
/// Sem sync_path, sem arquivo ou sem estado registrado (1ª vez) → `false`: não
/// há o que comparar nem o que recarregar.
fn external_changed(conn: &Connection, sync_path: &str) -> Result<bool, String> {
    if sync_path.is_empty() {
        return Ok(false);
    }
    let Some(current) = file_fingerprint(sync_path) else {
        return Ok(false); // arquivo apagado: nada pra recarregar
    };
    let Some(known) = read_fp(conn)? else {
        return Ok(false); // nunca copiamos: a 1ª sync não tem "nosso" estado
    };
    Ok(current != known)
}

#[tauri::command(async)]
pub fn sync_external_changed(db: State<'_, Db>) -> Result<bool, String> {
    with_conn(&db, |conn| {
        let v = read_settings(conn)?;
        let path = v
            .get("syncPath")
            .and_then(|p| p.as_str())
            .map(|s| s.to_string())
            .unwrap_or_default();
        external_changed(conn, &path)
    })
}

/// Checkpoint WAL + cópia do banco pro sync_path, registrando a impressão
/// digital do arquivo copiado ("nosso" estado, que o check compara). Tudo na
/// MESMA trava: o tick de lembretes não pode escrever entre o checkpoint e a
/// cópia (senão o arquivo ficaria sem as linhas mais novas). No-op sem
/// sync_path. Chamado pelo comando `sync_now` (front) e por saídas do Rust
/// que escrevem por fora da store (snooze, tick, exit).
pub fn autosave(app: &tauri::AppHandle, db: &Db) -> Result<(), String> {
    let path = setting_str(db, "syncPath", "");
    if path.is_empty() {
        return Ok(());
    }
    let src = db_path(app)?;
    with_conn(db, |conn| {
        let _ = conn.execute_batch("PRAGMA wal_checkpoint(TRUNCATE);");
        std::fs::copy(&src, &path).map_err(|e| format!("falha ao copiar pro sync: {}", e))?;
        if let Some(fp) = file_fingerprint(&path) {
            write_fp(conn, &fp)?;
        }
        Ok(())
    })
}

/// Grava o banco atual no sync_path na hora (o front usa no `forceSave` e no
/// flush do autosave com debounce de 2s).
#[tauri::command(async)]
pub fn sync_now(app: tauri::AppHandle, db: State<'_, Db>) -> Result<(), String> {
    autosave(&app, &db)
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
    // Se o importado É o arquivo de sync (botão "Recarregar do disco"), o
    // estado dele passa a ser o "nosso" — senão a 1ª sync seguinte acusaria
    // mudança externa à toa.
    let sync_path = setting_str(&db, "syncPath", "");
    if !sync_path.is_empty() {
        let same = std::fs::canonicalize(&path).ok() == std::fs::canonicalize(&sync_path).ok();
        if same {
            if let Some(fp) = file_fingerprint(&path) {
                let _ = with_conn(&db, |conn| write_fp(conn, &fp));
            }
        }
    }
    Ok(())
}

// ----------------------------------------------------------------------------
// Testes
// ----------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    /// Schema exatamente como era na v1 (sem series_id/recurrence_id).
    fn v1_db() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            r#"
            CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
            CREATE TABLE calendars (
                id TEXT PRIMARY KEY, name TEXT NOT NULL, color TEXT NOT NULL,
                visible INTEGER NOT NULL DEFAULT 1, sort INTEGER NOT NULL DEFAULT 0
            );
            CREATE TABLE events (
                id TEXT PRIMARY KEY, calendar_id TEXT NOT NULL, title TEXT NOT NULL,
                description TEXT NOT NULL DEFAULT '', location TEXT NOT NULL DEFAULT '',
                start TEXT NOT NULL, "end" TEXT NOT NULL,
                all_day INTEGER NOT NULL DEFAULT 0, rrule TEXT NOT NULL DEFAULT '',
                exdates TEXT NOT NULL DEFAULT '[]', reminders TEXT NOT NULL DEFAULT '[]',
                created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
            );
            INSERT INTO meta(key, value) VALUES('schema_version', '1');
            INSERT INTO calendars(id, name, color) VALUES('c1', 'Pessoal', '#2563eb');
            INSERT INTO events(id, calendar_id, title, start, "end", rrule, exdates, created_at, updated_at)
            VALUES('ev_velho', 'c1', 'Reunião antiga', '2026-07-15T09:00', '2026-07-15T10:00',
                   'FREQ=WEEKLY;BYDAY=WE', '["2026-07-22T09:00"]', 1, 1);
            "#,
        )
        .unwrap();
        conn
    }

    fn version(conn: &Connection) -> i64 {
        conn.query_row("SELECT value FROM meta WHERE key='schema_version'", [], |r| {
            r.get::<_, String>(0)
        })
        .unwrap()
        .parse()
        .unwrap()
    }

    /// O caso que importa: quem já tem base não pode perder evento na migração.
    #[test]
    fn migra_v1_sem_perder_dado() {
        let conn = v1_db();
        init_schema(&conn).unwrap();

        assert_eq!(version(&conn), SCHEMA_VERSION);
        assert!(has_column(&conn, "events", "series_id").unwrap());
        assert!(has_column(&conn, "events", "recurrence_id").unwrap());
        assert!(has_column(&conn, "reminders", "snoozed").unwrap());

        // O evento antigo continua lá, inteiro, e virou "série normal" (campos
        // novos vazios) — comportamento idêntico ao de antes da migração.
        let mut stmt = conn
            .prepare(&format!("SELECT {} FROM events", EVENT_COLS))
            .unwrap();
        let evs: Vec<Event> = stmt
            .query_map([], row_to_event)
            .unwrap()
            .map(|r| r.unwrap())
            .collect();
        assert_eq!(evs.len(), 1);
        let ev = &evs[0];
        assert_eq!(ev.id, "ev_velho");
        assert_eq!(ev.title, "Reunião antiga");
        assert_eq!(ev.rrule, "FREQ=WEEKLY;BYDAY=WE");
        assert_eq!(ev.exdates, vec!["2026-07-22T09:00".to_string()]);
        assert_eq!(ev.series_id, "");
        assert_eq!(ev.recurrence_id, "");
    }

    /// Reabrir o app roda init_schema de novo: não pode tentar re-adicionar
    /// coluna nem regredir a versão.
    #[test]
    fn migracao_e_idempotente() {
        let conn = v1_db();
        init_schema(&conn).unwrap();
        init_schema(&conn).unwrap();
        init_schema(&conn).unwrap();
        assert_eq!(version(&conn), SCHEMA_VERSION);
        let n: i64 = conn
            .query_row("SELECT COUNT(*) FROM events", [], |r| r.get(0))
            .unwrap();
        assert_eq!(n, 1);
    }

    /// Base nova nasce já na versão corrente, sem passar pela migração.
    #[test]
    fn base_nova_ja_nasce_na_versao_corrente() {
        let conn = Connection::open_in_memory().unwrap();
        init_schema(&conn).unwrap();
        assert_eq!(version(&conn), SCHEMA_VERSION);
        assert!(has_column(&conn, "events", "series_id").unwrap());
        assert!(has_column(&conn, "reminders", "snoozed").unwrap());
    }

    /// O adiado sobrevive ao `reminders_replace` (que só apaga os pendentes
    /// normais) e dispara quando o horário novo vence, zerando o snoozed.
    #[test]
    fn snoozed_sobrevive_ao_replace_e_dispara() {
        let conn = Connection::open_in_memory().unwrap();
        init_schema(&conn).unwrap();

        conn.execute(
            "INSERT INTO reminders(id, kind, ref_id, occ, title, body, fire_at, fired, snoozed)
             VALUES('event:e1:occ:60','event','e1','occ','Reunião','',1000,0,0)",
            [],
        )
        .unwrap();

        let db = Db(Arc::new(Mutex::new(Some(conn))));

        // Adia: fired=0 de novo + snoozed=1, com novo horário.
        snooze(&db, "event:e1:occ:60", 5).unwrap();
        let (snoozed, fire_at): (i64, i64) = db
            .0
            .lock()
            .unwrap()
            .as_ref()
            .unwrap()
            .query_row(
                "SELECT snoozed, fire_at FROM reminders WHERE id='event:e1:occ:60'",
                [],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .unwrap();
        assert_eq!(snoozed, 1);

        // Replace vazio (janela rolante sem nada): só o ADIADO sobra — o mesmo
        // DELETE que o reminders_replace faz.
        with_conn(&db, |conn| {
            conn.execute("DELETE FROM reminders WHERE fired=0 AND snoozed=0", [])
                .unwrap();
            Ok(())
        })
        .unwrap();
        let n: i64 = db
            .0
            .lock()
            .unwrap()
            .as_ref()
            .unwrap()
            .query_row("SELECT COUNT(*) FROM reminders", [], |r| r.get(0))
            .unwrap();
        assert_eq!(n, 1);

        // O tick colhe quando o horário novo vence e zera o snoozed.
        let due = take_due_reminders(&db, fire_at);
        assert_eq!(due.len(), 1);
        let (fired, snoozed): (i64, i64) = db
            .0
            .lock()
            .unwrap()
            .as_ref()
            .unwrap()
            .query_row(
                "SELECT fired, snoozed FROM reminders WHERE id='event:e1:occ:60'",
                [],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .unwrap();
        assert_eq!(fired, 1);
        assert_eq!(snoozed, 0);
    }

    /// Check de mudança externa: registrado o fingerprint da NOSSA cópia,
    /// mexer no arquivo de fora passa a ser detectado; intacto, não.
    #[test]
    fn mudanca_externa_e_detectada_pelo_fingerprint() {
        let conn = Connection::open_in_memory().unwrap();
        init_schema(&conn).unwrap();

        let dir = std::env::temp_dir().join(format!("localagenda-sync-test-{}", now_ms()));
        std::fs::create_dir_all(&dir).unwrap();
        let file = dir.join("agenda.db");
        let path = file.to_str().unwrap().to_string();

        // Simula a NOSSA 1ª cópia: escreve + registra o fingerprint.
        std::fs::write(&file, b"versao local").unwrap();
        let fp = file_fingerprint(&path).unwrap();
        write_fp(&conn, &fp).unwrap();
        assert!(!external_changed(&conn, &path).unwrap());

        // Mexe por fora (conteúdo E mtime novos) → detectado.
        std::thread::sleep(std::time::Duration::from_millis(20));
        std::fs::write(&file, b"versao do android").unwrap();
        assert!(external_changed(&conn, &path).unwrap());

        // Nossa cópia de novo (re-registra) → volta a ser "igual".
        let fp2 = file_fingerprint(&path).unwrap();
        write_fp(&conn, &fp2).unwrap();
        assert!(!external_changed(&conn, &path).unwrap());

        // Sem arquivo → nada pra recarregar, sem alarme falso.
        std::fs::remove_file(&file).unwrap();
        assert!(!external_changed(&conn, &path).unwrap());

        std::fs::remove_dir_all(&dir).unwrap();
    }
}
