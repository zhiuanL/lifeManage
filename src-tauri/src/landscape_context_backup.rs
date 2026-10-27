use serde_json::Value;
use sqlx::SqliteConnection;

pub(super) async fn validate_landscape_context_data(
    conn: &mut SqliteConnection, data: &Value,
) -> Result<(), String> {
    let rows = data["landscape_context"].as_array().ok_or("生活状态备份缺失。")?;
    if rows.len() > 1 { return Err("生活状态备份只能有一条当前记录。".into()); }
    for value in rows {
        let row = value.as_object().ok_or("生活状态备份行无效。")?;
        let fields = ["id", "life_state", "current_stage", "current_focus", "life_tensions", "updated_at"];
        if row.len() != fields.len() || fields.iter().any(|key| !row.contains_key(*key))
            || row["id"].as_str() != Some("current") {
            return Err("生活状态备份字段无效。".into());
        }
        for (key, limit) in [("life_state", 2000), ("current_stage", 120),
            ("current_focus", 500), ("life_tensions", 2000)] {
            if row[key].as_str().map_or(true, |text| text.trim().encode_utf16().count() > limit) {
                return Err("生活状态备份文字无效或过长。".into());
            }
        }
        let date = row["updated_at"].as_str().ok_or("生活状态备份日期无效。")?;
        let valid: i64 = sqlx::query_scalar("SELECT julianday(?) IS NOT NULL")
            .bind(date).fetch_one(&mut *conn).await.map_err(|e| e.to_string())?;
        if valid == 0 { return Err("生活状态备份日期无效。".into()); }
    }
    Ok(())
}
