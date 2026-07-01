/**
 * LingMo 智能排版一键云端部署服务
 * 支持将生成的离线 HTML 页面一键打包部署至 Vercel，支持公网公开访问与分享
 */

// ---------------------------------------------------------------------------
// 1. 类型定义
// ---------------------------------------------------------------------------

export type VercelDeployResult = {
  /** 部署的唯一 URL 地址 */
  url: string
  /** Vercel 部署 ID */
  deploymentId: string
  /** 部署状态，ready 代表已就绪可访问，protected 代表有密码保护，error 代表出错 */
  status: "ready" | "error" | "protected"
  /** 状态的自然语言描述 */
  statusMessage: string
}

const VERCEL_API = "https://api.vercel.com"

// ---------------------------------------------------------------------------
// 2. 辅助方法
// ---------------------------------------------------------------------------

/**
 * 格式化 Vercel 允许的项目名称
 * 仅包含小写字母、数字、短横线，最大长度 80，不以短横线开头或结尾
 */
function sanitizeProjectName(title: string): string {
  const cleaned = title
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80)
    .replace(/-+$/g, "")

  const randId = Math.random().toString(36).substring(2, 8)
  return cleaned ? `lingmo-${cleaned}-${randId}` : `lingmo-workshop-${randId}`
}

/**
 * 将 String 转化为 Base64 编码的 Buffer (兼容浏览器沙盒环境)
 */
function toBase64(str: string): string {
  try {
    return btoa(encodeURIComponent(str).replace(/%([0-9A-F]{2})/g, (match, p1) => {
      return String.fromCharCode(parseInt(p1, 16))
    }))
  } catch {
    // 降级使用 Uint8Array 转换
    const bytes = new TextEncoder().encode(str)
    let binary = ""
    const len = bytes.byteLength
    for (let i = 0; i < len; i++) {
      binary += String.fromCharCode(bytes[i])
    }
    return window.btoa(binary)
  }
}

// ---------------------------------------------------------------------------
// 3. 部署核心逻辑
// ---------------------------------------------------------------------------

/**
 * 物理部署 HTML 页面至 Vercel (关闭预览保护)
 * @param htmlContent HTML 页面代码
 * @param title 报告主标题，用作项目标签名称
 * @param token Vercel API Token (必选)
 * @param onProgress 部署进度回调，用以在 UI 上实时显示轮询百分比/状态
 */
export async function deployToVercel(
  htmlContent: string,
  title: string,
  token: string,
  onProgress?: (msg: string) => void
): Promise<VercelDeployResult> {
  const trimmedToken = token.trim()
  if (!trimmedToken) {
    throw new Error("请先在设置中配置 Vercel API Token")
  }
  if (!htmlContent.trim()) {
    throw new Error("页面内容为空，无法部署")
  }

  const projectName = sanitizeProjectName(title || "output")
  const base64Data = toBase64(htmlContent)

  // 步骤 1: 创建 Vercel 部署体
  onProgress?.("正在打包上传网页代码...")
  const createResp = await fetch(`${VERCEL_API}/v13/deployments`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${trimmedToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      name: projectName,
      files: [
        {
          file: "index.html",
          data: base64Data,
          encoding: "base64",
        },
      ],
      projectSettings: { framework: null },
    }),
  })

  const createdData = await createResp.json()
  if (!createResp.ok) {
    throw new Error(createdData?.error?.message || `Vercel 部署失败 (${createResp.status})`)
  }

  const deploymentId = String(createdData.id || createdData.uid || "")
  const projectId = String(createdData.projectId || "")
  let deploymentUrl = String(createdData.url || "")
  if (deploymentUrl && !deploymentUrl.startsWith("http")) {
    deploymentUrl = `https://${deploymentUrl}`
  }

  // 步骤 2: 关闭 SSO 鉴权锁（重点！防止公网访问时报 401 权限错误）
  if (projectId) {
    onProgress?.("正在开启公网访问权限...")
    try {
      const patchResp = await fetch(`${VERCEL_API}/v9/projects/${projectId}`, {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${trimmedToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          ssoProtection: null,
        }),
      })
      if (!patchResp.ok) {
        console.warn("关闭 Vercel 访问锁失败，返回 HTTP", patchResp.status)
      }
    } catch (e) {
      console.warn("关闭 Vercel 访问锁时发生异常:", e)
    }
  }

  // 步骤 3: 轮询状态，直到部署完成 (READY)
  onProgress?.("等待云端服务器编译部署中...")
  let readyState = "QUEUED"
  let pollCount = 0
  const maxPolls = 20

  while (readyState !== "READY" && readyState !== "ERROR" && pollCount < maxPolls) {
    pollCount++
    onProgress?.(`等待云端就绪中 (轮询中 ${pollCount}/${maxPolls})...`)
    // 每 2 秒轮询一次
    await new Promise((res) => setTimeout(res, 2000))

    try {
      const checkResp = await fetch(`${VERCEL_API}/v13/deployments/${deploymentId}`, {
        headers: {
          Authorization: `Bearer ${trimmedToken}`,
        },
      })
      const checkData = await checkResp.json()
      if (checkResp.ok) {
        readyState = String(checkData.readyState || "QUEUED")
        if (checkData.url) {
          deploymentUrl = checkData.url.startsWith("http")
            ? checkData.url
            : `https://${checkData.url}`
        }
        if (readyState === "ERROR") {
          throw new Error(checkData?.error?.message || "Vercel 云端构建失败")
        }
      }
    } catch (e) {
      console.warn("轮询 Vercel 状态时异常:", e)
    }
  }

  if (readyState !== "READY") {
    return {
      url: deploymentUrl,
      deploymentId,
      status: "protected",
      statusMessage: "云端部署耗时较长，已转入后台，您可以稍后直接通过链接访问",
    }
  }

  // 部署成功，额外多延时 1.5 秒以确保边缘网络路由生效
  onProgress?.("同步云端网络缓存...")
  await new Promise((res) => setTimeout(res, 1500))

  return {
    url: deploymentUrl,
    deploymentId,
    status: "ready",
    statusMessage: "网页部署已成功就绪，公网已开放访问！",
  }
}
