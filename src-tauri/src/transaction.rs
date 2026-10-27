use serde::{Deserialize, Serialize};
use serde_json::Value;
use sqlx::SqlitePool;
use tauri::AppHandle;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SqlStatement {
    statement: String,
    #[serde(default)]
    bind_values: Vec<Value>,
    #[serde(default)]
    require_affected_rows: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SqlResult {
    rows_affected: u64,
    last_insert_id: i64,
}

#[tauri::command]
pub async fn execute_transaction(
    app: AppHandle,
    statements: Vec<SqlStatement>,
) -> Result<Option<Vec<SqlResult>>, String> {
    let pool = crate::backup::pool(&app).await?;
    execute_on_pool(&pool, statements).await
}

async fn execute_on_pool(
    pool: &SqlitePool,
    statements: Vec<SqlStatement>,
) -> Result<Option<Vec<SqlResult>>, String> {
    let mut conn = pool.acquire().await.map_err(|error| error.to_string())?;
    sqlx::query("BEGIN IMMEDIATE")
        .execute(&mut *conn)
        .await
        .map_err(|error| error.to_string())?;

    let outcome: Result<Option<Vec<SqlResult>>, String> = async {
        let mut results = Vec::with_capacity(statements.len());
        for statement in statements {
            let mut query = sqlx::query(&statement.statement);
            // Match the SQL plugin's SQLite binding rules for frontend values.
            for value in statement.bind_values {
                query = if value.is_null() {
                    query.bind(None::<Value>)
                } else if let Some(text) = value.as_str() {
                    query.bind(text.to_owned())
                } else if let Some(number) = value.as_f64() {
                    query.bind(number)
                } else {
                    query.bind(value)
                };
            }
            let result = query.execute(&mut *conn).await.map_err(|error| error.to_string())?;
            if statement.require_affected_rows && result.rows_affected() == 0 {
                return Ok(None);
            }
            results.push(SqlResult {
                rows_affected: result.rows_affected(),
                last_insert_id: result.last_insert_rowid(),
            });
        }
        Ok(Some(results))
    }
    .await;

    if outcome.as_ref().is_ok_and(Option::is_some) {
        if let Err(error) = sqlx::query("COMMIT").execute(&mut *conn).await {
            sqlx::query("ROLLBACK")
                .execute(&mut *conn)
                .await
                .map_err(|rollback| format!("{error}; rollback failed: {rollback}"))?;
            return Err(error.to_string());
        }
    } else {
        sqlx::query("ROLLBACK")
            .execute(&mut *conn)
            .await
            .map_err(|error| match &outcome {
                Err(original) => format!("{original}; rollback failed: {error}"),
                _ => error.to_string(),
            })?;
    }
    outcome
}

#[cfg(test)]
mod tests {
    use super::*;
    use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};
    use sqlx::Executor;
    use std::fs;
    use std::time::{Duration, SystemTime, UNIX_EPOCH};

    fn statement(sql: &str, values: Vec<Value>, guarded: bool) -> SqlStatement {
        SqlStatement {
            statement: sql.into(),
            bind_values: values,
            require_affected_rows: guarded,
        }
    }

    #[test]
    fn batch_keeps_metric_and_domain_links_atomic_on_a_pool() {
        tauri::async_runtime::block_on(async {
            let stamp = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos();
            let dir = std::env::temp_dir().join(format!("lifeos-transaction-test-{}-{stamp}", std::process::id()));
            fs::create_dir(&dir).unwrap();
            let path = dir.join("isolated.db");
            let options = SqliteConnectOptions::new()
                .filename(&path)
                .create_if_missing(true)
                .foreign_keys(true)
                .busy_timeout(Duration::from_millis(100));
            let pool = SqlitePoolOptions::new().max_connections(2).connect_with(options).await.unwrap();
            pool.execute("CREATE TABLE life_domains (id TEXT PRIMARY KEY)").await.unwrap();
            pool.execute("CREATE TABLE metric_definitions (id TEXT PRIMARY KEY, name TEXT NOT NULL)").await.unwrap();
            pool.execute("CREATE TABLE metric_domain_links (metric_id TEXT NOT NULL REFERENCES metric_definitions(id), domain_id TEXT NOT NULL REFERENCES life_domains(id), PRIMARY KEY (metric_id, domain_id))").await.unwrap();
            pool.execute("INSERT INTO life_domains (id) VALUES ('health')").await.unwrap();

            // A separate pooled connection cannot write while the first owns BEGIN IMMEDIATE.
            let mut held = pool.acquire().await.unwrap();
            sqlx::query("BEGIN IMMEDIATE").execute(&mut *held).await.unwrap();
            assert!(pool.execute("INSERT INTO metric_definitions VALUES ('split', 'sleep')").await.is_err());
            sqlx::query("ROLLBACK").execute(&mut *held).await.unwrap();
            drop(held);

            let create = |id: &str, domain: &str| vec![
                statement("INSERT INTO metric_definitions (id, name) VALUES (?, ?)", vec![id.into(), "sleep".into()], false),
                statement("INSERT INTO metric_domain_links (metric_id, domain_id) VALUES (?, ?)", vec![id.into(), domain.into()], false),
            ];
            let result = execute_on_pool(&pool, create("sleep", "health")).await.unwrap().unwrap();
            assert_eq!(result.iter().map(|item| item.rows_affected).collect::<Vec<_>>(), vec![1, 1]);
            assert!(execute_on_pool(&pool, create("invalid", "missing")).await.is_err());
            let definitions: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM metric_definitions")
                .fetch_one(&pool).await.unwrap();
            assert_eq!(definitions, 1);
            let links: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM metric_domain_links")
                .fetch_one(&pool).await.unwrap();
            assert_eq!(links, 1);

            let missing = execute_on_pool(&pool, vec![
                statement("UPDATE metric_definitions SET name = ? WHERE id = ?", vec!["changed".into(), "missing".into()], true),
                statement("DELETE FROM metric_domain_links WHERE metric_id = ?", vec!["sleep".into()], false),
            ]).await.unwrap();
            assert!(missing.is_none());
            let links: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM metric_domain_links")
                .fetch_one(&pool).await.unwrap();
            assert_eq!(links, 1);

            assert!(execute_on_pool(&pool, vec![
                statement("CREATE TABLE pending_migration (id INTEGER PRIMARY KEY)", vec![], false),
                statement("INSERT INTO missing_migration_table (id) VALUES (1)", vec![], false),
            ]).await.is_err());
            let pending_tables: i64 = sqlx::query_scalar(
                "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = 'pending_migration'"
            ).fetch_one(&pool).await.unwrap();
            assert_eq!(pending_tables, 0);

            pool.close().await;
            fs::remove_file(path).unwrap();
            fs::remove_dir(dir).unwrap();
        });
    }
}
