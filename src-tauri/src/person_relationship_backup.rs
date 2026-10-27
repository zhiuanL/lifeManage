use serde_json::{Map, Value};
use std::collections::HashSet;
use super::domain_history_backup::timestamp;

fn shape<'a>(value: &'a Value, fields: &[&str]) -> Result<&'a Map<String, Value>, String> {
    let row = value.as_object().ok_or("人物关系历史记录无效。")?;
    if row.len() != fields.len() || fields.iter().any(|field| !row.contains_key(*field)) {
        return Err("人物关系历史字段不完整或包含未知字段。".into());
    }
    Ok(row)
}

fn snapshot(text: &str, domains: &HashSet<&str>) -> Result<Value, String> {
    let value: Value = serde_json::from_str(text).map_err(|_| "人物关系历史快照不是有效 JSON。")?;
    let row = shape(&value, &["name", "relationshipType", "state", "domainIds"])?;
    for (field, limit) in [("name", 80), ("relationshipType", 80), ("state", 200)] {
        let text = row[field].as_str().ok_or("人物关系历史文字无效。")?;
        if text.encode_utf16().count() > limit || (field == "name" && text.trim().is_empty()) {
            return Err("人物关系历史文字超出长度限制或为空。".into());
        }
    }
    let ids = row["domainIds"].as_array().ok_or("人物关系历史领域范围无效。")?;
    let mut seen = HashSet::new();
    for value in ids {
        let id = value.as_str().filter(|id| !id.trim().is_empty()).ok_or("人物关系历史领域无效。")?;
        if !domains.contains(id) || !seen.insert(id) {
            return Err("人物关系历史领域不存在或重复。".into());
        }
    }
    Ok(value)
}

pub(super) fn validate_person_relationship_data(data: &Value) -> Result<(), String> {
    let people = data["people"].as_array().ok_or("备份缺少人物数据。")?
        .iter().filter_map(|row| row["id"].as_str()).collect::<HashSet<_>>();
    let domains = data["life_domains"].as_array().ok_or("备份缺少生活领域。")?
        .iter().filter_map(|row| row["id"].as_str()).collect::<HashSet<_>>();
    let rows = data["person_relationship_versions"].as_array().ok_or("备份缺少人物关系历史。")?;
    let mut seen = HashSet::new();
    for value in rows {
        let row = shape(value, &["id", "person_id", "changed_at", "before_json", "after_json"])?;
        let id = row["id"].as_f64().ok_or("人物关系历史标识无效。")?;
        if !id.is_finite() || id.fract() != 0.0 || !(1.0..=9_007_199_254_740_991.0).contains(&id)
            || !seen.insert(id as u64) { return Err("人物关系历史标识无效或重复。".into()); }
        let person = row["person_id"].as_str().filter(|id| !id.trim().is_empty())
            .ok_or("人物关系历史归属无效。")?;
        if !people.contains(person) { return Err("人物关系历史引用不存在的人物。".into()); }
        if !row["changed_at"].as_str().is_some_and(timestamp) {
            return Err("人物关系历史时间无效。".into());
        }
        for field in ["before_json", "after_json"] {
            snapshot(row[field].as_str().ok_or("人物关系历史快照无效。")?, &domains)?;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn validates_original_scopes_and_never_normalizes_historical_text() {
        let before = json!({"name":"  老朋友  ","relationshipType":"朋友","state":"保持联系","domainIds":["health"]});
        let after = json!({"name":"老朋友","relationshipType":"朋友","state":"暂时疏远","domainIds":[]});
        let data = json!({"people":[{"id":"person"}],"life_domains":[{"id":"health"}],
            "person_relationship_versions":[{"id":1,"person_id":"person",
                "changed_at":"2026-10-22T08:00:00.000Z",
                "before_json":before.to_string(),"after_json":after.to_string()}]});
        assert!(validate_person_relationship_data(&data).is_ok());
        let mut invalid = data.clone();
        invalid["person_relationship_versions"][0]["person_id"] = json!("missing");
        assert!(validate_person_relationship_data(&invalid).is_err());
        invalid = data.clone();
        invalid["person_relationship_versions"][0]["changed_at"] = json!("2026-02-30T08:00:00Z");
        assert!(validate_person_relationship_data(&invalid).is_err());
        invalid = data.clone();
        invalid["person_relationship_versions"][0]["id"] = json!(0.5);
        assert!(validate_person_relationship_data(&invalid).is_err());
        let domains = HashSet::from(["health"]);
        assert_eq!(snapshot(&before.to_string(), &domains).unwrap()["name"], "  老朋友  ");
        for row in [
            json!({"name":"老朋友","relationshipType":"朋友","state":"","domainIds":["missing"]}),
            json!({"name":"老朋友","relationshipType":"朋友","state":"","domainIds":["health","health"]}),
            json!({"name":"","relationshipType":"朋友","state":"","domainIds":[]}),
            json!({"name":"老朋友","relationshipType":"朋友","state":"","domainIds":[],"extra":true}),
        ] { assert!(snapshot(&row.to_string(), &domains).is_err()); }
    }
}
