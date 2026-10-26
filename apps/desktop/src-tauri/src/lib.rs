use tauri::{
    Manager,
    menu::{MenuBuilder, MenuItemBuilder},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
};
use tauri_plugin_sql::{Migration, MigrationKind};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let migrations = vec![Migration {
        version: 1,
        description: "create_tasks",
        sql: include_str!("../migrations/0001_create_tasks.sql"),
        kind: MigrationKind::Up,
    }];
    let builder = tauri::Builder::default();
    #[cfg(desktop)]
    let builder = builder.plugin(tauri_plugin_single_instance::init(|app, _, _| {
        show_main_window(app);
    }));

    builder
        .plugin(
            tauri_plugin_sql::Builder::default()
                .add_migrations("sqlite:dayset.db", migrations)
                .build(),
        )
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }

            let show = MenuItemBuilder::with_id("show", "显示 Dayset").build(app)?;
            let quit = MenuItemBuilder::with_id("quit", "退出 Dayset").build(app)?;
            let menu = MenuBuilder::new(app).items(&[&show, &quit]).build()?;
            let tray_icon = tauri::image::Image::from_bytes(include_bytes!("../icons/128x128.png"))?;
            if let Some(window) = app.get_webview_window("main") {
                window.set_icon(tray_icon.clone())?;
            }

            TrayIconBuilder::new()
                .icon(tray_icon)
                .tooltip("Dayset")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id().as_ref() {
                    "show" => show_main_window(app),
                    "quit" => app.exit(0),
                    _ => (),
                })
                .on_tray_icon_event(|tray, event| {
                    if matches!(
                        event,
                        TrayIconEvent::Click {
                            button: MouseButton::Left,
                            button_state: MouseButtonState::Up,
                            ..
                        }
                    ) {
                        show_main_window(tray.app_handle());
                    }
                })
                .build(app)?;

            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event
                && window.label() == "main"
            {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .run(tauri::generate_context!())
        .expect("error while building tauri application");
}

fn show_main_window(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}
