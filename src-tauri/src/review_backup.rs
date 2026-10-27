use serde_json::{Map, Value};
use std::collections::{HashMap, HashSet};

// Shared preflight for structured review snapshots and owned answers.
pub(super) fn validate_review_data(data: &Value) -> Result<(), String> {
    let reviews = data["reviews"].as_array().ok_or("Missing review records.")?;
    let answers = data["review_answers"].as_array().ok_or("Missing review answers.")?;
    let histories = data["object_versions"].as_array().ok_or("Missing review histories.")?;
    let mut groups: HashMap<&str, Vec<&Value>> = HashMap::new();
    let ids = reviews.iter().map(|row| identifier(&row["id"])).collect::<Result<HashSet<_>, _>>()?;
    for answer in answers {
        let source = object(answer)?;
        if source.len() != 3 || !["review_id", "field_key", "value"].iter().all(|key| source.contains_key(*key)) {
            return Err("Invalid review answer shape.".into());
        }
        let id = identifier(&answer["review_id"])?;
        if !ids.contains(id) { return Err("Orphan review answer.".into()); }
        text(&answer["value"], 12000)?;
        groups.entry(id).or_default().push(answer);
    }
    for row in reviews {
        let id = identifier(&row["id"])?;
        validate_structure(row, groups.get(id).map_or(&[], Vec::as_slice))?;
    }
    for history in histories.iter().filter(|row| row["object_type"] == "review") {
        let snapshot: Value = serde_json::from_str(history["snapshot_json"].as_str().ok_or("Invalid review history.")?)
            .map_err(|_| "Invalid review history.")?;
        let source = object(&snapshot)?;
        for key in ["goal_ids", "issue_ids"] {
            if let Some(value) = source.get(key) {
                let ids = value.as_array().ok_or("Invalid review history links.")?;
                let mut seen = HashSet::new();
                for id in ids { if !seen.insert(identifier(id)?) { return Err("Duplicate review history link.".into()); } }
            }
        }
        if !source.contains_key("answers") && !COLUMNS.iter().any(|key| source.contains_key(*key)) { continue; }
        identifier(&history["object_id"])?;
        let answers = snapshot["answers"].as_array().ok_or("Missing review history answers.")?;
        for answer in answers {
            let source = object(answer)?;
            if source.len() != 2 || !source.contains_key("field_key") || !source.contains_key("value") {
                return Err("Invalid review history answer shape.".into());
            }
        }
        validate_structure(&snapshot, &answers.iter().collect::<Vec<_>>())?;
    }
    Ok(())
}

const COLUMNS: [&str; 6] = ["review_type", "period_start", "period_end", "review_status", "review_mode", "template_snapshot"];

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    #[test]
    fn accepts_integer_json_versions_and_monthly_narrative() {
        let mut data = fixture("monthly", "2026-10-01", "2026-10-31");
        let mut template: Value = serde_json::from_str(data["reviews"][0]["template_snapshot"].as_str().unwrap()).unwrap();
        template["version"] = json!(1.0);
        template["fields"][0]["key"] = json!("toString");
        data["reviews"][0]["template_snapshot"] = template.to_string().into();
        data["reviews"][0]["review_mode"] = json!("narrative");
        data["review_answers"][0]["field_key"] = json!("toString");
        validate_review_data(&data).unwrap();
        template["version"] = json!(1.5);
        data["reviews"][0]["template_snapshot"] = template.to_string().into();
        assert!(validate_review_data(&data).is_err());
    }
    #[test]
    fn rejects_bad_templates_status_modes_and_utf16_limits() {
        let base = fixture("daily", "2026-10-13", "2026-10-13");
        for (key, value) in [
            ("review_status", json!("unknown")), ("review_mode", json!("narrative")),
            ("template_snapshot", json!("invalid")), ("template_snapshot", json!("[]")),
        ] {
            let mut data = base.clone();
            data["reviews"][0][key] = value;
            assert!(validate_review_data(&data).is_err());
        }
        for change in 0..5 {
            let mut data = base.clone();
            let mut template: Value = serde_json::from_str(data["reviews"][0]["template_snapshot"].as_str().unwrap()).unwrap();
            let first = template["fields"][0].clone();
            match change {
                0 => template["version"] = json!(9_007_199_254_740_992u64),
                1 => template["fields"][0]["key"] = json!("constructor"),
                2 => template["fields"][0]["label"] = json!("\u{1f600}".repeat(41)),
                3 => template["fields"].as_array_mut().unwrap().push(first),
                _ => template["extra"] = Value::Null,
            }
            data["reviews"][0]["template_snapshot"] = template.to_string().into();
            assert!(validate_review_data(&data).is_err());
        }
        let mut data = base;
        data["review_answers"][0]["value"] = json!("\u{1f600}".repeat(6001));
        assert!(validate_review_data(&data).is_err());
    }
    #[test]
    fn rejects_corrupt_history_without_current_review() {
        for change in 0..4 {
            let mut data = fixture("daily", "2026-10-13", "2026-10-13");
            data["reviews"] = json!([]);
            data["review_answers"] = json!([]);
            let mut snapshot: Value = serde_json::from_str(data["object_versions"][0]["snapshot_json"].as_str().unwrap()).unwrap();
            match change {
                0 => { snapshot.as_object_mut().unwrap().remove("answers"); },
                1 => snapshot["answers"][0]["value"] = Value::Null,
                2 => snapshot["answers"][0]["extra"] = json!("unexpected"),
                _ => snapshot["period_end"] = json!("2026-10-14"),
            }
            data["object_versions"][0]["snapshot_json"] = snapshot.to_string().into();
            assert!(validate_review_data(&data).is_err());
        }
    }
    #[test]
    fn rejects_invalid_dates_periods_and_partial_metadata() {
        for (kind, start, end) in [
            ("daily", "2026-02-30", "2026-02-30"), ("daily", "2026-10-13", "2026-10-14"),
            ("weekly", "2026-10-13", "2026-10-19"), ("weekly", "2026-10-12", "2026-10-17"),
            ("monthly", "2023-02-01", "2023-02-29"), ("quarterly", "2026-11-01", "2027-01-31"),
            ("annual", "2026-01-01", "2026-12-30"), ("daily", "0099-01-01", "0099-01-01"),
            ("daily", "2026-1-01", "2026-1-01"), ("daily", "2026-00-01", "2026-00-01"),
        ] { assert!(validate_review_data(&fixture(kind, start, end)).is_err()); }
        let mut data = fixture("daily", "2026-10-13", "2026-10-13");
        data["reviews"][0]["review_type"] = Value::Null;
        assert!(validate_review_data(&data).is_err());
        data["reviews"][0].as_object_mut().unwrap().remove("review_type");
        assert!(validate_review_data(&data).is_err());
    }
    #[test]
    fn rejects_orphan_duplicate_missing_and_malformed_answers() {
        let base = fixture("daily", "2026-10-13", "2026-10-13");
        for answer in [
            json!({"review_id":"missing", "field_key":"learning", "value":""}),
            json!({"review_id":" review-1", "field_key":"learning", "value":""}),
            json!({"review_id":"review-1", "field_key":"unknown", "value":""}),
            json!({"review_id":"review-1", "field_key":"learning", "value":0}),
            json!({"review_id":"review-1", "field_key":"learning", "value":"", "extra":null}),
        ] {
            let mut data = base.clone();
            data["review_answers"] = json!([answer]);
            assert!(validate_review_data(&data).is_err());
        }
        let mut data = base.clone();
        data["review_answers"].as_array_mut().unwrap().push(base["review_answers"][0].clone());
        assert!(validate_review_data(&data).is_err());
        data["review_answers"] = json!([]);
        assert!(validate_review_data(&data).is_err());
    }
    fn fixture(kind: &str, start: &str, end: &str) -> Value {
        let template = json!({"id":"template", "name":"Review", "version":1,
            "fields":[{"key":"learning", "label":"Learning", "defaultValue":""}]});
        let row = json!({"id":"review-1", "review_type":kind, "period_start":start, "period_end":end,
            "review_status":"draft", "review_mode":"structured", "template_snapshot":template.to_string()});
        let mut snapshot = row.clone();
        snapshot["answers"] = json!([{"field_key":"learning", "value":""}]);
        json!({"reviews":[row], "review_answers":[{"review_id":"review-1", "field_key":"learning", "value":""}],
            "object_versions":[{"object_type":"review", "object_id":"review-1", "snapshot_json":snapshot.to_string()}]})
    }
    #[test]
    fn five_cycles_and_detached_history_preserve_blank_answers() {
        for (kind, start, end) in [
            ("daily", "2026-10-13", "2026-10-13"), ("weekly", "2026-10-12", "2026-10-18"),
            ("weekly", "2025-12-29", "2026-01-04"), ("monthly", "2024-02-01", "2024-02-29"),
            ("quarterly", "2026-10-01", "2026-12-31"), ("annual", "2026-01-01", "2026-12-31"),
        ] {
            let mut data = fixture(kind, start, end);
            let before = data.clone();
            validate_review_data(&data).unwrap();
            assert_eq!(data, before);
            data["reviews"] = json!([]);
            data["review_answers"] = json!([]);
            validate_review_data(&data).unwrap();
        }
    }
    #[test]
    fn unclassified_and_legacy_history_are_not_invented() {
        let mut data = fixture("daily", "2026-10-13", "2026-10-13");
        for key in COLUMNS { data["reviews"][0][key] = Value::Null; }
        data["review_answers"] = json!([]);
        data["object_versions"][0]["snapshot_json"] = json!({"reflection":"Old text"}).to_string().into();
        validate_review_data(&data).unwrap();
        data["review_answers"] = json!([{"review_id":"review-1", "field_key":"learning", "value":""}]);
        assert!(validate_review_data(&data).is_err());
    }
}

fn object(value: &Value) -> Result<&Map<String, Value>, String> {
    value.as_object().ok_or_else(|| "Invalid review backup object.".into())
}
fn text(value: &Value, limit: usize) -> Result<&str, String> {
    let value = value.as_str().ok_or("Invalid review backup text.")?;
    if value.encode_utf16().count() > limit { return Err("Review backup text exceeds limit.".into()); }
    Ok(value.trim())
}
fn identifier(value: &Value) -> Result<&str, String> {
    let id = value.as_str().ok_or("Invalid review identifier.")?;
    if id.is_empty() || id != id.trim() { return Err("Invalid review identifier.".into()); }
    Ok(id)
}
fn days(year: u32, month: u32) -> u32 {
    match month {
        2 if year % 4 == 0 && (year % 100 != 0 || year % 400 == 0) => 29,
        2 => 28, 4 | 6 | 9 | 11 => 30, _ => 31,
    }
}
fn date(value: &Value) -> Result<(u32, u32, u32), String> {
    let value = value.as_str().ok_or("Invalid review date.")?;
    let bytes = value.as_bytes();
    if bytes.len() != 10 || bytes[4] != b'-' || bytes[7] != b'-'
        || bytes.iter().enumerate().any(|(i, b)| i != 4 && i != 7 && !b.is_ascii_digit()) {
        return Err("Invalid review date.".into());
    }
    let year = value[..4].parse::<u32>().map_err(|_| "Invalid review date.")?;
    let month = value[5..7].parse::<u32>().map_err(|_| "Invalid review date.")?;
    let day = value[8..].parse::<u32>().map_err(|_| "Invalid review date.")?;
    // Match the TypeScript date-only contract, including its lower year bound.
    if year < 100 || !(1..=12).contains(&month) || day == 0 || day > days(year, month) {
        return Err("Invalid review date.".into());
    }
    Ok((year, month, day))
}
fn ordinal((year, month, day): (u32, u32, u32)) -> u32 {
    let prior = year - 1;
    365 * prior + prior / 4 - prior / 100 + prior / 400
        + (1..month).map(|m| days(year, m)).sum::<u32>() + day
}

fn validate_structure(row: &Value, answers: &[&Value]) -> Result<(), String> {
    let source = object(row)?;
    if COLUMNS.iter().any(|key| !source.contains_key(*key)) { return Err("Missing review metadata.".into()); }
    if COLUMNS.iter().all(|key| row[*key].is_null()) {
        return if answers.is_empty() { Ok(()) } else { Err("Unclassified review has answers.".into()) };
    }
    if COLUMNS.iter().any(|key| !row[*key].is_string()) { return Err("Partial review metadata.".into()); }
    let start = date(&row["period_start"])?;
    let end = date(&row["period_end"])?;
    let kind = row["review_type"].as_str().unwrap();
    let valid = match kind {
        "daily" => start == end,
        "weekly" => ordinal(start) % 7 == 1 && ordinal(end) == ordinal(start) + 6,
        "monthly" => start.0 == end.0 && start.1 == end.1 && start.2 == 1 && end.2 == days(end.0, end.1),
        "quarterly" => start.0 == end.0 && (start.1 - 1) % 3 == 0 && start.2 == 1
            && end.1 == start.1 + 2 && end.2 == days(end.0, end.1),
        "annual" => start == (end.0, 1, 1) && end == (start.0, 12, 31),
        _ => false,
    };
    if !valid { return Err("Review period does not match cycle.".into()); }
    if !matches!(row["review_status"].as_str(), Some("draft" | "completed"))
        || !matches!(row["review_mode"].as_str(), Some("structured" | "narrative"))
        || (matches!(kind, "daily" | "weekly") && row["review_mode"] == "narrative") {
        return Err("Invalid review status or mode.".into());
    }
    let template: Value = serde_json::from_str(row["template_snapshot"].as_str().unwrap())
        .map_err(|_| "Corrupt review template snapshot.")?;
    let source = object(&template)?;
    if source.keys().any(|key| !["id", "name", "version", "fields"].contains(&key.as_str()))
        || text(&template["id"], 128)?.is_empty() || text(&template["name"], 80)?.is_empty()
        || template["version"].as_f64().map_or(true, |n| !n.is_finite() || n < 1.0 || n.fract() != 0.0 || n > 9_007_199_254_740_991.0) {
        return Err("Invalid review template version.".into());
    }
    let fields = template["fields"].as_array().ok_or("Invalid review template fields.")?;
    if fields.is_empty() || fields.len() > 32 { return Err("Invalid review field count.".into()); }
    let mut keys = HashSet::new();
    for field in fields {
        let source = object(field)?;
        let key = text(&field["key"], 64)?;
        let bytes = key.as_bytes();
        if bytes.first().map_or(true, |b| !b.is_ascii_lowercase())
            || bytes.iter().any(|b| !b.is_ascii_alphanumeric() && *b != b'_')
            || matches!(key, "constructor" | "prototype") || !keys.insert(key)
            || text(&field["label"], 80)?.is_empty()
            || source.keys().any(|k| !["key", "label", "defaultValue"].contains(&k.as_str())) {
            return Err("Invalid or duplicate review template field.".into());
        }
        if let Some(value) = source.get("defaultValue") { text(value, 2000)?; }
    }
    let mut seen = HashSet::new();
    for answer in answers {
        let key = answer["field_key"].as_str().ok_or("Invalid review answer key.")?;
        if !keys.contains(key) || !seen.insert(key) { return Err("Unknown or duplicate review answer.".into()); }
        text(&answer["value"], 12000)?;
    }
    if seen.len() != keys.len() { return Err("Missing review answer.".into()); }
    Ok(())
}

pub(super) fn validate_review_links(data: &Value) -> Result<(), String> {
    let reviews = data["reviews"].as_array().ok_or("Missing reviews.")?.iter()
        .map(|row| identifier(&row["id"])).collect::<Result<HashSet<_>, _>>()?;
    for (table, target_table, column) in [("review_goal_links", "goals", "goal_id"), ("review_issue_links", "issues", "issue_id")] {
        let targets = data[target_table].as_array().ok_or("Missing linked objects.")?.iter()
            .map(|row| identifier(&row["id"])).collect::<Result<HashSet<_>, _>>()?;
        let mut pairs = HashSet::new();
        for row in data[table].as_array().ok_or("Missing review links.")? {
            let source = object(row)?;
            if source.len() != 2 || !source.contains_key("review_id") || !source.contains_key(column) { return Err("Invalid review link shape.".into()); }
            let review = identifier(&row["review_id"])?;
            let target = identifier(&row[column])?;
            if !reviews.contains(review) || !targets.contains(target) || !pairs.insert((review, target)) { return Err("Orphan or duplicate review link.".into()); }
        }
    }
    Ok(())
}
