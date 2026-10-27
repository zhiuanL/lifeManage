use serde_json::{Map, Value};
use sqlx::SqliteConnection;
use std::collections::{HashMap, HashSet};

const ROLE_FIELDS: &[&str] = &["id", "name", "description", "active", "privacy_level",
    "archived_at", "deleted_at", "created_at", "updated_at", "version"];

fn object(value: &Value) -> Result<&Map<String, Value>, String> {
    value.as_object().ok_or_else(|| "身份角色备份结构无效。".into())
}
fn rows<'a>(data: &'a Value, table: &str) -> Result<&'a Vec<Value>, String> {
    data[table].as_array().ok_or_else(|| "身份角色备份缺少数据表。".into())
}
fn shape(row: &Value, fields: &[&str]) -> Result<(), String> {
    let row = object(row)?;
    if row.len() != fields.len() || fields.iter().any(|field| !row.contains_key(*field)) {
        return Err("身份角色备份字段不完整或包含未知字段。".into());
    }
    Ok(())
}
fn identifier(value: &Value) -> Result<&str, String> {
    value.as_str().filter(|id| !id.trim().is_empty()).ok_or_else(|| "身份角色备份标识无效。".into())
}
fn version(value: &Value) -> Result<u64, String> {
    let number = value.as_f64().ok_or("身份角色版本号无效。")?;
    if !number.is_finite() || number.fract() != 0.0 || !(1.0..=9_007_199_254_740_991.0).contains(&number) {
        return Err("身份角色版本号无效。".into());
    }
    Ok(number as u64)
}
async fn timestamp(conn: &mut SqliteConnection, value: &Value) -> Result<(), String> {
    let text = value.as_str().ok_or("身份角色备份时间无效。")?;
    let valid: i64 = sqlx::query_scalar("SELECT julianday(?) IS NOT NULL")
        .bind(text).fetch_one(&mut *conn).await.map_err(|error| error.to_string())?;
    if valid != 1 { return Err("身份角色备份时间无效。".into()); }
    Ok(())
}
async fn validate_fields(conn: &mut SqliteConnection, row: &Value) -> Result<(), String> {
    if row["name"].as_str().is_none_or(|text| text.trim().is_empty() || text.encode_utf16().count() > 120)
        || row["description"].as_str().is_none_or(|text| text.encode_utf16().count() > 6000)
        || !matches!(row["active"].as_f64(), Some(0.0 | 1.0))
        || !matches!(row["privacy_level"].as_str(), Some("normal" | "private" | "highly_sensitive")) {
        return Err("身份角色备份包含无效内容或隐私级别。".into());
    }
    version(&row["version"])?;
    for key in ["created_at", "updated_at"] { timestamp(conn, &row[key]).await?; }
    for key in ["archived_at", "deleted_at"] {
        if !row[key].is_null() { timestamp(conn, &row[key]).await?; }
    }
    Ok(())
}

pub(super) async fn validate_identity_role_data(conn: &mut SqliteConnection, data: &Value) -> Result<(), String> {
    let mut roles = HashMap::new();
    for row in rows(data, "identity_roles")? {
        shape(row, ROLE_FIELDS)?;
        let id = identifier(&row["id"])?;
        if roles.insert(id, row).is_some() { return Err("身份角色标识重复。".into()); }
        validate_fields(conn, row).await?;
    }
    for (table, column, target_table) in [
        ("identity_role_domain_links", "domain_id", "life_domains"),
        ("identity_role_goal_links", "goal_id", "goals"),
    ] {
        let targets = rows(data, target_table)?.iter().map(|row| identifier(&row["id"]))
            .collect::<Result<HashSet<_>, _>>()?;
        let mut seen = HashSet::new();
        for row in rows(data, table)? {
            shape(row, &["role_id", column])?;
            let id = identifier(&row["role_id"])?;
            let target = identifier(&row[column])?;
            if !roles.contains_key(id) || !targets.contains(target) || !seen.insert((id, target)) {
                return Err("身份角色关联无效或重复。".into());
            }
        }
    }
    let mut seen = HashSet::new();
    let fields: Vec<&str> = ROLE_FIELDS.iter().copied().filter(|field| *field != "id")
        .chain(["domain_ids", "goal_ids"]).collect();
    for row in rows(data, "identity_role_versions")? {
        shape(row, &["role_id", "version", "changed_at", "snapshot_json"])?;
        let id = identifier(&row["role_id"])?;
        let number = version(&row["version"])?;
        let role = roles.get(id).ok_or("身份角色历史归属或版本无效。")?;
        if number >= version(&role["version"])? || !seen.insert((id, number)) {
            return Err("身份角色历史归属或版本无效。".into());
        }
        timestamp(conn, &row["changed_at"]).await?;
        let snapshot: Value = serde_json::from_str(row["snapshot_json"].as_str().ok_or("身份角色历史快照无效。")?)
            .map_err(|_| "身份角色历史快照无效。")?;
        shape(&snapshot, &fields)?;
        validate_fields(conn, &snapshot).await?;
        if version(&snapshot["version"])? != number { return Err("身份角色历史版本与快照不一致。".into()); }
        for field in ["domain_ids", "goal_ids"] {
            let ids = snapshot[field].as_array().ok_or("身份角色历史关联无效。")?;
            let mut seen = HashSet::new();
            for id in ids {
                if !seen.insert(identifier(id)?) { return Err("身份角色历史关联重复。".into()); }
            }
        }
    }
    Ok(())
}
