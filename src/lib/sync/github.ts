import { toast } from '@/hooks/use-toast';
import { Store } from '@tauri-apps/plugin-store';
import { v4 as uuid } from 'uuid';
import { GithubError, GithubRepoInfo, OctokitResponse } from './github.types';
import { fetch } from '@tauri-apps/plugin-http'
import { buildRepoContentPath, buildRepoContentsEndpoint } from './remote-file'
import { getProxyConfig } from '@/lib/network-proxy';
export { decodeBase64ToString } from './remote-file';

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

function isJsonParseError(error: unknown) {
  if (error instanceof SyntaxError) return true
  return /json|unterminated string|unexpected end/i.test(getErrorMessage(error))
}

function isBadControlCharacterError(error: unknown) {
  return /bad control character/i.test(getErrorMessage(error))
}

function isTruncatedJsonError(error: unknown) {
  return /unterminated string|unexpected end/i.test(getErrorMessage(error))
}

function escapeJsonStringControlCharacters(text: string) {
  let result = ''
  let inString = false
  let escaped = false

  for (const char of text) {
    if (!inString) {
      result += char
      if (char === '"') {
        inString = true
      }
      continue
    }

    if (escaped) {
      result += char
      escaped = false
      continue
    }

    if (char === '\\') {
      result += char
      escaped = true
      continue
    }

    if (char === '"') {
      result += char
      inString = false
      continue
    }

    const code = char.charCodeAt(0)
    if (code < 0x20) {
      if (char === '\b') result += '\\b'
      else if (char === '\f') result += '\\f'
      else if (char === '\n') result += '\\n'
      else if (char === '\r') result += '\\r'
      else if (char === '\t') result += '\\t'
      else result += `\\u${code.toString(16).padStart(4, '0')}`
      continue
    }

    result += char
  }

  return result
}

function safeGetHeader(headers: Headers | null | undefined, name: string): string | null {
  if (!headers || typeof headers.get !== 'function') return null
  try {
    return headers.get(name)
  } catch {
    return null
  }
}

async function safeResponseJson<T = any>(response: Response, context = 'GitHub API'): Promise<T> {
  if (response.status === 204) return {} as T

  const text = await response.text()
  if (!text.trim()) return {} as T

  try {
    return JSON.parse(text) as T
  } catch (error) {
    if (isBadControlCharacterError(error)) {
      try {
        return JSON.parse(escapeJsonStringControlCharacters(text)) as T
      } catch (normalizedError) {
        throw new Error(`${context} JSON 响应包含未转义控制字符，自动修正后仍解析失败：${getErrorMessage(normalizedError)}`)
      }
    }

    if (isTruncatedJsonError(error)) {
      throw new Error(`${context} JSON 响应不完整，可能是代理或网络中断导致响应被截断：${getErrorMessage(error)}`)
    }

    if (isJsonParseError(error)) {
      throw new Error(`${context} JSON 响应解析失败：${getErrorMessage(error)}`)
    }

    throw error
  }
}

async function getGitHubErrorMessage(response: Response, context: string) {
  try {
    const data = await safeResponseJson<{ message?: string }>(response, context)
    return data?.message ? ` - ${data.message}` : ''
  } catch (error) {
    return ` - ${getErrorMessage(error)}`
  }
}

async function throwGitHubResponseError(response: Response, context: string): Promise<never> {
  const message = await getGitHubErrorMessage(response, context)

  if (response.status === 401) {
    throw new Error('GitHub Token 无效或已过期，请检查同步设置中的 Token')
  }

  if (response.status === 403) {
    const remaining = safeGetHeader(response.headers, 'x-ratelimit-remaining')
    const reset = safeGetHeader(response.headers, 'x-ratelimit-reset')
    if (remaining === '0' && reset) {
      const resetTime = new Date(Number(reset) * 1000).toLocaleString()
      throw new Error(`GitHub API 请求已达限额，请在 ${resetTime} 后重试`)
    }

    throw new Error(`GitHub Token 权限不足或访问被 GitHub 拒绝，请确认 Token 至少具备 repo 权限${message}`)
  }

  if (response.status === 404) {
    throw new Error(`${context}：仓库不存在，或当前 Token 没有访问权限`)
  }

  throw new Error(`${context}：${response.status} ${response.statusText}${message}`)
}

export function uint8ArrayToBase64(data: Uint8Array) {
  return Buffer.from(data).toString('base64');
}

// File 转换 Base64
export async function fileToBase64(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => {
      // 删除前缀
      const base64 = reader.result?.toString().replace(/^data:image\/\w+;base64,/, '');
      resolve(base64 || '');
    }
    reader.onerror = () => {
      reject(reader.error ?? new Error('读取文件失败'))
    }
  });
}

export interface GithubFile {
  name: string;
  path: string;
  sha: string;
  size: number;
  url: string;
  html_url: string;
  git_url: string;
  download_url: string;
  type: string;
  _links: Links;
  isNew?: boolean;
}

interface Links {
  self: string;
  git: string;
  html: string;
}

export async function uploadFile(
  { file, filename, sha, message, repo, path }:
  { file: string, filename?: string, sha?: string, message?: string, repo: string, path?: string })
{
  const store = await Store.load('store.json');
  const accessToken = await store.get('accessToken')
  const githubUsername = await store.get('githubUsername')
  const id = uuid()
  
  // 获取代理设置
  const proxy = await getProxyConfig()
  
  try {
    // 构建路径，将空格转换成下划线
    const _path = path ? `/${path.replace(/\s/g, '_')}` : ''

    // 对 URL 路径进行编码（保留中文字符的 UTF-8 编码）
    const urlPath = _path.split('/').map(segment => encodeURIComponent(segment)).join('/')

    // 将内容转换为 Base64（GitHub API 要求）
    const base64Content = Buffer.from(file, 'utf-8').toString('base64')

    // 设置请求头
    const headers = new Headers();
    headers.append('Authorization', `Bearer ${accessToken}`);
    headers.append('Accept', 'application/vnd.github+json');
    headers.append('X-GitHub-Api-Version', '2022-11-28');
    headers.append('Content-Type', 'application/json');

    const requestOptions = {
      method: 'PUT',
      headers,
      body: JSON.stringify({
        message: message || `Upload ${filename || id}`,
        content: base64Content,
        sha
      }),
      proxy
    };

    const url = `https://api.github.com/repos/${githubUsername}/${repo}/contents${urlPath}`;
    const response = await fetch(url, requestOptions);

    if (response.status >= 200 && response.status < 300) {
      const data = await safeResponseJson(response, '上传文件');
      return { data } as OctokitResponse<any>;
    }

    if (response.status === 400) {
      return null;
    }

    const errorData = await safeResponseJson<{ message?: string }>(response, '上传文件');
    throw {
      status: response.status,
      message: errorData.message || '同步失败'
    };
  } catch (error) {
    toast({
      title: '同步失败',
      description: (error as GithubError).message,
      variant: 'destructive',
    })
  }
}

export async function getFiles({ path, repo, ref }: { path: string, repo: string, ref?: string }) {
  const store = await Store.load('store.json');
  const accessToken = await store.get('accessToken')
  if (!accessToken) return;

  const githubUsername = await store.get('githubUsername')

  // 只对空格进行转义，保留中文字符的原始 UTF-8 编码
  const safePath = path.replace(/\s/g, '_')

  // 对 URL 路径进行编码
  const encodedPath = safePath.split('/').map(segment => encodeURIComponent(segment)).join('/')

  // 获取代理设置
  const proxy = await getProxyConfig()

  try {
    // 设置请求头
    const headers = new Headers();
    headers.append('Authorization', `Bearer ${accessToken}`);
    headers.append('Accept', 'application/vnd.github+json');
    headers.append('X-GitHub-Api-Version', '2022-11-28');
    headers.append('If-None-Match', '');

    const requestOptions = {
      method: 'GET',
      headers,
      proxy
    };

    // 如果有 ref 参数，添加到 URL 查询参数中
    const refParam = ref ? `?ref=${ref}` : '';
    const url = `https://api.github.com/repos/${githubUsername}/${repo}/contents/${encodedPath}${refParam}`;
    
    try {
      const response = await fetch(url, requestOptions);
      if (response.status >= 200 && response.status < 300) {
        const data = await safeResponseJson(response, '查询文件');
        return data;
      }
      return null;
    } catch {
      return null;
    }
  } catch (error) {
    if ((error as GithubError).status !== 404) {
      toast({
        title: '查询失败',
        description: (error as GithubError).message,
        variant: 'destructive',
      })
    }
  }
}

export async function deleteFile(
  { path, sha, repo, token, username }: 
  { path: string, sha: string, repo: string, token?: string, username?: string }
) {
  const store = await Store.load('store.json');
  const accessToken = token || await store.get('accessToken')
  if (!accessToken) return;
  
  const githubUsername = username || await store.get('githubUsername')
  
  // 获取代理设置
  const proxy = await getProxyConfig()
  
  try {
    // 设置请求头
    const headers = new Headers();
    headers.append('Authorization', `Bearer ${accessToken}`);
    headers.append('Accept', 'application/vnd.github+json');
    headers.append('X-GitHub-Api-Version', '2022-11-28');
    headers.append('Content-Type', 'application/json');
    
    const requestOptions = {
      method: 'DELETE',
      headers,
      body: JSON.stringify({
        sha,
        message: `Delete ${path}`
      }),
      proxy
    };

    const encodedPath = buildRepoContentPath({ path, preserveWhitespace: true })
    const url = `https://api.github.com/repos/${githubUsername}/${repo}${buildRepoContentsEndpoint(encodedPath)}`;
    const response = await fetch(url, requestOptions);
    
    if (response.status >= 200 && response.status < 300) {
      const data = await safeResponseJson(response, '删除文件');
      return data;
    }

    throw new Error(`删除文件失败: ${response.status} ${response.statusText}`);
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  } catch (error) {
    return false
  }
}

export async function getFileCommits({ path, repo }: { path: string, repo: string }) {
  if (!path) return;
  const store = await Store.load('store.json');
  const accessToken = await store.get('accessToken')
  if (!accessToken) return;

  const githubUsername = await store.get('githubUsername')

  // 只对空格进行转义，保留中文字符的原始 UTF-8 编码
  const safePath = path.replace(/\s/g, '_')

  // 获取代理设置
  const proxy = await getProxyConfig()

  try {
    // 设置请求头
    const headers = new Headers();
    headers.append('Authorization', `Bearer ${accessToken}`);
    headers.append('Accept', 'application/vnd.github+json');
    headers.append('X-GitHub-Api-Version', '2022-11-28');
    headers.append('If-None-Match', '');

    const requestOptions = {
      method: 'GET',
      headers,
      proxy
    };
    
    const url = `https://api.github.com/repos/${githubUsername}/${repo}/commits?path=${encodeURIComponent(safePath)}&per_page=100`;
    const response = await fetch(url, requestOptions);

    if (response.status >= 200 && response.status < 300) {
      const data = await safeResponseJson(response, '查询文件提交历史');
      return data;
    }

    if (response.status === 404) {
      return [];
    }
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  } catch (error) {
    return false
  }
}

// 获取 Github 用户信息
export async function getUserInfo(token?: string) {
  const store = await Store.load('store.json');
  const accessToken = token || await store.get('accessToken')
  if (!accessToken) return;
  
  // 获取代理设置
  const proxy = await getProxyConfig()
  
  // 设置请求头
  const headers = new Headers();
  headers.append('Authorization', `Bearer ${accessToken}`);
  headers.append('Accept', 'application/vnd.github+json');
  headers.append('X-GitHub-Api-Version', '2022-11-28');

  const requestOptions = {
    method: 'GET',
    headers,
    proxy,
    connectTimeout: 8000,
  };

  const url = 'https://api.github.com/user';
  const response = await fetch(url, requestOptions);

  if (response.status >= 200 && response.status < 300) {
    const data = await safeResponseJson<{ login: string }>(response, '获取 GitHub 用户信息');
    await store.set('githubUsername', data.login);
    await store.save();
    return { data } as OctokitResponse<any>;
  }

  await throwGitHubResponseError(response, '获取 GitHub 用户信息失败');
}

// 检查 Github 仓库
export async function checkSyncRepoState(name: string): Promise<GithubRepoInfo | false | undefined> {
  const store = await Store.load('store.json');
  const githubUsername = await store.get<string>('githubUsername')
  const accessToken = await store.get<string>('accessToken')
  if (!accessToken) return;
  if (!githubUsername) {
    throw new Error('GitHub 用户名未获取到，请先检查 GitHub Token 是否有效')
  }
  
  // 获取代理设置
  const proxy = await getProxyConfig()
  
  // 设置请求头
  const headers = new Headers();
  headers.append('Authorization', `Bearer ${accessToken}`);
  headers.append('Accept', 'application/vnd.github+json');
  headers.append('X-GitHub-Api-Version', '2022-11-28');
  
  const requestOptions = {
    method: 'GET',
    headers,
    proxy,
    connectTimeout: 8000,
  };
  
  const url = `https://api.github.com/repos/${githubUsername}/${name}`;
  const response = await fetch(url, requestOptions);
  
  if (response.status >= 200 && response.status < 300) {
    return await safeResponseJson<GithubRepoInfo>(response, `检查 GitHub 仓库 ${githubUsername}/${name}`);
  }

  if (response.status === 404) {
    return false
  }
  
  await throwGitHubResponseError(response, `检查 GitHub 仓库 ${githubUsername}/${name} 失败`);
}

// 创建 Github 仓库
export async function createSyncRepo(name: string, isPrivate?: boolean) {
  const store = await Store.load('store.json');
  const accessToken = await store.get('accessToken')
  if (!accessToken) {
    throw new Error('请先在同步设置中配置 GitHub Token')
  }
  
  // 获取代理设置
  const proxy = await getProxyConfig()
  
  // 设置请求头
  const headers = new Headers();
  headers.append('Authorization', `Bearer ${accessToken}`);
  headers.append('Accept', 'application/vnd.github+json');
  headers.append('X-GitHub-Api-Version', '2022-11-28');
  headers.append('Content-Type', 'application/json');

  const requestOptions = {
    method: 'POST',
    headers,
    body: JSON.stringify({
      name,
      description: 'This is a LingMo sync repository.',
      private: isPrivate
    }),
    proxy,
    connectTimeout: 8000,
  };

  const url = 'https://api.github.com/user/repos';
  const response = await fetch(url, requestOptions);

  if (response.status >= 200 && response.status < 300) {
    const data = await safeResponseJson<GithubRepoInfo>(response, `创建 GitHub 仓库 ${name}`);
    return data;
  }

  await throwGitHubResponseError(response, `创建 GitHub 仓库 ${name} 失败`);
}

// 读取 release
export async function getRelease() {
  const store = await Store.load('store.json');
  const accessToken = await store.get('accessToken')
  if (!accessToken) return;
  
  // 获取代理设置
  const proxy = await getProxyConfig()
  
  try {
    // 设置请求头
    const headers = new Headers();
    headers.append('Authorization', `Bearer ${accessToken}`);
    headers.append('Accept', 'application/vnd.github+json');
    headers.append('X-GitHub-Api-Version', '2022-11-28');
    headers.append('If-None-Match', '');
    
    const requestOptions = {
      method: 'GET',
      headers,
      proxy
    };
    
    const url = `https://api.github.com/repos/Ye-hey1/LingMo/releases/latest`;
    const response = await fetch(url, requestOptions);
    
    if (response.status >= 200 && response.status < 300) {
      const data = await safeResponseJson(response, '获取 release');
      return data;
    }
    
    throw new Error('获取 release 失败');
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  } catch (error) {
    return false
  }
}
