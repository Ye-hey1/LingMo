import { join } from '@tauri-apps/api/path'
import { exists, mkdir, readDir, readFile, stat, writeFile } from '@tauri-apps/plugin-fs'
import { fetch, type Proxy } from '@tauri-apps/plugin-http'
import { Store } from '@tauri-apps/plugin-store'

import { DEFAULT_SYNC_EXCLUDE_PATTERNS, getSyncExcludeReason } from '@/config/sync-exclusions'
import { getRemoteFileContent } from '@/lib/sync/remote-file'
import { getSyncRepoName } from '@/lib/sync/repo-utils'
import { s3Download, s3ListObjects, s3Upload } from '@/lib/sync/s3'
import { webdavDownload, webdavListObjects, webdavUpload } from '@/lib/sync/webdav'
import { getFilePathOptions, getWorkspacePath } from '@/lib/workspace'
import type { S3Config, SyncPlatform, WebDAVConfig } from '@/types/sync'

const WORKSPACE_SYNC_ROOT = '.workspace'
const WORKSPACE_MANIFEST_PATH = `${WORKSPACE_SYNC_ROOT}/manifest.json`
const WORKSPACE_FILE_ROOT = `${WORKSPACE_SYNC_ROOT}/files`
const WORKSPACE_PACKAGE_VERSION = 1

type GitProvider = Extract<SyncPlatform, 'github' | 'gitee' | 'gitlab' | 'gitea'>

interface WorkspaceFileEntry {
  path: string
  size: number
  updatedAt?: string
}

interface WorkspaceManifest {
  version: number
  generatedAt: string
  files: WorkspaceFileEntry[]
  excludePatterns: string[]
}

interface WorkspaceFilePackage {
  version: number
  path: string
  encoding: 'base64'
  data: string
  size: number
  updatedAt?: string
}

export interface WorkspaceFullSyncResult {
  success: boolean
  totalFiles: number
  successCount: number
  failedCount: number
  errors: string[]
}

function normalizePath(path: string) {
  return path.replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+/g, '/')
}

function packagePath(relativePath: string) {
  return `${WORKSPACE_FILE_ROOT}/${normalizePath(relativePath)}.json`
}

function splitRemotePath(path: string) {
  const normalized = normalizePath(path)
  const index = normalized.lastIndexOf('/')
  if (index === -1) {
    return { dir: '', filename: normalized }
  }
  return {
    dir: normalized.slice(0, index),
    filename: normalized.slice(index + 1),
  }
}

function bytesToBase64(bytes: Uint8Array) {
  return Buffer.from(bytes).toString('base64')
}

function base64ToBytes(content: string) {
  return new Uint8Array(Buffer.from(content, 'base64'))
}

async function getProxy(): Promise<Proxy | undefined> {
  const store = await Store.load('store.json')
  const proxyUrl = await store.get<string>('proxy')
  return proxyUrl ? { all: proxyUrl } : undefined
}

async function collectWorkspaceFiles(): Promise<WorkspaceFileEntry[]> {
  const workspace = await getWorkspacePath()
  const files: WorkspaceFileEntry[] = []

  async function walk(relativeDir: string) {
    const pathOptions = await getFilePathOptions(relativeDir)
    const entries = workspace.isCustom
      ? await readDir(pathOptions.path)
      : await readDir(pathOptions.path, { baseDir: pathOptions.baseDir })

    for (const entry of entries) {
      if (entry.name === '.DS_Store' || entry.name.startsWith('.')) {
        continue
      }

      const relativePath = normalizePath(relativeDir ? `${relativeDir}/${entry.name}` : entry.name)
      if (getSyncExcludeReason(relativePath)) {
        continue
      }

      if (entry.isDirectory) {
        await walk(relativePath)
      } else if (entry.isFile) {
        const fileOptions = await getFilePathOptions(relativePath)
        const metadata = workspace.isCustom
          ? await stat(fileOptions.path)
          : await stat(fileOptions.path, { baseDir: fileOptions.baseDir })
        files.push({
          path: relativePath,
          size: metadata.size || 0,
          updatedAt: metadata.mtime?.toISOString(),
        })
      }
    }
  }

  await walk('')
  return files
}

async function readWorkspaceFileAsPackage(file: WorkspaceFileEntry): Promise<WorkspaceFilePackage> {
  const workspace = await getWorkspacePath()
  const pathOptions = await getFilePathOptions(file.path)
  const bytes = workspace.isCustom
    ? await readFile(pathOptions.path)
    : await readFile(pathOptions.path, { baseDir: pathOptions.baseDir })

  return {
    version: WORKSPACE_PACKAGE_VERSION,
    path: file.path,
    encoding: 'base64',
    data: bytesToBase64(bytes),
    size: bytes.byteLength,
    updatedAt: file.updatedAt,
  }
}

async function ensureLocalParentDir(relativePath: string) {
  const dir = normalizePath(relativePath).split('/').slice(0, -1).join('/')
  if (!dir) return

  const workspace = await getWorkspacePath()
  const pathOptions = await getFilePathOptions(dir)
  const existsOptions = workspace.isCustom ? undefined : { baseDir: pathOptions.baseDir }
  const mkdirOptions = workspace.isCustom ? { recursive: true } : { baseDir: pathOptions.baseDir, recursive: true }

  if (!(await exists(pathOptions.path, existsOptions))) {
    await mkdir(pathOptions.path, mkdirOptions)
  }
}

async function writeWorkspaceFileFromPackage(filePackage: WorkspaceFilePackage) {
  if (filePackage.encoding !== 'base64') {
    throw new Error(`不支持的文件编码: ${filePackage.path}`)
  }

  await ensureLocalParentDir(filePackage.path)
  const workspace = await getWorkspacePath()
  const pathOptions = await getFilePathOptions(filePackage.path)
  const bytes = base64ToBytes(filePackage.data)

  if (workspace.isCustom) {
    await writeFile(pathOptions.path, bytes)
  } else {
    await writeFile(pathOptions.path, bytes, { baseDir: pathOptions.baseDir })
  }
}

function parseBase64Json<T>(content: string): T {
  return JSON.parse(Buffer.from(content.replace(/\s+/g, ''), 'base64').toString('utf-8')) as T
}

function encodeJsonBase64(value: unknown) {
  return Buffer.from(JSON.stringify(value, null, 2), 'utf-8').toString('base64')
}

function encodeJsonText(value: unknown) {
  return JSON.stringify(value, null, 2)
}

async function getGitContext(provider: GitProvider) {
  const store = await Store.load('store.json')
  const repo = await getSyncRepoName(provider)

  if (provider === 'github') {
    return {
      repo,
      token: await store.get<string>('accessToken'),
      username: await store.get<string>('githubUsername'),
      branch: 'main',
    }
  }

  if (provider === 'gitee') {
    return {
      repo,
      token: await store.get<string>('giteeAccessToken'),
      username: await store.get<string>('giteeUsername'),
      branch: 'master',
    }
  }

  if (provider === 'gitlab') {
    return {
      repo,
      token: await store.get<string>('gitlabAccessToken'),
      projectId: await store.get<string>(`gitlab_${repo}_project_id`),
      branch: await store.get<string>('gitlabBranch') || 'main',
    }
  }

  return {
    repo,
    token: await store.get<string>('giteaAccessToken'),
    username: await store.get<string>('giteaUsername'),
    branch: await store.get<string>('giteaBranch') || 'main',
    baseUrl: await getGiteaApiBaseUrlForWorkspace(),
  }
}

async function getGitlabApiBaseUrlForWorkspace() {
  const store = await Store.load('store.json')
  const instanceType = await store.get<string>('gitlabInstanceType') || 'official'
  if (instanceType === 'self-hosted') {
    let customUrl = await store.get<string>('gitlabCustomUrl') || ''
    customUrl = customUrl.replace(/\/+$/, '').trim()
    if (!customUrl) throw new Error('GitLab URL 未配置')
    if (!customUrl.startsWith('http://') && !customUrl.startsWith('https://')) {
      customUrl = `https://${customUrl}`
    }
    return `${customUrl}/api/v4`
  }
  return instanceType === 'jihulab' ? 'https://jihulab.com/api/v4' : 'https://gitlab.com/api/v4'
}

async function getGiteaApiBaseUrlForWorkspace() {
  const store = await Store.load('store.json')
  const instanceType = await store.get<string>('giteaInstanceType') || 'official'
  if (instanceType === 'self-hosted') {
    let customUrl = await store.get<string>('giteaCustomUrl') || ''
    customUrl = customUrl.replace(/\/+$/, '').trim()
    if (!customUrl) throw new Error('Gitea URL 未配置')
    if (!customUrl.startsWith('http://') && !customUrl.startsWith('https://')) {
      customUrl = `http://${customUrl}`
    }
    return `${customUrl}/api/v1`
  }
  return 'https://gitea.com/api/v1'
}

function encodeRepoPath(path: string, replaceSpaces = true) {
  return normalizePath(path)
    .split('/')
    .map(segment => encodeURIComponent(replaceSpaces ? segment.replace(/\s/g, '_') : segment))
    .join('/')
}

async function uploadGitFile(provider: GitProvider, remotePath: string, contentBase64: string) {
  const ctx = await getGitContext(provider)
  const proxy = await getProxy()

  if (provider === 'github') {
    if (!ctx.token || !ctx.username) throw new Error('GitHub 未配置')
    const encodedPath = encodeRepoPath(remotePath)
    const headers = new Headers({
      Authorization: `Bearer ${ctx.token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'Content-Type': 'application/json',
    })
    const getUrl = `https://api.github.com/repos/${ctx.username}/${ctx.repo}/contents/${encodedPath}`
    const existing = await fetch(getUrl, { method: 'GET', headers, proxy }).then(res => res.ok ? res.json() : null).catch(() => null)
    const response = await fetch(getUrl, {
      method: 'PUT',
      headers,
      proxy,
      body: JSON.stringify({
        message: `Sync workspace file: ${remotePath}`,
        content: contentBase64,
        sha: existing?.sha,
      }),
    })
    if (!response.ok) throw new Error(`GitHub 上传失败: ${remotePath}`)
    return
  }

  if (provider === 'gitee') {
    if (!ctx.token || !ctx.username) throw new Error('Gitee 未配置')
    const encodedPath = encodeRepoPath(remotePath)
    const url = `https://gitee.com/api/v5/repos/${ctx.username}/${ctx.repo}/contents/${encodedPath}`
    const existing = await fetch(`${url}?access_token=${ctx.token}`, { method: 'GET', proxy }).then(res => res.ok ? res.json() : null).catch(() => null)
    const response = await fetch(url, {
      method: existing?.sha ? 'PUT' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      proxy,
      body: JSON.stringify({
        access_token: ctx.token,
        content: contentBase64,
        message: `Sync workspace file: ${remotePath}`,
        branch: ctx.branch,
        sha: existing?.sha,
      }),
    })
    if (!response.ok) throw new Error(`Gitee 上传失败: ${remotePath}`)
    return
  }

  if (provider === 'gitlab') {
    if (!ctx.token || !ctx.projectId) throw new Error('GitLab 未配置')
    const baseUrl = await getGitlabApiBaseUrlForWorkspace()
    const encodedPath = encodeURIComponent(normalizePath(remotePath).replace(/\s/g, '_'))
    const headers = new Headers({
      'PRIVATE-TOKEN': ctx.token,
      'Content-Type': 'application/json',
    })
    const url = `${baseUrl}/projects/${ctx.projectId}/repository/files/${encodedPath}`
    const createBody = {
      branch: ctx.branch,
      content: contentBase64,
      commit_message: `Sync workspace file: ${remotePath}`,
      encoding: 'base64',
    }
    const createResponse = await fetch(url, { method: 'POST', headers, proxy, body: JSON.stringify(createBody) })
    if (createResponse.ok) return
    const updateResponse = await fetch(url, { method: 'PUT', headers, proxy, body: JSON.stringify(createBody) })
    if (!updateResponse.ok) throw new Error(`GitLab 上传失败: ${remotePath}`)
    return
  }

  if (!ctx.token || !ctx.username || !ctx.baseUrl) throw new Error('Gitea 未配置')
  const encodedPath = encodeRepoPath(remotePath)
  const headers = new Headers({
    Authorization: `token ${ctx.token}`,
    'Content-Type': 'application/json',
  })
  const url = `${ctx.baseUrl}/repos/${ctx.username}/${ctx.repo}/contents/${encodedPath}`
  const existing = await fetch(`${url}?ref=${ctx.branch}`, { method: 'GET', headers, proxy }).then(res => res.ok ? res.json() : null).catch(() => null)
  const response = await fetch(url, {
    method: existing?.sha ? 'PUT' : 'POST',
    headers,
    proxy,
    body: JSON.stringify({
      branch: ctx.branch,
      content: contentBase64,
      message: `Sync workspace file: ${remotePath}`,
      sha: existing?.sha,
    }),
  })
  if (!response.ok) throw new Error(`Gitea 上传失败: ${remotePath}`)
}

async function downloadGitFile(provider: GitProvider, remotePath: string): Promise<string | null> {
  const ctx = await getGitContext(provider)
  const proxy = await getProxy()

  if (provider === 'github') {
    if (!ctx.token || !ctx.username) throw new Error('GitHub 未配置')
    const url = `https://api.github.com/repos/${ctx.username}/${ctx.repo}/contents/${encodeRepoPath(remotePath)}`
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${ctx.token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
      proxy,
    })
    if (!response.ok) return null
    return getRemoteFileContent(await response.json(), remotePath)
  }

  if (provider === 'gitee') {
    if (!ctx.token || !ctx.username) throw new Error('Gitee 未配置')
    const url = `https://gitee.com/api/v5/repos/${ctx.username}/${ctx.repo}/contents/${encodeRepoPath(remotePath)}?access_token=${ctx.token}`
    const response = await fetch(url, { method: 'GET', proxy })
    if (!response.ok) return null
    return getRemoteFileContent(await response.json(), remotePath)
  }

  if (provider === 'gitlab') {
    if (!ctx.token || !ctx.projectId) throw new Error('GitLab 未配置')
    const baseUrl = await getGitlabApiBaseUrlForWorkspace()
    const url = `${baseUrl}/projects/${ctx.projectId}/repository/files/${encodeURIComponent(normalizePath(remotePath).replace(/\s/g, '_'))}?ref=${ctx.branch}`
    const response = await fetch(url, {
      method: 'GET',
      headers: { 'PRIVATE-TOKEN': ctx.token },
      proxy,
    })
    if (!response.ok) return null
    return getRemoteFileContent(await response.json(), remotePath)
  }

  if (!ctx.token || !ctx.username || !ctx.baseUrl) throw new Error('Gitea 未配置')
  const url = `${ctx.baseUrl}/repos/${ctx.username}/${ctx.repo}/contents/${encodeRepoPath(remotePath)}?ref=${ctx.branch}`
  const response = await fetch(url, {
    method: 'GET',
    headers: { Authorization: `token ${ctx.token}` },
    proxy,
  })
  if (!response.ok) return null
  return getRemoteFileContent(await response.json(), remotePath)
}

async function uploadRemoteJson(platform: SyncPlatform, remotePath: string, value: unknown) {
  if (platform === 's3') {
    const store = await Store.load('store.json')
    const config = await store.get<S3Config>('s3SyncConfig')
    if (!config) throw new Error('S3 未配置')
    const result = await s3Upload(config, remotePath, encodeJsonText(value), await getProxy())
    if (!result) throw new Error(`S3 上传失败: ${remotePath}`)
    return
  }

  if (platform === 'webdav') {
    const store = await Store.load('store.json')
    const config = await store.get<WebDAVConfig>('webdavSyncConfig')
    if (!config) throw new Error('WebDAV 未配置')
    const result = await webdavUpload(config, remotePath, encodeJsonText(value), await getProxy())
    if (!result) throw new Error(`WebDAV 上传失败: ${remotePath}`)
    return
  }

  await uploadGitFile(platform, remotePath, encodeJsonBase64(value))
}

async function downloadRemoteJson<T>(platform: SyncPlatform, remotePath: string): Promise<T | null> {
  if (platform === 's3') {
    const store = await Store.load('store.json')
    const config = await store.get<S3Config>('s3SyncConfig')
    if (!config) throw new Error('S3 未配置')
    const result = await s3Download(config, remotePath, await getProxy())
    return result?.content ? JSON.parse(result.content) as T : null
  }

  if (platform === 'webdav') {
    const store = await Store.load('store.json')
    const config = await store.get<WebDAVConfig>('webdavSyncConfig')
    if (!config) throw new Error('WebDAV 未配置')
    const result = await webdavDownload(config, remotePath, await getProxy())
    return result?.content ? JSON.parse(result.content) as T : null
  }

  const content = await downloadGitFile(platform, remotePath)
  return content ? parseBase64Json<T>(content) : null
}

export async function uploadWorkspaceFiles(): Promise<WorkspaceFullSyncResult> {
  const store = await Store.load('store.json')
  const platform = (await store.get<string>('primaryBackupMethod') || 'github') as SyncPlatform
  const files = await collectWorkspaceFiles()
  const errors: string[] = []
  let successCount = 0

  for (const file of files) {
    try {
      const filePackage = await readWorkspaceFileAsPackage(file)
      await uploadRemoteJson(platform, packagePath(file.path), filePackage)
      successCount += 1
    } catch (error) {
      errors.push(`${file.path}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  const manifest: WorkspaceManifest = {
    version: 1,
    generatedAt: new Date().toISOString(),
    files,
    excludePatterns: DEFAULT_SYNC_EXCLUDE_PATTERNS.map(item => item.pattern),
  }
  await uploadRemoteJson(platform, WORKSPACE_MANIFEST_PATH, manifest)

  return {
    success: errors.length === 0,
    totalFiles: files.length,
    successCount,
    failedCount: errors.length,
    errors,
  }
}

export async function downloadWorkspaceFiles(): Promise<WorkspaceFullSyncResult> {
  const store = await Store.load('store.json')
  const platform = (await store.get<string>('primaryBackupMethod') || 'github') as SyncPlatform
  const manifest = await downloadRemoteJson<WorkspaceManifest>(platform, WORKSPACE_MANIFEST_PATH)
  const files = manifest?.files || await listRemoteWorkspaceFiles(platform)
  const errors: string[] = []
  let successCount = 0

  for (const file of files) {
    try {
      const filePackage = await downloadRemoteJson<WorkspaceFilePackage>(platform, packagePath(file.path))
      if (!filePackage) {
        throw new Error('远程文件包不存在')
      }
      await writeWorkspaceFileFromPackage(filePackage)
      successCount += 1
    } catch (error) {
      errors.push(`${file.path}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  return {
    success: errors.length === 0,
    totalFiles: files.length,
    successCount,
    failedCount: errors.length,
    errors,
  }
}

async function listRemoteWorkspaceFiles(platform: SyncPlatform): Promise<WorkspaceFileEntry[]> {
  if (platform === 's3') {
    const store = await Store.load('store.json')
    const config = await store.get<S3Config>('s3SyncConfig')
    if (!config) return []
    return (await s3ListObjects(config, WORKSPACE_FILE_ROOT, await getProxy()))
      .filter(item => item.key.endsWith('.json'))
      .map(item => ({
        path: item.key.replace(new RegExp(`^${WORKSPACE_FILE_ROOT}/`), '').replace(/\.json$/, ''),
        size: item.size,
        updatedAt: item.lastModified,
      }))
  }

  if (platform === 'webdav') {
    const store = await Store.load('store.json')
    const config = await store.get<WebDAVConfig>('webdavSyncConfig')
    if (!config) return []
    return (await webdavListObjects(config, WORKSPACE_FILE_ROOT, await getProxy()))
      .filter(item => item.key.endsWith('.json'))
      .map(item => ({
        path: item.key.replace(new RegExp(`^${WORKSPACE_FILE_ROOT}/`), '').replace(/\.json$/, ''),
        size: item.size,
        updatedAt: item.lastModified,
      }))
  }

  return []
}
