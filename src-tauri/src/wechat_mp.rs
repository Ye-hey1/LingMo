use base64::{Engine as _, engine::general_purpose::STANDARD as BASE64};
use futures_util::StreamExt;
use regex::Regex;
use reqwest::header::{
    ACCEPT, ACCEPT_LANGUAGE, CONTENT_TYPE, COOKIE, HeaderMap, HeaderValue, REFERER, SET_COOKIE,
    USER_AGENT,
};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::BTreeMap;
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::Duration;
use tauri::Manager;
use url::Url;
use uuid::Uuid;

const MP_BASE_URL: &str = "https://mp.weixin.qq.com";
const WECHAT_MP_SESSION_TTL_SECONDS: i64 = 7 * 24 * 60 * 60;
const WECHAT_MP_SESSION_FILE: &str = "wechat-mp-session.json";
const MAX_WECHAT_IMAGE_BYTES: usize = 8 * 1024 * 1024;
const WECHAT_ARTICLE_CONNECT_TIMEOUT_SECS: u64 = 8;
const WECHAT_ARTICLE_READ_TIMEOUT_SECS: u64 = 10;
const WECHAT_ARTICLE_REQUEST_TIMEOUT_SECS: u64 = 12;
const WECHAT_ARTICLE_MAX_ATTEMPTS: u64 = 3;
#[cfg(test)]
const WECHAT_ARTICLE_UI_BUDGET_SECS: u64 = 45;
const WECHAT_IMAGE_CONNECT_TIMEOUT_SECS: u64 = 6;
const WECHAT_IMAGE_READ_TIMEOUT_SECS: u64 = 10;
const WECHAT_IMAGE_REQUEST_TIMEOUT_SECS: u64 = 18;
const WECHAT_MOBILE_UA: &str = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 MicroMessenger/8.0.49 NetType/WIFI Language/zh_CN";
const WECHAT_DESKTOP_UA: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 MicroMessenger/8.0.49";

#[derive(Default)]
pub struct WechatMpState(pub Mutex<Option<WechatMpSession>>);

pub struct WechatMpSession {
    client: reqwest::Client,
    fingerprint: String,
    uuid: String,
    token: Option<String>,
    cookie_header: Option<String>,
    saved_at: i64,
    expires_at: i64,
    qr_ready: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WechatMpLoginStart {
    qr_image_data_url: String,
    fingerprint: String,
    status: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WechatMpLoginStatus {
    status: String,
    token: Option<String>,
    message: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WechatMpSessionStatus {
    connected: bool,
    token: Option<String>,
    message: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WechatMpAccount {
    fakeid: String,
    nickname: String,
    alias: String,
    service_type: i64,
    signature: String,
    round_head_img: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WechatMpListArticlesInput {
    fakeid: String,
    begin: Option<i64>,
    count: Option<i64>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WechatMpArticle {
    aid: String,
    title: String,
    link: String,
    digest: String,
    cover: String,
    create_time: i64,
    update_time: i64,
}

fn browser_headers() -> HeaderMap {
    let mut headers = HeaderMap::new();
    headers.insert(USER_AGENT, HeaderValue::from_static("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"));
    headers.insert(
        ACCEPT,
        HeaderValue::from_static(
            "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
        ),
    );
    headers.insert(
        ACCEPT_LANGUAGE,
        HeaderValue::from_static("zh-CN,zh;q=0.9,en;q=0.8"),
    );
    headers.insert(
        REFERER,
        HeaderValue::from_static("https://mp.weixin.qq.com/"),
    );
    headers
}

fn new_client_with_cookie(cookie_header: Option<&str>) -> Result<reqwest::Client, String> {
    let mut headers = browser_headers();
    if let Some(cookie) = cookie_header.filter(|value| !value.trim().is_empty()) {
        headers.insert(
            COOKIE,
            HeaderValue::from_str(cookie)
                .map_err(|error| format!("恢复微信公众号 Cookie 失败：{error}"))?,
        );
    }
    reqwest::Client::builder()
        .cookie_store(true)
        .default_headers(headers)
        .redirect(reqwest::redirect::Policy::limited(5))
        .build()
        .map_err(|error| format!("初始化微信公众号客户端失败：{error}"))
}

fn new_client() -> Result<reqwest::Client, String> {
    new_client_with_cookie(None)
}

fn new_fingerprint() -> String {
    Uuid::new_v4().simple().to_string()
}

fn extract_token(text: &str) -> Option<String> {
    let re = Regex::new(r#"token=([^&\s"']+)"#).ok()?;
    re.captures(text)
        .and_then(|captures| captures.get(1))
        .map(|matched| matched.as_str().to_string())
}

fn now_seconds() -> i64 {
    chrono::Utc::now().timestamp()
}

fn session_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("读取应用数据目录失败：{error}"))?;
    Ok(app_data_dir.join(WECHAT_MP_SESSION_FILE))
}

fn delete_persisted_session(app: &tauri::AppHandle) {
    if let Ok(path) = session_path(app) {
        let _ = std::fs::remove_file(path);
    }
}

fn save_persisted_session(app: &tauri::AppHandle, session: &WechatMpSession) -> Result<(), String> {
    let _ = session;
    delete_persisted_session(app);
    Ok(())
}

fn load_persisted_session(app: &tauri::AppHandle) -> Result<Option<WechatMpSession>, String> {
    let path = session_path(app)?;
    if path.exists() {
        let _ = std::fs::remove_file(path);
    }
    Ok(None)
}

fn cookie_map_from_header(header: &str) -> BTreeMap<String, String> {
    header
        .split(';')
        .filter_map(|part| {
            let (name, value) = part.trim().split_once('=')?;
            let name = name.trim();
            if name.is_empty() {
                return None;
            }
            Some((name.to_string(), value.trim().to_string()))
        })
        .collect()
}

fn merge_set_cookies(existing: Option<&str>, headers: &HeaderMap) -> Option<String> {
    let mut cookies = existing.map(cookie_map_from_header).unwrap_or_default();
    for value in headers.get_all(SET_COOKIE).iter() {
        let Ok(raw) = value.to_str() else {
            continue;
        };
        let Some(first) = raw.split(';').next() else {
            continue;
        };
        let Some((name, cookie_value)) = first.trim().split_once('=') else {
            continue;
        };
        let name = name.trim();
        if !name.is_empty() {
            cookies.insert(name.to_string(), cookie_value.trim().to_string());
        }
    }
    if cookies.is_empty() {
        None
    } else {
        Some(
            cookies
                .into_iter()
                .map(|(name, value)| format!("{name}={value}"))
                .collect::<Vec<_>>()
                .join("; "),
        )
    }
}

fn is_session_expired(session: &WechatMpSession) -> bool {
    session.expires_at <= now_seconds()
}

fn validate_wechat_article_url(raw: &str) -> Result<Url, String> {
    let url = Url::parse(raw.trim()).map_err(|_| "微信公众号文章地址无效".to_string())?;
    validate_wechat_article_redirect_target(&url)?;
    Ok(url)
}

fn validate_wechat_article_redirect_target(url: &Url) -> Result<(), String> {
    if url.scheme() != "https"
        || url.host_str() != Some("mp.weixin.qq.com")
        || url.port_or_known_default() != Some(443)
    {
        return Err("只允许读取 mp.weixin.qq.com 的 HTTPS 文章".to_string());
    }
    Ok(())
}

fn is_allowed_wechat_image_host(host: &str) -> bool {
    matches!(host, "mmbiz.qpic.cn" | "mmbiz.qlogo.cn")
}

fn validate_wechat_image_url(raw: &str) -> Result<Url, String> {
    let trimmed = raw.trim().replace("&amp;", "&");
    let normalized = if trimmed.starts_with("//") {
        format!("https:{trimmed}")
    } else {
        trimmed
    };
    let url = Url::parse(&normalized).map_err(|_| "微信图片地址无效".to_string())?;
    validate_wechat_image_redirect_target(&url)?;
    Ok(url)
}

fn validate_wechat_image_redirect_target(url: &Url) -> Result<(), String> {
    if url.scheme() != "https"
        || !url.host_str().is_some_and(is_allowed_wechat_image_host)
        || url.port_or_known_default() != Some(443)
    {
        return Err("只允许代理 mmbiz.qpic.cn / mmbiz.qlogo.cn 的 HTTPS 图片".to_string());
    }
    Ok(())
}

fn strict_wechat_redirect_policy(
    max_redirects: usize,
    validate_target: fn(&Url) -> Result<(), String>,
) -> reqwest::redirect::Policy {
    reqwest::redirect::Policy::custom(move |attempt| {
        if attempt.previous().len() > max_redirects {
            return attempt.error("too many redirects");
        }
        if let Err(error) = validate_target(attempt.url()) {
            return attempt.error(std::io::Error::new(
                std::io::ErrorKind::PermissionDenied,
                error,
            ));
        }
        attempt.follow()
    })
}

fn is_wechat_verification_page(html: &str) -> bool {
    let lowercase = html.to_ascii_lowercase();
    lowercase.contains("wappoc_appmsgcaptcha")
        || lowercase.contains("id=\"js_verify\"")
        || lowercase.contains("id='js_verify'")
        || html.contains("当前环境异常，完成验证后即可继续访问")
        || (html.contains("环境异常") && html.contains("完成验证"))
}

fn is_wechat_article_content(html: &str) -> bool {
    let lowercase = html.to_ascii_lowercase();
    lowercase.contains("id=\"js_content\"")
        || lowercase.contains("id='js_content'")
        || lowercase.contains("id=js_content")
        || lowercase.contains("rich_media_content")
        || lowercase.contains("var msg_title") && lowercase.contains("var msg_link")
}

fn append_limited_chunk(bytes: &mut Vec<u8>, chunk: &[u8], limit: usize) {
    let remaining = limit.saturating_add(1).saturating_sub(bytes.len());
    bytes.extend_from_slice(&chunk[..chunk.len().min(remaining)]);
}

fn wechat_article_headers(
    user_agent: &'static str,
    cookie_header: Option<&str>,
) -> Result<HeaderMap, String> {
    let mut headers = HeaderMap::new();
    headers.insert(
        ACCEPT,
        HeaderValue::from_static("text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.1"),
    );
    headers.insert(
        ACCEPT_LANGUAGE,
        HeaderValue::from_static("zh-CN,zh;q=0.9,en;q=0.8"),
    );
    headers.insert(
        REFERER,
        HeaderValue::from_static("https://mp.weixin.qq.com/"),
    );
    headers.insert(
        USER_AGENT,
        HeaderValue::from_str(user_agent).map_err(|error| format!("微信 UA 无效：{error}"))?,
    );
    if let Some(cookie) = cookie_header.filter(|value| !value.trim().is_empty()) {
        headers.insert(
            COOKIE,
            HeaderValue::from_str(cookie)
                .map_err(|error| format!("微信公众号 Cookie 无效：{error}"))?,
        );
    }
    Ok(headers)
}

fn wechat_image_headers() -> HeaderMap {
    let mut headers = HeaderMap::new();
    headers.insert(
        ACCEPT,
        HeaderValue::from_static("image/avif,image/webp,image/apng,image/*,*/*;q=0.8"),
    );
    headers.insert(
        ACCEPT_LANGUAGE,
        HeaderValue::from_static("zh-CN,zh;q=0.9,en;q=0.8"),
    );
    headers.insert(
        REFERER,
        HeaderValue::from_static("https://mp.weixin.qq.com/"),
    );
    headers.insert(USER_AGENT, HeaderValue::from_static(WECHAT_DESKTOP_UA));
    headers
}

async fn fetch_wechat_article_with_headers(
    target_url: &Url,
    headers: HeaderMap,
) -> Result<String, String> {
    let client = reqwest::Client::builder()
        .default_headers(headers)
        .connect_timeout(Duration::from_secs(WECHAT_ARTICLE_CONNECT_TIMEOUT_SECS))
        .read_timeout(Duration::from_secs(WECHAT_ARTICLE_READ_TIMEOUT_SECS))
        .timeout(Duration::from_secs(WECHAT_ARTICLE_REQUEST_TIMEOUT_SECS))
        .redirect(strict_wechat_redirect_policy(
            5,
            validate_wechat_article_redirect_target,
        ))
        .build()
        .map_err(|error| format!("初始化微信公众号文章客户端失败：{error}"))?;

    let response = client
        .get(target_url.clone())
        .send()
        .await
        .map_err(|error| format!("读取微信公众号文章失败：{error}"))?;
    validate_wechat_article_redirect_target(response.url())
        .map_err(|error| format!("{error}，已阻止跳转：{}", response.url()))?;
    if !response.status().is_success() {
        return Err(format!(
            "读取微信公众号文章失败：HTTP {}",
            response.status()
        ));
    }
    response
        .text()
        .await
        .map_err(|error| format!("读取微信公众号文章正文失败：{error}"))
}

fn get_optional_session_cookie(
    app: &tauri::AppHandle,
    state: tauri::State<'_, WechatMpState>,
) -> Result<Option<String>, String> {
    let mut guard = state
        .0
        .lock()
        .map_err(|_| "微信公众号登录状态锁定失败".to_string())?;
    if guard.as_ref().is_none() {
        *guard = load_persisted_session(app)?;
    }
    if guard.as_ref().is_some_and(is_session_expired) {
        *guard = None;
        delete_persisted_session(app);
        return Ok(None);
    }
    Ok(guard
        .as_ref()
        .and_then(|session| session.cookie_header.clone())
        .filter(|value| !value.trim().is_empty()))
}

fn get_base_ret(json: &Value) -> i64 {
    json.get("base_resp")
        .and_then(|base| base.get("ret"))
        .and_then(Value::as_i64)
        .unwrap_or(0)
}

fn get_base_error(json: &Value) -> String {
    json.get("base_resp")
        .and_then(|base| base.get("err_msg"))
        .and_then(Value::as_str)
        .unwrap_or("unknown error")
        .to_string()
}

fn session_parts(
    app: &tauri::AppHandle,
    state: tauri::State<'_, WechatMpState>,
) -> Result<(reqwest::Client, String, String), String> {
    let mut guard = state
        .0
        .lock()
        .map_err(|_| "微信公众号登录状态锁定失败".to_string())?;
    if guard.as_ref().is_none() {
        *guard = load_persisted_session(app)?;
    }
    if guard.as_ref().is_some_and(is_session_expired) {
        *guard = None;
        delete_persisted_session(app);
        return Err("微信连接已超过 7 天，请重新扫码登录公众号平台".to_string());
    }
    let session = guard
        .as_ref()
        .ok_or_else(|| "微信未连接，请先扫码登录公众号平台".to_string())?;
    let token = session
        .token
        .clone()
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| "微信未连接，请先扫码登录公众号平台".to_string())?;
    Ok((session.client.clone(), session.fingerprint.clone(), token))
}

#[tauri::command]
pub async fn wechat_mp_start_login(
    state: tauri::State<'_, WechatMpState>,
) -> Result<WechatMpLoginStart, String> {
    let client = new_client()?;
    let fingerprint = new_fingerprint();
    let mut cookie_header: Option<String> = None;

    let initial_response = client
        .get(format!("{MP_BASE_URL}/"))
        .send()
        .await
        .map_err(|error| format!("访问微信公众号登录页失败：{error}"))?;
    cookie_header = merge_set_cookies(cookie_header.as_deref(), initial_response.headers());

    let start_login = client
        .post(format!("{MP_BASE_URL}/cgi-bin/bizlogin?action=startlogin"))
        .form(&[
            ("fingerprint", fingerprint.as_str()),
            ("token", ""),
            ("lang", "zh_CN"),
            ("f", "json"),
            ("ajax", "1"),
            (
                "redirect_url",
                "/cgi-bin/settingpage?t=setting/index&action=index&token=&lang=zh_CN",
            ),
            ("login_type", "3"),
        ])
        .send()
        .await
        .map_err(|error| format!("启动微信公众号扫码登录失败：{error}"))?;
    cookie_header = merge_set_cookies(cookie_header.as_deref(), start_login.headers());

    let uuid = start_login
        .headers()
        .get("X-UUID")
        .and_then(|value| value.to_str().ok())
        .filter(|value| !value.trim().is_empty())
        .map(|value| value.to_string())
        .unwrap_or_else(new_fingerprint);

    let random = chrono::Utc::now().timestamp_millis();
    let qr_url = format!(
        "{MP_BASE_URL}/cgi-bin/scanloginqrcode?action=getqrcode&uuid={uuid}&random={random}"
    );
    let qr_response = client
        .get(qr_url)
        .send()
        .await
        .map_err(|error| format!("获取微信公众号登录二维码失败：{error}"))?;
    cookie_header = merge_set_cookies(cookie_header.as_deref(), qr_response.headers());

    if !qr_response.status().is_success() {
        return Err(format!(
            "获取微信公众号登录二维码失败：HTTP {}",
            qr_response.status()
        ));
    }

    let qr_bytes = qr_response
        .bytes()
        .await
        .map_err(|error| format!("读取微信公众号登录二维码失败：{error}"))?;
    if qr_bytes.is_empty() {
        return Err("微信公众号登录二维码为空".to_string());
    }

    let mut guard = state
        .0
        .lock()
        .map_err(|_| "微信公众号登录状态锁定失败".to_string())?;
    *guard = Some(WechatMpSession {
        client,
        fingerprint: fingerprint.clone(),
        uuid,
        token: None,
        cookie_header,
        saved_at: 0,
        expires_at: 0,
        qr_ready: true,
    });

    Ok(WechatMpLoginStart {
        qr_image_data_url: format!("data:image/png;base64,{}", BASE64.encode(qr_bytes)),
        fingerprint,
        status: "waiting".to_string(),
    })
}

#[tauri::command]
pub async fn wechat_mp_poll_login(
    app: tauri::AppHandle,
    state: tauri::State<'_, WechatMpState>,
) -> Result<WechatMpLoginStatus, String> {
    let (client, fingerprint, _uuid, mut cookie_header) = {
        let guard = state
            .0
            .lock()
            .map_err(|_| "微信公众号登录状态锁定失败".to_string())?;
        let session = guard
            .as_ref()
            .ok_or_else(|| "请先获取微信公众号登录二维码".to_string())?;
        if !session.qr_ready {
            return Err("微信公众号登录二维码尚未准备好".to_string());
        }
        (
            session.client.clone(),
            session.fingerprint.clone(),
            session.uuid.clone(),
            session.cookie_header.clone(),
        )
    };

    let response = client
        .get(format!("{MP_BASE_URL}/cgi-bin/scanloginqrcode"))
        .query(&[
            ("action", "ask"),
            ("fingerprint", fingerprint.as_str()),
            ("lang", "zh_CN"),
            ("f", "json"),
            ("ajax", "1"),
        ])
        .send()
        .await
        .map_err(|error| format!("检查微信公众号扫码状态失败：{error}"))?;
    cookie_header = merge_set_cookies(cookie_header.as_deref(), response.headers());
    let json = response
        .json::<Value>()
        .await
        .map_err(|error| format!("解析微信公众号扫码状态失败：{error}"))?;
    let status_code = json.get("status").and_then(Value::as_i64).unwrap_or(0);

    if status_code == 2 || status_code == 4 {
        return Ok(WechatMpLoginStatus {
            status: "scanned".to_string(),
            token: None,
            message: "已扫码，请在手机上确认登录".to_string(),
        });
    }

    if status_code != 1 && status_code != 3 {
        return Ok(WechatMpLoginStatus {
            status: "waiting".to_string(),
            token: None,
            message: "等待扫码".to_string(),
        });
    }

    let login_response = client
        .post(format!("{MP_BASE_URL}/cgi-bin/bizlogin?action=login"))
        .form(&[
            ("userlang", "zh_CN"),
            ("redirect_url", ""),
            ("cookie_forbidden", "0"),
            ("cookie_cleaned", "0"),
            ("plugin_used", "0"),
            ("login_type", "3"),
            ("fingerprint", fingerprint.as_str()),
            ("token", ""),
            ("lang", "zh_CN"),
            ("f", "json"),
            ("ajax", "1"),
        ])
        .send()
        .await
        .map_err(|error| format!("完成微信公众号登录失败：{error}"))?;
    cookie_header = merge_set_cookies(cookie_header.as_deref(), login_response.headers());
    let body = login_response
        .text()
        .await
        .map_err(|error| format!("读取微信公众号登录结果失败：{error}"))?;
    let mut token = extract_token(&body);
    if token.is_none() {
        let home_response = client
            .get(format!("{MP_BASE_URL}/cgi-bin/home"))
            .send()
            .await
            .map_err(|error| format!("读取微信公众号首页失败：{error}"))?;
        cookie_header = merge_set_cookies(cookie_header.as_deref(), home_response.headers());
        let home_body = home_response
            .text()
            .await
            .map_err(|error| format!("读取微信公众号首页内容失败：{error}"))?;
        token = extract_token(&home_body);
    }

    {
        let mut guard = state
            .0
            .lock()
            .map_err(|_| "微信公众号登录状态锁定失败".to_string())?;
        if let Some(session) = guard.as_mut() {
            session.token = token.clone();
            session.cookie_header = cookie_header.clone();
            if token.is_some() {
                session.saved_at = now_seconds();
                session.expires_at = session.saved_at + WECHAT_MP_SESSION_TTL_SECONDS;
                save_persisted_session(&app, session)?;
            }
        }
    }

    if token.is_none() {
        return Ok(WechatMpLoginStatus {
            status: "failed".to_string(),
            token: None,
            message: "扫码完成，但没有获取到公众号平台 token，请重新扫码登录。".to_string(),
        });
    }

    Ok(WechatMpLoginStatus {
        status: "success".to_string(),
        token,
        message: "微信公众号登录成功".to_string(),
    })
}

#[tauri::command]
pub async fn wechat_mp_status(
    app: tauri::AppHandle,
    state: tauri::State<'_, WechatMpState>,
) -> Result<WechatMpSessionStatus, String> {
    let mut guard = state
        .0
        .lock()
        .map_err(|_| "微信公众号登录状态锁定失败".to_string())?;
    if guard.as_ref().is_none() {
        *guard = load_persisted_session(&app)?;
    }
    if guard.as_ref().is_some_and(is_session_expired) {
        *guard = None;
        delete_persisted_session(&app);
    }
    let token = guard.as_ref().and_then(|session| session.token.clone());
    let connected = token.as_ref().is_some_and(|value| !value.trim().is_empty());
    Ok(WechatMpSessionStatus {
        connected,
        token,
        message: if connected {
            let expires_at = guard
                .as_ref()
                .map(|session| session.expires_at)
                .unwrap_or_default();
            let expires_text = chrono::DateTime::from_timestamp(expires_at, 0)
                .map(|date| {
                    date.with_timezone(&chrono::Local)
                        .format("%Y-%m-%d %H:%M")
                        .to_string()
                })
                .unwrap_or_else(|| "未知时间".to_string());
            format!("微信已连接，有效期至 {expires_text}")
        } else {
            "微信未连接或登录已超过 7 天，请重新扫码".to_string()
        },
    })
}

#[tauri::command]
pub async fn wechat_mp_search_accounts(
    app: tauri::AppHandle,
    state: tauri::State<'_, WechatMpState>,
    query: String,
) -> Result<Vec<WechatMpAccount>, String> {
    let keyword = query.trim();
    if keyword.is_empty() {
        return Ok(vec![]);
    }
    let (client, fingerprint, token) = session_parts(&app, state)?;
    let response = client
        .get(format!("{MP_BASE_URL}/cgi-bin/searchbiz"))
        .query(&[
            ("action", "search_biz"),
            ("begin", "0"),
            ("count", "10"),
            ("query", keyword),
            ("token", token.as_str()),
            ("lang", "zh_CN"),
            ("f", "json"),
            ("ajax", "1"),
            ("fingerprint", fingerprint.as_str()),
        ])
        .send()
        .await
        .map_err(|error| format!("搜索公众号失败：{error}"))?;
    let json = response
        .json::<Value>()
        .await
        .map_err(|error| format!("解析公众号搜索结果失败：{error}"))?;
    let ret = get_base_ret(&json);
    if ret != 0 {
        return Err(format!("搜索公众号失败：{}", get_base_error(&json)));
    }
    let list = json
        .get("list")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    Ok(list
        .into_iter()
        .map(|item| WechatMpAccount {
            fakeid: item
                .get("fakeid")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_string(),
            nickname: item
                .get("nickname")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_string(),
            alias: item
                .get("alias")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_string(),
            service_type: item
                .get("service_type")
                .and_then(Value::as_i64)
                .unwrap_or_default(),
            signature: item
                .get("signature")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_string(),
            round_head_img: item
                .get("round_head_img")
                .and_then(Value::as_str)
                .or_else(|| item.get("head_img").and_then(Value::as_str))
                .unwrap_or_default()
                .to_string(),
        })
        .filter(|item| !item.fakeid.is_empty())
        .collect())
}

#[tauri::command]
pub async fn wechat_mp_list_articles(
    app: tauri::AppHandle,
    state: tauri::State<'_, WechatMpState>,
    input: WechatMpListArticlesInput,
) -> Result<Vec<WechatMpArticle>, String> {
    let fakeid = input.fakeid.trim();
    if fakeid.is_empty() {
        return Ok(vec![]);
    }
    let (client, _fingerprint, token) = session_parts(&app, state)?;
    let begin = input.begin.unwrap_or(0).max(0).to_string();
    let count = input.count.unwrap_or(5).clamp(1, 20).to_string();
    let response = client
        .get(format!("{MP_BASE_URL}/cgi-bin/appmsg"))
        .query(&[
            ("action", "list_ex"),
            ("begin", begin.as_str()),
            ("count", count.as_str()),
            ("fakeid", fakeid),
            ("type", "9"),
            ("token", token.as_str()),
            ("lang", "zh_CN"),
            ("f", "json"),
            ("ajax", "1"),
        ])
        .send()
        .await
        .map_err(|error| format!("拉取公众号文章列表失败：{error}"))?;
    let json = response
        .json::<Value>()
        .await
        .map_err(|error| format!("解析公众号文章列表失败：{error}"))?;
    let ret = get_base_ret(&json);
    if ret != 0 {
        return Err(format!("拉取公众号文章列表失败：{}", get_base_error(&json)));
    }
    let list = json
        .get("app_msg_list")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    Ok(list
        .into_iter()
        .map(|item| WechatMpArticle {
            aid: item
                .get("aid")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_string(),
            title: item
                .get("title")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_string(),
            link: item
                .get("link")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_string(),
            digest: item
                .get("digest")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_string(),
            cover: item
                .get("cover")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_string(),
            create_time: item
                .get("create_time")
                .and_then(Value::as_i64)
                .unwrap_or_default(),
            update_time: item
                .get("update_time")
                .and_then(Value::as_i64)
                .unwrap_or_default(),
        })
        .filter(|item| !item.link.is_empty() && !item.title.is_empty())
        .collect())
}

#[tauri::command]
pub async fn wechat_mp_fetch_article_html(
    app: tauri::AppHandle,
    state: tauri::State<'_, WechatMpState>,
    url: String,
) -> Result<String, String> {
    let target_url = validate_wechat_article_url(&url)?;
    let cookie_header = get_optional_session_cookie(&app, state)?;
    let mut attempts = Vec::with_capacity(WECHAT_ARTICLE_MAX_ATTEMPTS as usize);
    if let Some(cookie) = cookie_header.as_deref() {
        attempts.push(wechat_article_headers(WECHAT_DESKTOP_UA, Some(cookie))?);
    }
    attempts.push(wechat_article_headers(WECHAT_MOBILE_UA, None)?);
    attempts.push(wechat_article_headers(WECHAT_DESKTOP_UA, None)?);

    let mut last_error = "微信公众号文章抓取失败".to_string();
    for headers in attempts {
        match fetch_wechat_article_with_headers(&target_url, headers).await {
            Ok(html) if is_wechat_verification_page(&html) => {
                last_error = "微信公众号返回验证页，正在尝试其他浏览器环境".to_string()
            }
            Ok(html) if is_wechat_article_content(&html) => return Ok(html),
            Ok(html) if html.trim().is_empty() => {
                last_error = "微信公众号文章返回空正文".to_string()
            }
            Ok(_) => last_error = "微信公众号返回的页面不是可识别的文章正文".to_string(),
            Err(error) => last_error = error,
        }
    }
    Err(last_error)
}

#[tauri::command]
pub async fn wechat_mp_fetch_image_data_url(url: String) -> Result<String, String> {
    let target_url = validate_wechat_image_url(&url)?;
    let client = reqwest::Client::builder()
        .default_headers(wechat_image_headers())
        .connect_timeout(Duration::from_secs(WECHAT_IMAGE_CONNECT_TIMEOUT_SECS))
        .read_timeout(Duration::from_secs(WECHAT_IMAGE_READ_TIMEOUT_SECS))
        .timeout(Duration::from_secs(WECHAT_IMAGE_REQUEST_TIMEOUT_SECS))
        .redirect(strict_wechat_redirect_policy(
            3,
            validate_wechat_image_redirect_target,
        ))
        .build()
        .map_err(|error| format!("初始化微信图片客户端失败：{error}"))?;

    let response = client
        .get(target_url)
        .send()
        .await
        .map_err(|error| format!("读取微信图片失败：{error}"))?;
    validate_wechat_image_redirect_target(response.url())
        .map_err(|error| format!("{error}，已阻止跳转：{}", response.url()))?;
    if !response.status().is_success() {
        return Err(format!("读取微信图片失败：HTTP {}", response.status()));
    }
    if response
        .content_length()
        .is_some_and(|length| length > MAX_WECHAT_IMAGE_BYTES as u64)
    {
        return Err("微信图片过大，已跳过代理".to_string());
    }

    let content_type = response
        .headers()
        .get(CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.split(';').next())
        .map(str::trim)
        .filter(|value| value.starts_with("image/") && *value != "image/svg+xml")
        .unwrap_or("image/jpeg")
        .to_string();
    let mut bytes = Vec::with_capacity(
        response
            .content_length()
            .unwrap_or_default()
            .min(MAX_WECHAT_IMAGE_BYTES as u64) as usize,
    );
    let mut stream = response.bytes_stream();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|error| format!("读取微信图片内容失败：{error}"))?;
        append_limited_chunk(&mut bytes, &chunk, MAX_WECHAT_IMAGE_BYTES);
        if bytes.len() > MAX_WECHAT_IMAGE_BYTES {
            return Err("微信图片过大，已跳过代理".to_string());
        }
    }
    if bytes.is_empty() {
        return Err("微信图片为空".to_string());
    }

    Ok(format!(
        "data:{content_type};base64,{}",
        BASE64.encode(bytes)
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn article_redirect_targets_require_exact_https_allowlist() {
        assert!(
            validate_wechat_article_redirect_target(
                &Url::parse("https://mp.weixin.qq.com/s?__biz=test").unwrap()
            )
            .is_ok()
        );
        assert!(
            validate_wechat_article_redirect_target(
                &Url::parse("http://mp.weixin.qq.com/s?__biz=test").unwrap()
            )
            .is_err()
        );
        assert!(
            validate_wechat_article_redirect_target(
                &Url::parse("https://mp.weixin.qq.com.evil.example/s").unwrap()
            )
            .is_err()
        );
        assert!(
            validate_wechat_article_redirect_target(
                &Url::parse("https://mp.weixin.qq.com:8443/s").unwrap()
            )
            .is_err()
        );
    }

    #[test]
    fn image_redirect_targets_require_exact_https_allowlist() {
        for allowed in ["mmbiz.qpic.cn", "mmbiz.qlogo.cn"] {
            assert!(
                validate_wechat_image_redirect_target(
                    &Url::parse(&format!("https://{allowed}/image.jpg")).unwrap()
                )
                .is_ok()
            );
        }
        assert!(
            validate_wechat_image_redirect_target(
                &Url::parse("http://mmbiz.qpic.cn/image.jpg").unwrap()
            )
            .is_err()
        );
        assert!(
            validate_wechat_image_redirect_target(
                &Url::parse("https://mmbiz.qpic.cn.evil.example/image.jpg").unwrap()
            )
            .is_err()
        );
        assert!(
            validate_wechat_image_redirect_target(
                &Url::parse("https://mmbiz.qpic.cn:8443/image.jpg").unwrap()
            )
            .is_err()
        );
    }

    #[test]
    fn verification_page_is_not_accepted_as_article_content() {
        let verification = r#"<html><title>环境异常</title><body>当前环境异常，完成验证后即可继续访问</body></html>"#;
        let open_in_wechat = r#"<html><body>请在微信客户端打开链接</body></html>"#;
        let article = r#"<html><body><div id="js_content" class="rich_media_content">正文</div></body></html>"#;

        assert!(is_wechat_verification_page(verification));
        assert!(!is_wechat_verification_page(article));
        assert!(!is_wechat_article_content(verification));
        assert!(!is_wechat_article_content(open_in_wechat));
        assert!(is_wechat_article_content(article));
    }

    #[test]
    fn limited_chunk_accumulator_stops_at_limit_plus_one() {
        let mut bytes = Vec::new();
        append_limited_chunk(&mut bytes, &[1, 2, 3], 3);
        assert_eq!(bytes, vec![1, 2, 3]);

        append_limited_chunk(&mut bytes, &[4, 5, 6], 3);
        assert_eq!(bytes, vec![1, 2, 3, 4]);
    }

    #[test]
    fn request_timeouts_fit_ui_budget() {
        assert!(
            WECHAT_ARTICLE_REQUEST_TIMEOUT_SECS * WECHAT_ARTICLE_MAX_ATTEMPTS
                <= WECHAT_ARTICLE_UI_BUDGET_SECS
        );
        assert!(WECHAT_ARTICLE_CONNECT_TIMEOUT_SECS < WECHAT_ARTICLE_REQUEST_TIMEOUT_SECS);
        assert!(WECHAT_ARTICLE_READ_TIMEOUT_SECS < WECHAT_ARTICLE_REQUEST_TIMEOUT_SECS);
        assert!((15..=20).contains(&WECHAT_IMAGE_REQUEST_TIMEOUT_SECS));
        assert!(WECHAT_IMAGE_CONNECT_TIMEOUT_SECS < WECHAT_IMAGE_REQUEST_TIMEOUT_SECS);
        assert!(WECHAT_IMAGE_READ_TIMEOUT_SECS < WECHAT_IMAGE_REQUEST_TIMEOUT_SECS);
    }
}
