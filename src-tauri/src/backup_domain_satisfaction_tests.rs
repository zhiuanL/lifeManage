use super::*;
use sqlx::Connection;

#[test]
fn domain_satisfaction_restore_preserves_zero_and_rolls_back() {
    let stamp = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos();
    let dir = std::env::temp_dir().join(format!("lifeos-satisfaction-{}-{stamp}", std::process::id()));
    fs::create_dir(&dir).unwrap();
    let source_path = dir.join("source.sqlite");
    let fresh_path = dir.join("fresh.sqlite");
    let legacy_path = dir.join("legacy.sqlite");
    let helper = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../tests/helpers/create-domain-satisfaction-native-databases.mjs");
    let result = std::process::Command::new("node").arg(helper)
        .arg(&source_path).arg(&fresh_path).arg(&legacy_path).output().unwrap();
    assert!(result.status.success(), "{}", String::from_utf8_lossy(&result.stderr));
    tauri::async_runtime::block_on(async {
        let mut source = sqlx::SqliteConnection::connect(&format!("sqlite:{}", source_path.display())).await.unwrap();
        let mut fresh = sqlx::SqliteConnection::connect(&format!("sqlite:{}", fresh_path.display())).await.unwrap();
        let mut legacy = sqlx::SqliteConnection::connect(&format!("sqlite:{}", legacy_path.display())).await.unwrap();
        let backup = snapshot(&mut source).await.unwrap();
        assert_eq!(backup["schemaVersion"], 51);
        assert_eq!(backup["data"]["domain_satisfaction_links"],
            json!([{"domain_id":"satisfaction-domain","metric_id":"source-rating"}]));
        let score = backup["data"]["metric_records"].as_array().unwrap().iter()
            .find(|row| row["id"] == "satisfaction-record").unwrap();
        assert_eq!(score["value"].as_f64(), Some(0.0));
        assert_eq!(score["note"], " 原评分记录 ");
        let current = snapshot(&mut fresh).await.unwrap();
        let safety = restore_with_safety(&mut fresh, &backup, &dir.join("safety")).await.unwrap();
        let safety: Value = serde_json::from_str(&fs::read_to_string(safety).unwrap()).unwrap();
        assert_eq!(safety["data"], current["data"]);
        assert_eq!(snapshot(&mut fresh).await.unwrap()["data"], backup["data"]);
        let old = snapshot(&mut legacy).await.unwrap();
        assert_eq!(old["schemaVersion"], 50);
        assert!(restore_with_safety(&mut legacy, &backup, &dir.join("future")).await.is_err());
        assert!(!dir.join("future").exists());
        assert_eq!(snapshot(&mut legacy).await.unwrap()["data"], old["data"]);
        for (index, row) in [
            json!({"domain_id":"missing","metric_id":"source-rating"}),
            json!({"domain_id":"satisfaction-domain","metric_id":"missing"}),
            json!({"domain_id":"satisfaction-domain","metric_id":null}),
            json!({"domain_id":"satisfaction-domain","metric_id":"source-rating","score":0}),
        ].into_iter().enumerate() {
            let mut invalid = backup.clone();
            invalid["data"]["domain_satisfaction_links"][0] = row;
            let rejected = dir.join(format!("invalid-{index}"));
            assert!(restore_with_safety(&mut fresh, &invalid, &rejected).await.is_err());
            assert!(!rejected.exists());
            assert_eq!(snapshot(&mut fresh).await.unwrap()["data"], backup["data"]);
        }
        sqlx::query("CREATE TRIGGER fail_satisfaction_restore BEFORE INSERT ON domain_satisfaction_links BEGIN SELECT RAISE(ABORT, 'injected failure'); END")
            .execute(&mut fresh).await.unwrap();
        assert!(restore_with_safety(&mut fresh, &backup, &dir.join("rollback")).await.is_err());
        assert_eq!(snapshot(&mut fresh).await.unwrap()["data"], backup["data"]);
        sqlx::query("DROP TRIGGER fail_satisfaction_restore").execute(&mut fresh).await.unwrap();
        restore_with_safety(&mut fresh, &old, &dir.join("legacy")).await.unwrap();
        let restored = snapshot(&mut fresh).await.unwrap();
        assert_eq!(restored["schemaVersion"], 51);
        assert_eq!(restored["data"]["domain_satisfaction_links"], json!([]));
        let mut projected = restored["data"].clone();
        projected.as_object_mut().unwrap().remove("domain_satisfaction_links");
        assert_eq!(projected, old["data"]);
        source.close().await.unwrap();
        fresh.close().await.unwrap();
        legacy.close().await.unwrap();
    });
    fs::remove_dir_all(dir).unwrap();
}
