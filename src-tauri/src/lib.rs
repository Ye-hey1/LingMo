mod ai;
mod backup;
mod desktop_notification;
mod device;
mod llm_memory;
mod mcp;
mod mcp_runtime;
mod ocr_packages;
mod skills;
mod skills_v2;
mod wechat_mp;

use ai::{
    AiRequestManager, ai_binary_request, ai_chat_completion_stream, ai_json_request,
    ai_multipart_request, cancel_ai_request,
};
use backup::{export_app_data, import_app_data, import_app_data_from_file};
use desktop_notification::send_desktop_notification;
use device::get_device_id;
use mcp::{
    McpServerManager, send_mcp_message, send_mcp_notification, start_mcp_stdio_server,
    stop_mcp_server,
};
use mcp_runtime::{
    RuntimeInstallManager, cancel_mcp_runtime_install, inspect_mcp_runtime, install_mcp_runtime,
};
use ocr_packages::{list_ocr_providers, run_ocr_provider};
use skills::import_skill_zip;
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
        .plugin(tauri_plugin_notification::init())
        .manage(McpServerManager::new())
        .manage(RuntimeInstallManager::new())
        .manage(AiRequestManager::new())
        .manage(wechat_mp::WechatMpState::default())
        .setup(|app| {
            let app_data_dir = app.path().app_data_dir()?;
            let store =
                db::init_skill_store(&app_data_dir).expect("Failed to initialize skills database");
            app.manage(SkillState(std::sync::Mutex::new(store)));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            start_mcp_stdio_server,
            stop_mcp_server,
            send_mcp_message,
            send_mcp_notification,
            inspect_mcp_runtime,
            install_mcp_runtime,
            cancel_mcp_runtime_install,
            get_device_id,
            send_desktop_notification,
            export_app_data,
            import_app_data,
            import_app_data_from_file,
            import_skill_zip,
            ai_json_request,
            ai_binary_request,
            ai_multipart_request,
            ai_chat_completion_stream,
            cancel_ai_request,
            list_ocr_providers,
            run_ocr_provider,
            wechat_mp::wechat_mp_start_login,
            wechat_mp::wechat_mp_poll_login,
            wechat_mp::wechat_mp_status,
            wechat_mp::wechat_mp_search_accounts,
            wechat_mp::wechat_mp_list_articles,
            wechat_mp::wechat_mp_fetch_article_html,
            wechat_mp::wechat_mp_fetch_image_data_url,
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
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
