/**
 * 事件上报工具函数
 * 用于向 toolsetlink API 上报应用事件
 */

import CryptoJS from 'crypto-js'
import { arch, platform } from '@tauri-apps/plugin-os'
import { fetch as tauriFetch } from '@tauri-apps/plugin-http'
import { getVersion } from '@tauri-apps/api/app'
import { invoke } from '@tauri-apps/api/core'

// 配置常量 - 从环境变量读取，避免硬编码泄露
const API_CONFIG = {
  baseURL: process.env.NEXT_PUBLIC_UPGRADE_API_URL || 'https://api.upgrade.toolsetlink.com',
  accessKey: process.env.NEXT_PUBLIC_UPGRADE_ACCESS_KEY || '',
  secretKey: process.env.UPGRADE_SECRET_KEY || '',
  appKey: process.env.NEXT_PUBLIC_UPGRADE_APP_KEY || '',
}

function isEventReportConfigured(): boolean {
  return Boolean(
    API_CONFIG.baseURL &&
    API_CONFIG.accessKey &&
    API_CONFIG.secretKey &&
    API_CONFIG.appKey
  )
}

function logEventReportDebug(message: string, detail?: unknown) {
  if (process.env.NODE_ENV !== 'development') {
    return
  }

  if (detail !== undefined) {
    // eslint-disable-next-line no-console
    console.debug(`[event-report] ${message}`, detail)
  } else {
    // eslint-disable-next-line no-console
    console.debug(`[event-report] ${message}`)
  }
}

function isSuccessfulReportResponse(result: unknown): result is { code: number } {
  return Boolean(
    result &&
    typeof result === 'object' &&
    'code' in result &&
    (result as { code?: unknown }).code === 0
  )
}

// 事件类型枚举
export enum EventType {
  APP_START = 'app_start',
  APP_UPGRADE_DOWNLOAD = 'app_upgrade_download',
  APP_UPGRADE_UPGRADE = 'app_upgrade_upgrade',
}

// 事件数据接口
export interface AppStartEventData {
  launchTime: string // RFC3339格式
  versionCode: number
  devModelKey?: string
  devKey?: string
  target?: string
  arch?: string
}

export interface AppUpgradeDownloadEventData {
  downloadVersionCode: number
  code: number // 0: 成功, 1: 失败
  versionCode: number
  devModelKey?: string
  devKey?: string
  target?: string
  arch?: string
}

export interface AppUpgradeUpgradeEventData {
  upgradeVersionCode: number
  code: number // 0: 成功, 1: 失败
  versionCode: number
  devModelKey?: string
  devKey?: string
  target?: string
  arch?: string
}

export type EventData = AppStartEventData | AppUpgradeDownloadEventData | AppUpgradeUpgradeEventData

// 请求体接口
interface ReportRequestBody {
  eventType: EventType
  appKey: string
  timestamp: string
  eventData: EventData
}

/**
 * 生成 RFC3339 格式的时间戳
 * 使用 UTC 时间，避免时区问题
 */
function generateRFC3339Timestamp(): string {
  const now = new Date()
  return now.toISOString()
}

/**
 * 生成随机 Nonce（至少16位）
 */
function generateNonce(): string {
  return Array.from({ length: 16 }, () => 
    Math.floor(Math.random() * 16).toString(16)
  ).join('')
}

/**
 * 生成请求签名
 * 签名规则：MD5(body=${body}&nonce=${nonce}&secretKey=${secretKey}&timestamp=${timestamp}&url=${url})
 */
function generateSignature(
  body: string,
  nonce: string,
  timestamp: string,
  url: string,
  secretKey: string
): string {
  const signStr = `body=${body}&nonce=${nonce}&secretKey=${secretKey}&timestamp=${timestamp}&url=${url}`
  return CryptoJS.MD5(signStr).toString()
}

/**
 * 获取当前应用版本号
 * 从运行时获取版本号，转换为数字格式
 * 例如: "0.22.2" -> 22002, "1.22.2" -> 1022002
 * 每个点分隔的数字占3位，1000进一位
 */
async function getVersionCode(): Promise<number> {
  try {
    // 从运行时获取版本号
    const version = await getVersion()
    const versionParts = version.split('.')
    
    // 确保有3个部分，不足的补0
    const major = parseInt(versionParts[0] || '0', 10)
    const minor = parseInt(versionParts[1] || '0', 10)
    const patch = parseInt(versionParts[2] || '0', 10)
    
    // 转换为数字: major * 1000000 + minor * 1000 + patch
    return major * 1000000 + minor * 1000 + patch
  } catch (error) {
    logEventReportDebug('Failed to get version code', error)
    return 1
  }
}

/**
 * 获取设备唯一标识
 * - 桌面端：使用硬件唯一标识（machine-uid）
 * - 移动端：使用 UUID 并持久化存储（应用卸载后会重置）
 */
async function getDeviceId(): Promise<string | undefined> {
  try {
    const deviceId = await invoke<string>('get_device_id')
    return deviceId
  } catch (error) {
    logEventReportDebug('Failed to get device ID', error)
    return undefined
  }
}

/**
 * 获取设备信息
 */
async function getDeviceInfo() {
  try {
    const targetPlatform = await platform()
    const archInfo = await arch()
    const deviceId = await getDeviceId()
    
    return {
      target: targetPlatform,
      arch: archInfo,
      devKey: deviceId,
    }
  } catch (error) {
    logEventReportDebug('Failed to get device info', error)
    return {
      target: undefined,
      arch: undefined,
      devKey: undefined,
    }
  }
}

/**
 * 上报事件
 */
export async function reportEvent(
  eventType: EventType,
  eventData: EventData
): Promise<boolean> {
  if (!isEventReportConfigured()) {
    logEventReportDebug('Skipped event report because upgrade API credentials are incomplete', { eventType })
    return false
  }

  try {
    const timestamp = generateRFC3339Timestamp()
    const nonce = generateNonce()
    const url = '/v1/app/report'
    
    const requestBody: ReportRequestBody = {
      eventType,
      appKey: API_CONFIG.appKey,
      timestamp,
      eventData,
    }
    
    const bodyString = JSON.stringify(requestBody)
    const signature = generateSignature(
      bodyString,
      nonce,
      timestamp,
      url,
      API_CONFIG.secretKey
    )
    
    const response = await tauriFetch(`${API_CONFIG.baseURL}${url}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Timestamp': timestamp,
        'X-Nonce': nonce,
        'X-AccessKey': API_CONFIG.accessKey,
        'X-Signature': signature,
      },
      body: bodyString,
    })
    
    const responseText = await response.text()
    if (!responseText.trim()) {
      return response.ok
    }

    let result: unknown
    try {
      result = JSON.parse(responseText)
    } catch {
      return false
    }

    if (response.ok && isSuccessfulReportResponse(result)) {
      return true
    } else {
      logEventReportDebug('Failed to report event', {
        eventType,
        status: response.status,
        result,
      })
      return false
    }
  } catch (error) {
    logEventReportDebug('Error reporting event', { eventType, error })
    return false
  }
}

/**
 * 上报应用启动事件
 */
export async function reportAppStart(): Promise<boolean> {
  if (!isEventReportConfigured()) {
    logEventReportDebug('Skipped app start report because upgrade API credentials are incomplete')
    return false
  }

  try {
    const versionCode = await getVersionCode()
    const deviceInfo = await getDeviceInfo()
    const launchTime = generateRFC3339Timestamp()
    
    const eventData: AppStartEventData = {
      launchTime,
      versionCode,
      devKey: deviceInfo.devKey,
      target: deviceInfo.target,
      arch: deviceInfo.arch,
    }
    
    return await reportEvent(EventType.APP_START, eventData)
  } catch (error) {
    logEventReportDebug('Failed to report app start', error)
    return false
  }
}

/**
 * 上报应用升级下载事件
 */
export async function reportAppUpgradeDownload(
  downloadVersionCode: number,
  code: number
): Promise<boolean> {
  if (!isEventReportConfigured()) {
    logEventReportDebug('Skipped app upgrade download report because upgrade API credentials are incomplete')
    return false
  }

  try {
    const versionCode = await getVersionCode()
    const deviceInfo = await getDeviceInfo()
    
    const eventData: AppUpgradeDownloadEventData = {
      downloadVersionCode,
      code,
      versionCode,
      devKey: deviceInfo.devKey,
      target: deviceInfo.target,
      arch: deviceInfo.arch,
    }
    
    return await reportEvent(EventType.APP_UPGRADE_DOWNLOAD, eventData)
  } catch (error) {
    logEventReportDebug('Failed to report app upgrade download', error)
    return false
  }
}

/**
 * 上报应用升级事件
 */
export async function reportAppUpgradeUpgrade(
  upgradeVersionCode: number,
  code: number
): Promise<boolean> {
  if (!isEventReportConfigured()) {
    logEventReportDebug('Skipped app upgrade report because upgrade API credentials are incomplete')
    return false
  }

  try {
    const versionCode = await getVersionCode()
    const deviceInfo = await getDeviceInfo()
    
    const eventData: AppUpgradeUpgradeEventData = {
      upgradeVersionCode,
      code,
      versionCode,
      devKey: deviceInfo.devKey,
      target: deviceInfo.target,
      arch: deviceInfo.arch,
    }
    
    return await reportEvent(EventType.APP_UPGRADE_UPGRADE, eventData)
  } catch (error) {
    logEventReportDebug('Failed to report app upgrade', error)
    return false
  }
}
