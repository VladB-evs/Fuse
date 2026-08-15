//! Fuse — visual command workflow builder.
//!
//! Layering, outermost first:
//!   `commands`  Tauri bridge (this is the only module that knows about the UI)
//!   `storage`   workflow persistence behind a trait
//!   `engine`    DAG scheduling + process supervision, UI-agnostic
//!   `model`     the shared document model

pub mod commands;
pub mod engine;
pub mod model;
pub mod storage;

use commands::AppState;
use std::sync::Arc;
use storage::JsonStore;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .setup(|app| {
            let data_dir = app.path().app_data_dir()?;
            let settings = commands::load_settings(&data_dir);
            let store_dir = settings.custom_workflow_dir.map(std::path::PathBuf::from).unwrap_or_else(|| data_dir.clone());
            let store = JsonStore::new(&store_dir)?;
            app.manage(AppState::new(Arc::new(store), data_dir));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_settings,
            commands::set_workflow_directory,
            commands::open_directory,
            commands::list_workflows,
            commands::load_workflow,
            commands::save_workflow,
            commands::delete_workflow,
            commands::run_workflow,
            commands::run_node,
            commands::stop_run,
            commands::resolve_prompt,
            commands::is_running,
            commands::home_directory,
            commands::pick_directory,
            commands::repository_activity,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Fuse");
}
