use std::{
    path::PathBuf,
    time::{Duration, SystemTime, UNIX_EPOCH},
};

use sqlx::{
    Row, SqlitePool,
    sqlite::{SqliteConnectOptions, SqlitePoolOptions},
};
use tauri::AppHandle;
use tauri_plugin_notification::NotificationExt;

const SCAN_INTERVAL: Duration = Duration::from_secs(5);
const CATCH_UP_WINDOW_MS: i64 = 24 * 60 * 60 * 1000;

struct DueReminder {
    id: String,
    title: String,
    scheduled_at: i64,
}

pub fn start(app: AppHandle, database_path: PathBuf) {
    tauri::async_runtime::spawn(async move {
        let options = SqliteConnectOptions::new()
            .filename(database_path)
            .create_if_missing(false)
            .busy_timeout(Duration::from_secs(5));
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect_lazy_with(options);
        let mut ticker = tokio::time::interval(SCAN_INTERVAL);
        ticker.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);

        loop {
            ticker.tick().await;
            let now = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .map(|duration| duration.as_millis() as i64)
                .unwrap_or_default();

            let due = match due_reminders(&pool, now).await {
                Ok(due) => due,
                Err(error) => {
                    log::warn!("Could not check Dayset reminders: {error}");
                    continue;
                }
            };

            for reminder in due {
                match claim_reminder(&pool, &reminder).await {
                    Ok(true) => {}
                    Ok(false) => continue,
                    Err(error) => {
                        log::warn!("Could not claim Dayset reminder: {error}");
                        continue;
                    }
                }

                if let Err(error) = app
                    .notification()
                    .builder()
                    .title("Dayset 提醒")
                    .body(&reminder.title)
                    .show()
                {
                    log::warn!("Could not show Dayset notification: {error}");
                    if let Err(reset_error) = reset_claim(&pool, &reminder).await {
                        log::warn!("Could not reset Dayset reminder: {reset_error}");
                    }
                }
            }
        }
    });
}

async fn due_reminders(pool: &SqlitePool, now: i64) -> Result<Vec<DueReminder>, sqlx::Error> {
    let rows = sqlx::query(
        "SELECT id, title, due_at - reminder_minutes * 60000 AS scheduled_at
         FROM tasks
         WHERE due_at IS NOT NULL AND reminder_minutes IS NOT NULL
           AND completed_at IS NULL AND deleted_at IS NULL
           AND due_at - reminder_minutes * 60000 BETWEEN ? AND ?
           AND (reminded_for IS NULL OR reminded_for != due_at - reminder_minutes * 60000)
         ORDER BY scheduled_at ASC LIMIT 20",
    )
    .bind(now - CATCH_UP_WINDOW_MS)
    .bind(now)
    .fetch_all(pool)
    .await?;

    rows.into_iter()
        .map(|row| {
            Ok(DueReminder {
                id: row.try_get("id")?,
                title: row.try_get("title")?,
                scheduled_at: row.try_get("scheduled_at")?,
            })
        })
        .collect()
}

async fn claim_reminder(pool: &SqlitePool, reminder: &DueReminder) -> Result<bool, sqlx::Error> {
    let result = sqlx::query(
        "UPDATE tasks SET reminded_for = ?
         WHERE id = ? AND completed_at IS NULL AND deleted_at IS NULL
           AND due_at IS NOT NULL AND reminder_minutes IS NOT NULL
           AND due_at - reminder_minutes * 60000 = ?
           AND (reminded_for IS NULL OR reminded_for != ?)",
    )
    .bind(reminder.scheduled_at)
    .bind(&reminder.id)
    .bind(reminder.scheduled_at)
    .bind(reminder.scheduled_at)
    .execute(pool)
    .await?;

    Ok(result.rows_affected() == 1)
}

async fn reset_claim(pool: &SqlitePool, reminder: &DueReminder) -> Result<(), sqlx::Error> {
    sqlx::query("UPDATE tasks SET reminded_for = NULL WHERE id = ? AND reminded_for = ?")
        .bind(&reminder.id)
        .bind(reminder.scheduled_at)
        .execute(pool)
        .await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn due_tasks_are_selected_once_and_rescheduling_makes_them_eligible_again() {
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();
        sqlx::query(
            "CREATE TABLE tasks (
                id TEXT PRIMARY KEY, title TEXT NOT NULL, due_at INTEGER,
                reminder_minutes INTEGER, completed_at INTEGER, deleted_at INTEGER,
                reminded_for INTEGER
            )",
        )
        .execute(&pool)
        .await
        .unwrap();

        let now = 1_700_000_000_000_i64;
        for (id, due_at, completed_at, deleted_at, reminded_for) in [
            ("due", now - 1_000, None, None, None),
            ("future", now + 60_000, None, None, None),
            ("old", now - CATCH_UP_WINDOW_MS - 1, None, None, None),
            ("done", now - 1_000, Some(now - 500), None, None),
            ("deleted", now - 1_000, None, Some(now - 500), None),
            ("sent", now - 1_000, None, None, Some(now - 1_000)),
        ] {
            sqlx::query(
                "INSERT INTO tasks (id, title, due_at, reminder_minutes, completed_at, deleted_at, reminded_for)
                 VALUES (?, ?, ?, 0, ?, ?, ?)",
            )
            .bind(id)
            .bind(id)
            .bind(due_at)
            .bind(completed_at)
            .bind(deleted_at)
            .bind(reminded_for)
            .execute(&pool)
            .await
            .unwrap();
        }

        let due = due_reminders(&pool, now).await.unwrap();
        assert_eq!(
            due.iter().map(|task| task.id.as_str()).collect::<Vec<_>>(),
            ["due"]
        );
        assert!(claim_reminder(&pool, &due[0]).await.unwrap());
        assert!(due_reminders(&pool, now).await.unwrap().is_empty());

        sqlx::query("UPDATE tasks SET due_at = ? WHERE id = 'due'")
            .bind(now + 1_000)
            .execute(&pool)
            .await
            .unwrap();
        let rescheduled = due_reminders(&pool, now + 1_000).await.unwrap();
        assert_eq!(rescheduled.len(), 1);
        assert_eq!(rescheduled[0].id, "due");
    }
}
