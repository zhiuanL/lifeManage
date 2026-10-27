#[path = "../src-tauri/src/review_backup.rs"]
mod review_backup;

#[cfg(test)]
mod links_tests {
    use super::review_backup::{validate_review_data, validate_review_links};
    use serde_json::{json, Value};

    fn fixture() -> Value {
        json!({"reviews":[{"id":"r"}], "goals":[{"id":"g"}], "issues":[{"id":"i"}],
            "review_goal_links":[{"review_id":"r","goal_id":"g"}],
            "review_issue_links":[{"review_id":"r","issue_id":"i"}]})
    }

    #[test]
    fn accepts_links_without_mutating_input() {
        let data = fixture();
        let before = data.clone();
        validate_review_links(&data).unwrap();
        assert_eq!(data, before);
    }

    #[test]
    fn rejects_orphans_duplicates_and_invalid_shapes() {
        for (table, column) in [("review_goal_links", "goal_id"), ("review_issue_links", "issue_id")] {
            for change in 0..6 {
                let mut data = fixture();
                match change {
                    0 => data[table][0]["review_id"] = json!("missing"),
                    1 => data[table][0][column] = json!("missing"),
                    2 => data[table][0]["extra"] = Value::Null,
                    3 => data[table][0][column] = json!(" invalid "),
                    4 => data[table] = Value::Null,
                    _ => {
                        let duplicate = data[table][0].clone();
                        data[table].as_array_mut().unwrap().push(duplicate);
                    }
                }
                assert!(validate_review_links(&data).is_err());
            }
        }
    }

    #[test]
    fn history_links_allow_removed_objects_but_reject_invalid_ids() {
        for key in ["goal_ids", "issue_ids"] {
            let mut snapshot = json!({"reflection":"old"});
            snapshot[key] = json!(["removed"]);
            let mut data = json!({"reviews":[], "review_answers":[], "object_versions":[{
                "object_type":"review", "object_id":"removed-review", "snapshot_json":snapshot.to_string()}]});
            validate_review_data(&data).unwrap();
            for invalid in [json!(["duplicate", "duplicate"]), json!([" invalid "]), json!(3)] {
                snapshot[key] = invalid;
                data["object_versions"][0]["snapshot_json"] = snapshot.to_string().into();
                assert!(validate_review_data(&data).is_err());
            }
        }
    }
}
