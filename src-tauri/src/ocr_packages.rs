use serde::Serialize;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager, command};

#[cfg(target_os = "windows")]
const WINDOWS_OCR_PROVIDER_ID: &str = "ocr-native-windows";
#[cfg(target_os = "windows")]
const WINDOWS_OCR_PROVIDER_NAME: &str = "System OCR (Windows)";
#[cfg(target_os = "windows")]
const WINDOWS_OCR_PROVIDER_VERSION: &str = "1.0.0";

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OcrProviderInfo {
    pub id: String,
    pub name: String,
    pub version: String,
    pub platform: String,
    pub builtin: bool,
}

#[command]
pub async fn list_ocr_providers(_app_handle: AppHandle) -> Result<Vec<OcrProviderInfo>, String> {
    let mut providers = Vec::new();

    #[cfg(target_os = "windows")]
    if windows_ocr_available().is_ok() {
        providers.push(OcrProviderInfo {
            id: WINDOWS_OCR_PROVIDER_ID.to_string(),
            name: WINDOWS_OCR_PROVIDER_NAME.to_string(),
            version: WINDOWS_OCR_PROVIDER_VERSION.to_string(),
            platform: current_platform_tag(),
            builtin: true,
        });
    }

    Ok(providers)
}

#[command]
pub async fn run_ocr_provider(
    app_handle: AppHandle,
    provider_id: String,
    image_path: String,
    languages: Vec<String>,
) -> Result<String, String> {
    let app_data_dir = app_handle
        .path()
        .app_data_dir()
        .map_err(|error| format!("Failed to get app data directory: {error}"))?;

    tauri::async_runtime::spawn_blocking(move || {
        run_ocr_provider_sync(&app_data_dir, &provider_id, &image_path, languages)
    })
    .await
    .map_err(|error| format!("Failed to join OCR provider task: {error}"))?
}

fn run_ocr_provider_sync(
    app_data_dir: &Path,
    provider_id: &str,
    image_path: &str,
    languages: Vec<String>,
) -> Result<String, String> {
    let image_path = image_path.trim();
    let relative_image_path = image_path.trim_start_matches(&['/', '\\'][..]);
    let absolute_image_path = if Path::new(image_path).is_absolute() {
        PathBuf::from(image_path)
    } else {
        app_data_dir.join(relative_image_path)
    };

    #[cfg(target_os = "windows")]
    if provider_id == WINDOWS_OCR_PROVIDER_ID {
        return run_windows_ocr_provider_sync(&absolute_image_path, languages);
    }

    Err(format!("Unknown OCR provider: {provider_id}"))
}

#[cfg(target_os = "windows")]
fn run_windows_ocr_provider_sync(
    absolute_image_path: &Path,
    languages: Vec<String>,
) -> Result<String, String> {
    use windows::{
        Graphics::Imaging::{BitmapAlphaMode, BitmapDecoder, BitmapPixelFormat, SoftwareBitmap},
        Storage::{FileAccessMode, StorageFile},
        core::HSTRING,
    };

    let file_path = windows_ocr_image_path(absolute_image_path)?;
    let file = StorageFile::GetFileFromPathAsync(&HSTRING::from(file_path))
        .map_err(|error| format!("Failed to open image file: {error}"))?
        .get()
        .map_err(|error| format!("Failed to read image file: {error}"))?;
    let stream = file
        .OpenAsync(FileAccessMode::Read)
        .map_err(|error| format!("Failed to open image stream: {error}"))?
        .get()
        .map_err(|error| format!("Failed to read image stream: {error}"))?;
    let decoder = BitmapDecoder::CreateAsync(&stream)
        .map_err(|error| format!("Failed to decode image: {error}"))?
        .get()
        .map_err(|error| format!("Failed to create image decoder: {error}"))?;
    let decoded_bitmap = decoder
        .GetSoftwareBitmapAsync()
        .map_err(|error| format!("Failed to read image bitmap: {error}"))?
        .get()
        .map_err(|error| format!("Failed to create image bitmap: {error}"))?;
    let bitmap = SoftwareBitmap::ConvertWithAlpha(
        &decoded_bitmap,
        BitmapPixelFormat::Bgra8,
        BitmapAlphaMode::Premultiplied,
    )
    .map_err(|error| format!("Failed to normalize image bitmap for OCR: {error}"))?;
    let engine = create_windows_ocr_engine(languages)?;
    let result = engine
        .RecognizeAsync(&bitmap)
        .map_err(|error| format!("Windows OCR failed to start: {error}"))?
        .get()
        .map_err(|error| format!("Windows OCR failed: {error}"))?;
    let lines = result
        .Lines()
        .map_err(|error| format!("Failed to read OCR result lines: {error}"))?;
    let mut text_lines = Vec::new();

    for index in 0..lines
        .Size()
        .map_err(|error| format!("Failed to read OCR line count: {error}"))?
    {
        let line = lines
            .GetAt(index)
            .map_err(|error| format!("Failed to read OCR line: {error}"))?;
        let text = line
            .Text()
            .map_err(|error| format!("Failed to read OCR text: {error}"))?
            .to_string_lossy();

        if !text.trim().is_empty() {
            text_lines.push(text);
        }
    }

    Ok(text_lines.join("\n"))
}

#[cfg(target_os = "windows")]
fn windows_ocr_image_path(path: &Path) -> Result<String, String> {
    if !path.is_file() {
        return Err(format!("OCR image file does not exist: {}", path.display()));
    }

    path.to_str()
        .map(|value| value.replace('/', "\\"))
        .ok_or("OCR image path is not valid UTF-8.".to_string())
}

#[cfg(target_os = "windows")]
fn create_windows_ocr_engine(
    languages: Vec<String>,
) -> Result<windows::Media::Ocr::OcrEngine, String> {
    use windows::{Globalization::Language, Media::Ocr::OcrEngine, core::HSTRING};

    let available_tags = windows_available_ocr_language_tags()?;
    let candidate_tags = if languages.is_empty() {
        default_ocr_language_tags()
    } else {
        languages
            .into_iter()
            .filter_map(|language| normalize_ocr_language(&language))
            .collect()
    };

    for candidate in candidate_tags {
        if let Some(available_tag) = find_available_ocr_language(&available_tags, &candidate) {
            let language = Language::CreateLanguage(&HSTRING::from(available_tag.as_str()))
                .map_err(|error| {
                    format!("Failed to create OCR language {available_tag}: {error}")
                })?;

            if let Ok(engine) = OcrEngine::TryCreateFromLanguage(&language) {
                return Ok(engine);
            }
        }
    }

    OcrEngine::TryCreateFromUserProfileLanguages().map_err(|error| {
        format!(
            "Windows OCR language is unavailable. Install the Windows OCR language pack for Chinese or English. {error}",
        )
    })
}

#[cfg(target_os = "windows")]
fn windows_ocr_available() -> Result<(), String> {
    let languages = windows_available_ocr_language_tags()?;
    if languages.is_empty() {
        Err("No Windows OCR recognition languages are installed.".to_string())
    } else {
        Ok(())
    }
}

#[cfg(target_os = "windows")]
fn windows_available_ocr_language_tags() -> Result<Vec<String>, String> {
    use windows::Media::Ocr::OcrEngine;

    let languages = OcrEngine::AvailableRecognizerLanguages()
        .map_err(|error| format!("Failed to list Windows OCR languages: {error}"))?;
    let mut tags = Vec::new();

    for index in 0..languages
        .Size()
        .map_err(|error| format!("Failed to read OCR language count: {error}"))?
    {
        let language = languages
            .GetAt(index)
            .map_err(|error| format!("Failed to read OCR language: {error}"))?;
        let tag = language
            .LanguageTag()
            .map_err(|error| format!("Failed to read OCR language tag: {error}"))?
            .to_string_lossy();
        tags.push(tag);
    }

    Ok(tags)
}

#[cfg(target_os = "windows")]
fn default_ocr_language_tags() -> Vec<String> {
    // Native defaults prefer Chinese before English. Explicit user settings keep their order.
    [
        "zh-Hans", "zh-CN", "zh-Hant", "zh-TW", "en-US", "en", "ja-JP", "ja", "ko-KR", "ko",
    ]
    .into_iter()
    .map(ToOwned::to_owned)
    .collect()
}

#[cfg(target_os = "windows")]
fn normalize_ocr_language(language: &str) -> Option<String> {
    let normalized = language.trim().replace('_', "-").to_lowercase();

    if normalized.is_empty() {
        return None;
    }

    let tag = match normalized.as_str() {
        "eng" | "en" | "en-us" => "en-US",
        "chi-sim" | "chi_sim" | "zh" | "zh-cn" | "zh-hans" => "zh-Hans",
        "chi-tra" | "chi_tra" | "zh-tw" | "zh-hant" => "zh-Hant",
        "jpn" | "ja" | "ja-jp" => "ja-JP",
        "kor" | "ko" | "ko-kr" => "ko-KR",
        _ => language,
    };

    Some(tag.to_string())
}

#[cfg(target_os = "windows")]
fn find_available_ocr_language(available_tags: &[String], candidate: &str) -> Option<String> {
    let candidate = candidate.to_lowercase();
    let candidate_prefix = format!("{candidate}-");
    available_tags
        .iter()
        .find(|tag| {
            let available = tag.to_lowercase();
            let available_prefix = format!("{available}-");
            available == candidate
                || available.starts_with(&candidate_prefix)
                || candidate.starts_with(&available_prefix)
                || windows_ocr_language_alias_matches(&available, &candidate)
        })
        .cloned()
}

#[cfg(target_os = "windows")]
fn windows_ocr_language_alias_matches(available: &str, candidate: &str) -> bool {
    match candidate {
        "zh-hans" | "zh-cn" => {
            available == "zh"
                || available.starts_with("zh-hans")
                || available.starts_with("zh-cn")
                || available.starts_with("zh-sg")
        }
        "zh-hant" | "zh-tw" => {
            available.starts_with("zh-hant")
                || available.starts_with("zh-tw")
                || available.starts_with("zh-hk")
                || available.starts_with("zh-mo")
        }
        _ => false,
    }
}

fn current_platform_tag() -> String {
    format!(
        "{}-{}",
        normalize_os(std::env::consts::OS),
        normalize_arch(std::env::consts::ARCH)
    )
}

fn normalize_os(os: &str) -> &str {
    match os {
        "macos" => "macos",
        "windows" => "windows",
        "linux" => "linux",
        other => other,
    }
}

fn normalize_arch(arch: &str) -> &str {
    match arch {
        "aarch64" => "arm64",
        "x86_64" => "x64",
        other => other,
    }
}

#[cfg(all(test, target_os = "windows"))]
mod tests {
    use super::*;

    #[test]
    fn native_default_languages_prefer_chinese_before_english() {
        let defaults = default_ocr_language_tags();
        let first_chinese = defaults
            .iter()
            .position(|tag| tag.starts_with("zh"))
            .unwrap();
        let first_english = defaults
            .iter()
            .position(|tag| tag.starts_with("en"))
            .unwrap();

        assert!(first_chinese < first_english);
    }
}
