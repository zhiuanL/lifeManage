use serde_json::Value;
use std::collections::{HashMap, HashSet};

fn plain_date(text: &str) -> bool {
    if !text.is_ascii() || text.len() != 10 { return false; }
    let bytes = text.as_bytes();
    if bytes[4] != b'-' || bytes[7] != b'-'
        || bytes.iter().enumerate().any(|(i, b)| i != 4 && i != 7 && !b.is_ascii_digit()) {
        return false;
    }
    let year = text[..4].parse::<u32>().unwrap();
    let month = text[5..7].parse::<u32>().unwrap();
    let day = text[8..10].parse::<u32>().unwrap();
    let leap = year % 4 == 0 && (year % 100 != 0 || year % 400 == 0);
    let days = match month {
        1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
        4 | 6 | 9 | 11 => 30,
        2 => if leap { 29 } else { 28 },
        _ => return false,
    };
    year >= 100 && day > 0 && day <= days
}

pub(super) fn validate_person_dates_data(data: &Value) -> Result<(), String> {
    let people = data["people"].as_array().ok_or("备份缺少人物数据。")?
        .iter().filter_map(|row| row["id"].as_str()).collect::<HashSet<_>>();
    let rows = data["person_dates"].as_array().ok_or("备份缺少人物日期数据。")?;
    let mut positions = HashSet::new();
    let mut dates = HashSet::new();
    let mut counts: HashMap<&str, (usize, usize)> = HashMap::new();
    let fields = ["person_id", "sort_order", "kind", "label", "happened_on"];
    for value in rows {
        let row = value.as_object().ok_or("人物日期备份行无效。")?;
        if row.len() != fields.len() || fields.iter().any(|field| !row.contains_key(*field)) {
            return Err("人物日期备份字段不完整或包含未知字段。".into());
        }
        let person = row["person_id"].as_str().filter(|id| !id.trim().is_empty())
            .ok_or("人物日期归属无效。")?;
        if !people.contains(person) { return Err("人物日期引用不存在的人物。".into()); }
        let position = row["sort_order"].as_f64().ok_or("人物日期排序无效。")?;
        if position.fract() != 0.0 || !(0.0..=20.0).contains(&position)
            || !positions.insert((person, position as u64)) {
            return Err("人物日期排序无效或重复。".into());
        }
        let kind = row["kind"].as_str().ok_or("人物日期类型无效。")?;
        let label = row["label"].as_str().ok_or("人物日期名称无效。")?;
        let date = row["happened_on"].as_str().filter(|text| plain_date(text))
            .ok_or("人物日期不是有效年月日。")?;
        if label.trim().is_empty() || label.encode_utf16().count() > 80
            || !matches!(kind, "birthday" | "important") || (kind == "birthday" && label != "生日")
            || !dates.insert((person, kind, label, date)) {
            return Err("人物日期名称、类型无效或同名同日重复。".into());
        }
        let count = counts.entry(person).or_default();
        if kind == "birthday" { count.0 += 1; } else { count.1 += 1; }
        if count.0 > 1 || count.1 > 20 {
            return Err("最多保存一个生日和二十个重要日期。".into());
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn dates_use_real_calendar_and_preserve_labels() {
        for date in ["2024-02-29", "2026-10-22", "0100-01-01"] { assert!(plain_date(date)); }
        for date in ["2026-02-29", "2026-02-30", "2026-13-01", "2026-01-00",
            "2026-1-01", "0099-01-01", "年月日"] { assert!(!plain_date(date)); }
        let data = json!({"people":[{"id":"person"}], "person_dates":[
            {"person_id":"person","sort_order":0,"kind":"birthday","label":"生日","happened_on":"1990-02-28"},
            {"person_id":"person","sort_order":1,"kind":"important","label":"  第一次合作  ","happened_on":"2026-10-22"}
        ]});
        assert!(validate_person_dates_data(&data).is_ok());
        let mut invalid = data.clone();
        invalid["person_dates"][1]["kind"] = json!("birthday");
        invalid["person_dates"][1]["label"] = json!("生日");
        assert!(validate_person_dates_data(&invalid).is_err());
        invalid = data.clone();
        invalid["person_dates"][1]["sort_order"] = json!(0);
        assert!(validate_person_dates_data(&invalid).is_err());
        invalid = data.clone();
        invalid["person_dates"][1]["person_id"] = json!("missing");
        assert!(validate_person_dates_data(&invalid).is_err());
        invalid = data.clone();
        invalid["person_dates"][1]["happened_on"] = json!("2026-02-30");
        assert!(validate_person_dates_data(&invalid).is_err());
    }
}
