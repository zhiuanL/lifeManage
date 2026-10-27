use super::*;
use sqlx::Connection;

#[test]
fn domain_history_native_roundtrip_legacy_and_rollback() {
    let stamp = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos();
    let dir = std::env::temp_dir().join(format!("lifeos-domain-history-{}-{stamp}", std::process::id()));
    fs::create_dir(&dir).unwrap();
    let source_path = dir.join("source.sqlite");
    let fresh_path = dir.join("fresh.sqlite");
    let legacy_path = dir.join("legacy.sqlite");
    let helper = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../tests/helpers/create-domain-history-native-databases.mjs");
    let result = std::process::Command::new("node").arg(helper)
        .arg(&source_path).arg(&fresh_path).arg(&legacy_path).output().unwrap();
    assert!(result.status.success(), "{}", String::from_utf8_lossy(&result.stderr));
    tauri::async_runtime::block_on(async {
        let mut source = sqlx::SqliteConnection::connect(&format!("sqlite:{}", source_path.display())).await.unwrap();
        let mut fresh = sqlx::SqliteConnection::connect(&format!("sqlite:{}", fresh_path.display())).await.unwrap();
        let mut legacy = sqlx::SqliteConnection::connect(&format!("sqlite:{}", legacy_path.display())).await.unwrap();
        let backup = snapshot(&mut source).await.unwrap();
        assert_eq!(backup["schemaVersion"], 48);
        assert_eq!(backup["data"]["life_domain_versions"].as_array().unwrap().len(), 1);
        let record: Value = serde_json::from_str(backup["data"]["life_domain_versions"][0]["after_json"].as_str().unwrap()).unwrap();
        assert_eq!(record["current_state"], "  保留原文\n舒适活动  ");
        let before = snapshot(&mut fresh).await.unwrap();
        let safety = restore_with_safety(&mut fresh, &backup, &dir.join("safety")).await.unwrap();
        let safety: Value = serde_json::from_str(&fs::read_to_string(safety).unwrap()).unwrap();
        assert_eq!(safety["data"], before["data"]);
        assert_eq!(snapshot(&mut fresh).await.unwrap()["data"], backup["data"]);

        let legacy_backup = snapshot(&mut legacy).await.unwrap();
        assert_eq!(legacy_backup["schemaVersion"], 47);
        assert!(restore_with_safety(&mut legacy, &backup, &dir.join("future")).await.is_err());
        assert!(!dir.join("future").exists());
        assert_eq!(snapshot(&mut legacy).await.unwrap()["data"], legacy_backup["data"]);
        let mut disguised = backup.clone();
        disguised["schemaVersion"] = json!(47);
        assert!(restore_with_safety(&mut fresh, &disguised, &dir.join("disguised")).await.is_err());

        for (index, (field, value)) in [
            ("id", json!(0)), ("domain_id", json!("missing")),
            ("changed_at", json!("2026-02-30T08:00:00Z")),
            ("before_json", json!("[]")),
            ("after_json", json!(json!({"name":"missing fields"}).to_string())),
        ].into_iter().enumerate() {
            let mut invalid = backup.clone();
            invalid["data"]["life_domain_versions"][0][field] = value;
            let rejected = dir.join(format!("invalid-{index}"));
            assert!(restore_with_safety(&mut fresh, &invalid, &rejected).await.is_err());
            assert!(!rejected.exists());
            assert_eq!(snapshot(&mut fresh).await.unwrap()["data"], backup["data"]);
        }
        let mut duplicate = backup.clone();
        let row = duplicate["data"]["life_domain_versions"][0].clone();
        duplicate["data"]["life_domain_versions"].as_array_mut().unwrap().push(row);
        assert!(restore_with_safety(&mut fresh, &duplicate, &dir.join("duplicate")).await.is_err());
        assert_eq!(snapshot(&mut fresh).await.unwrap()["data"], backup["data"]);

        sqlx::query("CREATE TRIGGER fail_domain_history_restore BEFORE INSERT ON life_domain_versions BEGIN SELECT RAISE(ABORT, 'injected failure'); END")
            .execute(&mut fresh).await.unwrap();
        assert!(restore_with_safety(&mut fresh, &backup, &dir.join("rollback")).await.is_err());
        assert_eq!(snapshot(&mut fresh).await.unwrap()["data"], backup["data"]);
        sqlx::query("DROP TRIGGER fail_domain_history_restore").execute(&mut fresh).await.unwrap();

        let domain_id = backup["data"]["life_domain_versions"][0]["domain_id"].as_str().unwrap();
        sqlx::query("UPDATE life_domains SET status = 'active', updated_at = '2026-10-22T10:00:00.000Z' WHERE id = ?")
            .bind(domain_id).execute(&mut fresh).await.unwrap();
        let next: i64 = sqlx::query_scalar("SELECT MAX(id) FROM life_domain_versions").fetch_one(&mut fresh).await.unwrap();
        assert!(next > backup["data"]["life_domain_versions"][0]["id"].as_i64().unwrap());
        restore_with_safety(&mut fresh, &legacy_backup, &dir.join("legacy")).await.unwrap();
        let restored = snapshot(&mut fresh).await.unwrap();
        assert_eq!(restored["schemaVersion"], 48);
        assert_eq!(restored["data"]["life_domain_versions"], json!([]));
        let mut projected = restored["data"].clone();
        projected.as_object_mut().unwrap().remove("life_domain_versions");
        assert_eq!(projected, legacy_backup["data"]);
        source.close().await.unwrap();
        fresh.close().await.unwrap();
        legacy.close().await.unwrap();
    });
    fs::remove_dir_all(dir).unwrap();
}
