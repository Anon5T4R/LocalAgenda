mod db;
mod llm;

use std::path::Path;
use std::sync::Mutex;
use std::time::Duration;

use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{Emitter, Manager, State, WindowEvent};
use tauri_plugin_autostart::ManagerExt;
use tauri_plugin_notification::NotificationExt;

use db::Db;

/// Caminho passado no launch (abrir um `.ics` pelo "Abrir com"), se houver.
#[tauri::command(async)]
fn get_startup_file() -> Option<String> {
    std::env::args()
        .skip(1)
        .find(|a| !a.starts_with('-') && Path::new(a).is_file())
}

/// Lê um arquivo como base64 (import `.ics`: o parse fica no webview, Rust só
/// move bytes — mesma filosofia do resto da suíte).
#[tauri::command(async)]
fn read_file_base64(path: String) -> Result<String, String> {
    use base64::Engine;
    let bytes = std::fs::read(&path).map_err(|e| format!("Falha ao ler '{}': {}", path, e))?;
    Ok(base64::engine::general_purpose::STANDARD.encode(bytes))
}

/// Grava bytes base64 em disco (export `.ics`, backup).
#[tauri::command(async)]
fn write_file_base64(path: String, base64_data: String) -> Result<(), String> {
    use base64::Engine;
    if let Some(parent) = Path::new(&path).parent() {
        if !parent.as_os_str().is_empty() {
            std::fs::create_dir_all(parent)
                .map_err(|e| format!("Falha ao criar diretório '{}': {}", parent.display(), e))?;
        }
    }
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(base64_data.as_bytes())
        .map_err(|e| format!("base64 inválido: {}", e))?;
    std::fs::write(&path, bytes).map_err(|e| format!("Falha ao salvar '{}': {}", path, e))
}

/// Grava texto direto (export `.ics`) — atalho pra não passar por base64.
#[tauri::command(async)]
fn write_text_file(path: String, content: String) -> Result<(), String> {
    std::fs::write(&path, content).map_err(|e| format!("Falha ao salvar '{}': {}", path, e))
}

// --- autostart (abrir com o Windows pra os lembretes funcionarem sozinhos) ---

#[tauri::command(async)]
fn autostart_get(app: tauri::AppHandle) -> bool {
    app.autolaunch().is_enabled().unwrap_or(false)
}

#[tauri::command(async)]
fn autostart_set(app: tauri::AppHandle, enabled: bool) -> Result<(), String> {
    let mgr = app.autolaunch();
    if enabled {
        mgr.enable().map_err(|e| e.to_string())
    } else {
        mgr.disable().map_err(|e| e.to_string())
    }
}

// --- lembretes: dispara os vencidos (notificação de desktop + evento pro front) ---

/// Colhe os lembretes vencidos e, pra cada um, mostra a notificação nativa e
/// emite `reminder-fired` pro front (toast in-app com botão de adiar). Roda no
/// tick e também sob demanda (comando abaixo), pra o lembrete recém-passado sair
/// na hora sem esperar o próximo tick.
fn dispatch_due(app: &tauri::AppHandle, db: &Db) {
    let now = db::now_ms();
    let due = db::take_due_reminders(db, now);
    for r in due {
        let body = if r.body.is_empty() { "Lembrete".to_string() } else { r.body.clone() };
        let _ = app
            .notification()
            .builder()
            .title(r.title.clone())
            .body(body)
            .show();
        let _ = app.emit("reminder-fired", &r);
    }
}

/// Força uma verificação de lembretes vencidos (o front chama logo após
/// materializar, pra não esperar o tick).
#[tauri::command(async)]
fn reminders_dispatch(app: tauri::AppHandle, db: State<'_, Db>) {
    dispatch_due(&app, &db);
}

/// Traz a janela de volta da bandeja.
fn open_main(app: &tauri::AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.show();
        let _ = w.unminimize();
        let _ = w.set_focus();
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // single-instance primeiro: um 2º launch (ex.: "abrir com" num .ics)
        // encaminha o caminho pra janela viva em vez de subir outra instância.
        .plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            if let Some(file) = argv.iter().skip(1).find(|a| Path::new(a).is_file()) {
                let _ = app.emit("open-file", file.clone());
            }
            open_main(app);
        }))
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        ))
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .manage(Db::default())
        .manage(Mutex::new(llm::LlmState::default()))
        .setup(|app| {
            // Abre o banco (app_data/agenda.db) e semeia o calendário padrão.
            let db = app.state::<Db>().inner().clone();
            if let Err(e) = db::open(app.handle(), &db) {
                eprintln!("[localagenda] falha ao abrir o banco: {e}");
                return Err(e.into());
            }

            // Bandeja: fechar a janela ESCONDE (o app segue vivo pra disparar os
            // lembretes); reabre pela bandeja; "Sair" encerra de verdade.
            let show = MenuItem::with_id(app, "show", "Abrir LocalAgenda", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "Sair", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show, &quit])?;
            let _tray = TrayIconBuilder::with_id("main")
                .icon(app.default_window_icon().unwrap().clone())
                .tooltip("LocalAgenda")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "show" => open_main(app),
                    "quit" => app.exit(0),
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        open_main(tray.app_handle());
                    }
                })
                .build(app)?;

            // Fechar → bandeja (a menos que o usuário desligue em Configurações).
            if let Some(win) = app.get_webview_window("main") {
                let w = win.clone();
                let handle = app.handle().clone();
                win.on_window_event(move |event| {
                    if let WindowEvent::CloseRequested { api, .. } = event {
                        let to_tray = handle
                            .try_state::<Db>()
                            .map(|db| db::setting_bool(&db, "closeToTray", true))
                            .unwrap_or(true);
                        if to_tray {
                            api.prevent_close();
                            let _ = w.hide();
                        }
                        // to_tray=false: deixa fechar de verdade (o RunEvent::Exit
                        // abaixo mata o llama-server).
                    }
                });
            }

            // Tick de lembretes: a cada 30s, dispara o que venceu. Barato — só um
            // SELECT indexado. Funciona minimizado na bandeja (o processo vive).
            let tick_handle = app.handle().clone();
            let tick_db = db.clone();
            std::thread::spawn(move || loop {
                std::thread::sleep(Duration::from_secs(30));
                dispatch_due(&tick_handle, &tick_db);
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_startup_file,
            read_file_base64,
            write_file_base64,
            write_text_file,
            autostart_get,
            autostart_set,
            reminders_dispatch,
            db::calendars_list,
            db::calendar_save,
            db::calendar_delete,
            db::events_list,
            db::event_save,
            db::event_delete,
            db::tasks_list,
            db::task_save,
            db::task_delete,
            db::reminders_replace,
            db::reminder_snooze,
            db::settings_get,
            db::settings_set,
            db::db_export,
            db::db_import,
            llm::list_models,
            llm::start_llm,
            llm::stop_llm,
            llm::llm_status
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app_handle, event| {
            // Garante que o llama-server morre quando o app sai.
            if let tauri::RunEvent::Exit = event {
                if let Some(state) = app_handle.try_state::<Mutex<llm::LlmState>>() {
                    if let Ok(mut s) = state.lock() {
                        if let Some(child) = s.child.as_mut() {
                            let _ = child.kill();
                        }
                    }
                }
            }
        });
}
