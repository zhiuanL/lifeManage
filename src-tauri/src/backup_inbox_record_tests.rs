use super::*;
use sqlx::Connection;

#[test]
fn inbox_record_native_backup_roundtrip_and_compatibility() {
    let stamp = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos();
    let dir = std::env::temp_dir().join(format!("lifeos-native-inbox-{stamp}"));
    fs::create_dir(&dir).unwrap();
    let source_path = dir.join("source.sqlite");
    let fresh_path = dir.join("fresh.sqlite");
    let legacy_path = dir.join("legacy.sqlite");
    let helper = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../tests/helpers/create-inbox-record-native-databases.mjs");
    let result = std::process::Command::new("node").arg(helper)
        .arg(&source_path).arg(&fresh_path).arg(&legacy_path).output().unwrap();
    assert!(result.status.success(), "{}", String::from_utf8_lossy(&result.stderr));
    tauri::async_runtime::block_on(async {
        let mut source = sqlx::SqliteConnection::connect(&format!("sqlite:{}", source_path.display())).await.unwrap();
        let mut fresh = sqlx::SqliteConnection::connect(&format!("sqlite:{}", fresh_path.display())).await.unwrap();
        let mut legacy = sqlx::SqliteConnection::connect(&format!("sqlite:{}", legacy_path.display())).await.unwrap();
        let backup = snapshot(&mut source).await.unwrap();
        assert_eq!(backup["schemaVersion"], 46);
        let before = snapshot(&mut fresh).await.unwrap();
        let safety = restore_with_safety(&mut fresh, &backup, &dir.join("safety")).await.unwrap();
        let safety: Value = serde_json::from_str(&fs::read_to_string(safety).unwrap()).unwrap();
        assert_eq!(safety["data"], before["data"]);
        assert_eq!(snapshot(&mut fresh).await.unwrap()["data"], backup["data"]);

        let legacy_backup = snapshot(&mut legacy).await.unwrap();
        assert_eq!(legacy_backup["schemaVersion"], 45);
        assert!(restore_with_safety(&mut legacy, &backup, &dir.join("future")).await.is_err());
        assert!(!dir.join("future").exists());
        assert_eq!(snapshot(&mut legacy).await.unwrap()["data"], legacy_backup["data"]);

        for kind in ["event", "person"] {
            let mut invalid = backup.clone();
            let row = invalid["data"]["inbox_items"].as_array_mut().unwrap().iter_mut()
                .find(|row| row["target_type"] == kind && row["status"] == "organized").unwrap();
            row["target_id"] = json!("missing");
            let rejected = dir.join(format!("orphan-{kind}"));
            assert!(restore_with_safety(&mut fresh, &invalid, &rejected).await.is_err());
            assert!(!rejected.exists());
            assert_eq!(snapshot(&mut fresh).await.unwrap()["data"], backup["data"]);
        }
        let mut disguised = backup.clone();
        disguised["schemaVersion"] = json!(45);
        assert!(restore_with_safety(&mut fresh, &disguised, &dir.join("disguised")).await.is_err());
        assert!(!dir.join("disguised").exists());

        sqlx::query("CREATE TRIGGER fail_inbox_restore BEFORE INSERT ON inbox_items BEGIN SELECT RAISE(ABORT, 'injected failure'); END")
            .execute(&mut fresh).await.unwrap();
        assert!(restore_with_safety(&mut fresh, &backup, &dir.join("rollback")).await.is_err());
        assert_eq!(snapshot(&mut fresh).await.unwrap()["data"], backup["data"]);
        sqlx::query("DROP TRIGGER fail_inbox_restore").execute(&mut fresh).await.unwrap();
        restore_with_safety(&mut fresh, &legacy_backup, &dir.join("legacy")).await.unwrap();
        assert_eq!(snapshot(&mut fresh).await.unwrap()["data"], legacy_backup["data"]);
        source.close().await.unwrap();
        fresh.close().await.unwrap();
        legacy.close().await.unwrap();
    });
    fs::remove_dir_all(dir).unwrap();
}
