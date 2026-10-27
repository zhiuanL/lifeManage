use super::*;
use sqlx::Connection;

#[test]
fn person_relationship_native_restore_retains_facts_and_rolls_back_failures() {
    let stamp = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos();
    let dir = std::env::temp_dir().join(format!("lifeos-person-relationship-{}-{stamp}", std::process::id()));
    fs::create_dir(&dir).unwrap();
    let source_path = dir.join("source.sqlite");
    let fresh_path = dir.join("fresh.sqlite");
    let legacy_path = dir.join("legacy.sqlite");
    let helper = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../tests/helpers/create-person-relationship-native-databases.mjs");
    let result = std::process::Command::new("node").arg(helper)
        .arg(&source_path).arg(&fresh_path).arg(&legacy_path).output().unwrap();
    assert!(result.status.success(), "{}", String::from_utf8_lossy(&result.stderr));
    tauri::async_runtime::block_on(async {
        let mut source = sqlx::SqliteConnection::connect(&format!("sqlite:{}", source_path.display())).await.unwrap();
        let mut fresh = sqlx::SqliteConnection::connect(&format!("sqlite:{}", fresh_path.display())).await.unwrap();
        let mut legacy = sqlx::SqliteConnection::connect(&format!("sqlite:{}", legacy_path.display())).await.unwrap();
        let backup = snapshot(&mut source).await.unwrap();
        assert_eq!(backup["schemaVersion"], 50);
        let history = &backup["data"]["person_relationship_versions"];
        assert_eq!(history.as_array().unwrap().len(), 1);
        assert_eq!(history[0]["id"], 7);
        let before: Value = serde_json::from_str(history[0]["before_json"].as_str().unwrap()).unwrap();
        assert_eq!(before["name"], "  原始人物名称  ");
        let current = snapshot(&mut fresh).await.unwrap();
        let safety = restore_with_safety(&mut fresh, &backup, &dir.join("safety")).await.unwrap();
        let safety: Value = serde_json::from_str(&fs::read_to_string(safety).unwrap()).unwrap();
        assert_eq!(safety["data"], current["data"]);
        assert_eq!(snapshot(&mut fresh).await.unwrap()["data"], backup["data"]);
        let sequence: i64 = sqlx::query_scalar("SELECT seq FROM sqlite_sequence WHERE name='person_relationship_versions'")
            .fetch_one(&mut fresh).await.unwrap();
        assert_eq!(sequence, 7);
        let old = snapshot(&mut legacy).await.unwrap();
        assert_eq!(old["schemaVersion"], 49);
        assert!(restore_with_safety(&mut legacy, &backup, &dir.join("future")).await.is_err());
        assert!(!dir.join("future").exists());
        assert_eq!(snapshot(&mut legacy).await.unwrap()["data"], old["data"]);
        let mut disguised = backup.clone();
        disguised["schemaVersion"] = json!(49);
        assert!(restore_with_safety(&mut fresh, &disguised, &dir.join("disguised")).await.is_err());
        for (index, (field, value)) in [
            ("person_id", json!("missing")), ("id", json!(0.5)),
            ("changed_at", json!("2026-02-30T08:00:00Z")), ("before_json", json!("{}")),
            ("after_json", json!(json!({"name":"人物日期","relationshipType":"朋友",
                "state":"暂时疏远","domainIds":["missing"]}).to_string())),
        ].into_iter().enumerate() {
            let mut invalid = backup.clone();
            invalid["data"]["person_relationship_versions"][0][field] = value;
            let rejected = dir.join(format!("invalid-{index}"));
            assert!(restore_with_safety(&mut fresh, &invalid, &rejected).await.is_err());
            assert!(!rejected.exists());
            assert_eq!(snapshot(&mut fresh).await.unwrap()["data"], backup["data"]);
        }
        sqlx::query("CREATE TRIGGER fail_relationship_restore BEFORE INSERT ON person_relationship_versions BEGIN SELECT RAISE(ABORT, 'injected failure'); END")
            .execute(&mut fresh).await.unwrap();
        assert!(restore_with_safety(&mut fresh, &backup, &dir.join("rollback")).await.is_err());
        assert_eq!(snapshot(&mut fresh).await.unwrap()["data"], backup["data"]);
        let sequence: i64 = sqlx::query_scalar("SELECT seq FROM sqlite_sequence WHERE name='person_relationship_versions'")
            .fetch_one(&mut fresh).await.unwrap();
        assert_eq!(sequence, 7);
        sqlx::query("DROP TRIGGER fail_relationship_restore").execute(&mut fresh).await.unwrap();
        restore_with_safety(&mut fresh, &old, &dir.join("legacy")).await.unwrap();
        let restored = snapshot(&mut fresh).await.unwrap();
        assert_eq!(restored["schemaVersion"], 50);
        assert_eq!(restored["data"]["person_relationship_versions"], json!([]));
        let mut projected = restored["data"].clone();
        projected.as_object_mut().unwrap().remove("person_relationship_versions");
        assert_eq!(projected, old["data"]);
        source.close().await.unwrap();
        fresh.close().await.unwrap();
        legacy.close().await.unwrap();
    });
    fs::remove_dir_all(dir).unwrap();
}
