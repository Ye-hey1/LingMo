mod mcp;
mod mcp_runtime;
mod device;
mod backup;
mod skills;
mod ai;
mod skills_v2;

use mcp::{start_mcp_stdio_server, stop_mcp_server, send_mcp_message, McpServerManager};
use mcp_runtime::{cancel_mcp_runtime_install, inspect_mcp_runtime, install_mcp_runtime, RuntimeInstallManager};
use device::get_device_id;
use backup::{export_app_data, import_app_data, import_app_data_from_file};
use skills::import_skill_zip;
use ai::{ai_binary_request, ai_chat_completion_stream, ai_json_request, ai_multipart_request, cancel_ai_request, AiRequestManager};
use skills_v2::commands::SkillState;
use skills_v2::db;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_sql::Builder::default().build())
        .manage(McpServerManager::new())
        .manage(RuntimeInstallManager::new())
        .manage(AiRequestManager::new())
        .setup(|app| {
            let app_data_dir = app.path().app_data_dir()?;
            let store = db::init_skill_store(&app_data_dir)
                .expect("Failed to initialize skills database");
            app.manage(SkillState(std::sync::Mutex::new(store)));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            start_mcp_stdio_server,
            stop_mcp_server,
            send_mcp_message,
            inspect_mcp_runtime,
            install_mcp_runtime,
            cancel_mcp_runtime_install,
            get_device_id,
            export_app_data,
            import_app_data,
            import_app_data_from_file,
            import_skill_zip,
            ai_json_request,
            ai_binary_request,
            ai_multipart_request,
            ai_chat_completion_stream,
            cancel_ai_request,
            skills_v2::commands::skill_v2_get_all,
            skills_v2::commands::skill_v2_get_by_id,
            skills_v2::commands::skill_v2_delete,
            skills_v2::commands::skill_v2_set_enabled,
            skills_v2::commands::skill_v2_scan,
            skills_v2::commands::skill_v2_get_discovered,
            skills_v2::commands::skill_v2_import_discovered,
            skills_v2::commands::skill_v2_get_scenarios,
            skills_v2::commands::skill_v2_create_scenario,
            skills_v2::commands::skill_v2_delete_scenario,
            skills_v2::commands::skill_v2_get_active_scenario,
            skills_v2::commands::skill_v2_switch_scenario,
            skills_v2::commands::skill_v2_add_to_scenario,
            skills_v2::commands::skill_v2_remove_from_scenario,
            skills_v2::commands::skill_v2_get_scenario_skills,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
