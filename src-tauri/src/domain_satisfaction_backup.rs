use serde_json::Value;
use std::collections::HashSet;

pub(super) fn validate_domain_satisfaction_data(data: &Value) -> Result<(), String> {
    let domains = data["life_domains"].as_array().ok_or("备份缺少领域数据。")?
        .iter().filter_map(|row| row["id"].as_str()).collect::<HashSet<_>>();
    let metrics = data["metric_definitions"].as_array().ok_or("备份缺少指标数据。")?
        .iter().filter_map(|row| row["id"].as_str()).collect::<HashSet<_>>();
    let pairs = data["metric_domain_links"].as_array().ok_or("备份缺少指标领域关联。")?
        .iter().filter_map(|row| Some((row["domain_id"].as_str()?, row["metric_id"].as_str()?)))
        .collect::<HashSet<_>>();
    let rows = data["domain_satisfaction_links"].as_array().ok_or("备份缺少满意度选择。")?;
    let mut seen = HashSet::new();
    for value in rows {
        let row = value.as_object().ok_or("领域满意度备份行无效。")?;
        if row.len() != 2 || !row.contains_key("domain_id") || !row.contains_key("metric_id") {
            return Err("领域满意度备份字段无效。".into());
        }
        let domain = row["domain_id"].as_str().ok_or("领域满意度归属无效。")?;
        let metric = row["metric_id"].as_str().ok_or("领域满意度指标无效。")?;
        if !domains.contains(domain) || !metrics.contains(metric) ||
            !pairs.contains(&(domain, metric)) || !seen.insert(domain) {
            return Err("领域满意度评分引用无效或重复。".into());
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn satisfaction_requires_one_explicit_link_per_domain() {
        let data = json!({"life_domains":[{"id":"d"},{"id":"other"}],
            "metric_definitions":[{"id":"m","archived":1}],
            "metric_domain_links":[{"domain_id":"d","metric_id":"m"}],
            "domain_satisfaction_links":[{"domain_id":"d","metric_id":"m"}]});
        assert!(validate_domain_satisfaction_data(&data).is_ok());
        for patch in [json!({"domain_id":"other","metric_id":"m"}),
            json!({"domain_id":"d","metric_id":"missing"}),
            json!({"domain_id":"d","metric_id":null}),
            json!({"domain_id":"d","metric_id":"m","score":0})] {
            let mut invalid = data.clone();
            invalid["domain_satisfaction_links"][0] = patch;
            assert!(validate_domain_satisfaction_data(&invalid).is_err());
        }
        let mut invalid = data.clone();
        invalid["domain_satisfaction_links"] = json!([data["domain_satisfaction_links"][0],
            data["domain_satisfaction_links"][0]]);
        assert!(validate_domain_satisfaction_data(&invalid).is_err());
        invalid["domain_satisfaction_links"] = json!([]);
        assert!(validate_domain_satisfaction_data(&invalid).is_ok());
    }
}
