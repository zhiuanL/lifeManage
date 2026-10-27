use super::*;
use sqlx::Connection;

#[test]
fn landscape_context_restore_preserves_text_legacy_and_rollback() {
    let stamp = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos();
    let dir = std::env::temp_dir().join(format!("lifeos-landscape-{}-{stamp}", std::process::id()));
    fs::create_dir(&dir).unwrap();
    let source_path = dir.join("source.sqlite");
    let fresh_path = dir.join("fresh.sqlite");
    let legacy_path = dir.join("legacy.sqlite");
    let helper = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../tests/helpers/create-landscape-context-native-databases.mjs");
    let result = std::process::Command::new("node").arg(helper)
        .arg(&source_path).arg(&fresh_path).arg(&legacy_path).output().unwrap();
    assert!(result.status.success(), "{}", String::from_utf8_lossy(&result.stderr));
    tauri::async_runtime::block_on(async {
        let mut source = sqlx::SqliteConnection::connect(&format!("sqlite:{}", source_path.display())).await.unwrap();
        let mut fresh = sqlx::SqliteConnection::connect(&format!("sqlite:{}", fresh_path.display())).await.unwrap();
        let mut legacy = sqlx::SqliteConnection::connect(&format!("sqlite:{}", legacy_path.display())).await.unwrap();
        let backup = snapshot(&mut source).await.unwrap();
        assert_eq!(backup["schemaVersion"], 52);
        assert_eq!(backup["data"]["landscape_context"][0]["life_state"], " 原始生活状态 ");
        let previous = snapshot(&mut fresh).await.unwrap();
        let path = restore_with_safety(&mut fresh, &backup, &dir.join("safety")).await.unwrap();
        let safety: Value = serde_json::from_str(&fs::read_to_string(path).unwrap()).unwrap();
        assert_eq!(safety["data"], previous["data"]);
        assert_eq!(snapshot(&mut fresh).await.unwrap()["data"], backup["data"]);
        let old = snapshot(&mut legacy).await.unwrap();
        assert_eq!(old["schemaVersion"], 51);
        assert!(restore_with_safety(&mut legacy, &backup, &dir.join("future")).await.is_err());
        assert!(!dir.join("future").exists());
        assert_eq!(snapshot(&mut legacy).await.unwrap()["data"], old["data"]);
        for (index, (key, value)) in [
            ("id", json!("other")), ("current_stage", json!("x".repeat(121))),
            ("life_state", Value::Null), ("life_tensions", json!(7)),
            ("updated_at", json!("invalid")), ("extra", json!("unexpected")),
        ].into_iter().enumerate() {
            let mut invalid = backup.clone();
            invalid["data"]["landscape_context"][0][key] = value;
            let rejected = dir.join(format!("invalid-{index}"));
            assert!(restore_with_safety(&mut fresh, &invalid, &rejected).await.is_err());
            assert!(!rejected.exists());
            assert_eq!(snapshot(&mut fresh).await.unwrap()["data"], backup["data"]);
        }
        let mut duplicate = backup.clone();
        let row = duplicate["data"]["landscape_context"][0].clone();
        duplicate["data"]["landscape_context"].as_array_mut().unwrap().push(row);
        assert!(restore_with_safety(&mut fresh, &duplicate, &dir.join("duplicate")).await.is_err());
        assert_eq!(snapshot(&mut fresh).await.unwrap()["data"], backup["data"]);
        sqlx::query("CREATE TRIGGER fail_landscape_restore BEFORE INSERT ON landscape_context BEGIN SELECT RAISE(ABORT, 'injected failure'); END")
            .execute(&mut fresh).await.unwrap();
        assert!(restore_with_safety(&mut fresh, &backup, &dir.join("rollback")).await.is_err());
        assert_eq!(snapshot(&mut fresh).await.unwrap()["data"], backup["data"]);
        sqlx::query("DROP TRIGGER fail_landscape_restore").execute(&mut fresh).await.unwrap();
        restore_with_safety(&mut fresh, &old, &dir.join("legacy")).await.unwrap();
        let restored = snapshot(&mut fresh).await.unwrap();
        assert_eq!(restored["schemaVersion"], 52);
        assert_eq!(restored["data"]["landscape_context"], json!([]));
        let mut projected = restored["data"].clone();
        projected.as_object_mut().unwrap().remove("landscape_context");
        assert_eq!(projected, old["data"]);
        source.close().await.unwrap();
        fresh.close().await.unwrap();
        legacy.close().await.unwrap();
    });
    fs::remove_dir_all(dir).unwrap();
}
