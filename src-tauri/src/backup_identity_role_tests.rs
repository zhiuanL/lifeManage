use super::*;
use sqlx::Connection;

#[test]
fn identity_role_native_backup_smoke() {
    let stamp = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos();
    let dir = std::env::temp_dir().join(format!("lifeos-native-roles-{stamp}"));
    fs::create_dir(&dir).unwrap();
    let source_path = dir.join("source.sqlite");
    let fresh_path = dir.join("fresh.sqlite");
    let helper = Path::new(env!("CARGO_MANIFEST_DIR")).join("../tests/helpers/create-identity-role-native-databases.mjs");
    let result = std::process::Command::new("node").arg(helper).arg(&source_path).arg(&fresh_path).output().unwrap();
    assert!(result.status.success(), "{}", String::from_utf8_lossy(&result.stderr));
    tauri::async_runtime::block_on(async {
        let mut source = sqlx::SqliteConnection::connect(&format!("sqlite:{}", source_path.display())).await.unwrap();
        let mut fresh = sqlx::SqliteConnection::connect(&format!("sqlite:{}", fresh_path.display())).await.unwrap();
        let backup = snapshot(&mut source).await.unwrap();
        assert_eq!(backup["schemaVersion"], 45);
        assert_eq!(backup["data"]["identity_role_versions"].as_array().unwrap().len(), 1);
        let before = snapshot(&mut fresh).await.unwrap();
        let safety_path = restore_with_safety(&mut fresh, &backup, &dir.join("safety")).await.unwrap();
        let safety: Value = serde_json::from_str(&fs::read_to_string(safety_path).unwrap()).unwrap();
        assert_eq!(safety["data"], before["data"]);
        assert_eq!(snapshot(&mut fresh).await.unwrap()["data"], backup["data"]);

        let mut invalid = backup.clone();
        invalid["data"]["identity_role_goal_links"][0]["goal_id"] = json!("missing");
        assert!(restore_with_safety(&mut fresh, &invalid, &dir.join("rejected")).await.is_err());
        assert!(!dir.join("rejected").exists());
        assert_eq!(snapshot(&mut fresh).await.unwrap()["data"], backup["data"]);

        let mut legacy = backup.clone();
        legacy["schemaVersion"] = json!(44);
        for table in IDENTITY_ROLE_TABLES { legacy["data"].as_object_mut().unwrap().remove(*table); }
        restore_with_safety(&mut fresh, &legacy, &dir.join("legacy")).await.unwrap();
        let restored = snapshot(&mut fresh).await.unwrap();
        for table in IDENTITY_ROLE_TABLES { assert!(restored["data"][*table].as_array().unwrap().is_empty()); }
        let mut data = restored["data"].clone();
        for table in IDENTITY_ROLE_TABLES { data.as_object_mut().unwrap().remove(*table); }
        assert_eq!(data, legacy["data"]);
        source.close().await.unwrap();
        fresh.close().await.unwrap();
    });
    fs::remove_dir_all(dir).unwrap();
}
