use serde_json::{Map, Value};
use std::collections::HashSet;

const FIELDS: &[&str] = &["name", "description", "focus", "color_key", "icon_key",
    "current_state", "long_term_expectation", "status"];

fn shape<'a>(value: &'a Value, fields: &[&str]) -> Result<&'a Map<String, Value>, String> {
    let row = value.as_object().ok_or("领域历史备份记录无效。")?;
    if row.len() != fields.len() || fields.iter().any(|field| !row.contains_key(*field)) {
        return Err("领域历史备份字段不完整或包含未知字段。".into());
    }
    Ok(row)
}

fn number(text: &str) -> Option<u32> {
    if text.is_empty() || !text.bytes().all(|byte| byte.is_ascii_digit()) { return None; }
    text.parse().ok()
}

fn clock(text: &str, seconds: bool) -> bool {
    let size = if seconds { 8 } else { 5 };
    text.len() == size && text.as_bytes()[2] == b':'
        && number(&text[..2]).is_some_and(|hour| hour <= 23)
        && number(&text[3..5]).is_some_and(|minute| minute <= 59)
        && (!seconds || (text.as_bytes()[5] == b':'
            && number(&text[6..8]).is_some_and(|second| second <= 59)))
}

// Match the frontend's ISO/calendar contract instead of SQLite's permissive date normalization.
pub(super) fn timestamp(text: &str) -> bool {
    if !text.is_ascii() || text.len() < 20 { return false; }
    let bytes = text.as_bytes();
    if bytes[4] != b'-' || bytes[7] != b'-' || bytes[10] != b'T' { return false; }
    let Some(year) = number(&text[..4]) else { return false };
    let Some(month) = number(&text[5..7]) else { return false };
    let Some(day) = number(&text[8..10]) else { return false };
    let leap = year % 4 == 0 && (year % 100 != 0 || year % 400 == 0);
    let days = match month {
        1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
        4 | 6 | 9 | 11 => 30,
        2 => if leap { 29 } else { 28 },
        _ => return false,
    };
    if year < 100 || day == 0 || day > days || !clock(&text[11..19], true) { return false; }
    let rest = &text[19..];
    let (fraction, zone) = if rest.ends_with('Z') {
        (&rest[..rest.len() - 1], "Z")
    } else if rest.len() >= 6 {
        let split = rest.len() - 6;
        (&rest[..split], &rest[split..])
    } else { return false };
    if !fraction.is_empty() && (fraction.len() < 2 || fraction.len() > 4
        || !fraction.starts_with('.') || number(&fraction[1..]).is_none()) { return false; }
    zone == "Z" || ((zone.starts_with('+') || zone.starts_with('-')) && clock(&zone[1..], false))
}

fn snapshot(text: &str) -> Result<(), String> {
    let value: Value = serde_json::from_str(text).map_err(|_| "领域历史快照不是有效 JSON。")?;
    let row = shape(&value, FIELDS)?;
    if row.values().any(|value| !value.is_string()) { return Err("领域历史快照内容无效。".into()); }
    for (field, limit) in [("name", 28), ("description", 280), ("focus", 120),
        ("current_state", 500), ("long_term_expectation", 500)] {
        if row[field].as_str().unwrap().encode_utf16().count() > limit {
            return Err("领域历史快照内容超出长度限制。".into());
        }
    }
    if row["name"].as_str().unwrap().trim().is_empty()
        || !matches!(row["color_key"].as_str(), Some("ocean" | "fern" | "coral" | "gold" | "violet"))
        || !matches!(row["icon_key"].as_str(), Some("heart" | "briefcase" | "users" | "wallet" | "sprout" | "home" | "book-open" | "sparkles"))
        || !matches!(row["status"].as_str(), Some("active" | "paused" | "archived")) {
        return Err("领域历史快照内容无效。".into());
    }
    Ok(())
}

pub(super) fn validate_domain_history_data(data: &Value) -> Result<(), String> {
    let domains = data["life_domains"].as_array().ok_or("备份缺少生活领域。")?
        .iter().filter_map(|row| row["id"].as_str()).collect::<HashSet<_>>();
    let rows = data["life_domain_versions"].as_array().ok_or("备份缺少领域历史。")?;
    let mut seen = HashSet::new();
    for value in rows {
        let row = shape(value, &["id", "domain_id", "changed_at", "before_json", "after_json"])?;
        let id = row["id"].as_f64().ok_or("领域历史标识无效。")?;
        if !id.is_finite() || id.fract() != 0.0 || !(1.0..=9_007_199_254_740_991.0).contains(&id)
            || !seen.insert(id as u64) { return Err("领域历史标识无效或重复。".into()); }
        let domain = row["domain_id"].as_str().ok_or("领域历史归属无效。")?;
        if domain.trim().is_empty() || !domains.contains(domain) { return Err("领域历史归属无效。".into()); }
        if !row["changed_at"].as_str().is_some_and(timestamp) { return Err("领域历史时间无效。".into()); }
        for field in ["before_json", "after_json"] {
            snapshot(row[field].as_str().ok_or("领域历史快照无效。")?)?;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn strict_calendar_and_clock() {
        for text in ["2026-10-22T08:00:00Z", "2024-02-29T08:00:00.123+08:00"] {
            assert!(timestamp(text));
        }
        for text in ["2026-02-30T08:00:00Z", "2026-10-22T24:00:00Z",
            "2026-10-22", "2026-10-22T08:00:00.1234Z", "2026-10-22T08:00:00+24:00"] {
            assert!(!timestamp(text));
        }
    }
}
