use serde_json::Value;

pub(super) fn validate_domain_templates(data: &Value, version: u64) -> Result<(), String> {
    let rows = data["templates"].as_array().ok_or("模板备份缺失。")?;
    for row in rows {
        if row["category"].as_str() != Some("domain") { continue; }
        if version < 47 {
            return Err("此备份版本不支持领域模板，未更改当前数据。".into());
        }
        let name = row["name"].as_str().ok_or("领域模板名称无效。")?;
        if name.trim().is_empty() || name.trim().encode_utf16().count() > 80 ||
            row["version"].as_f64().map_or(true, |value|
                !value.is_finite() || value < 1.0 || value.fract() != 0.0 || value > 9_007_199_254_740_991.0) {
            return Err("领域模板版本或名称无效。".into());
        }
        let defaults: Value = serde_json::from_str(row["defaults_json"].as_str().ok_or("领域模板内容无效。")?)
            .map_err(|_| "领域模板内容无效。")?;
        let fields = defaults.as_object().ok_or("领域模板内容无效。")?;
        for (key, value) in fields {
            let text = value.as_str().ok_or("领域模板字段无效。")?;
            let valid = match key.as_str() {
                "name" => text.encode_utf16().count() <= 28,
                "description" => text.encode_utf16().count() <= 280,
                "focus" => text.encode_utf16().count() <= 120,
                "longTermExpectation" => text.encode_utf16().count() <= 500,
                "color" => ["ocean", "fern", "coral", "gold", "violet"].contains(&text),
                "icon" => ["heart", "briefcase", "users", "wallet", "sprout", "home", "book-open", "sparkles"].contains(&text),
                _ => false,
            };
            if !valid { return Err("领域模板字段无效或内容过长。".into()); }
        }
    }
    Ok(())
}
