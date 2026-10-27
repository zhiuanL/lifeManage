use serde_json::{json, Map, Value};
use sqlx::{Column, Row, SqlitePool, TypeInfo, ValueRef};
use std::collections::{HashMap, HashSet};
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Manager};
use tauri_plugin_sql::{DbInstances, DbPool};

#[path = "review_backup.rs"]
mod review_backup;
#[path = "identity_role_backup.rs"]
mod identity_role_backup;
#[path = "domain_template_backup.rs"]
mod domain_template_backup;
#[path = "domain_history_backup.rs"]
mod domain_history_backup;
#[path = "person_dates_backup.rs"]
mod person_dates_backup;
#[path = "person_relationship_backup.rs"]
mod person_relationship_backup;
#[path = "domain_satisfaction_backup.rs"]
mod domain_satisfaction_backup;
#[path = "landscape_context_backup.rs"]
mod landscape_context_backup;

#[cfg(test)]
#[path = "backup_review_tests.rs"]
mod backup_review_tests;
#[cfg(test)]
#[path = "backup_identity_role_tests.rs"]
mod backup_identity_role_tests;
#[cfg(test)]
#[path = "backup_inbox_record_tests.rs"]
mod backup_inbox_record_tests;
#[cfg(test)]
#[path = "backup_domain_template_tests.rs"]
mod backup_domain_template_tests;
#[cfg(test)]
#[path = "backup_domain_history_tests.rs"]
mod backup_domain_history_tests;
#[cfg(test)]
#[path = "backup_person_dates_tests.rs"]
mod backup_person_dates_tests;
#[cfg(test)]
#[path = "backup_person_relationship_tests.rs"]
mod backup_person_relationship_tests;
#[cfg(test)]
#[path = "backup_domain_satisfaction_tests.rs"]
mod backup_domain_satisfaction_tests;
#[cfg(test)]
#[path = "backup_landscape_context_tests.rs"]
mod backup_landscape_context_tests;

const VERSION: &str = "0042-v1-action-history";
const REVIEW_OBJECT_VERSION: &str = "0044-v1-review-object-links";
const REVIEW_VERSION: &str = "0043-v1-review-structure";
const IDENTITY_ROLE_VERSION: &str = "0045-v1-identity-roles";
const INBOX_RECORD_VERSION: &str = "0046-v1-inbox-record-targets";
const DOMAIN_TEMPLATE_VERSION: &str = "0047-v1-domain-templates";
const DOMAIN_HISTORY_VERSION: &str = "0048-v1-domain-history";
const PERSON_DATES_VERSION: &str = "0049-v1-person-dates";
const PERSON_RELATIONSHIP_VERSION: &str = "0050-v1-person-relationship-history";
const DOMAIN_SATISFACTION_VERSION: &str = "0051-v1-domain-satisfaction";
const LANDSCAPE_CONTEXT_VERSION: &str = "0052-v1-landscape-context";
const IDENTITY_ROLE_TABLES: &[&str] = &[
    "identity_roles", "identity_role_domain_links", "identity_role_goal_links", "identity_role_versions",
];
const REVIEW_COLUMNS: &[&str] = &[
    "review_type", "period_start", "period_end", "review_status", "review_mode", "template_snapshot",
];
const GOAL_LIFECYCLE_COLUMNS: &[&str] = &["lifecycle_status", "status_reason", "archived_at"];
const DOMAIN_CONTEXT_COLUMNS: &[&str] = &["current_state", "long_term_expectation", "status"];
const PREVIOUS_TABLE_COUNT: usize = 18;
const HABIT_TABLE_COUNT: usize = 21;
const RECORD_TABLE_COUNT: usize = 27;
const DOMAIN_TABLE_COUNT: usize = 29;
const GOAL_LINK_TABLE_COUNT: usize = 30;
const ACTION_LINK_TABLE_COUNT: usize = 31;
const REVIEW_LINK_TABLE_COUNT: usize = 32;
// Every persisted application table except schema_migrations. The order respects ownership.
const TABLES: &[&str] = &[
    "app_metadata", "life_domains", "metric_definitions", "goals", "actions",
    "reviews", "issues", "decisions", "inbox_items", "metric_domain_links",
    "metric_records", "issue_domain_links", "decision_domain_links",
    "action_plan_changes", "action_completion_plans", "action_state_events",
    "object_versions", "templates", "habits", "habit_domain_links", "habit_logs",
    "people", "person_domain_links", "life_events", "event_domain_links",
    "skills", "skill_domain_links", "resource_needs", "system_assessments",
    "goal_domain_links",
    "action_domain_links",
    "review_domain_links",
    "goal_progress_items",
    "goal_habit_progress",
    "goal_relations", "life_navigation", "decision_navigation_links", "decision_person_links", "decision_resource_need_links",
];

pub(crate) async fn pool(app: &AppHandle) -> Result<SqlitePool, String> {
    let instances = app.state::<DbInstances>();
    let guard = instances.0.read().await;
    match guard.get("sqlite:lifeos.db") {
        Some(DbPool::Sqlite(pool)) => Ok(pool.clone()),
        _ => Err("本地数据库尚未就绪。".into()),
    }
}

fn schema_tables(version: u64) -> Vec<&'static str> {
    TABLES.iter().copied().chain((version >= 43).then_some("review_answers"))
        .chain((version >= 44).then_some("review_goal_links"))
        .chain((version >= 44).then_some("review_issue_links"))
        .chain(IDENTITY_ROLE_TABLES.iter().copied().filter(|_| version >= 45))
        .chain((version >= 48).then_some("life_domain_versions"))
        .chain((version >= 49).then_some("person_dates"))
        .chain((version >= 50).then_some("person_relationship_versions"))
        .chain((version >= 51).then_some("domain_satisfaction_links"))
        .chain((version >= 52).then_some("landscape_context")).collect()
}

async fn check_schema(conn: &mut sqlx::SqliteConnection) -> Result<u64, String> {
    let version: String =
        sqlx::query_scalar("SELECT version FROM schema_migrations ORDER BY version DESC LIMIT 1")
            .fetch_one(&mut *conn).await.map_err(|e| e.to_string())?;
    let version = match version.as_str() {
        VERSION => 42,
        REVIEW_VERSION => 43,
        REVIEW_OBJECT_VERSION => 44,
        IDENTITY_ROLE_VERSION => 45,
        INBOX_RECORD_VERSION => 46,
        DOMAIN_TEMPLATE_VERSION => 47,
        DOMAIN_HISTORY_VERSION => 48,
        PERSON_DATES_VERSION => 49,
        PERSON_RELATIONSHIP_VERSION => 50,
        DOMAIN_SATISFACTION_VERSION => 51,
        LANDSCAPE_CONTEXT_VERSION => 52,
        _ => return Err("数据库版本与备份功能不匹配。".into()),
    };
    let expected = schema_tables(version);
    let tables: Vec<String> = sqlx::query_scalar(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name != 'schema_migrations'"
    ).fetch_all(&mut *conn).await.map_err(|e| e.to_string())?;
    if tables.len() != expected.len() || tables.iter().any(|name| !expected.contains(&name.as_str())) {
        return Err("数据库包含备份清单之外的数据表，已停止操作。".into());
    }
    Ok(version)
}

async fn snapshot(conn: &mut sqlx::SqliteConnection) -> Result<Value, String> {
    let version = check_schema(conn).await?;
    let mut data = Map::new();
    for table in &schema_tables(version) {
        let query = format!("SELECT * FROM {table}");
        let records = sqlx::query(&query).fetch_all(&mut *conn).await.map_err(|e| e.to_string())?;
        let mut values = Vec::with_capacity(records.len());
        for row in records {
            let mut fields = Map::new();
            for (index, column) in row.columns().iter().enumerate() {
                let raw = row.try_get_raw(index).map_err(|e| e.to_string())?;
                let value = if raw.is_null() { Value::Null } else {
                    match raw.type_info().name() {
                        "INTEGER" => json!(row.try_get::<i64, _>(index).map_err(|e| e.to_string())?),
                        "REAL" => json!(row.try_get::<f64, _>(index).map_err(|e| e.to_string())?),
                        "TEXT" => json!(row.try_get::<String, _>(index).map_err(|e| e.to_string())?),
                        _ => return Err(format!("{table} 中存在不支持的二进制字段。")),
                    }
                };
                fields.insert(column.name().to_owned(), value);
            }
            values.push(Value::Object(fields));
        }
        data.insert((*table).to_owned(), Value::Array(values));
    }
    let exported_at: String = sqlx::query_scalar("SELECT strftime('%Y-%m-%dT%H:%M:%fZ', 'now')")
        .fetch_one(&mut *conn).await.map_err(|e| e.to_string())?;
    Ok(json!({
        "format": "lifeos-backup", "schemaVersion": version,
        "appVersion": env!("CARGO_PKG_VERSION"), "exportedAt": exported_at, "data": data,
    }))
}

#[tauri::command]
pub async fn create_backup(app: AppHandle) -> Result<Value, String> {
    let pool = pool(&app).await?;
    let mut conn = pool.acquire().await.map_err(|e| e.to_string())?;
    sqlx::query("BEGIN").execute(&mut *conn).await.map_err(|e| e.to_string())?;
    let result = snapshot(&mut conn).await;
    let ending = if result.is_ok() { "COMMIT" } else { "ROLLBACK" };
    sqlx::query(ending).execute(&mut *conn).await.map_err(|e| e.to_string())?;
    result
}

async fn columns(conn: &mut sqlx::SqliteConnection, table: &str) -> Result<Vec<String>, String> {
    let query = format!("PRAGMA table_info({table})");
    sqlx::query(&query).fetch_all(&mut *conn).await.map_err(|e| e.to_string())?
        .iter().map(|row| row.try_get::<String, _>("name").map_err(|e| e.to_string())).collect()
}

async fn backup_columns(
    conn: &mut sqlx::SqliteConnection, table: &str, version: u64,
) -> Result<Vec<String>, String> {
    let mut names = columns(conn, table).await?;
    if table == "reviews" && version < 43 {
        names.retain(|name| !REVIEW_COLUMNS.contains(&name.as_str()));
    }
    if table == "actions" && version < 41 { names.retain(|name| name != "details_json"); }
    if table == "resource_needs" && version < 40 {
        names.retain(|name| name != "privacy_level");
    }
    if table == "resource_needs" && version < 39 {
        names.retain(|name| name != "decision_id");
    }
    if table == "life_navigation" && version < 35 {
        names.retain(|name| name != "privacy_level");
    }
    if table == "life_domains" && version < 20 {
        names.retain(|name| !DOMAIN_CONTEXT_COLUMNS.contains(&name.as_str()));
    }
    if table == "goals" && version < 24 {
        names.retain(|name| name != "parent_id");
    }
    if table == "goals" && version < 26 {
        names.retain(|name| !GOAL_LIFECYCLE_COLUMNS.contains(&name.as_str()));
    }
    if table == "goals" && version < 27 {
        names.retain(|name| name != "progress_mode");
    }
    if matches!(table, "goals" | "actions") && version < 29 {
        names.retain(|name| name != "progress_weight");
    }
    if table == "goals" && version < 30 {
        names.retain(|name| name != "priority");
    }
    if table == "goals" && version < 33 {
        names.retain(|name| name != "horizon" && name != "direction_id");
    }
    Ok(names)
}

fn validate_action_details(json: &str) -> Result<(), String> {
    let value: Value = serde_json::from_str(json).map_err(|_| "行动反馈格式无效。")?;
    let fields = value.as_object().ok_or("行动反馈格式无效。")?;
    for (key, cell) in fields {
        if key == "actualMinutes" {
            if !cell.is_null() && cell.as_u64().map_or(true, |n| n > 9_007_199_254_740_991) {
                return Err("投入时间请填写零或正整数分钟。".into());
            }
        } else if !["actualResult", "learning", "problems", "incompleteReason", "nextAdjustment",
            "trigger", "execution", "fallback"].contains(&key.as_str()) {
            return Err("行动反馈包含未知字段。".into());
        } else if !cell.is_null() && cell.as_str().map_or(true, |text| text.trim().encode_utf16().count() > 2000) {
            return Err("行动反馈文字无效或过长。".into());
        }
    }
    Ok(())
}

fn validate_inbox_targets(data: &Value, version: u64) -> Result<(), String> {
    let items = data["inbox_items"].as_array().ok_or("收集箱记录缺失。")?;
    for row in items {
        let status = row["status"].as_str().ok_or("收集箱状态无效。")?;
        if matches!(status, "unprocessed" | "archived") {
            if !row["target_type"].is_null() || !row["target_id"].is_null() {
                return Err("收集箱状态与整理关联不一致。".into());
            }
            continue;
        }
        if !matches!(status, "processing" | "organized") {
            return Err("收集箱状态无效。".into());
        }
        let table = match row["target_type"].as_str() {
            Some("goal") => "goals",
            Some("action") => "actions",
            Some("review") => "reviews",
            Some("issue") => "issues",
            Some("decision") => "decisions",
            Some("event") if version >= 46 => "life_events",
            Some("person") if version >= 46 => "people",
            _ => return Err("收集箱指向了未知的记录类型。".into()),
        };
        let id = row["target_id"].as_str().filter(|id| !id.trim().is_empty())
            .ok_or("收集箱整理关联标识无效。")?;
        if status == "organized" && !data[table].as_array()
            .ok_or("收集箱目标数据表缺失。")?
            .iter().any(|target| target["id"].as_str() == Some(id)) {
            return Err("收集箱指向了备份中不存在的记录。".into());
        }
    }
    Ok(())
}

async fn validate_rows(conn: &mut sqlx::SqliteConnection, backup: &Value) -> Result<(), String> {
    if backup.get("format").and_then(Value::as_str) != Some("lifeos-backup") ||
        !matches!(backup.get("schemaVersion").and_then(Value::as_u64), Some(15 | 16 | 17 | 18 | 19 | 20 | 21 | 22 | 23 | 24 | 25 | 26 | 27 | 28 | 29 | 30 | 31 | 32 | 33 | 34 | 35 | 36 | 37 | 38 | 39 | 40 | 41 | 42 | 43 | 44 | 45 | 46 | 47 | 48 | 49 | 50 | 51 | 52)) {
        return Err("备份版本不受支持。".into());
    }
    let target_version = check_schema(conn).await?;
    if backup["schemaVersion"].as_u64().unwrap() >= 43 && backup["schemaVersion"].as_u64().unwrap() > target_version {
        return Err("当前数据库尚不支持此版本的备份，未更改当前数据。".into());
    }
    let data = backup.get("data").and_then(Value::as_object).ok_or("备份数据无效。")?;
    let supported = schema_tables(backup["schemaVersion"].as_u64().unwrap());
    if backup["schemaVersion"].as_u64().unwrap() >= 41 {
        for row in data["actions"].as_array().ok_or("行动记录缺失。")? {
            validate_action_details(row["details_json"].as_str().ok_or("行动反馈字段缺失。")?)?;
        }
    }
    let required = match backup["schemaVersion"].as_u64() {
        Some(43 | 44 | 45 | 46 | 47 | 48 | 49 | 50 | 51 | 52) => supported.as_slice(),
        Some(38 | 39 | 40 | 41 | 42) => TABLES,
        Some(37) => &TABLES[..38],
        Some(36) => &TABLES[..37],
        Some(32 | 33 | 34 | 35) => &TABLES[..36],
        Some(31) => &TABLES[..35],
        Some(28 | 29 | 30) => &TABLES[..34],
        Some(25 | 26 | 27) => &TABLES[..33],
        Some(23 | 24) => &TABLES[..REVIEW_LINK_TABLE_COUNT],
        Some(22) => &TABLES[..ACTION_LINK_TABLE_COUNT],
        Some(21) => &TABLES[..GOAL_LINK_TABLE_COUNT],
        Some(19 | 20) => &TABLES[..DOMAIN_TABLE_COUNT],
        Some(18) => &TABLES[..RECORD_TABLE_COUNT],
        Some(17) => &TABLES[..HABIT_TABLE_COUNT],
        _ => &TABLES[..PREVIOUS_TABLE_COUNT],
    };
    if data.len() != required.len() || data.keys().any(|key| !required.contains(&key.as_str())) {
        return Err("备份数据表不完整。".into());
    }
    // Validate all rows before deleting anything. SQLite constraints check values on insertion.
    for table in required {
        let expected = backup_columns(conn, table, backup["schemaVersion"].as_u64().unwrap()).await?;
        let items = data.get(*table).and_then(Value::as_array).ok_or("备份数据无效。")?;
        for item in items {
            let row = item.as_object().ok_or("备份行无效。")?;
            if row.len() != expected.len() || expected.iter().any(|key| !row.contains_key(key)) ||
                row.values().any(|value| !value.is_null() && !value.is_number() && !value.is_string()) {
                return Err(format!("{table} 的字段与数据库不一致。"));
            }
        }
    }
    if backup["schemaVersion"].as_u64().unwrap() >= 43 {
        review_backup::validate_review_data(&backup["data"])
            .map_err(|detail| format!("复盘备份结构校验未通过：{detail}"))?;
    }
    if backup["schemaVersion"].as_u64().unwrap() >= 44 {
        review_backup::validate_review_links(&backup["data"]).map_err(|detail| format!("复盘关联校验未通过：{detail}"))?;
    }
    if backup["schemaVersion"].as_u64().unwrap() >= 45 {
        identity_role_backup::validate_identity_role_data(conn, &backup["data"]).await?;
    }
    if backup["schemaVersion"].as_u64().unwrap() >= 48 {
        domain_history_backup::validate_domain_history_data(&backup["data"])?;
    }
    if backup["schemaVersion"].as_u64().unwrap() >= 49 {
        person_dates_backup::validate_person_dates_data(&backup["data"])?;
    }
    if backup["schemaVersion"].as_u64().unwrap() >= 50 {
        person_relationship_backup::validate_person_relationship_data(&backup["data"])?;
    }
    if backup["schemaVersion"].as_u64().unwrap() >= 51 {
        domain_satisfaction_backup::validate_domain_satisfaction_data(&backup["data"])?;
    }
    if backup["schemaVersion"].as_u64().unwrap() >= 52 {
        landscape_context_backup::validate_landscape_context_data(conn, &backup["data"]).await?;
    }
    validate_inbox_targets(&backup["data"], backup["schemaVersion"].as_u64().unwrap())?;
    domain_template_backup::validate_domain_templates(&backup["data"], backup["schemaVersion"].as_u64().unwrap())?;
    for row in data["object_versions"].as_array().ok_or("版本历史缺失。")? {
        let kind = row["object_type"].as_str();
        if !matches!(kind, Some("goal" | "review" | "issue" | "decision"))
            && !(kind == Some("action") && backup["schemaVersion"].as_u64().unwrap() >= 42)
            && !(kind == Some("navigation") && backup["schemaVersion"].as_u64().unwrap() >= 34) {
            return Err("对象版本历史包含未知类型。".into());
        }
        if kind == Some("action") {
            let old: Value = serde_json::from_str(row["snapshot_json"].as_str().ok_or("行动反馈快照无效。")?)
                .map_err(|_| "行动反馈快照无效。")?;
            if !old.is_object() || old["title"].as_str().map_or(true, |s| s.trim().is_empty() || s.encode_utf16().count() > 120)
                || !matches!(old["status"].as_str(), Some("open" | "completed"))
                || row["object_id"].as_str().map_or(true, str::is_empty)
                || old.get("scheduled_for").is_none() || old.get("completed_at").is_none() {
                return Err("行动反馈历史包含无效快照。".into());
            }
            validate_action_details(old["details_json"].as_str().ok_or("行动反馈历史字段缺失。")?)?;
            for date in [&old["created_at"], &old["updated_at"], &row["changed_at"]]
                .into_iter().chain((!old["completed_at"].is_null()).then_some(&old["completed_at"])) {
                let valid: i64 = sqlx::query_scalar("SELECT julianday(?) IS NOT NULL")
                    .bind(date.as_str().ok_or("行动反馈历史日期无效。")?)
                    .fetch_one(&mut *conn).await.map_err(|e| e.to_string())?;
                if valid == 0 { return Err("行动反馈历史日期无效。".into()); }
            }
            if !old["scheduled_for"].is_null() {
                let date = old["scheduled_for"].as_str().ok_or("行动反馈历史计划日期无效。")?;
                let valid: i64 = sqlx::query_scalar("SELECT date(?) = ? AND length(?) = 10")
                    .bind(date).bind(date).bind(date).fetch_one(&mut *conn).await.unwrap_or(0);
                if valid == 0 { return Err("行动反馈历史计划日期无效。".into()); }
            }
        }
        if kind == Some("navigation") {
            let snapshot: Value = serde_json::from_str(row["snapshot_json"].as_str()
                .ok_or("人生导航版本快照无效。")?).map_err(|_| "人生导航版本快照无效。")?;
            if !snapshot.is_object()
                || !matches!(snapshot["kind"].as_str(), Some("mission" | "value" | "vision" | "principle"))
                || snapshot["title"].as_str().map_or(true, |s| s.trim().is_empty() || s.chars().count() > 120)
                || snapshot["description"].as_str().map_or(true, |s| s.chars().count() > 6000)
                || row["object_id"].as_str().map_or(true, str::is_empty) {
                return Err("人生导航版本历史包含无效快照。".into());
            }
            for date in [&snapshot["created_at"], &snapshot["updated_at"], &row["changed_at"]]
                .into_iter().chain((!snapshot["archived_at"].is_null()).then_some(&snapshot["archived_at"])) {
                let valid: i64 = sqlx::query_scalar("SELECT julianday(?) IS NOT NULL")
                    .bind(date.as_str().ok_or("人生导航历史日期无效。")?)
                    .fetch_one(&mut *conn).await.map_err(|e| e.to_string())?;
                if valid == 0 { return Err("人生导航历史日期无效。".into()); }
            }
            if snapshot.get("archived_at").is_none() { return Err("人生导航历史归档字段缺失。".into()); }
        }
    }
    if backup["schemaVersion"].as_u64().unwrap() >= 40 {
        for row in data["resource_needs"].as_array().ok_or("资源需求缺失。")? {
            if !matches!(row["privacy_level"].as_str(), Some("normal" | "private" | "highly_sensitive")) {
                return Err("资源需求隐私级别无效。".into());
            }
        }
    }
    if backup["schemaVersion"].as_u64().unwrap() >= 32 {
        for row in data["life_navigation"].as_array().ok_or("人生导航缺失。")? {
            if backup["schemaVersion"].as_u64().unwrap() >= 35 &&
                !matches!(row["privacy_level"].as_str(), Some("normal" | "private" | "highly_sensitive")) {
                return Err("人生导航隐私级别无效。".into());
            }
            let title = row["title"].as_str().ok_or("人生导航标题无效。")?;
            if !matches!(row["kind"].as_str(), Some("mission" | "value" | "vision" | "principle"))
                || title.trim().is_empty() || title.chars().count() > 120
                || row["description"].as_str().map_or(true, |value| value.chars().count() > 6000) {
                return Err("人生导航包含无效字段。".into());
            }
            for key in ["created_at", "updated_at", "archived_at"] {
                if key == "archived_at" && row[key].is_null() { continue; }
                let value = row[key].as_str().ok_or("人生导航时间无效。")?;
                let valid: i64 = sqlx::query_scalar("SELECT julianday(?) IS NOT NULL")
                    .bind(value).fetch_one(&mut *conn).await.map_err(|e| e.to_string())?;
                if valid == 0 { return Err("人生导航时间无效。".into()); }
            }
        }
    }
    if backup["schemaVersion"].as_u64().unwrap() >= 33 {
        let directions = data["life_navigation"].as_array().ok_or("人生导航缺失。")?;
        for row in data["goals"].as_array().ok_or("目标记录缺失。")? {
            if !row["horizon"].is_null() && !matches!(row["horizon"].as_str(), Some("annual" | "quarter" | "stage" | "month")) {
                return Err("目标周期无效。".into());
            }
            if !row["direction_id"].is_null() && !directions.iter().any(|direction|
                direction["id"] == row["direction_id"] && direction["kind"].as_str() == Some("vision")) {
                return Err("长期方向关联无效。".into());
            }
        }
    }
    if backup["schemaVersion"].as_u64().unwrap() >= 30 {
        for row in data["goals"].as_array().ok_or("目标记录缺失。")? {
            if !matches!(row["priority"].as_str(), Some("high" | "medium" | "low")) {
                return Err("目标优先级无效。".into());
            }
        }
    }
    if backup["schemaVersion"].as_u64().unwrap() >= 29 {
        for table in ["goals", "actions"] {
            for row in data[table].as_array().ok_or("备份数据无效。")? {
                let weight = row["progress_weight"].as_f64().ok_or("贡献权重无效。")?;
                if !weight.is_finite() || weight <= 0.0 || weight > 100.0 {
                    return Err("贡献权重须大于 0 且不超过 100。".into());
                }
            }
        }
    }
    if backup["schemaVersion"].as_u64().unwrap() >= 21 {
        let links = data["goal_domain_links"].as_array().ok_or("目标领域关联缺失。")?;
        for goal in data["goals"].as_array().ok_or("目标记录缺失。")? {
            if let Some(domain_id) = goal["domain_id"].as_str() {
                if !links.iter().any(|link| link["goal_id"] == goal["id"] &&
                    link["domain_id"] == domain_id) {
                    return Err("目标的主领域缺少对应关联。".into());
                }
            }
        }
    }
    if backup["schemaVersion"].as_u64().unwrap() >= 22 {
        let links = data["action_domain_links"].as_array().ok_or("行动领域关联缺失。")?;
        for action in data["actions"].as_array().ok_or("行动记录缺失。")? {
            if let Some(domain_id) = action["domain_id"].as_str() {
                if !links.iter().any(|link| link["action_id"] == action["id"] &&
                    link["domain_id"] == domain_id) {
                    return Err("行动的主领域缺少对应关联。".into());
                }
            }
        }
    }
    if backup["schemaVersion"].as_u64().unwrap() >= 23 {
        let links = data["review_domain_links"].as_array().ok_or("复盘领域关联缺失。")?;
        for review in data["reviews"].as_array().ok_or("复盘记录缺失。")? {
            if let Some(domain_id) = review["domain_id"].as_str() {
                if !links.iter().any(|link| link["review_id"] == review["id"] &&
                    link["domain_id"] == domain_id) {
                    return Err("复盘的主领域缺少对应关联。".into());
                }
            }
        }
    }
    if backup["schemaVersion"].as_u64().unwrap() >= 24 {
        let goals = data["goals"].as_array().ok_or("目标记录缺失。")?;
        let parents: HashMap<&str, Option<&str>> = goals.iter().map(|goal| {
            (goal["id"].as_str().unwrap_or(""), goal["parent_id"].as_str())
        }).collect();
        for goal in goals {
            let mut visited = HashSet::new();
            let mut current = goal["id"].as_str().ok_or("目标标识无效。")?;
            loop {
                if !visited.insert(current) { return Err("上级目标不能形成循环关联。".into()); }
                let parent = parents.get(current).ok_or("上级目标不存在。")?;
                match parent {
                    Some(id) => current = id,
                    None => break,
                }
            }
        }
    }
    if backup["schemaVersion"].as_u64().unwrap() >= 27 {
        for goal in data["goals"].as_array().unwrap() {
            if !matches!(goal["progress_mode"].as_str(), Some("automatic" | "exploration" | "exploration_percent")) {
                return Err("目标进度方式无效。".into());
            }
        }
    }
    if backup["schemaVersion"].as_u64().unwrap() >= 26 {
        for goal in data["goals"].as_array().ok_or("目标记录缺失。")? {
            let status = goal["status"].as_str();
            let extension = &goal["lifecycle_status"];
            let reason = &goal["status_reason"];
            let valid_extension = extension.is_null() || match extension.as_str() {
                Some("candidate") => status == Some("active"),
                Some("abandoned") => status == Some("paused"),
                Some("archived") => matches!(status, Some("active" | "completed")),
                _ => false,
            };
            if !matches!(status, Some("active" | "paused" | "completed")) || !valid_extension ||
                (!reason.is_null() && reason.as_str().is_none_or(|s| s.trim().is_empty() || s.chars().count() > 600)) ||
                (extension == "abandoned" && reason.is_null()) ||
                (if extension == "archived" {
                    goal["archived_at"].as_str().is_none_or(|s| s.trim().is_empty())
                } else { !goal["archived_at"].is_null() }) {
                return Err("目标生命周期或状态原因无效。".into());
            }
        }
    }
    if backup["schemaVersion"].as_u64().unwrap() >= 25 {
        let goals: HashSet<&str> = data["goals"].as_array().ok_or("目标记录缺失。")?
            .iter().filter_map(|goal| goal["id"].as_str()).collect();
        let mut ids = HashSet::new();
        for item in data["goal_progress_items"].as_array().ok_or("进度项缺失。")? {
            let id = item["id"].as_str().ok_or("进度项标识无效。")?;
            if !ids.insert(id) || !goals.contains(item["goal_id"].as_str().unwrap_or("")) ||
                !matches!(item["kind"].as_str(), Some("key_result" | "milestone" | "outcome" | "exploration")) ||
                item["title"].as_str().is_none_or(|s| s.trim().is_empty() || s.chars().count() > 80) ||
                item["target_value"].as_f64().is_none_or(|v| !v.is_finite() || v <= 0.0 || v > 1e9) ||
                item["current_value"].as_f64().is_none_or(|v| !v.is_finite() || v < 0.0 || v > 1e9) ||
                item["weight"].as_f64().is_none_or(|v| !v.is_finite() || v <= 0.0 || v > 100.0) ||
                item["sort_order"].as_u64().is_none() {
                return Err("目标进度项无效或关联目标不存在。".into());
            }
        }
    }
    Ok(())
}

async fn validate_habit_settings(conn: &mut sqlx::SqliteConnection, backup: &Value) -> Result<(), String> {
    if backup["schemaVersion"].as_u64().unwrap_or(0) < 28 { return Ok(()); }
    let data = &backup["data"];
    let goals: HashMap<&str, &Value> = data["goals"].as_array().ok_or("目标缺失。")?
        .iter().filter_map(|row| row["id"].as_str().map(|id| (id, row))).collect();
    let habits: HashSet<&str> = data["habits"].as_array().ok_or("习惯缺失。")?
        .iter().filter_map(|row| row["id"].as_str()).collect();
    let mut pairs = HashSet::new();
    let mut counts: HashMap<&str, usize> = HashMap::new();
    for row in data["goal_habit_progress"].as_array().ok_or("习惯型配置缺失。")? {
        let goal = row["goal_id"].as_str().ok_or("目标关联无效。")?;
        let habit = row["habit_id"].as_str().ok_or("习惯关联无效。")?;
        let count = counts.entry(goal).or_default();
        *count += 1;
        if !habits.contains(habit) || !pairs.insert((goal, habit)) || *count > 30 ||
            goals.get(goal).and_then(|value| value["progress_mode"].as_str()) != Some("automatic") ||
            !row["weekly_target"].as_i64().is_some_and(|n| (1..=7).contains(&n)) ||
            !row["weight"].as_f64().is_some_and(|n| n.is_finite() && n > 0.0 && n <= 100.0) ||
            !row["sort_order"].as_i64().is_some_and(|n| n >= 0) {
            return Err("习惯型目标配置无效。".into());
        }
        for key in ["start_on", "end_on"] {
            let date = row[key].as_str().ok_or("统计日期无效。")?;
            let valid: i64 = sqlx::query_scalar(
                "SELECT length(?) = 10 AND ? GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]' AND date(?, '+0 days') IS ?")
                .bind(date).bind(date).bind(date).bind(date).fetch_one(&mut *conn)
                .await.map_err(|e| e.to_string())?;
            if valid != 1 { return Err("统计日期无效。".into()); }
        }
        if row["start_on"].as_str() > row["end_on"].as_str() { return Err("统计周期倒置。".into()); }
    }
    Ok(())
}

async fn restore_rows(conn: &mut sqlx::SqliteConnection, backup: &Value) -> Result<(), String> {
    validate_rows(conn, backup).await?;
    validate_habit_settings(conn, backup).await?;
    let data = backup.get("data").and_then(Value::as_object).ok_or("备份数据无效。")?;
    let target_tables = schema_tables(check_schema(conn).await?);
    for table in target_tables.iter().rev() {
        sqlx::query(&format!("DELETE FROM {table}")).execute(&mut *conn)
            .await.map_err(|e| format!("清理 {table} 失败：{e}"))?;
    }
    // Preserve historical integer IDs; action insert triggers create temporary state records.
    sqlx::query("DELETE FROM sqlite_sequence WHERE name IN ('action_plan_changes', 'action_state_events', 'object_versions', 'life_domain_versions', 'person_relationship_versions')")
        .execute(&mut *conn).await.map_err(|e| e.to_string())?;
    for table in &target_tables {
        if *table == "action_plan_changes" {
            for generated in ["action_plan_changes", "action_state_events", "action_completion_plans"] {
                sqlx::query(&format!("DELETE FROM {generated}")).execute(&mut *conn)
                    .await.map_err(|e| e.to_string())?;
            }
            sqlx::query("DELETE FROM sqlite_sequence WHERE name IN ('action_plan_changes', 'action_state_events')")
                .execute(&mut *conn).await.map_err(|e| e.to_string())?;
        }
        let names = backup_columns(conn, table, backup["schemaVersion"].as_u64().unwrap()).await?;
        let sql = format!("INSERT INTO {table} ({}) VALUES ({})",
            names.join(", "), vec!["?"; names.len()].join(", "));
        // Older backups omit later tables; they remain empty after replacement.
        let items = data.get(*table).and_then(Value::as_array);
        for item in items.into_iter().flatten() {
            let record = item.as_object().ok_or("备份行无效。")?;
            let mut query = sqlx::query(&sql);
            for name in &names {
                let value = record.get(name).ok_or("备份字段缺失。")?;
                query = if value.is_null() { query.bind(None::<String>) }
                else if let Some(text) = value.as_str() { query.bind(text.to_owned()) }
                else if let Some(number) = value.as_i64() { query.bind(number) }
                else if let Some(number) = value.as_f64() { query.bind(number) }
                else { return Err("备份数值无效。".into()); };
            }
            query.execute(&mut *conn).await.map_err(|e| format!("恢复 {table} 失败：{e}"))?;
        }
    }
    if backup["schemaVersion"].as_u64().unwrap() < 21 {
        sqlx::query("INSERT INTO goal_domain_links (goal_id, domain_id)
            SELECT id, domain_id FROM goals WHERE domain_id IS NOT NULL")
            .execute(&mut *conn).await.map_err(|e| format!("恢复目标领域关联失败：{e}"))?;
    }
    if backup["schemaVersion"].as_u64().unwrap() < 22 {
        sqlx::query("INSERT INTO action_domain_links (action_id, domain_id)
            SELECT id, domain_id FROM actions WHERE domain_id IS NOT NULL")
            .execute(&mut *conn).await.map_err(|e| format!("恢复行动领域关联失败：{e}"))?;
    }
    if backup["schemaVersion"].as_u64().unwrap() < 23 {
        sqlx::query("INSERT INTO review_domain_links (review_id, domain_id)
            SELECT id, domain_id FROM reviews WHERE domain_id IS NOT NULL")
            .execute(&mut *conn).await.map_err(|e| format!("恢复复盘领域关联失败：{e}"))?;
    }
    if backup["schemaVersion"].as_u64().unwrap() < 40 {
        sqlx::query("UPDATE resource_needs SET privacy_level = COALESCE(
            (SELECT privacy_level FROM goals WHERE goals.id = resource_needs.goal_id),
            (SELECT privacy_level FROM decisions WHERE decisions.id = resource_needs.decision_id),
            'private')")
            .execute(&mut *conn).await.map_err(|e| format!("恢复资源隐私失败：{e}"))?;
    }
    let bad = sqlx::query("PRAGMA foreign_key_check").fetch_all(&mut *conn)
        .await.map_err(|e| e.to_string())?;
    if !bad.is_empty() { return Err("备份的关联完整性校验未通过。".into()); }
    let integrity: String = sqlx::query_scalar("PRAGMA integrity_check").fetch_one(&mut *conn)
        .await.map_err(|e| e.to_string())?;
    if integrity != "ok" { return Err(format!("数据库一致性检查失败：{integrity}")); }
    Ok(())
}

#[tauri::command]
pub async fn restore_backup(app: AppHandle, backup: Value) -> Result<String, String> {
    let pool = pool(&app).await?;
    let mut conn = pool.acquire().await.map_err(|e| e.to_string())?;
    let dir = app.path().app_config_dir().map_err(|e| e.to_string())?.join("backups");
    restore_with_safety(&mut conn, &backup, &dir).await
}

async fn restore_with_safety(
    mut conn: &mut sqlx::SqliteConnection, backup: &Value, dir: &Path,
) -> Result<String, String> {
    sqlx::query("PRAGMA foreign_keys = ON").execute(&mut *conn).await.map_err(|e| e.to_string())?;
    sqlx::query("BEGIN IMMEDIATE").execute(&mut *conn).await.map_err(|e| e.to_string())?;
    let result: Result<String, String> = async {
        validate_rows(&mut conn, &backup).await?;
        // Keep a durable safety copy of the exact state locked for this replacement.
        let safety = snapshot(&mut conn).await?;
        fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
        let stamp = SystemTime::now().duration_since(UNIX_EPOCH).map_err(|e| e.to_string())?.as_millis();
        let path = dir.join(format!("lifeos-before-restore-{stamp}.json"));
        let mut file = OpenOptions::new().write(true).create_new(true).open(&path)
            .map_err(|e| e.to_string())?;
        file.write_all(serde_json::to_string_pretty(&safety).map_err(|e| e.to_string())?.as_bytes())
            .map_err(|e| e.to_string())?;
        file.sync_all().map_err(|e| e.to_string())?;
        restore_rows(&mut conn, &backup).await?;
        Ok(path.display().to_string())
    }.await;
    match result {
        Ok(path) => {
            sqlx::query("COMMIT").execute(&mut *conn).await.map_err(|e| e.to_string())?;
            Ok(path)
        }
        Err(error) => {
            sqlx::query("ROLLBACK").execute(&mut *conn).await.map_err(|e| e.to_string())?;
            Err(error)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use sqlx::Connection;
    use std::path::PathBuf;
    use std::process::Command;

    fn test_dir() -> PathBuf {
        let stamp = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos();
        let dir = std::env::temp_dir().join(format!("lifeos-backup-test-{}-{stamp}", std::process::id()));
        fs::create_dir(&dir).unwrap();
        dir
    }

    fn cleanup(dir: &Path) {
        for entry in fs::read_dir(dir).unwrap() {
            fs::remove_file(entry.unwrap().path()).unwrap();
        }
        fs::remove_dir(dir).unwrap();
    }

    fn remove_context_columns(backup: &mut Value, version: u64) {
        backup["schemaVersion"] = json!(version);
        without_weights(backup);
        for row in backup["data"]["life_domains"].as_array_mut().unwrap() {
            let fields = row.as_object_mut().unwrap();
            for name in DOMAIN_CONTEXT_COLUMNS { fields.remove(*name); }
        }
        for row in backup["data"]["goals"].as_array_mut().unwrap() {
            row.as_object_mut().unwrap().remove("parent_id");
            row.as_object_mut().unwrap().remove("progress_mode");
            for name in GOAL_LIFECYCLE_COLUMNS { row.as_object_mut().unwrap().remove(*name); }
        }
    }

    fn without_action_details(backup: &mut Value) {
        for row in backup["data"]["actions"].as_array_mut().unwrap() {
            row.as_object_mut().unwrap().remove("details_json");
        }
    }

    fn without_resource_ownership(backup: &mut Value) {
        without_action_details(backup);
        for row in backup["data"]["resource_needs"].as_array_mut().unwrap() {
            row.as_object_mut().unwrap().remove("decision_id");
            row.as_object_mut().unwrap().remove("privacy_level");
        }
    }

    fn with_null_resource_owner(rows: &Value) -> Value {
        let mut restored = rows.clone();
        for row in restored.as_array_mut().unwrap() {
            row["decision_id"] = Value::Null;
            row["privacy_level"] = json!("private");
        }
        restored
    }

    fn without_goal_direction(backup: &mut Value) {
        without_resource_ownership(backup);
        backup["data"].as_object_mut().unwrap().remove("decision_navigation_links");
        backup["data"].as_object_mut().unwrap().remove("decision_person_links");
        backup["data"].as_object_mut().unwrap().remove("decision_resource_need_links");
        for row in backup["data"]["goals"].as_array_mut().unwrap() {
            row.as_object_mut().unwrap().remove("horizon");
            row.as_object_mut().unwrap().remove("direction_id");
        }
    }

    fn with_null_goal_direction(rows: &Value) -> Value {
        let mut restored = rows.clone();
        for row in restored.as_array_mut().unwrap() {
            row["horizon"] = Value::Null;
            row["direction_id"] = Value::Null;
        }
        restored
    }

    fn without_weights(backup: &mut Value) {
        without_resource_ownership(backup);
        backup["data"].as_object_mut().unwrap().remove("decision_navigation_links");
        backup["data"].as_object_mut().unwrap().remove("decision_person_links");
        backup["data"].as_object_mut().unwrap().remove("decision_resource_need_links");
        backup["data"].as_object_mut().unwrap().remove("life_navigation");
        backup["data"].as_object_mut().unwrap().remove("goal_relations");
        for row in backup["data"]["goals"].as_array_mut().unwrap() {
            row.as_object_mut().unwrap().remove("priority");
            row.as_object_mut().unwrap().remove("horizon");
            row.as_object_mut().unwrap().remove("direction_id");
        }
        for table in ["goals", "actions"] {
            for row in backup["data"][table].as_array_mut().unwrap() {
                row.as_object_mut().unwrap().remove("progress_weight");
            }
        }
    }

    fn with_default_weight(rows: &Value) -> Value {
        let mut restored = rows.clone();
        for row in restored.as_array_mut().unwrap() {
            row.as_object_mut().unwrap().insert("progress_weight".into(), json!(1.0));
            if row.get("parent_id").is_some() || row.get("description").is_some() {
                row.as_object_mut().unwrap().insert("priority".into(), json!("medium"));
                row.as_object_mut().unwrap().insert("horizon".into(), Value::Null);
                row.as_object_mut().unwrap().insert("direction_id".into(), Value::Null);
            } else if matches!(row["status"].as_str(), Some("open" | "completed")) {
                row["details_json"] = json!("{}");
            }
        }
        restored
    }

    fn with_default_parent(rows: &Value) -> Value {
        let mut restored = with_null_goal_direction(&with_default_weight(rows));
        for row in restored.as_array_mut().unwrap() {
            row.as_object_mut().unwrap().insert("parent_id".into(), Value::Null);
            row.as_object_mut().unwrap().insert("priority".into(), json!("medium"));
            row.as_object_mut().unwrap().insert("progress_mode".into(), json!("automatic"));
            for name in GOAL_LIFECYCLE_COLUMNS {
                row.as_object_mut().unwrap().insert((*name).into(), Value::Null);
            }
        }
        restored
    }

    fn without_lifecycle(backup: &mut Value) {
        without_weights(backup);
        backup["data"].as_object_mut().unwrap().remove("goal_habit_progress");
        for row in backup["data"]["goals"].as_array_mut().unwrap() {
            row.as_object_mut().unwrap().remove("progress_mode");
            for name in GOAL_LIFECYCLE_COLUMNS { row.as_object_mut().unwrap().remove(*name); }
        }
    }

    fn with_default_lifecycle(rows: &Value) -> Value {
        let mut restored = with_default_weight(rows);
        for row in restored.as_array_mut().unwrap() {
            row.as_object_mut().unwrap().insert("progress_mode".into(), json!("automatic"));
            for name in GOAL_LIFECYCLE_COLUMNS {
                row.as_object_mut().unwrap().insert((*name).into(), Value::Null);
            }
        }
        restored
    }

    fn with_default_context(rows: &Value) -> Value {
        let mut restored = rows.clone();
        for row in restored.as_array_mut().unwrap() {
            let fields = row.as_object_mut().unwrap();
            fields.insert("current_state".into(), json!(""));
            fields.insert("long_term_expectation".into(), json!(""));
            fields.insert("status".into(), json!("active"));
        }
        restored
    }

    // Model all backed-up tables, their key value types, and the action insert triggers.
    // Frontend migration tests exercise the full production schema separately.
    pub(super) async fn database(marker: &str, populate: bool) -> sqlx::SqliteConnection {
        let mut conn = sqlx::SqliteConnection::connect("sqlite::memory:").await.unwrap();
        sqlx::query("PRAGMA foreign_keys = ON").execute(&mut conn).await.unwrap();
        sqlx::query("CREATE TABLE schema_migrations (version TEXT PRIMARY KEY)")
            .execute(&mut conn).await.unwrap();
        sqlx::query("INSERT INTO schema_migrations VALUES (?)").bind(VERSION)
            .execute(&mut conn).await.unwrap();
        for table in TABLES {
            let definition = match *table {
                "life_domains" => "CREATE TABLE life_domains (
                    id TEXT PRIMARY KEY, note TEXT, current_state TEXT NOT NULL DEFAULT '',
                    long_term_expectation TEXT NOT NULL DEFAULT '',
                    status TEXT NOT NULL DEFAULT 'active'
                    CHECK (status IN ('active', 'paused', 'archived'))
                )".to_owned(),
                "goals" => "CREATE TABLE goals (
                    id TEXT PRIMARY KEY, note TEXT, domain_id TEXT REFERENCES life_domains(id),
                    parent_id TEXT REFERENCES goals(id) DEFERRABLE INITIALLY DEFERRED,
                    privacy_level TEXT NOT NULL DEFAULT 'private',
                    status TEXT NOT NULL DEFAULT 'active', lifecycle_status TEXT,
                    priority TEXT NOT NULL DEFAULT 'medium' CHECK(priority IN ('high', 'medium', 'low')),
                    horizon TEXT CHECK(horizon IN ('annual', 'quarter', 'stage', 'month')),
                    direction_id TEXT REFERENCES life_navigation(id) DEFERRABLE INITIALLY DEFERRED,
                    status_reason TEXT, archived_at TEXT, progress_mode TEXT NOT NULL DEFAULT 'automatic',
                    progress_weight REAL NOT NULL DEFAULT 1 CHECK(progress_weight > 0 AND progress_weight <= 100)
                )".to_owned(),
                "goal_domain_links" => "CREATE TABLE goal_domain_links (
                    goal_id TEXT NOT NULL REFERENCES goals(id),
                    domain_id TEXT NOT NULL REFERENCES life_domains(id),
                    PRIMARY KEY (goal_id, domain_id)
                )".to_owned(),
                "life_navigation" => "CREATE TABLE life_navigation (
                    id TEXT PRIMARY KEY, kind TEXT NOT NULL CHECK(kind IN ('mission', 'value', 'vision', 'principle')),
                    title TEXT NOT NULL CHECK(length(trim(title)) BETWEEN 1 AND 120),
                    description TEXT NOT NULL CHECK(length(description) <= 6000),
                    archived_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
                    privacy_level TEXT NOT NULL DEFAULT 'private' CHECK(privacy_level IN ('normal', 'private', 'highly_sensitive'))
                )".to_owned(),
                "goal_relations" => "CREATE TABLE goal_relations (
                    goal_id TEXT NOT NULL REFERENCES goals(id), target_goal_id TEXT NOT NULL REFERENCES goals(id),
                    relation_type TEXT NOT NULL CHECK(relation_type IN ('support', 'depend', 'conflict', 'related')),
                    PRIMARY KEY(goal_id, target_goal_id, relation_type), CHECK(goal_id <> target_goal_id)
                ); CREATE UNIQUE INDEX goal_relations_symmetric_unique ON goal_relations(
                    MIN(goal_id, target_goal_id), MAX(goal_id, target_goal_id), relation_type
                ) WHERE relation_type IN ('conflict', 'related')".to_owned(),
                "goal_habit_progress" => "CREATE TABLE goal_habit_progress (
                    goal_id TEXT NOT NULL REFERENCES goals(id), habit_id TEXT NOT NULL REFERENCES habits(id),
                    start_on TEXT NOT NULL, end_on TEXT NOT NULL, weekly_target INTEGER NOT NULL,
                    weight REAL NOT NULL, sort_order INTEGER NOT NULL, PRIMARY KEY (goal_id, habit_id)
                )".to_owned(),
                "goal_progress_items" => "CREATE TABLE goal_progress_items (
                    id TEXT PRIMARY KEY, goal_id TEXT NOT NULL REFERENCES goals(id),
                    kind TEXT NOT NULL, title TEXT NOT NULL CHECK(length(trim(title)) > 0),
                    target_value REAL NOT NULL CHECK(target_value > 0),
                    current_value REAL NOT NULL CHECK(current_value >= 0),
                    weight REAL NOT NULL CHECK(weight > 0), sort_order INTEGER NOT NULL,
                    created_at TEXT NOT NULL, updated_at TEXT NOT NULL
                )".to_owned(),
                "action_domain_links" => "CREATE TABLE action_domain_links (
                    action_id TEXT NOT NULL REFERENCES actions(id),
                    domain_id TEXT NOT NULL REFERENCES life_domains(id),
                    PRIMARY KEY (action_id, domain_id)
                )".to_owned(),
                "review_domain_links" => "CREATE TABLE review_domain_links (
                    review_id TEXT NOT NULL REFERENCES reviews(id),
                    domain_id TEXT NOT NULL REFERENCES life_domains(id),
                    PRIMARY KEY (review_id, domain_id)
                )".to_owned(),
                "reviews" => "CREATE TABLE reviews (
                    id TEXT PRIMARY KEY, note TEXT, domain_id TEXT REFERENCES life_domains(id)
                )".to_owned(),
                "actions" => format!("CREATE TABLE actions (
                    id TEXT PRIMARY KEY, title TEXT NOT NULL CHECK(length(trim(title)) > 0),
                    domain_id TEXT REFERENCES life_domains(id),
                    status TEXT NOT NULL, created_at TEXT NOT NULL,
                    details_json TEXT NOT NULL DEFAULT '{{}}',
                    progress_weight REAL NOT NULL DEFAULT 1 CHECK(progress_weight > 0 AND progress_weight <= 100)
                )"),
                "action_plan_changes" => format!("CREATE TABLE action_plan_changes (
                    id INTEGER PRIMARY KEY AUTOINCREMENT, action_id TEXT NOT NULL
                    REFERENCES actions(id), note TEXT, amount REAL
                )"),
                "action_state_events" => format!("CREATE TABLE action_state_events (
                    id INTEGER PRIMARY KEY AUTOINCREMENT, action_id TEXT NOT NULL
                    REFERENCES actions(id), before_status TEXT, after_status TEXT NOT NULL
                )"),
                "action_completion_plans" => format!("CREATE TABLE action_completion_plans (
                    action_id TEXT PRIMARY KEY REFERENCES actions(id), planned_date TEXT
                )"),
                "object_versions" => format!("CREATE TABLE object_versions (
                    id INTEGER PRIMARY KEY AUTOINCREMENT, object_type TEXT NOT NULL,
                    snapshot_json TEXT NOT NULL
                )"),
                "metric_records" => format!("CREATE TABLE metric_records (
                    id TEXT PRIMARY KEY, note TEXT, value REAL NOT NULL
                )"),
                "habits" => format!("CREATE TABLE habits (
                    id TEXT PRIMARY KEY, title TEXT NOT NULL CHECK(length(trim(title)) > 0)
                )"),
                "habit_domain_links" => format!("CREATE TABLE habit_domain_links (
                    habit_id TEXT NOT NULL REFERENCES habits(id),
                    domain_id TEXT NOT NULL REFERENCES life_domains(id),
                    PRIMARY KEY (habit_id, domain_id)
                )"),
                "habit_logs" => format!("CREATE TABLE habit_logs (
                    id TEXT PRIMARY KEY, habit_id TEXT NOT NULL REFERENCES habits(id),
                    recorded_on TEXT NOT NULL, completed INTEGER NOT NULL CHECK(completed IN (0, 1)),
                    UNIQUE (habit_id, recorded_on)
                )"),
                "people" => "CREATE TABLE people (
                    id TEXT PRIMARY KEY, name TEXT NOT NULL
                )".to_owned(),
                "life_events" => "CREATE TABLE life_events (
                    id TEXT PRIMARY KEY, person_id TEXT REFERENCES people(id), goal_id TEXT REFERENCES goals(id)
                )".to_owned(),
                "skills" => "CREATE TABLE skills (
                    id TEXT PRIMARY KEY, goal_id TEXT REFERENCES goals(id), current_level INTEGER NOT NULL
                    CHECK(current_level BETWEEN 0 AND 5)
                )".to_owned(),
                "person_domain_links" => "CREATE TABLE person_domain_links (
                    person_id TEXT REFERENCES people(id), domain_id TEXT REFERENCES life_domains(id),
                    PRIMARY KEY (person_id, domain_id)
                )".to_owned(),
                "event_domain_links" => "CREATE TABLE event_domain_links (
                    event_id TEXT REFERENCES life_events(id), domain_id TEXT REFERENCES life_domains(id),
                    PRIMARY KEY (event_id, domain_id)
                )".to_owned(),
                "skill_domain_links" => "CREATE TABLE skill_domain_links (
                    skill_id TEXT REFERENCES skills(id), domain_id TEXT REFERENCES life_domains(id),
                    PRIMARY KEY (skill_id, domain_id)
                )".to_owned(),
                "resource_needs" => "CREATE TABLE resource_needs (
                    id TEXT PRIMARY KEY, goal_id TEXT REFERENCES goals(id),
                    skill_id TEXT REFERENCES skills(id), person_id TEXT REFERENCES people(id),
                    decision_id TEXT REFERENCES decisions(id),
                    privacy_level TEXT NOT NULL DEFAULT 'private' CHECK(privacy_level IN ('normal', 'private', 'highly_sensitive')),
                    CHECK ((goal_id IS NOT NULL) != (decision_id IS NOT NULL))
                )".to_owned(),
                "system_assessments" => "CREATE TABLE system_assessments (
                    id TEXT PRIMARY KEY, period_kind TEXT NOT NULL, period_start TEXT NOT NULL,
                    UNIQUE(period_kind, period_start)
                )".to_owned(),
                "inbox_items" => "CREATE TABLE inbox_items (
                    id TEXT PRIMARY KEY, note TEXT,
                    status TEXT NOT NULL DEFAULT 'unprocessed'
                    CHECK(status IN ('unprocessed', 'processing', 'organized', 'archived')),
                    target_type TEXT, target_id TEXT
                )".to_owned(),
                _ => format!("CREATE TABLE {table} (id TEXT PRIMARY KEY, note TEXT)"),
            };
            sqlx::query(&definition).execute(&mut conn).await.unwrap();
        }
        sqlx::query("CREATE TRIGGER plan_initial AFTER INSERT ON actions BEGIN
            INSERT INTO action_plan_changes (action_id, note, amount) VALUES (NEW.id, 'generated', 0); END")
            .execute(&mut conn).await.unwrap();
        sqlx::query("CREATE TRIGGER state_initial AFTER INSERT ON actions BEGIN
            INSERT INTO action_state_events (action_id, before_status, after_status)
            VALUES (NEW.id, NULL, NEW.status); END").execute(&mut conn).await.unwrap();
        sqlx::query("CREATE TRIGGER completion_initial AFTER INSERT ON actions
            WHEN NEW.status = 'completed' BEGIN
            INSERT INTO action_completion_plans (action_id, planned_date)
            VALUES (NEW.id, '2026-09-28'); END").execute(&mut conn).await.unwrap();
        if !populate { return conn; }
        for table in TABLES {
            match *table {
                "life_navigation" => {
                    sqlx::query("INSERT INTO life_navigation (id, kind, title, description, archived_at, created_at, updated_at) VALUES (?, 'vision', ?, '保持成长', NULL, '2026-10-12', '2026-10-12')")
                        .bind(format!("{marker}-navigation")).bind(format!("{marker} 长期方向"))
                        .execute(&mut conn).await.unwrap();
                }
                "actions" => {
                    sqlx::query("INSERT INTO actions (id, title, domain_id, status, created_at) VALUES (?, ?, ?, 'completed', '2026-09-28')")
                        .bind(format!("{marker}-action")).bind(format!("{marker} 行动"))
                        .bind(format!("{marker}-life_domains"))
                        .execute(&mut conn).await.unwrap();
                }
                "action_domain_links" => {
                    for domain in ["life_domains", "secondary"] {
                        sqlx::query("INSERT INTO action_domain_links VALUES (?, ?)")
                            .bind(format!("{marker}-action")).bind(format!("{marker}-{domain}"))
                            .execute(&mut conn).await.unwrap();
                    }
                }
                "reviews" => {
                    sqlx::query("INSERT INTO reviews VALUES (?, ?, ?)")
                        .bind(format!("{marker}-review")).bind(format!("{marker} 复盘"))
                        .bind(format!("{marker}-life_domains"))
                        .execute(&mut conn).await.unwrap();
                }
                "review_domain_links" => {
                    for domain in ["life_domains", "secondary"] {
                        sqlx::query("INSERT INTO review_domain_links VALUES (?, ?)")
                            .bind(format!("{marker}-review")).bind(format!("{marker}-{domain}"))
                            .execute(&mut conn).await.unwrap();
                    }
                }
                "life_domains" => {
                    sqlx::query("INSERT INTO life_domains VALUES (?, ?, ?, ?, 'paused')")
                        .bind(format!("{marker}-life_domains")).bind(format!("{marker} 中文"))
                        .bind(format!("{marker} 当前状态")).bind(format!("{marker} 长期期待"))
                        .execute(&mut conn).await.unwrap();
                    sqlx::query("INSERT INTO life_domains VALUES (?, ?, '', '', 'active')")
                        .bind(format!("{marker}-secondary")).bind("成长")
                        .execute(&mut conn).await.unwrap();
                }
                "goals" => {
                    sqlx::query("INSERT INTO goals (id, note, domain_id) VALUES (?, ?, ?)")
                        .bind(format!("{marker}-goals")).bind(format!("{marker} 目标"))
                        .bind(format!("{marker}-life_domains"))
                        .execute(&mut conn).await.unwrap();
                }
                "goal_domain_links" => {
                    for domain in ["life_domains", "secondary"] {
                        sqlx::query("INSERT INTO goal_domain_links VALUES (?, ?)")
                            .bind(format!("{marker}-goals")).bind(format!("{marker}-{domain}"))
                            .execute(&mut conn).await.unwrap();
                    }
                }
                "goal_progress_items" => {
                    sqlx::query("INSERT INTO goal_progress_items VALUES (?, ?, 'key_result', ?, 10, 4, 2, 0, '2026-09-28', '2026-09-28')")
                        .bind(format!("{marker}-progress")).bind(format!("{marker}-goals"))
                        .bind(format!("{marker} 关键结果")).execute(&mut conn).await.unwrap();
                }
                "action_plan_changes" | "action_state_events" | "action_completion_plans" | "goal_habit_progress" | "goal_relations" => {}
                "object_versions" => {
                    sqlx::query("INSERT INTO object_versions VALUES (19, 'goal', ?)")
                        .bind(format!("{{\"title\":\"{marker}\"}}"))
                        .execute(&mut conn).await.unwrap();
                }
                "metric_records" => {
                    sqlx::query("INSERT INTO metric_records VALUES (?, NULL, 1.25)")
                        .bind(format!("{marker}-metric"))
                        .execute(&mut conn).await.unwrap();
                }
                "habits" => {
                    sqlx::query("INSERT INTO habits VALUES (?, ?)")
                        .bind(format!("{marker}-habit")).bind(format!("{marker} 散步"))
                        .execute(&mut conn).await.unwrap();
                }
                "habit_domain_links" => {
                    sqlx::query("INSERT INTO habit_domain_links VALUES (?, ?)")
                        .bind(format!("{marker}-habit")).bind(format!("{marker}-life_domains"))
                        .execute(&mut conn).await.unwrap();
                }
                "habit_logs" => {
                    sqlx::query("INSERT INTO habit_logs VALUES (?, ?, ?, 1)")
                        .bind(format!("{marker}-habit-log")).bind(format!("{marker}-habit"))
                        .bind("2026-09-27").execute(&mut conn).await.unwrap();
                }
                "people" => {
                    sqlx::query("INSERT INTO people VALUES (?, ?)")
                        .bind(format!("{marker}-person")).bind(format!("{marker} 朋友"))
                        .execute(&mut conn).await.unwrap();
                }
                "person_domain_links" => {
                    sqlx::query("INSERT INTO person_domain_links VALUES (?, ?)")
                        .bind(format!("{marker}-person")).bind(format!("{marker}-life_domains"))
                        .execute(&mut conn).await.unwrap();
                }
                "life_events" => {
                    sqlx::query("INSERT INTO life_events VALUES (?, ?, ?)")
                        .bind(format!("{marker}-event")).bind(format!("{marker}-person"))
                        .bind(format!("{marker}-goals")).execute(&mut conn).await.unwrap();
                }
                "event_domain_links" => {
                    sqlx::query("INSERT INTO event_domain_links VALUES (?, ?)")
                        .bind(format!("{marker}-event")).bind(format!("{marker}-life_domains"))
                        .execute(&mut conn).await.unwrap();
                }
                "skills" => {
                    sqlx::query("INSERT INTO skills VALUES (?, ?, 2)")
                        .bind(format!("{marker}-skill")).bind(format!("{marker}-goals"))
                        .execute(&mut conn).await.unwrap();
                }
                "skill_domain_links" => {
                    sqlx::query("INSERT INTO skill_domain_links VALUES (?, ?)")
                        .bind(format!("{marker}-skill")).bind(format!("{marker}-life_domains"))
                        .execute(&mut conn).await.unwrap();
                }
                "resource_needs" => {
                    sqlx::query("INSERT INTO resource_needs (id, goal_id, skill_id, person_id) VALUES (?, ?, ?, ?)")
                        .bind(format!("{marker}-need")).bind(format!("{marker}-goals"))
                        .bind(format!("{marker}-skill")).bind(format!("{marker}-person"))
                        .execute(&mut conn).await.unwrap();
                }
                "system_assessments" => {
                    sqlx::query("INSERT INTO system_assessments VALUES (?, 'month', '2026-09-01')")
                        .bind(format!("{marker}-assessment")).execute(&mut conn).await.unwrap();
                }
                "inbox_items" => {
                    sqlx::query("INSERT INTO inbox_items (id, note) VALUES (?, ?)")
                        .bind(format!("{marker}-inbox_items")).bind(format!("{marker} 中文"))
                        .execute(&mut conn).await.unwrap();
                }
                _ => {
                    sqlx::query(&format!("INSERT INTO {table} VALUES (?, ?)"))
                        .bind(format!("{marker}-{table}")).bind(format!("{marker} 中文"))
                        .execute(&mut conn).await.unwrap();
                }
            }
        }
        sqlx::query("INSERT INTO action_plan_changes VALUES (19, ?, NULL, 2.5)")
            .bind(format!("{marker}-action")).execute(&mut conn).await.unwrap();
        sqlx::query("INSERT INTO action_state_events VALUES (19, ?, 'open', 'completed')")
            .bind(format!("{marker}-action")).execute(&mut conn).await.unwrap();
        conn
    }

    #[test]
    fn restores_all_tables_and_can_restore_the_safety_snapshot() {
        tauri::async_runtime::block_on(async {
            let mut source = database("来源", true).await;
            let mut destination = database("原有", true).await;
            let original = snapshot(&mut destination).await.unwrap();
            let backup = snapshot(&mut source).await.unwrap();
            let dir = test_dir();

            let safety_path = restore_with_safety(&mut destination, &backup, &dir).await.unwrap();
            assert_eq!(snapshot(&mut destination).await.unwrap()["data"], backup["data"]);
            let restored: Value = serde_json::from_slice(&fs::read(&safety_path).unwrap()).unwrap();
            assert_eq!(restored["data"], original["data"]);
            restore_with_safety(&mut destination, &restored, &dir).await.unwrap();
            assert_eq!(snapshot(&mut destination).await.unwrap()["data"], original["data"]);
            assert_eq!(
                sqlx::query("PRAGMA foreign_key_check").fetch_all(&mut destination).await.unwrap().len(), 0
            );
            cleanup(&dir);
        });
    }

    #[test]
    fn restores_v29_priority_defaults_and_rejects_invalid_v30() {
        tauri::async_runtime::block_on(async {
            let mut source = database("priority-source", true).await;
            let mut destination = database("priority-destination", true).await;
            sqlx::query("UPDATE goals SET priority = 'high'").execute(&mut source).await.unwrap();
            let backup = snapshot(&mut source).await.unwrap();
            let mut legacy = backup.clone();
            legacy["schemaVersion"] = json!(29);
            without_goal_direction(&mut legacy);
            legacy["data"].as_object_mut().unwrap().remove("goal_relations");
            legacy["data"].as_object_mut().unwrap().remove("life_navigation");
            for row in legacy["data"]["goals"].as_array_mut().unwrap() {
                row.as_object_mut().unwrap().remove("priority");
            }
            let dir = test_dir();
            restore_with_safety(&mut destination, &legacy, &dir).await.unwrap();
            let mut expected = backup["data"].clone();
            expected["life_navigation"] = json!([]);
            expected["decision_navigation_links"] = json!([]);
            expected["decision_person_links"] = json!([]);
            expected["decision_resource_need_links"] = json!([]);
            for row in expected["goals"].as_array_mut().unwrap() { row["priority"] = json!("medium"); }
            assert_eq!(snapshot(&mut destination).await.unwrap()["data"], expected);
            for priority in [Value::Null, json!("urgent"), json!(1)] {
                let mut invalid = backup.clone();
                invalid["data"]["goals"][0]["priority"] = priority;
                assert!(restore_with_safety(&mut destination, &invalid, &dir).await.is_err());
                assert_eq!(snapshot(&mut destination).await.unwrap()["data"], expected);
            }
            restore_with_safety(&mut destination, &backup, &dir).await.unwrap();
            assert_eq!(snapshot(&mut destination).await.unwrap()["data"], backup["data"]);
            assert!(sqlx::query("PRAGMA foreign_key_check").fetch_all(&mut destination).await.unwrap().is_empty());
            cleanup(&dir);
        });
    }

    #[test]
    fn failed_restore_rolls_back_and_leaves_a_usable_safety_copy() {
        tauri::async_runtime::block_on(async {
            let mut destination = database("保留", true).await;
            let original = snapshot(&mut destination).await.unwrap();
            let mut invalid = snapshot(&mut database("错误", true).await).await.unwrap();
            invalid["data"]["actions"][0]["title"] = json!("");
            let dir = test_dir();

            assert!(restore_with_safety(&mut destination, &invalid, &dir).await.is_err());
            assert_eq!(snapshot(&mut destination).await.unwrap()["data"], original["data"]);
            let path = fs::read_dir(&dir).unwrap().next().unwrap().unwrap().path();
            let safety: Value = serde_json::from_slice(&fs::read(path).unwrap()).unwrap();
            assert_eq!(safety["data"], original["data"]);
            assert_eq!(
                sqlx::query("PRAGMA foreign_key_check").fetch_all(&mut destination).await.unwrap().len(), 0
            );
            cleanup(&dir);
        });
    }

    #[test]
    fn action_feedback_roundtrip_and_legacy_defaults() {
        tauri::async_runtime::block_on(async {
            let mut source = database("feedback-source", true).await;
            let mut fresh = database("feedback-target", false).await;
            let mut backup = snapshot(&mut source).await.unwrap();
            let dir = test_dir();
            for minutes in [json!(0), Value::Null] {
                backup["data"]["actions"][0]["details_json"] = json!(json!({
                    "actualResult": "走了两圈", "actualMinutes": minutes,
                    "trigger": "午饭后", "fallback": "室内拉伸"
                }).to_string());
                restore_with_safety(&mut fresh, &backup, &dir).await.unwrap();
                assert_eq!(snapshot(&mut fresh).await.unwrap()["data"], backup["data"]);
            }
            for details in [json!([]), json!({"unknown": 1}), json!({"actualMinutes": -1}),
                json!({"actualMinutes": 1.5}), json!({"trigger": "x".repeat(2001)})] {
                let mut invalid = backup.clone();
                invalid["data"]["actions"][0]["details_json"] = json!(details.to_string());
                assert!(restore_with_safety(&mut fresh, &invalid, &dir).await.is_err());
                assert_eq!(snapshot(&mut fresh).await.unwrap()["data"], backup["data"]);
            }
            let mut legacy = backup.clone();
            legacy["schemaVersion"] = json!(40);
            without_action_details(&mut legacy);
            restore_with_safety(&mut fresh, &legacy, &dir).await.unwrap();
            let mut expected = backup["data"].clone();
            expected["actions"][0]["details_json"] = json!("{}");
            assert_eq!(snapshot(&mut fresh).await.unwrap()["data"], expected);
            source.close().await.unwrap();
            fresh.close().await.unwrap();
            cleanup(&dir);
        });
    }

    #[test]
    fn restores_previous_version_into_empty_database() {
        tauri::async_runtime::block_on(async {
            let mut source = database("旧版", true).await;
            let mut fresh = database("空白", false).await;
            let mut backup = snapshot(&mut source).await.unwrap();
            remove_context_columns(&mut backup, 15);
            for table in &TABLES[PREVIOUS_TABLE_COUNT..] {
                backup["data"].as_object_mut().unwrap().remove(*table);
            }
            let dir = test_dir();

            let safety_path = restore_with_safety(&mut fresh, &backup, &dir).await.unwrap();
            let restored = snapshot(&mut fresh).await.unwrap();
            for table in &TABLES[..PREVIOUS_TABLE_COUNT] {
                let expected = if *table == "life_domains" {
                    with_default_context(&backup["data"][*table])
                } else if *table == "goals" {
                    with_default_parent(&backup["data"][*table])
                } else if *table == "actions" {
                    with_default_weight(&backup["data"][*table])
                } else { backup["data"][*table].clone() };
                assert_eq!(restored["data"][*table], expected);
            }
            for table in &TABLES[PREVIOUS_TABLE_COUNT..] {
                if *table == "goal_domain_links" {
                    assert_eq!(restored["data"][*table], json!([{
                        "goal_id": "旧版-goals", "domain_id": "旧版-life_domains",
                    }]));
                } else if *table == "action_domain_links" {
                    assert_eq!(restored["data"][*table], json!([{
                        "action_id": "旧版-action", "domain_id": "旧版-life_domains",
                    }]));
                } else if *table == "review_domain_links" {
                    assert_eq!(restored["data"][*table], json!([{
                        "review_id": "旧版-review", "domain_id": "旧版-life_domains",
                    }]));
                } else {
                    assert!(restored["data"][*table].as_array().unwrap().is_empty());
                }
            }
            assert_eq!(sqlx::query("PRAGMA foreign_key_check")
                .fetch_all(&mut fresh).await.unwrap().len(), 0);
            let integrity: String = sqlx::query_scalar("PRAGMA integrity_check")
                .fetch_one(&mut fresh).await.unwrap();
            assert_eq!(integrity, "ok");
            let safety: Value = serde_json::from_slice(&fs::read(safety_path).unwrap()).unwrap();
            assert_eq!(safety["data"]["actions"].as_array().unwrap().len(), 0);
            cleanup(&dir);
        });
    }

    #[test]
    fn restores_real_migrations_into_a_fresh_database() {
        let dir = test_dir();
        let source_path = dir.join("source.db");
        let fresh_path = dir.join("fresh.db");
        let old_backup_path = dir.join("m6-backup.json");
        let previous_backup_path = dir.join("v20-backup.json");
        let v21_backup_path = dir.join("v21-backup.json");
        let helper = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../tests/helpers/create-m6-backup-databases.mjs");
        let result = Command::new("node")
            .arg(helper)
            .arg(&source_path)
            .arg(&fresh_path)
            .arg(&old_backup_path)
            .arg(&previous_backup_path)
            .arg(&v21_backup_path)
            .output()
            .expect("Node 24 is required to load the production TypeScript migrations");
        assert!(
            result.status.success(),
            "Could not create migrated SQLite fixtures: {}",
            String::from_utf8_lossy(&result.stderr)
        );

        tauri::async_runtime::block_on(async {
            let mut source = sqlx::SqliteConnection::connect(&format!(
                "sqlite:{}", source_path.display()
            )).await.unwrap();
            let mut fresh = sqlx::SqliteConnection::connect(&format!(
                "sqlite:{}", fresh_path.display()
            )).await.unwrap();
            let backup = snapshot(&mut source).await.unwrap();
            assert_eq!(backup["schemaVersion"], json!(42));
            assert_eq!(backup["data"]["goal_progress_items"].as_array().unwrap().len(), 1);
            assert_eq!(backup["data"]["goal_domain_links"].as_array().unwrap().len(), 2);
            assert_eq!(backup["data"]["action_domain_links"].as_array().unwrap().len(), 2);
            assert_eq!(backup["data"]["review_domain_links"].as_array().unwrap().len(), 2);
            assert_eq!(backup["data"]["life_domains"][0]["status"], json!("paused"));
            assert_eq!(backup["data"]["action_plan_changes"].as_array().unwrap().len(), 1);
            assert_eq!(backup["data"]["action_state_events"].as_array().unwrap().len(), 1);
            assert_eq!(backup["data"]["action_completion_plans"].as_array().unwrap().len(), 1);
            assert_eq!(backup["data"]["object_versions"].as_array().unwrap().len(), 1);
            assert_eq!(backup["data"]["metric_records"][0]["value"], json!(7.25));
            assert_eq!(backup["data"]["habit_logs"].as_array().unwrap().len(), 1);
            assert_eq!(backup["data"]["habit_domain_links"][0]["domain_id"], json!("health"));
            assert_eq!(backup["data"]["life_events"][0]["person_id"], json!("person-1"));
            assert_eq!(backup["data"]["resource_needs"][0]["skill_id"], json!("skill-1"));
            let mut own_need = backup.clone();
            let mut need = backup["data"]["resource_needs"][0].clone();
            need["id"] = json!("decision-need-1");
            need["goal_id"] = Value::Null;
            need["decision_id"] = json!("decision-1");
            own_need["data"]["resource_needs"].as_array_mut().unwrap().push(need);
            let initial_safety_path = restore_with_safety(&mut fresh, &own_need, &dir).await.unwrap();
            assert_eq!(snapshot(&mut fresh).await.unwrap()["data"], own_need["data"]);
            for (goal, decision) in [(json!("goal-1"), json!("decision-1")),
                (Value::Null, Value::Null), (Value::Null, json!("missing"))] {
                let mut invalid = own_need.clone();
                invalid["data"]["resource_needs"][1]["goal_id"] = goal;
                invalid["data"]["resource_needs"][1]["decision_id"] = decision;
                assert!(restore_with_safety(&mut fresh, &invalid, &dir).await.is_err());
                assert_eq!(snapshot(&mut fresh).await.unwrap()["data"], own_need["data"]);
            }
            let mut v38 = backup.clone();
            v38["schemaVersion"] = json!(38);
            without_resource_ownership(&mut v38);
            restore_with_safety(&mut fresh, &v38, &dir).await.unwrap();
            assert_eq!(snapshot(&mut fresh).await.unwrap()["data"], backup["data"]);
            let legacy: Value = serde_json::from_slice(&fs::read(&old_backup_path).unwrap()).unwrap();
            assert_eq!(legacy["schemaVersion"], json!(16));
            assert!(legacy["data"].get("habits").is_none());
            let previous: Value = serde_json::from_slice(&fs::read(&previous_backup_path).unwrap()).unwrap();
            assert_eq!(previous["schemaVersion"], json!(20));
            assert!(previous["data"].get("goal_domain_links").is_none());
            let v21: Value = serde_json::from_slice(&fs::read(&v21_backup_path).unwrap()).unwrap();
            assert_eq!(v21["schemaVersion"], json!(21));
            assert!(v21["data"].get("action_domain_links").is_none());
            let mut v22 = backup.clone();
            v22["schemaVersion"] = json!(22);
            without_lifecycle(&mut v22);
            v22["data"].as_object_mut().unwrap().remove("review_domain_links");
            v22["data"].as_object_mut().unwrap().remove("goal_progress_items");
            for row in v22["data"]["goals"].as_array_mut().unwrap() {
                row.as_object_mut().unwrap().remove("parent_id");
            }
            let mut v23 = backup.clone();
            v23["schemaVersion"] = json!(23);
            without_lifecycle(&mut v23);
            v23["data"].as_object_mut().unwrap().remove("goal_progress_items");
            for row in v23["data"]["goals"].as_array_mut().unwrap() {
                row.as_object_mut().unwrap().remove("parent_id");
            }
            let mut v24 = backup.clone();
            v24["schemaVersion"] = json!(24);
            without_lifecycle(&mut v24);
            v24["data"].as_object_mut().unwrap().remove("goal_progress_items");

            restore_with_safety(&mut fresh, &backup, &dir).await.unwrap();
            assert_eq!(snapshot(&mut fresh).await.unwrap()["data"], backup["data"]);
            let mut missing_primary_link = backup.clone();
            missing_primary_link["data"]["goal_domain_links"]
                .as_array_mut().unwrap().retain(|link| link["domain_id"] != "health");
            assert!(restore_with_safety(&mut fresh, &missing_primary_link, &dir).await.is_err());
            assert_eq!(snapshot(&mut fresh).await.unwrap()["data"], backup["data"]);
            let mut invalid_goal_link = backup.clone();
            invalid_goal_link["data"]["goal_domain_links"][1]["domain_id"] = json!("missing");
            assert!(restore_with_safety(&mut fresh, &invalid_goal_link, &dir).await.is_err());
            assert_eq!(snapshot(&mut fresh).await.unwrap()["data"], backup["data"]);
            let mut missing_action_link = backup.clone();
            missing_action_link["data"]["action_domain_links"]
                .as_array_mut().unwrap().retain(|link| link["domain_id"] != "health");
            assert!(restore_with_safety(&mut fresh, &missing_action_link, &dir).await.is_err());
            assert_eq!(snapshot(&mut fresh).await.unwrap()["data"], backup["data"]);
            let mut invalid_action_link = backup.clone();
            invalid_action_link["data"]["action_domain_links"][1]["domain_id"] = json!("missing");
            assert!(restore_with_safety(&mut fresh, &invalid_action_link, &dir).await.is_err());
            assert_eq!(snapshot(&mut fresh).await.unwrap()["data"], backup["data"]);
            let mut missing_review_link = backup.clone();
            missing_review_link["data"]["review_domain_links"]
                .as_array_mut().unwrap().retain(|link| link["domain_id"] != "health");
            assert!(restore_with_safety(&mut fresh, &missing_review_link, &dir).await.is_err());
            assert_eq!(snapshot(&mut fresh).await.unwrap()["data"], backup["data"]);
            let mut invalid_review_link = backup.clone();
            invalid_review_link["data"]["review_domain_links"][1]["domain_id"] = json!("missing");
            assert!(restore_with_safety(&mut fresh, &invalid_review_link, &dir).await.is_err());
            assert_eq!(snapshot(&mut fresh).await.unwrap()["data"], backup["data"]);
            restore_with_safety(&mut fresh, &previous, &dir).await.unwrap();
            let from_previous = snapshot(&mut fresh).await.unwrap();
            assert_eq!(from_previous["data"]["goal_domain_links"], json!([{
                "goal_id": "goal-1", "domain_id": "health",
            }]));
            assert_eq!(from_previous["data"]["goals"], with_default_parent(&previous["data"]["goals"]));
            assert_eq!(from_previous["data"]["action_domain_links"], json!([{
                "action_id": "action-1", "domain_id": "health",
            }]));
            assert_eq!(from_previous["data"]["review_domain_links"], json!([{
                "review_id": "review-1", "domain_id": "health",
            }]));
            restore_with_safety(&mut fresh, &v21, &dir).await.unwrap();
            let from_v21 = snapshot(&mut fresh).await.unwrap();
            assert_eq!(from_v21["data"]["goal_domain_links"], v21["data"]["goal_domain_links"]);
            assert_eq!(from_v21["data"]["action_domain_links"], json!([{
                "action_id": "action-1", "domain_id": "health",
            }]));
            assert_eq!(from_v21["data"]["review_domain_links"], json!([{
                "review_id": "review-1", "domain_id": "health",
            }]));
            restore_with_safety(&mut fresh, &v22, &dir).await.unwrap();
            assert_eq!(snapshot(&mut fresh).await.unwrap()["data"]["review_domain_links"], json!([{
                "review_id": "review-1", "domain_id": "health",
            }]));
            restore_with_safety(&mut fresh, &v23, &dir).await.unwrap();
            assert_eq!(snapshot(&mut fresh).await.unwrap()["data"]["goals"],
                with_default_parent(&v23["data"]["goals"]));
            restore_with_safety(&mut fresh, &v24, &dir).await.unwrap();
            assert_eq!(snapshot(&mut fresh).await.unwrap()["data"]["goals"], with_default_lifecycle(&v24["data"]["goals"]));
            assert!(snapshot(&mut fresh).await.unwrap()["data"]["goal_progress_items"]
                .as_array().unwrap().is_empty());
            restore_with_safety(&mut fresh, &backup, &dir).await.unwrap();
            assert_eq!(snapshot(&mut fresh).await.unwrap()["data"], backup["data"]);
            let mut v25 = backup.clone();
            v25["schemaVersion"] = json!(25);
            without_lifecycle(&mut v25);
            restore_with_safety(&mut fresh, &v25, &dir).await.unwrap();
            assert_eq!(snapshot(&mut fresh).await.unwrap()["data"]["goals"],
                with_default_lifecycle(&v25["data"]["goals"]));
            let mut v26 = backup.clone();
            v26["schemaVersion"] = json!(26);
            without_weights(&mut v26);
            v26["data"].as_object_mut().unwrap().remove("goal_habit_progress");
            for goal in v26["data"]["goals"].as_array_mut().unwrap() {
                goal.as_object_mut().unwrap().remove("progress_mode");
            }
            restore_with_safety(&mut fresh, &v26, &dir).await.unwrap();
            let mut expected_goals = with_default_weight(&v26["data"]["goals"]);
            for goal in expected_goals.as_array_mut().unwrap() {
                goal.as_object_mut().unwrap().insert("progress_mode".into(), json!("automatic"));
            }
            assert_eq!(snapshot(&mut fresh).await.unwrap()["data"]["goals"], expected_goals);
            let mut configured = backup.clone();
            configured["data"]["goal_habit_progress"] = json!([{
                "goal_id": "goal-1", "habit_id": "habit-1", "start_on": "2026-09-28",
                "end_on": "2026-10-04", "weekly_target": 3, "weight": 2.0, "sort_order": 0
            }]);
            restore_with_safety(&mut fresh, &configured, &dir).await.unwrap();
            assert_eq!(snapshot(&mut fresh).await.unwrap()["data"], configured["data"]);
            for (key, value) in [("habit_id", json!("missing")), ("weekly_target", json!(8)),
                ("weight", json!(0)), ("start_on", json!("2026-02-30")), ("sort_order", json!(-1))] {
                let mut invalid = configured.clone();
                invalid["data"]["goal_habit_progress"][0][key] = value;
                assert!(restore_with_safety(&mut fresh, &invalid, &dir).await.is_err());
                assert_eq!(snapshot(&mut fresh).await.unwrap()["data"], configured["data"]);
            }
            let mut v28 = backup.clone();
            v28["schemaVersion"] = json!(28);
            without_weights(&mut v28);
            restore_with_safety(&mut fresh, &v28, &dir).await.unwrap();
            let restored_v28 = snapshot(&mut fresh).await.unwrap();
            for table in ["goals", "actions"] {
                assert_eq!(restored_v28["data"][table], with_default_weight(&v28["data"][table]));
            }
            let mut weighted = backup.clone();
            weighted["data"]["goals"][0]["progress_weight"] = json!(2.5);
            weighted["data"]["actions"][0]["progress_weight"] = json!(3.0);
            restore_with_safety(&mut fresh, &weighted, &dir).await.unwrap();
            assert_eq!(snapshot(&mut fresh).await.unwrap()["data"], weighted["data"]);
            for table in ["goals", "actions"] {
                for weight in [json!(0), json!(-1), json!(101), Value::Null] {
                    let mut invalid = weighted.clone();
                    invalid["data"][table][0]["progress_weight"] = weight;
                    assert!(restore_with_safety(&mut fresh, &invalid, &dir).await.is_err());
                    assert_eq!(snapshot(&mut fresh).await.unwrap()["data"], weighted["data"]);
                }
            }
            let mut v27 = backup.clone();
            v27["schemaVersion"] = json!(27);
            without_weights(&mut v27);
            v27["data"].as_object_mut().unwrap().remove("goal_habit_progress");
            restore_with_safety(&mut fresh, &v27, &dir).await.unwrap();
            assert!(snapshot(&mut fresh).await.unwrap()["data"]["goal_habit_progress"].as_array().unwrap().is_empty());
            for mode in ["exploration", "exploration_percent"] {
                let mut exploration = backup.clone();
                exploration["data"]["goals"][0]["progress_mode"] = json!(mode);
                restore_with_safety(&mut fresh, &exploration, &dir).await.unwrap();
                assert_eq!(snapshot(&mut fresh).await.unwrap()["data"], exploration["data"]);
                let mut invalid = exploration.clone();
                invalid["data"]["goals"][0]["progress_mode"] = json!("invalid");
                assert!(restore_with_safety(&mut fresh, &invalid, &dir).await.is_err());
                assert_eq!(snapshot(&mut fresh).await.unwrap()["data"], exploration["data"]);
            }
            for (extension, status, reason, archived_at) in [
                ("candidate", "active", Value::Null, Value::Null),
                ("abandoned", "paused", json!("方向已调整"), Value::Null),
                ("archived", "completed", json!("保留历史原因"), json!("2026-10-08T08:00:00Z")),
            ] {
                let mut lifecycle = backup.clone();
                lifecycle["data"]["goals"][0]["status"] = json!(status);
                lifecycle["data"]["goals"][0]["lifecycle_status"] = json!(extension);
                lifecycle["data"]["goals"][0]["status_reason"] = reason;
                lifecycle["data"]["goals"][0]["archived_at"] = archived_at;
                restore_with_safety(&mut fresh, &lifecycle, &dir).await.unwrap();
                assert_eq!(snapshot(&mut fresh).await.unwrap()["data"], lifecycle["data"]);
                let mut invalid = lifecycle.clone();
                invalid["data"]["goals"][0]["lifecycle_status"] = json!("unknown");
                assert!(restore_with_safety(&mut fresh, &invalid, &dir).await.is_err());
                assert_eq!(snapshot(&mut fresh).await.unwrap()["data"], lifecycle["data"]);
            }
            restore_with_safety(&mut fresh, &backup, &dir).await.unwrap();
            let mut invalid_progress = backup.clone();
            invalid_progress["data"]["goal_progress_items"][0]["goal_id"] = json!("missing");
            assert!(restore_with_safety(&mut fresh, &invalid_progress, &dir).await.is_err());
            assert_eq!(snapshot(&mut fresh).await.unwrap()["data"], backup["data"]);
            invalid_progress["data"]["goal_progress_items"][0]["goal_id"] = json!("goal-1");
            invalid_progress["data"]["goal_progress_items"][0]["weight"] = json!(0);
            assert!(restore_with_safety(&mut fresh, &invalid_progress, &dir).await.is_err());
            assert_eq!(snapshot(&mut fresh).await.unwrap()["data"], backup["data"]);
            let mut hierarchy = backup.clone();
            let mut child = hierarchy["data"]["goals"][0].clone();
            child["id"] = json!("goal-child");
            child["domain_id"] = Value::Null;
            child["parent_id"] = json!("goal-1");
            hierarchy["data"]["goals"].as_array_mut().unwrap().insert(0, child);
            restore_with_safety(&mut fresh, &hierarchy, &dir).await.unwrap();
            assert_eq!(snapshot(&mut fresh).await.unwrap()["data"]["goals"].as_array().unwrap().len(), 2);
            let mut related = hierarchy.clone();
            related["data"]["goal_relations"] = json!([
                {"goal_id": "goal-1", "target_goal_id": "goal-child", "relation_type": "support"},
                {"goal_id": "goal-1", "target_goal_id": "goal-child", "relation_type": "depend"},
                {"goal_id": "goal-1", "target_goal_id": "goal-child", "relation_type": "conflict"},
                {"goal_id": "goal-1", "target_goal_id": "goal-child", "relation_type": "related"}
            ]);
            restore_with_safety(&mut fresh, &related, &dir).await.unwrap();
            assert_eq!(snapshot(&mut fresh).await.unwrap()["data"], related["data"]);
            for (key, value) in [("target_goal_id", json!("missing")), ("target_goal_id", json!("goal-1")), ("relation_type", json!("unknown"))] {
                let mut invalid = related.clone();
                invalid["data"]["goal_relations"][0][key] = value;
                assert!(restore_with_safety(&mut fresh, &invalid, &dir).await.is_err());
                assert_eq!(snapshot(&mut fresh).await.unwrap()["data"], related["data"]);
            }
            let mut duplicate = related.clone();
            duplicate["data"]["goal_relations"].as_array_mut().unwrap().push(json!({
                "goal_id": "goal-child", "target_goal_id": "goal-1", "relation_type": "related"
            }));
            assert!(restore_with_safety(&mut fresh, &duplicate, &dir).await.is_err());
            assert_eq!(snapshot(&mut fresh).await.unwrap()["data"], related["data"]);
            let mut v30 = related.clone();
            v30["schemaVersion"] = json!(30);
            without_goal_direction(&mut v30);
            v30["data"].as_object_mut().unwrap().remove("goal_relations");
            v30["data"].as_object_mut().unwrap().remove("life_navigation");
            restore_with_safety(&mut fresh, &v30, &dir).await.unwrap();
            assert_eq!(snapshot(&mut fresh).await.unwrap()["data"]["goals"], with_null_goal_direction(&v30["data"]["goals"]));
            assert!(snapshot(&mut fresh).await.unwrap()["data"]["goal_relations"].as_array().unwrap().is_empty());
            let mut cyclic = hierarchy.clone();
            cyclic["data"]["goals"][1]["parent_id"] = json!("goal-child");
            assert!(restore_with_safety(&mut fresh, &cyclic, &dir).await.is_err());
            let mut dangling = hierarchy.clone();
            dangling["data"]["goals"][0]["parent_id"] = json!("unknown");
            assert!(restore_with_safety(&mut fresh, &dangling, &dir).await.is_err());
            restore_with_safety(&mut fresh, &backup, &dir).await.unwrap();
            let mut bad_log = backup.clone();
            bad_log["data"]["habit_logs"][0]["completed"] = json!(3);
            assert!(restore_with_safety(&mut fresh, &bad_log, &dir).await.is_err());
            assert_eq!(snapshot(&mut fresh).await.unwrap()["data"], backup["data"]);
            let mut broken_need = backup.clone();
            broken_need["data"]["resource_needs"][0]["skill_id"] = json!("missing");
            assert!(restore_with_safety(&mut fresh, &broken_need, &dir).await.is_err());
            assert_eq!(snapshot(&mut fresh).await.unwrap()["data"], backup["data"]);
            let mut missing_context = backup.clone();
            missing_context["data"]["life_domains"][0]
                .as_object_mut().unwrap().remove("current_state");
            assert!(restore_with_safety(&mut fresh, &missing_context, &dir).await.is_err());
            assert_eq!(snapshot(&mut fresh).await.unwrap()["data"], backup["data"]);
            for (version, count) in [
                (17, HABIT_TABLE_COUNT), (18, RECORD_TABLE_COUNT), (19, DOMAIN_TABLE_COUNT)
            ] {
                let mut older = backup.clone();
                remove_context_columns(&mut older, version);
                for table in &TABLES[count..] {
                    older["data"].as_object_mut().unwrap().remove(*table);
                }
                restore_with_safety(&mut fresh, &older, &dir).await.unwrap();
                let restored = snapshot(&mut fresh).await.unwrap();
                for table in &TABLES[..count] {
                    let expected = if *table == "life_domains" {
                        with_default_context(&older["data"][*table])
                    } else if *table == "goals" {
                        with_default_parent(&older["data"][*table])
                    } else if *table == "actions" {
                    with_default_weight(&older["data"][*table])
                } else if *table == "resource_needs" {
                    with_null_resource_owner(&older["data"][*table])
                } else { older["data"][*table].clone() };
                    assert_eq!(restored["data"][*table], expected);
                }
                for table in &TABLES[count..] {
                    if *table == "goal_domain_links" {
                        assert_eq!(restored["data"][*table], json!([{
                            "goal_id": "goal-1", "domain_id": "health",
                        }]));
                    } else if *table == "action_domain_links" {
                        assert_eq!(restored["data"][*table], json!([{
                            "action_id": "action-1", "domain_id": "health",
                        }]));
                    } else if *table == "review_domain_links" {
                        assert_eq!(restored["data"][*table], json!([{
                            "review_id": "review-1", "domain_id": "health",
                        }]));
                    } else {
                        assert!(restored["data"][*table].as_array().unwrap().is_empty());
                    }
                }
            }
            restore_with_safety(&mut fresh, &legacy, &dir).await.unwrap();
            let from_legacy = snapshot(&mut fresh).await.unwrap();
            for table in &TABLES[..PREVIOUS_TABLE_COUNT] {
                let expected = if *table == "life_domains" {
                    with_default_context(&legacy["data"][*table])
                } else if *table == "goals" {
                    with_default_parent(&legacy["data"][*table])
                } else if *table == "actions" {
                    with_default_weight(&legacy["data"][*table])
                } else { legacy["data"][*table].clone() };
                assert_eq!(from_legacy["data"][*table], expected);
            }
            for table in &TABLES[PREVIOUS_TABLE_COUNT..] {
                if *table == "goal_domain_links" {
                    assert_eq!(from_legacy["data"][*table], json!([{
                        "goal_id": "goal-1", "domain_id": "health",
                    }]));
                } else if *table == "action_domain_links" {
                    assert_eq!(from_legacy["data"][*table], json!([{
                        "action_id": "action-1", "domain_id": "health",
                    }]));
                } else if *table == "review_domain_links" {
                    assert_eq!(from_legacy["data"][*table], json!([{
                        "review_id": "review-1", "domain_id": "health",
                    }]));
                } else {
                    assert!(from_legacy["data"][*table].as_array().unwrap().is_empty());
                }
            }
            restore_with_safety(&mut fresh, &backup, &dir).await.unwrap();
            assert_eq!(snapshot(&mut fresh).await.unwrap()["data"], backup["data"]);
            assert!(sqlx::query("PRAGMA foreign_key_check").fetch_all(&mut fresh)
                .await.unwrap().is_empty());
            let integrity: String = sqlx::query_scalar("PRAGMA integrity_check")
                .fetch_one(&mut fresh).await.unwrap();
            assert_eq!(integrity, "ok");

            let safety: Value = serde_json::from_slice(&fs::read(initial_safety_path).unwrap()).unwrap();
            assert!(safety["data"]["goals"].as_array().unwrap().is_empty());
            let mut invalid = backup.clone();
            invalid["data"]["goals"][0]["title"] = json!("");
            assert!(restore_with_safety(&mut fresh, &invalid, &dir).await.is_err());
            assert_eq!(snapshot(&mut fresh).await.unwrap()["data"], backup["data"]);
            restore_with_safety(&mut fresh, &safety, &dir).await.unwrap();
            assert_eq!(snapshot(&mut fresh).await.unwrap()["data"], safety["data"]);
            assert_eq!(backup["data"]["life_navigation"].as_array().unwrap().len(), 1);
            restore_with_safety(&mut fresh, &backup, &dir).await.unwrap();
            assert_eq!(snapshot(&mut fresh).await.unwrap()["data"]["life_navigation"], backup["data"]["life_navigation"]);
            for (key, value) in [("kind", json!("invalid")), ("title", json!(" ")), ("created_at", json!("invalid")), ("archived_at", json!(7)), ("privacy_level", json!("invalid")), ("privacy_level", Value::Null)] {
                let mut invalid = backup.clone();
                invalid["data"]["life_navigation"][0][key] = value;
                assert!(restore_with_safety(&mut fresh, &invalid, &dir).await.is_err());
                assert_eq!(snapshot(&mut fresh).await.unwrap()["data"]["life_navigation"], backup["data"]["life_navigation"]);
            }
            for level in ["normal", "private", "highly_sensitive"] {
                let mut classified = backup.clone();
                classified["data"]["life_navigation"][0]["privacy_level"] = json!(level);
                restore_with_safety(&mut fresh, &classified, &dir).await.unwrap();
                assert_eq!(snapshot(&mut fresh).await.unwrap()["data"], classified["data"]);
            }
            assert_eq!(backup["data"]["decision_navigation_links"], json!([{"decision_id":"decision-1","navigation_id":"navigation-1"}]));
            for key in ["decision_id", "navigation_id"] {
                let mut invalid = backup.clone();
                invalid["data"]["decision_navigation_links"][0][key] = json!("missing");
                assert!(restore_with_safety(&mut fresh, &invalid, &dir).await.is_err());
                assert_eq!(snapshot(&mut fresh).await.unwrap()["data"], { let mut expected = backup["data"].clone(); expected["life_navigation"][0]["privacy_level"] = json!("highly_sensitive"); expected });
            }
            restore_with_safety(&mut fresh, &backup, &dir).await.unwrap();
            assert_eq!(backup["data"]["decision_person_links"], json!([{"decision_id":"decision-1","person_id":"person-1"}]));
            for key in ["decision_id", "person_id"] {
                let mut invalid = backup.clone();
                invalid["data"]["decision_person_links"][0][key] = json!("missing");
                assert!(restore_with_safety(&mut fresh, &invalid, &dir).await.is_err());
                assert_eq!(snapshot(&mut fresh).await.unwrap()["data"], backup["data"]);
            }
            let mut duplicate = backup.clone();
            let pair = duplicate["data"]["decision_person_links"][0].clone();
            duplicate["data"]["decision_person_links"].as_array_mut().unwrap().push(pair);
            assert!(restore_with_safety(&mut fresh, &duplicate, &dir).await.is_err());
            assert_eq!(snapshot(&mut fresh).await.unwrap()["data"], backup["data"]);
            assert_eq!(backup["data"]["decision_resource_need_links"], json!([{"decision_id":"decision-1","resource_need_id":"need-1"}]));
            for key in ["decision_id", "resource_need_id"] {
                let mut invalid = backup.clone();
                invalid["data"]["decision_resource_need_links"][0][key] = json!("missing");
                assert!(restore_with_safety(&mut fresh, &invalid, &dir).await.is_err());
                assert_eq!(snapshot(&mut fresh).await.unwrap()["data"], backup["data"]);
            }
            let mut duplicate = backup.clone();
            let pair = duplicate["data"]["decision_resource_need_links"][0].clone();
            duplicate["data"]["decision_resource_need_links"].as_array_mut().unwrap().push(pair);
            assert!(restore_with_safety(&mut fresh, &duplicate, &dir).await.is_err());
            assert_eq!(snapshot(&mut fresh).await.unwrap()["data"], backup["data"]);
            for level in ["normal", "private", "highly_sensitive"] {
                let mut classified = backup.clone();
                for row in classified["data"]["resource_needs"].as_array_mut().unwrap() {
                    row["privacy_level"] = json!(level);
                }
                restore_with_safety(&mut fresh, &classified, &dir).await.unwrap();
                assert_eq!(snapshot(&mut fresh).await.unwrap()["data"], classified["data"]);
            }
            restore_with_safety(&mut fresh, &backup, &dir).await.unwrap();
            for value in [json!("invalid"), Value::Null] {
                let mut invalid = backup.clone();
                invalid["data"]["resource_needs"][0]["privacy_level"] = value;
                assert!(restore_with_safety(&mut fresh, &invalid, &dir).await.is_err());
                assert_eq!(snapshot(&mut fresh).await.unwrap()["data"], backup["data"]);
            }
            let mut v39 = backup.clone();
            v39["schemaVersion"] = json!(39);
            without_action_details(&mut v39);
            for table in ["goals", "decisions"] {
                for row in v39["data"][table].as_array_mut().unwrap() {
                    row["privacy_level"] = json!("highly_sensitive");
                }
            }
            for row in v39["data"]["resource_needs"].as_array_mut().unwrap() {
                row.as_object_mut().unwrap().remove("privacy_level");
            }
            restore_with_safety(&mut fresh, &v39, &dir).await.unwrap();
            let mut expected_v39 = v39["data"].clone();
            for row in expected_v39["actions"].as_array_mut().unwrap() {
                row["details_json"] = json!("{}");
            }
            for row in expected_v39["resource_needs"].as_array_mut().unwrap() {
                row["privacy_level"] = json!("highly_sensitive");
            }
            assert_eq!(snapshot(&mut fresh).await.unwrap()["data"], expected_v39);
            restore_with_safety(&mut fresh, &backup, &dir).await.unwrap();
            let mut v37 = backup.clone();
            v37["schemaVersion"] = json!(37);
            without_resource_ownership(&mut v37);
            v37["data"].as_object_mut().unwrap().remove("decision_resource_need_links");
            restore_with_safety(&mut fresh, &v37, &dir).await.unwrap();
            let mut expected_v37 = backup["data"].clone();
            expected_v37["decision_resource_need_links"] = json!([]);
            assert_eq!(snapshot(&mut fresh).await.unwrap()["data"], expected_v37);
            let mut v36 = backup.clone();
            v36["schemaVersion"] = json!(36);
            without_resource_ownership(&mut v36);
            v36["data"].as_object_mut().unwrap().remove("decision_person_links");
            v36["data"].as_object_mut().unwrap().remove("decision_resource_need_links");
            restore_with_safety(&mut fresh, &v36, &dir).await.unwrap();
            let mut expected_v36 = backup["data"].clone();
            expected_v36["decision_person_links"] = json!([]);
            expected_v36["decision_resource_need_links"] = json!([]);
            assert_eq!(snapshot(&mut fresh).await.unwrap()["data"], expected_v36);
            let mut v35 = backup.clone();
            v35["schemaVersion"] = json!(35);
            without_resource_ownership(&mut v35);
            v35["data"].as_object_mut().unwrap().remove("decision_navigation_links");
            v35["data"].as_object_mut().unwrap().remove("decision_person_links");
            v35["data"].as_object_mut().unwrap().remove("decision_resource_need_links");
            restore_with_safety(&mut fresh, &v35, &dir).await.unwrap();
            assert!(snapshot(&mut fresh).await.unwrap()["data"]["decision_navigation_links"].as_array().unwrap().is_empty());
            let mut v34 = backup.clone();
            v34["schemaVersion"] = json!(34);
            without_resource_ownership(&mut v34);
            v34["data"].as_object_mut().unwrap().remove("decision_navigation_links");
            v34["data"].as_object_mut().unwrap().remove("decision_person_links");
            v34["data"].as_object_mut().unwrap().remove("decision_resource_need_links");
            v34["data"]["life_navigation"][0].as_object_mut().unwrap().remove("privacy_level");
            restore_with_safety(&mut fresh, &v34, &dir).await.unwrap();
            assert_eq!(snapshot(&mut fresh).await.unwrap()["data"]["life_navigation"][0]["privacy_level"], json!("private"));
            let mut linked = backup.clone();
            linked["data"]["goals"][0]["horizon"] = json!("annual");
            linked["data"]["goals"][0]["direction_id"] = json!("navigation-1");
            restore_with_safety(&mut fresh, &linked, &dir).await.unwrap();
            assert_eq!(snapshot(&mut fresh).await.unwrap()["data"], linked["data"]);
            for (key, value) in [("horizon", json!("week")), ("direction_id", json!("missing")), ("direction_id", json!(7))] {
                let mut invalid = linked.clone();
                invalid["data"]["goals"][0][key] = value;
                assert!(restore_with_safety(&mut fresh, &invalid, &dir).await.is_err());
                assert_eq!(snapshot(&mut fresh).await.unwrap()["data"], linked["data"]);
            }
            let mut wrong_kind = linked.clone();
            wrong_kind["data"]["life_navigation"][0]["kind"] = json!("principle");
            assert!(restore_with_safety(&mut fresh, &wrong_kind, &dir).await.is_err());
            assert_eq!(snapshot(&mut fresh).await.unwrap()["data"], linked["data"]);
            let mut v32 = linked.clone();
            v32["schemaVersion"] = json!(32);
            without_resource_ownership(&mut v32);
            for row in v32["data"]["life_navigation"].as_array_mut().unwrap() {
                row.as_object_mut().unwrap().remove("privacy_level");
            }
            without_goal_direction(&mut v32);
            restore_with_safety(&mut fresh, &v32, &dir).await.unwrap();
            assert_eq!(snapshot(&mut fresh).await.unwrap()["data"]["goals"], with_null_goal_direction(&v32["data"]["goals"]));
            assert_eq!(snapshot(&mut fresh).await.unwrap()["data"]["life_navigation"], backup["data"]["life_navigation"]);
            let mut v31 = backup.clone();
            v31["schemaVersion"] = json!(31);
            without_resource_ownership(&mut v31);
            without_goal_direction(&mut v31);
            v31["data"].as_object_mut().unwrap().remove("life_navigation");
            restore_with_safety(&mut fresh, &v31, &dir).await.unwrap();
            assert!(snapshot(&mut fresh).await.unwrap()["data"]["life_navigation"].as_array().unwrap().is_empty());
            restore_with_safety(&mut fresh, &backup, &dir).await.unwrap();
            sqlx::query("UPDATE life_navigation SET description = '新版内容', updated_at = '2026-10-12T08:00:00Z' WHERE id = 'navigation-1'")
                .execute(&mut fresh).await.unwrap();
            let with_history = snapshot(&mut fresh).await.unwrap();
            let navigation_history = with_history["data"]["object_versions"].as_array().unwrap()
                .iter().position(|row| row["object_type"] == "navigation").unwrap();
            restore_with_safety(&mut fresh, &with_history, &dir).await.unwrap();
            assert_eq!(snapshot(&mut fresh).await.unwrap()["data"], with_history["data"]);
            for (key, value) in [("kind", json!("invalid")), ("title", json!(" ")),
                ("description", json!("x".repeat(6001))), ("created_at", json!("invalid")),
                ("updated_at", Value::Null), ("archived_at", json!(7))] {
                let mut invalid = with_history.clone();
                let mut old: Value = serde_json::from_str(invalid["data"]["object_versions"][navigation_history]["snapshot_json"].as_str().unwrap()).unwrap();
                old[key] = value;
                invalid["data"]["object_versions"][navigation_history]["snapshot_json"] = json!(old.to_string());
                assert!(restore_with_safety(&mut fresh, &invalid, &dir).await.is_err());
                assert_eq!(snapshot(&mut fresh).await.unwrap()["data"], with_history["data"]);
            }
            for malformed in ["{", "[]", "null"] {
                let mut invalid = with_history.clone();
                invalid["data"]["object_versions"][navigation_history]["snapshot_json"] = json!(malformed);
                assert!(restore_with_safety(&mut fresh, &invalid, &dir).await.is_err());
                assert_eq!(snapshot(&mut fresh).await.unwrap()["data"], with_history["data"]);
            }
            let mut v33 = with_history.clone();
            v33["schemaVersion"] = json!(33);
            without_resource_ownership(&mut v33);
            v33["data"].as_object_mut().unwrap().remove("decision_navigation_links");
            v33["data"].as_object_mut().unwrap().remove("decision_person_links");
            v33["data"].as_object_mut().unwrap().remove("decision_resource_need_links");
            v33["data"]["life_navigation"][0].as_object_mut().unwrap().remove("privacy_level");
            assert!(restore_with_safety(&mut fresh, &v33, &dir).await.is_err());
            v33["data"]["object_versions"].as_array_mut().unwrap().retain(|row| row["object_type"] != "navigation");
            restore_with_safety(&mut fresh, &v33, &dir).await.unwrap();
            let mut expected_v33 = v33["data"].clone();
            for row in expected_v33["actions"].as_array_mut().unwrap() {
                row["details_json"] = json!("{}");
            }
            for row in expected_v33["resource_needs"].as_array_mut().unwrap() {
                row["decision_id"] = Value::Null;
                row["privacy_level"] = json!("private");
            }
            expected_v33["decision_navigation_links"] = json!([]);
            expected_v33["decision_person_links"] = json!([]);
            expected_v33["decision_resource_need_links"] = json!([]);
            expected_v33["life_navigation"][0]["privacy_level"] = json!("private");
            assert_eq!(snapshot(&mut fresh).await.unwrap()["data"], expected_v33);
            sqlx::query("UPDATE life_navigation SET title = '恢复后可编辑', updated_at = '2026-10-12T09:00:00Z' WHERE id = 'navigation-1'")
                .execute(&mut fresh).await.unwrap();
            assert!(snapshot(&mut fresh).await.unwrap()["data"]["object_versions"].as_array().unwrap()
                .iter().any(|row| row["object_type"] == "navigation"));
            restore_with_safety(&mut fresh, &backup, &dir).await.unwrap();
            let action_id = backup["data"]["actions"][0]["id"].as_str().unwrap();
            sqlx::query("UPDATE actions SET details_json = ?, updated_at = ? WHERE id = ?")
                .bind(json!({"actualMinutes":0,"actualResult":"result"}).to_string())
                .bind("2026-10-13T09:00:00Z").bind(action_id).execute(&mut fresh).await.unwrap();
            sqlx::query("UPDATE actions SET details_json = '{}', updated_at = ? WHERE id = ?")
                .bind("2026-10-13T10:00:00Z").bind(action_id).execute(&mut fresh).await.unwrap();
            let action_backup = snapshot(&mut fresh).await.unwrap();
            let history_index = action_backup["data"]["object_versions"].as_array().unwrap().iter()
                .rposition(|row| row["object_type"] == "action").unwrap();
            let old: Value = serde_json::from_str(action_backup["data"]["object_versions"][history_index]["snapshot_json"].as_str().unwrap()).unwrap();
            let details: Value = serde_json::from_str(old["details_json"].as_str().unwrap()).unwrap();
            assert_eq!(details["actualMinutes"], json!(0));
            restore_with_safety(&mut fresh, &action_backup, &dir).await.unwrap();
            assert_eq!(snapshot(&mut fresh).await.unwrap()["data"], action_backup["data"]);
            for (key, value) in [("details_json", json!("[]")), ("title", json!(" ")), ("scheduled_for", json!("2026-02-30")), ("completed_at", json!(7))] {
                let mut invalid = action_backup.clone();
                let mut old = old.clone(); old[key] = value;
                invalid["data"]["object_versions"][history_index]["snapshot_json"] = json!(old.to_string());
                assert!(restore_with_safety(&mut fresh, &invalid, &dir).await.is_err());
                assert_eq!(snapshot(&mut fresh).await.unwrap()["data"], action_backup["data"]);
            }
            let mut v41 = action_backup.clone(); v41["schemaVersion"] = json!(41);
            assert!(restore_with_safety(&mut fresh, &v41, &dir).await.is_err());
            v41["data"]["object_versions"].as_array_mut().unwrap().retain(|row| row["object_type"] != "action");
            restore_with_safety(&mut fresh, &v41, &dir).await.unwrap();
            assert_eq!(snapshot(&mut fresh).await.unwrap()["data"], v41["data"]);
            source.close().await.unwrap();
            fresh.close().await.unwrap();
        });
        cleanup(&dir);
    }
}
