// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod ai;
mod app_setup;
mod backup;
mod desktop_notification;
mod device;
mod fuzzy_search;
mod keywords;
mod llm_memory;
mod mcp;
mod mcp_runtime;
mod ocr_packages;
mod screenshot;
mod skills;
mod skills_v2;
mod tray;
mod wechat_mp;
mod window;

use ai::{
    AiRequestManager, ai_binary_request, ai_chat_completion_stream, ai_json_request,
    ai_multipart_request, cancel_ai_request,
};
use backup::{export_app_data, import_app_data, import_app_data_from_file};
use desktop_notification::send_desktop_notification;
use device::get_device_id;
use fuzzy_search::{fuzzy_search, fuzzy_search_parallel};
use keywords::rank_keywords;
use mcp::{
    McpServerManager, send_mcp_message, send_mcp_notification, start_mcp_stdio_server,
    stop_mcp_server,
};
use mcp_runtime::{
    RuntimeInstallManager, cancel_mcp_runtime_install, inspect_mcp_runtime, install_mcp_runtime,
};
use ocr_packages::{list_ocr_providers, run_ocr_provider};
use screenshot::{cleanup_temp_screenshot_dir, screenshot};
use skills::import_skill_zip;
use skills_v2::commands::SkillState;
use skills_v2::db;
use tauri::Manager;

fn main() {
    tauri::Builder::default()
        // 核心插件 - 最先加载
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_sql::Builder::default().build())
        .plugin(tauri_plugin_single_instance::init(
            window::handle_single_instance,
        ))
        // MCP 服务器管理器
        .manage(McpServerManager::new())
        .manage(RuntimeInstallManager::new())
        .manage(AiRequestManager::new())
        .manage(wechat_mp::WechatMpState::default())
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
        .plugin(tauri_plugin_notification::init())
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
            send_desktop_notification,
            import_skill_zip,
            start_mcp_stdio_server,
            stop_mcp_server,
            send_mcp_message,
            send_mcp_notification,
            inspect_mcp_runtime,
            install_mcp_runtime,
            cancel_mcp_runtime_install,
            get_device_id,
            ai_json_request,
            ai_binary_request,
            ai_multipart_request,
            ai_chat_completion_stream,
            cancel_ai_request,
            list_ocr_providers,
            run_ocr_provider,
            llm_memory::llm_memory_list_sessions,
            llm_memory::llm_memory_get_session_detail,
            llm_memory::llm_memory_update_message,
            llm_memory::llm_memory_delete_session,
            llm_memory::llm_memory_delete_message,
            llm_memory::llm_memory_list_edit_logs,
            llm_memory::llm_memory_restore_message,
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
            wechat_mp::wechat_mp_start_login,
            wechat_mp::wechat_mp_poll_login,
            wechat_mp::wechat_mp_status,
            wechat_mp::wechat_mp_search_accounts,
            wechat_mp::wechat_mp_list_articles,
            wechat_mp::wechat_mp_fetch_article_html,
            wechat_mp::wechat_mp_fetch_image_data_url,
        ])
        // 应用设置 - 在所有插件和命令注册后
        .setup(|app| {
            let app_data_dir = app.path().app_data_dir()?;
            let store =
                db::init_skill_store(&app_data_dir).expect("Failed to initialize skills database");
            app.manage(SkillState(std::sync::Mutex::new(store)));
            app_setup::setup_app(app)
        })
        .build(tauri::generate_context!())
        .expect("error while running tauri application")
        .run(|app_handle, event| match event {
            #[cfg(target_os = "macos")]
            tauri::RunEvent::Reopen {
                has_visible_windows,
                ..
            } => {
                window::handle_macos_reopen(&app_handle, has_visible_windows);
            }
            tauri::RunEvent::Exit => {
                cleanup_temp_screenshot_dir(&app_handle);
            }
            _ => {}
        });
}
