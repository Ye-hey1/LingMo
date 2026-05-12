use crate::screenshot::cleanup_temp_screenshot_dir;
use crate::tray::create_tray;
use crate::window;
use tauri::{App, WebviewUrl, WebviewWindowBuilder};

pub fn setup_app(app: &mut App) -> Result<(), Box<dyn std::error::Error>> {
    let app_handle = app.handle();

    cleanup_temp_screenshot_dir(&app_handle);

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
