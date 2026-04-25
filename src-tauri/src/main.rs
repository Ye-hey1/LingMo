// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod screenshot;
mod fuzzy_search;
mod keywords;
mod window;
mod app_setup;
mod backup;
mod mcp;
mod mcp_runtime;
mod device;
mod skills;
mod tray;
mod ai;
mod skills_v2;

use screenshot::{cleanup_temp_screenshot_dir, screenshot};
use fuzzy_search::{fuzzy_search, fuzzy_search_parallel};
use keywords::{rank_keywords};
use backup::{export_app_data, import_app_data, import_app_data_from_file};
use skills::import_skill_zip;
use mcp::{start_mcp_stdio_server, stop_mcp_server, send_mcp_message, McpServerManager};
use mcp_runtime::{cancel_mcp_runtime_install, inspect_mcp_runtime, install_mcp_runtime, RuntimeInstallManager};
use device::get_device_id;
use ai::{ai_binary_request, ai_chat_completion_stream, ai_json_request, ai_multipart_request, cancel_ai_request, AiRequestManager};
use skills_v2::commands::SkillState;
use skills_v2::db;
use tauri::Manager;

fn main() {
    tauri::Builder::default()
        // 核心插件 - 最先加载
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_sql::Builder::default().build())
        .plugin(tauri_plugin_single_instance::init(window::handle_single_instance))

        // MCP 服务器管理器
        .manage(McpServerManager::new())
        .manage(RuntimeInstallManager::new())
        .manage(AiRequestManager::new())

        // 系统级插件
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_http::init())

        // UI 相关插件
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_window_state::Builder::new().build())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_clipboard::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())

        // 功能插件
        .plugin(tauri_plugin_updater::Builder::new().build())

        // 注册命令处理器
        .invoke_handler(tauri::generate_handler![
            screenshot,
            fuzzy_search,
            fuzzy_search_parallel,
            rank_keywords,
            export_app_data,
            import_app_data,
            import_app_data_from_file,
            import_skill_zip,
            start_mcp_stdio_server,
            stop_mcp_server,
            send_mcp_message,
            inspect_mcp_runtime,
            install_mcp_runtime,
            cancel_mcp_runtime_install,
            get_device_id,
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
            skills_v2::commands::skill_v2_preview_git,
            skills_v2::commands::skill_v2_install_git,
            skills_v2::commands::skill_v2_install_archive,
            skills_v2::commands::skill_v2_install_local_dir,
            skills_v2::commands::skill_v2_fetch_leaderboard,
            skills_v2::commands::skill_v2_search_skillssh,
            skills_v2::commands::skill_v2_install_from_skillssh,
        ])

        // 应用设置 - 在所有插件和命令注册后
        .setup(|app| {
            let app_data_dir = app.path().app_data_dir()?;
            let store = db::init_skill_store(&app_data_dir)
                .expect("Failed to initialize skills database");
            app.manage(SkillState(std::sync::Mutex::new(store)));
            app_setup::setup_app(app)
        })

        .build(tauri::generate_context!())
        .expect("error while running tauri application")
        .run(|app_handle, event| match event {
            #[cfg(target_os = "macos")]
            tauri::RunEvent::Reopen { has_visible_windows, .. } => {
                window::handle_macos_reopen(&app_handle, has_visible_windows);
            }
            tauri::RunEvent::Exit => {
                cleanup_temp_screenshot_dir(&app_handle);
            }
            _ => {}
        });
}
