use super::*;
use sqlx::Connection;

#[test]
fn domain_template_native_backup_roundtrip_and_compatibility() {
    let stamp = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos();
    let dir = std::env::temp_dir().join(format!("lifeos-native-domain-{}-{stamp}", std::process::id()));
    fs::create_dir(&dir).unwrap();
    let source_path = dir.join("source.sqlite");
    let fresh_path = dir.join("fresh.sqlite");
    let legacy_path = dir.join("legacy.sqlite");
    let helper = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../tests/helpers/create-domain-template-native-databases.mjs");
    let result = std::process::Command::new("node").arg(helper)
        .arg(&source_path).arg(&fresh_path).arg(&legacy_path).output().unwrap();
    assert!(result.status.success(), "{}", String::from_utf8_lossy(&result.stderr));
    tauri::async_runtime::block_on(async {
        let mut source = sqlx::SqliteConnection::connect(&format!("sqlite:{}", source_path.display())).await.unwrap();
        let mut fresh = sqlx::SqliteConnection::connect(&format!("sqlite:{}", fresh_path.display())).await.unwrap();
        let mut legacy = sqlx::SqliteConnection::connect(&format!("sqlite:{}", legacy_path.display())).await.unwrap();
        let backup = snapshot(&mut source).await.unwrap();
        assert_eq!(backup["schemaVersion"], 47);
        let before = snapshot(&mut fresh).await.unwrap();
        let safety = restore_with_safety(&mut fresh, &backup, &dir.join("safety")).await.unwrap();
        let safety: Value = serde_json::from_str(&fs::read_to_string(safety).unwrap()).unwrap();
        assert_eq!(safety["data"], before["data"]);
        assert_eq!(snapshot(&mut fresh).await.unwrap()["data"], backup["data"]);
        let preserved = backup["data"]["templates"].as_array().unwrap().iter()
            .find(|row| row["id"] == "preserved-template").unwrap();
        assert_eq!(preserved["version"], 3);
        assert_eq!(preserved["defaults_json"], r#"{"frequency":"保留原文"}"#);

        let legacy_backup = snapshot(&mut legacy).await.unwrap();
        assert_eq!(legacy_backup["schemaVersion"], 46);
        assert!(restore_with_safety(&mut legacy, &backup, &dir.join("future")).await.is_err());
        assert!(!dir.join("future").exists());
        assert_eq!(snapshot(&mut legacy).await.unwrap()["data"], legacy_backup["data"]);
        let mut disguised = backup.clone();
        disguised["schemaVersion"] = json!(46);
        assert!(restore_with_safety(&mut fresh, &disguised, &dir.join("disguised")).await.is_err());
        assert!(!dir.join("disguised").exists());

        for (index, defaults) in [json!({"icon":"unknown"}), json!({"currentState":"guess"}),
            json!({"longTermExpectation":"😀".repeat(251)}), json!([])].iter().enumerate() {
            let mut invalid = backup.clone();
            let row = invalid["data"]["templates"].as_array_mut().unwrap().iter_mut()
                .find(|row| row["category"] == "domain").unwrap();
            row["defaults_json"] = json!(defaults.to_string());
            let rejected = dir.join(format!("invalid-{index}"));
            assert!(restore_with_safety(&mut fresh, &invalid, &rejected).await.is_err());
            assert!(!rejected.exists());
            assert_eq!(snapshot(&mut fresh).await.unwrap()["data"], backup["data"]);
        }
        sqlx::query("CREATE TRIGGER fail_template_restore BEFORE INSERT ON templates BEGIN SELECT RAISE(ABORT, 'injected failure'); END")
            .execute(&mut fresh).await.unwrap();
        assert!(restore_with_safety(&mut fresh, &backup, &dir.join("rollback")).await.is_err());
        assert_eq!(snapshot(&mut fresh).await.unwrap()["data"], backup["data"]);
        sqlx::query("DROP TRIGGER fail_template_restore").execute(&mut fresh).await.unwrap();
        restore_with_safety(&mut fresh, &legacy_backup, &dir.join("legacy")).await.unwrap();
        assert_eq!(snapshot(&mut fresh).await.unwrap()["schemaVersion"], 47);
        assert_eq!(snapshot(&mut fresh).await.unwrap()["data"], legacy_backup["data"]);
        source.close().await.unwrap();
        fresh.close().await.unwrap();
        legacy.close().await.unwrap();
    });
    fs::remove_dir_all(dir).unwrap();
}
