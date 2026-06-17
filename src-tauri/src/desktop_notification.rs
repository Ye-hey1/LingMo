use serde::Serialize;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopNotificationResult {
    delivered: bool,
    backend: String,
    app_id: Option<String>,
}

#[cfg(target_os = "windows")]
fn notification_app_id(app: &tauri::AppHandle) -> String {
    let identifier = app.config().identifier.clone();

    match tauri::utils::platform::current_exe()
        .ok()
        .and_then(|path| path.parent().map(|parent| parent.display().to_string()))
    {
        Some(dir) if dir.ends_with("\\target\\debug") || dir.ends_with("\\target\\release") => {
            tauri_winrt_notification::Toast::POWERSHELL_APP_ID.to_string()
        }
        _ => identifier,
    }
}

#[tauri::command]
pub fn send_desktop_notification(
    app: tauri::AppHandle,
    title: String,
    body: Option<String>,
) -> Result<DesktopNotificationResult, String> {
    #[cfg(target_os = "windows")]
    {
        use tauri_winrt_notification::{Duration, Sound, Toast};

        let app_id = notification_app_id(&app);
        let title = title.trim();
        if title.is_empty() {
            return Err("notification title is empty".to_string());
        }

        let mut toast = Toast::new(&app_id)
            .title(title)
            .duration(Duration::Short)
            .sound(Some(Sound::Default));

        if let Some(body) = body
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty())
        {
            let mut lines = body.lines().map(str::trim).filter(|line| !line.is_empty());
            if let Some(line) = lines.next() {
                toast = toast.text1(line);
            }
            if let Some(line) = lines.next() {
                toast = toast.text2(line);
            }
        }

        toast
            .show()
            .map_err(|error| format!("Windows toast failed: {error}"))?;

        return Ok(DesktopNotificationResult {
            delivered: true,
            backend: "windows-winrt".to_string(),
            app_id: Some(app_id),
        });
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = app;
        let _ = title;
        let _ = body;

        Ok(DesktopNotificationResult {
            delivered: false,
            backend: "unsupported".to_string(),
            app_id: None,
        })
    }
}
