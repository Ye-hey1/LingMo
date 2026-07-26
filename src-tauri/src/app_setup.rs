use crate::screenshot::cleanup_temp_screenshot_dir;
use crate::tray::create_tray;
use crate::window;
use tauri::{App, Manager, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_fs::FsExt;

/// 为指定目录同时追加 fs 与 asset 协议作用域。
fn grant_workspace_scopes(
    app_handle: &tauri::AppHandle,
    dir: &std::path::Path,
) -> Result<(), String> {
    app_handle
        .asset_protocol_scope()
        .allow_directory(dir, true)
        .map_err(|err| format!("追加 asset 作用域失败: {err}"))?;
    app_handle
        .fs_scope()
        .allow_directory(dir, true)
        .map_err(|err| format!("追加 fs 作用域失败: {err}"))?;
    Ok(())
}

/// 供前端在切换工作区后调用，为新目录追加 fs 与 asset 协议作用域。
///
/// 作用域只增不减，是 Tauri scope API 的固有行为；这里不做额外放宽，
/// 传入的必须是已存在的目录，否则拒绝。
#[tauri::command]
pub fn allow_workspace_asset_scope(
    app_handle: tauri::AppHandle,
    path: String,
) -> Result<(), String> {
    let trimmed = path.trim();
    if trimmed.is_empty() {
        return Err("工作区路径为空".into());
    }
    let candidate = std::path::Path::new(trimmed);
    if !candidate.is_dir() {
        return Err(format!("工作区路径不存在或不是目录: {trimmed}"));
    }
    grant_workspace_scopes(&app_handle, candidate)
}

/// 启动时把用户自定义的工作区目录追加进 fs 与 asset 协议作用域。
///
/// capabilities/default.json 与 tauri.conf.json 里的静态作用域只覆盖标准目录，
/// 而工作区路径由用户在设置里任选，编译期无法枚举。若不在运行时补授权，自定义
/// 工作区下的笔记读写与图片加载都会被拒绝。读取 store.json 里的 `workspacePath`，
/// 只授权该目录，不做全盘放宽。
fn allow_custom_workspace_asset_scope(app_handle: &tauri::AppHandle) {
    let Ok(app_data_dir) = app_handle.path().app_data_dir() else {
        return;
    };
    let store_path = app_data_dir.join("store.json");
    let Ok(raw) = std::fs::read_to_string(&store_path) else {
        // 首次启动时 store.json 还不存在，属正常情况。
        return;
    };
    let Ok(parsed) = serde_json::from_str::<serde_json::Value>(&raw) else {
        return;
    };
    let Some(workspace_path) = parsed.get("workspacePath").and_then(|v| v.as_str()) else {
        return;
    };
    if workspace_path.trim().is_empty() {
        return;
    }

    if let Err(err) = grant_workspace_scopes(app_handle, std::path::Path::new(workspace_path)) {
        eprintln!("[setup] 追加工作区作用域失败 {workspace_path}: {err}");
    }
}

pub fn setup_app(app: &mut App) -> Result<(), Box<dyn std::error::Error>> {
    let app_handle = app.handle();

    cleanup_temp_screenshot_dir(&app_handle);
    allow_custom_workspace_asset_scope(&app_handle);

    // 手动创建主窗口，禁用 WebView 内置缩放热键以支持 JS 侧自定义 Ctrl+滚轮缩放
    let main_window = WebviewWindowBuilder::new(app, "main", WebviewUrl::App("index.html".into()))
        .title("灵墨")
        .inner_size(1360.0, 720.0)
        .zoom_hotkeys_enabled(false)
        .build()?;

    // 在 Windows 上禁用窗口装饰（等效于 titleBarStyle: Overlay）
    #[cfg(target_os = "windows")]
    {
        let _ = main_window.set_decorations(false);
        let _ = main_window.set_title("灵墨");
    }

    // macOS 上设置 Overlay 标题栏样式
    #[cfg(target_os = "macos")]
    {
        use tauri::TitleBarStyle;
        let _ = main_window.set_title_bar_style(TitleBarStyle::Overlay);
    }

    // 设置窗口事件监听器
    window::setup_window_events(&app_handle)?;

    // 创建系统托盘
    let _tray = create_tray(&app_handle)?;

    Ok(())
}
