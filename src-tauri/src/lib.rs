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
//
// A intenção do usuário mora no banco (`settings.autostart`), NÃO no registro do
// Windows. O registro é só o efeito — e um efeito que se perde sozinho: o
// `is_enabled()` do plugin só checa se a entrada em `...\CurrentVersion\Run`
// EXISTE, nunca se ela aponta pro exe atual. Resultado: se a entrada some (um
// instalador/limpador que a apague) ou envelhece (o caminho do exe muda e ela
// segue apontando pro lugar antigo), o app parava de subir no logon enquanto a
// checkbox continuava marcada — que é exatamente o sintoma relatado.
//
// Com a intenção no banco, `reconcile_autostart` (no setup) reimpõe o registro a
// cada boot, então o estado se conserta sozinho.

/// Estado desejado pelo usuário. `None` = nunca decidiu (instalação antiga):
/// herda o que já está no SO pra não ligar/desligar nada por conta própria.
fn autostart_intent(app: &tauri::AppHandle, db: &Db) -> bool {
    db::setting_bool_opt(db, "autostart")
        .unwrap_or_else(|| app.autolaunch().is_enabled().unwrap_or(false))
}

/// O que o SO tem hoje, do ponto de vista de "precisa consertar?".
#[derive(Debug, PartialEq)]
enum OsAutostart {
    /// Entrada presente e apontando pro exe atual — nada a fazer.
    Ok,
    /// Ausente ou apontando pro caminho errado (instalação antiga/movida) —
    /// é o caso a reimpor.
    Broken,
    /// O usuário desligou pelo Gerenciador de Tarefas do Windows. É uma escolha
    /// explícita dele, na UI oficial do SO: obedecemos e desmarcamos a checkbox.
    UserDisabled,
}

/// Espelha o formato que o `auto-launch` grava: `"<exe> <args>"`, sem aspas.
#[cfg(windows)]
fn os_autostart(app: &tauri::AppHandle) -> OsAutostart {
    use winreg::enums::{HKEY_CURRENT_USER, KEY_READ};
    use winreg::RegKey;

    const RUN: &str = r"SOFTWARE\Microsoft\Windows\CurrentVersion\Run";
    const APPROVED: &str =
        r"SOFTWARE\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run";

    let name = &app.package_info().name;
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);

    // Override do Gerenciador de Tarefas: 12 bytes = flag (DWORD) + FILETIME de
    // quando foi desligado. No flag, o bit 0 ligado = desabilitado (2/6 ligado,
    // 3/7 desligado); quando habilitado, o timestamp fica zerado. Checamos os
    // dois: o auto-launch só olha o timestamp, o que não enxerga um flag
    // desligado com timestamp zerado.
    let approved_off = hkcu
        .open_subkey_with_flags(APPROVED, KEY_READ)
        .ok()
        .and_then(|k| k.get_raw_value(name).ok())
        .map(|v| {
            let b = &v.bytes;
            let flag_off = b.first().map(|f| f & 1 != 0).unwrap_or(false);
            let stamped_off = b.len() >= 12 && !b[4..12].iter().all(|x| *x == 0);
            flag_off || stamped_off
        })
        .unwrap_or(false);
    if approved_off {
        return OsAutostart::UserDisabled;
    }

    let current = std::env::current_exe()
        .map(|p| p.display().to_string())
        .unwrap_or_default();
    let expected = format!("{current} --hidden");

    match hkcu
        .open_subkey_with_flags(RUN, KEY_READ)
        .ok()
        .and_then(|k| k.get_value::<String, _>(name).ok())
    {
        Some(v) if v.trim().eq_ignore_ascii_case(expected.trim()) => OsAutostart::Ok,
        _ => OsAutostart::Broken,
    }
}

/// Fora do Windows não há registro pra envelhecer: o `is_enabled()` basta.
#[cfg(not(windows))]
fn os_autostart(app: &tauri::AppHandle) -> OsAutostart {
    if app.autolaunch().is_enabled().unwrap_or(false) {
        OsAutostart::Ok
    } else {
        OsAutostart::Broken
    }
}

/// Alinha o SO com a intenção guardada, a cada boot. É isso que conserta a
/// entrada apagada por um instalador ou apontando pro caminho antigo — sem isso
/// o app simplesmente parava de subir no logon, calado, com a checkbox marcada.
fn reconcile_autostart(app: &tauri::AppHandle, db: &Db) {
    let mut want = autostart_intent(app, db);
    let state = os_autostart(app);

    // O Gerenciador de Tarefas vence a checkbox: o usuário mandou desligar por
    // lá, então a intenção passa a ser essa (senão reimporíamos todo boot,
    // brigando com ele).
    if want && state == OsAutostart::UserDisabled {
        want = false;
    }
    let _ = db::set_setting_bool(db, "autostart", want);

    let mgr = app.autolaunch();
    let res = match (want, &state) {
        (true, OsAutostart::Broken) => mgr.enable(),
        (false, OsAutostart::Ok) => mgr.disable(),
        _ => Ok(()),
    };
    if let Err(e) = res {
        eprintln!("[localagenda] falha ao reconciliar o autostart (want={want}, so={state:?}): {e}");
    }
}

#[tauri::command(async)]
fn autostart_get(app: tauri::AppHandle, db: State<'_, Db>) -> Result<bool, String> {
    Ok(autostart_intent(&app, &db))
}

#[tauri::command(async)]
fn autostart_set(app: tauri::AppHandle, db: State<'_, Db>, enabled: bool) -> Result<(), String> {
    // A intenção primeiro: se o registro falhar, o reconcile do próximo boot
    // ainda tenta de novo em vez de esquecer o que o usuário pediu.
    db::set_setting_bool(&db, "autostart", enabled)?;
    let mgr = app.autolaunch();
    if enabled {
        let _ = mgr.disable();
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
    if !due.is_empty() {
        // O tick gravou fired=1 no banco: reflete no arquivo de sync na hora
        // (senão o Android re-notificaria o que já disparou). Best-effort —
        // falha aqui não derruba o disparo.
        if let Err(e) = db::autosave(app, db) {
            eprintln!("[localagenda] autosave pós-disparo falhou: {e}");
        }
    }
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

/// Notificação de desktop avulsa (fim de timer, etc.) — o toast e o som ficam no
/// front; isto garante o aviso do SO mesmo com a janela na bandeja.
#[tauri::command(async)]
fn notify(app: tauri::AppHandle, title: String, body: String) {
    let _ = app.notification().builder().title(title).body(body).show();
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
    // ── Contorno da tela branca do webkit: REMOVIDO, e o porquê importa ──────
    //
    // Este bloco desligava o renderer DMABUF, desligava o compositing e forçava
    // XWayland, porque o webkit2gtk pintava a janela inteira de branco em
    // Arch/GNOME. Era mitigação às cegas — o comentário dizia "branco é pior que
    // lento" — e custava a aceleração do WebView.
    //
    // A CAUSA foi encontrada em 26/07/2026 e é de EMPACOTAMENTO, não de código:
    // o AppDir do AppImage levava `libwayland-*` do Ubuntu do CI, que brigavam
    // com o Mesa do host e derrubavam o EGL (`EGL_BAD_PARAMETER`). Corrigido em
    // `Anon5T4R/linux-packaging`: as libs que falam com driver/compositor agora
    // vêm do host, e o pacote nativo (pacman/apt) usa o webkit do sistema.
    // Tratar o sintoma deixou de fazer sentido.
    //
    // Remover o forçamento NÃO tira a saída de emergência: estas variáveis são
    // lidas pelo próprio webkitgtk, não por este código. Se a tela branca voltar
    // em alguma combinação de driver, rodar com
    // `WEBKIT_DISABLE_DMABUF_RENDERER=1` continua funcionando — e aí é sinal de
    // que sobrou lib de host em algum AppDir, que é onde se deve olhar.

    tauri::Builder::default()
        // single-instance primeiro: um 2º launch (ex.: "abrir com" num .ics)
        // encaminha o caminho pra janela viva em vez de subir outra instância.
        .plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            if let Some(file) = argv.iter().skip(1).find(|a| Path::new(a).is_file()) {
                let _ = app.emit("open-file", file.clone());
            }
            // Um 2º launch com "--hidden" é o logon batendo num app que já está
            // vivo: não estoura a janela na cara do usuário (só "abrir com" um
            // arquivo ou um clique no atalho é que trazem a janela pra frente).
            if !argv.iter().any(|a| a == "--hidden") {
                open_main(app);
            }
        }))
        // Autostart: quando ligado, o app entra no logon com "--hidden" pra abrir
        // direto na bandeja (segundo plano), sem estourar a janela — os lembretes
        // rodam sozinhos.
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            Some(vec!["--hidden"]),
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

            // Reimpõe o autostart conforme a intenção guardada (conserta entrada
            // apagada ou apontando pro caminho antigo). Fora da thread principal:
            // mexe no registro e não deve segurar a abertura da janela.
            let auto_handle = app.handle().clone();
            let auto_db = db.clone();
            std::thread::spawn(move || reconcile_autostart(&auto_handle, &auto_db));

            // Início no logon com "--hidden": esconde a janela e fica só na
            // bandeja (o app roda em segundo plano disparando os lembretes).
            if std::env::args().any(|a| a == "--hidden") {
                if let Some(win) = app.get_webview_window("main") {
                    let _ = win.hide();
                }
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
            notify,
            db::alarms_list,
            db::alarm_save,
            db::alarm_delete,
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
            db::sync_path_get,
            db::sync_path_set,
            db::sync_now,
            db::sync_external_changed,
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
            // Save de saída: garante que a última alteração chega no sync_path
            // mesmo sem os 2s de debounce (fechou logo depois de editar).
            if let tauri::RunEvent::Exit = event {
                if let Some(state) = app_handle.try_state::<Db>() {
                    if let Err(e) = db::autosave(app_handle, &state) {
                        eprintln!("[localagenda] autosave de saída falhou: {e}");
                    }
                }
                // Garante que o llama-server morre quando o app sai.
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
