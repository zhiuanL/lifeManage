mod backup;
mod transaction;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_sql::Builder::new().build())
        .invoke_handler(tauri::generate_handler![
            backup::create_backup, backup::restore_backup, transaction::execute_transaction,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
