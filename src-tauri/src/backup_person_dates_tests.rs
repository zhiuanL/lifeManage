use super::*;
use sqlx::Connection;

#[test]
fn person_dates_native_backup_preserves_old_date_and_safely_restores() {
    let stamp = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos();
    let dir = std::env::temp_dir().join(format!("lifeos-person-dates-{}-{stamp}", std::process::id()));
    fs::create_dir(&dir).unwrap();
    let source_path = dir.join("source.sqlite");
    let fresh_path = dir.join("fresh.sqlite");
    let legacy_path = dir.join("legacy.sqlite");
    let helper = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../tests/helpers/create-person-dates-native-databases.mjs");
    let result = std::process::Command::new("node").arg(helper)
        .arg(&source_path).arg(&fresh_path).arg(&legacy_path).output().unwrap();
    assert!(result.status.success(), "{}", String::from_utf8_lossy(&result.stderr));
    tauri::async_runtime::block_on(async {
        let mut source = sqlx::SqliteConnection::connect(&format!("sqlite:{}", source_path.display())).await.unwrap();
        let mut fresh = sqlx::SqliteConnection::connect(&format!("sqlite:{}", fresh_path.display())).await.unwrap();
        let mut legacy = sqlx::SqliteConnection::connect(&format!("sqlite:{}", legacy_path.display())).await.unwrap();
        let backup = snapshot(&mut source).await.unwrap();
        assert_eq!(backup["schemaVersion"], 49);
        assert_eq!(backup["data"]["person_dates"].as_array().unwrap().len(), 2);
        assert_eq!(backup["data"]["person_dates"][1]["label"], "  第一次合作  ");
        let before = snapshot(&mut fresh).await.unwrap();
        let safety = restore_with_safety(&mut fresh, &backup, &dir.join("safety")).await.unwrap();
        let safety: Value = serde_json::from_str(&fs::read_to_string(safety).unwrap()).unwrap();
        assert_eq!(safety["data"], before["data"]);
        assert_eq!(snapshot(&mut fresh).await.unwrap()["data"], backup["data"]);
        let old = snapshot(&mut legacy).await.unwrap();
        assert_eq!(old["schemaVersion"], 48);
        assert!(restore_with_safety(&mut legacy, &backup, &dir.join("future")).await.is_err());
        assert!(!dir.join("future").exists());
        let mut disguised = backup.clone();
        disguised["schemaVersion"] = json!(48);
        assert!(restore_with_safety(&mut fresh, &disguised, &dir.join("disguised")).await.is_err());
        for (index, (field, value)) in [
            ("person_id", json!("missing")), ("sort_order", json!(-1)),
            ("happened_on", json!("2026-02-30")), ("label", json!("")),
            ("kind", json!("unknown")),
        ].into_iter().enumerate() {
            let mut invalid = backup.clone();
            invalid["data"]["person_dates"][0][field] = value;
            let rejected = dir.join(format!("invalid-{index}"));
            assert!(restore_with_safety(&mut fresh, &invalid, &rejected).await.is_err());
            assert!(!rejected.exists());
            assert_eq!(snapshot(&mut fresh).await.unwrap()["data"], backup["data"]);
        }
        sqlx::query("CREATE TRIGGER fail_dates_restore BEFORE INSERT ON person_dates BEGIN SELECT RAISE(ABORT, 'injected failure'); END")
            .execute(&mut fresh).await.unwrap();
        assert!(restore_with_safety(&mut fresh, &backup, &dir.join("rollback")).await.is_err());
        assert_eq!(snapshot(&mut fresh).await.unwrap()["data"], backup["data"]);
        sqlx::query("DROP TRIGGER fail_dates_restore").execute(&mut fresh).await.unwrap();
        restore_with_safety(&mut fresh, &old, &dir.join("legacy")).await.unwrap();
        let restored = snapshot(&mut fresh).await.unwrap();
        assert_eq!(restored["schemaVersion"], 49);
        assert_eq!(restored["data"]["person_dates"], json!([]));
        let mut projected = restored["data"].clone();
        projected.as_object_mut().unwrap().remove("person_dates");
        assert_eq!(projected, old["data"]);
        source.close().await.unwrap();
        fresh.close().await.unwrap();
        legacy.close().await.unwrap();
    });
    fs::remove_dir_all(dir).unwrap();
}
