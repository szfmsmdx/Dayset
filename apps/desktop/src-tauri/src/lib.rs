use std::time::Duration;

use serde::Deserialize;
use sqlx::{
    SqlitePool,
    sqlite::{SqliteConnectOptions, SqlitePoolOptions},
};
use tauri::{
    Manager,
    menu::{MenuBuilder, MenuItemBuilder},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
};
use tauri_plugin_notification::NotificationExt;
use tauri_plugin_sql::{Migration, MigrationKind};

mod reminders;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct TaskRecord {
    id: String,
    title: String,
    notes: String,
    due_date: Option<String>,
    due_time: Option<String>,
    time_zone: Option<String>,
    due_at: Option<i64>,
    reminder_minutes: Option<i64>,
    repeat_frequency: String,
    repeat_end_mode: String,
    repeat_end_date: Option<String>,
    repeat_count: Option<i64>,
    repeat_series_id: Option<String>,
    repeat_occurrence: i64,
    repeat_anchor_month: Option<i64>,
    repeat_anchor_day: Option<i64>,
    completed_at: Option<i64>,
    created_at: i64,
    updated_at: i64,
    deleted_at: Option<i64>,
    parent_task_id: Option<String>,
    tags: Vec<String>,
}

#[tauri::command]
async fn save_tasks_atomically(
    app: tauri::AppHandle,
    tasks: Vec<TaskRecord>,
) -> Result<(), String> {
    let database_path = app
        .path()
        .app_config_dir()
        .map_err(|error| error.to_string())?
        .join("dayset.db");
    let options = SqliteConnectOptions::new()
        .filename(database_path)
        .create_if_missing(false)
        .busy_timeout(Duration::from_secs(5));
    let pool: SqlitePool = SqlitePoolOptions::new()
        .max_connections(1)
        .connect_with(options)
        .await
        .map_err(|error| error.to_string())?;
    let mut transaction = pool.begin().await.map_err(|error| error.to_string())?;

    for task in tasks {
        sqlx::query(
            "INSERT INTO tasks (id, title, notes, due_date, due_time, time_zone, due_at, reminder_minutes,
                repeat_frequency, repeat_end_mode, repeat_end_date, repeat_count, repeat_series_id,
                repeat_occurrence, repeat_anchor_month, repeat_anchor_day,
                completed_at, created_at, updated_at, deleted_at, parent_task_id, tags)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22)
             ON CONFLICT(id) DO UPDATE SET
                title=excluded.title, notes=excluded.notes, due_date=excluded.due_date,
                due_time=excluded.due_time, time_zone=excluded.time_zone, due_at=excluded.due_at,
                reminder_minutes=excluded.reminder_minutes, repeat_frequency=excluded.repeat_frequency,
                repeat_end_mode=excluded.repeat_end_mode, repeat_end_date=excluded.repeat_end_date,
                repeat_count=excluded.repeat_count, repeat_series_id=excluded.repeat_series_id,
                repeat_occurrence=excluded.repeat_occurrence, repeat_anchor_month=excluded.repeat_anchor_month,
                repeat_anchor_day=excluded.repeat_anchor_day, completed_at=excluded.completed_at,
                updated_at=excluded.updated_at, deleted_at=excluded.deleted_at,
                parent_task_id=excluded.parent_task_id, tags=excluded.tags",
        )
        .bind(task.id)
        .bind(task.title)
        .bind(task.notes)
        .bind(task.due_date)
        .bind(task.due_time)
        .bind(task.time_zone)
        .bind(task.due_at)
        .bind(task.reminder_minutes)
        .bind(task.repeat_frequency)
        .bind(task.repeat_end_mode)
        .bind(task.repeat_end_date)
        .bind(task.repeat_count)
        .bind(task.repeat_series_id)
        .bind(task.repeat_occurrence)
        .bind(task.repeat_anchor_month)
        .bind(task.repeat_anchor_day)
        .bind(task.completed_at)
        .bind(task.created_at)
        .bind(task.updated_at)
        .bind(task.deleted_at)
        .bind(task.parent_task_id)
        .bind(serde_json::to_string(&task.tags).map_err(|error| error.to_string())?)
        .execute(&mut *transaction)
        .await
        .map_err(|error| error.to_string())?;
    }

    transaction
        .commit()
        .await
        .map_err(|error| error.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let migrations = vec![
        Migration {
            version: 1,
            description: "create_tasks",
            sql: include_str!("../migrations/0001_create_tasks.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 2,
            description: "track_sent_reminders",
            sql: include_str!("../migrations/0002_track_sent_reminders.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 3,
            description: "add_task_recurrence",
            sql: include_str!("../migrations/0003_task_recurrence.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 4,
            description: "add_subtasks_and_tags",
            sql: include_str!("../migrations/0004_subtasks_and_tags.sql"),
            kind: MigrationKind::Up,
        },
    ];
    let start_hidden = std::env::args().any(|arg| arg == "--start-hidden");
    let builder = tauri::Builder::default();
    #[cfg(desktop)]
    let builder = builder.plugin(tauri_plugin_single_instance::init(|app, _, _| {
        show_main_window(app);
    }));
    #[cfg(desktop)]
    let builder = builder.plugin(
        tauri_plugin_autostart::Builder::new()
            .args(["--start-hidden"])
            .build(),
    );

    builder
        .invoke_handler(tauri::generate_handler![
            save_tasks_atomically,
            notification_status,
            send_test_notification,
        ])
        .plugin(tauri_plugin_notification::init())
        .plugin(
            tauri_plugin_sql::Builder::default()
                .add_migrations("sqlite:dayset.db", migrations)
                .build(),
        )
        .setup(move |app| {
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
            let tray_icon =
                tauri::image::Image::from_bytes(include_bytes!("../icons/128x128.png"))?;
            if let Some(window) = app.get_webview_window("main") {
                let window_icon =
                    tauri::image::Image::from_bytes(include_bytes!("../icons/32x32.png"))?;
                window.set_icon(window_icon)?;
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

            reminders::start(
                app.handle().clone(),
                app.path().app_config_dir()?.join("dayset.db"),
            );
            if !start_hidden {
                show_main_window(app.handle());
            }

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

#[tauri::command]
fn notification_status(app: tauri::AppHandle) -> Result<bool, String> {
    app.notification()
        .permission_state()
        .map(|state| matches!(state, tauri::plugin::PermissionState::Granted))
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn send_test_notification(app: tauri::AppHandle) -> Result<(), String> {
    app.notification()
        .builder()
        .title("Dayset 测试提醒")
        .body("测试提醒已发送。若未显示，请检查 Windows 通知设置。")
        .show()
        .map_err(|error| error.to_string())
}

fn show_main_window(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}
