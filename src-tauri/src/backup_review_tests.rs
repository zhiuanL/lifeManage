use super::*;
use sqlx::Connection;

#[test]
fn structured_reviews_native_roundtrip_and_rollback() {
    let stamp = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos();
    let dir = std::env::temp_dir().join(format!("lifeos-native-review-{stamp}"));
    fs::create_dir_all(&dir).unwrap();
    let source_path = dir.join("source.sqlite");
    let fresh_path = dir.join("fresh.sqlite");
    let helper = Path::new(env!("CARGO_MANIFEST_DIR")).join("../tests/helpers/create-review-native-databases.mjs");
    let result = std::process::Command::new("node").arg(helper).arg(&source_path).arg(&fresh_path).output().unwrap();
    assert!(result.status.success(), "{}", String::from_utf8_lossy(&result.stderr));
    tauri::async_runtime::block_on(async {
        let mut source = sqlx::SqliteConnection::connect(&format!("sqlite:{}", source_path.display())).await.unwrap();
        let mut fresh = sqlx::SqliteConnection::connect(&format!("sqlite:{}", fresh_path.display())).await.unwrap();
        let backup = snapshot(&mut source).await.unwrap();
        assert_eq!(backup["schemaVersion"], 43);
        assert_eq!(backup["data"]["review_answers"].as_array().unwrap().len(), 10);
        let before = snapshot(&mut fresh).await.unwrap();
        let safety_path = restore_with_safety(&mut fresh, &backup, &dir.join("safety")).await.unwrap();
        let safety: Value = serde_json::from_str(&fs::read_to_string(safety_path).unwrap()).unwrap();
        assert_eq!(safety["data"], before["data"]);
        assert_eq!(snapshot(&mut fresh).await.unwrap()["data"], backup["data"]);

        for mutation in ["orphan", "duplicate", "missing", "period", "history"] {
            let mut invalid = backup.clone();
            match mutation {
                "orphan" => invalid["data"]["review_answers"][0]["review_id"] = json!("missing"),
                "duplicate" => {
                    let answer = invalid["data"]["review_answers"][0].clone();
                    invalid["data"]["review_answers"].as_array_mut().unwrap().push(answer);
                }
                "missing" => { invalid["data"]["review_answers"].as_array_mut().unwrap().remove(0); }
                "period" => {
                    let review = invalid["data"]["reviews"].as_array_mut().unwrap().iter_mut().find(|row| row["review_type"] == "weekly").unwrap();
                    review["period_end"] = json!("2026-10-19");
                }
                _ => {
                    let history = invalid["data"]["object_versions"].as_array_mut().unwrap().iter_mut().find(|row| row["object_id"] == "native-daily").unwrap();
                    history["snapshot_json"] = json!("{\"review_type\":\"daily\"}");
                }
            }
            let rejected_dir = dir.join(format!("rejected-{mutation}"));
            assert!(restore_with_safety(&mut fresh, &invalid, &rejected_dir).await.is_err(), "{mutation}");
            assert!(!rejected_dir.exists(), "Preflight must precede safety file creation");
            assert_eq!(snapshot(&mut fresh).await.unwrap()["data"], backup["data"]);
        }

        sqlx::query("CREATE TRIGGER fail_answer_restore AFTER INSERT ON review_answers BEGIN SELECT RAISE(ABORT, 'Injected answer failure'); END").execute(&mut fresh).await.unwrap();
        assert!(restore_with_safety(&mut fresh, &backup, &dir.join("rollback")).await.is_err());
        assert_eq!(snapshot(&mut fresh).await.unwrap()["data"], backup["data"]);
        sqlx::query("DROP TRIGGER fail_answer_restore").execute(&mut fresh).await.unwrap();
        let mut old_target = super::tests::database("old-target", true).await;
        let old_before = snapshot(&mut old_target).await.unwrap();
        let old_safety = dir.join("rejected-old-target");
        assert!(restore_with_safety(&mut old_target, &backup, &old_safety).await.is_err());
        assert!(!old_safety.exists());
        assert_eq!(snapshot(&mut old_target).await.unwrap()["data"], old_before["data"]);
        old_target.close().await.unwrap();

        let mut legacy = backup.clone();
        legacy["schemaVersion"] = json!(42);
        legacy["data"].as_object_mut().unwrap().remove("review_answers");
        for review in legacy["data"]["reviews"].as_array_mut().unwrap() {
            for column in REVIEW_COLUMNS { review.as_object_mut().unwrap().remove(*column); }
        }
        for history in legacy["data"]["object_versions"].as_array_mut().unwrap().iter_mut().filter(|row| row["object_type"] == "review") {
            let mut old: Value = serde_json::from_str(history["snapshot_json"].as_str().unwrap()).unwrap();
            for column in REVIEW_COLUMNS { old.as_object_mut().unwrap().remove(*column); }
            old.as_object_mut().unwrap().remove("answers");
            history["snapshot_json"] = json!(old.to_string());
        }
        restore_with_safety(&mut fresh, &legacy, &dir.join("legacy")).await.unwrap();
        let upgraded = snapshot(&mut fresh).await.unwrap();
        assert_eq!(upgraded["schemaVersion"], 43);
        assert!(upgraded["data"]["review_answers"].as_array().unwrap().is_empty());
        for review in upgraded["data"]["reviews"].as_array().unwrap() {
            for column in REVIEW_COLUMNS { assert!(review[*column].is_null()); }
        }
        let mut downgraded = upgraded["data"].clone();
        downgraded.as_object_mut().unwrap().remove("review_answers");
        for review in downgraded["reviews"].as_array_mut().unwrap() {
            for column in REVIEW_COLUMNS { review.as_object_mut().unwrap().remove(*column); }
        }
        assert_eq!(downgraded, legacy["data"]);
        source.close().await.unwrap();
        fresh.close().await.unwrap();
    });
    fs::remove_dir_all(&dir).unwrap();
}
