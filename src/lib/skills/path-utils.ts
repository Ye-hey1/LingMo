/**
 * Skills 路径解析工具模块
 *
 * 提供统一的路径解析函数，用于处理 global 和 project scope 的 skill 目录路径。
 */

import { appDataDir } from '@tauri-apps/api/path'
import { getFilePathOptions } from '@/lib/workspace'
import type { SkillScope } from './types'

/**
 * 解析 skill 目录的完整路径
 *
 * @param skillDir - skill 目录相对路径（如 "skills/pdf"）
 * @param scope - skill 作用域（global 或 project）
 * @returns 完整的文件系统路径
 */
export async function resolveSkillDirectory(
  skillDir: string,
  scope: SkillScope
): Promise<string> {
  if (scope === 'global') {
    // For global skills, fileInfo.directory is a relative path under AppData
    const appDataPath = await appDataDir()
    return `${appDataPath}/${skillDir}`
  }

  // For project skills
  const options = await getFilePathOptions(skillDir)

  if (options.baseDir) {
    // 默认 workspace: options.path 是 "article/skills/xxx"
    // 需要使用 appDataDir 作为基础路径
    const appDataPath = await appDataDir()
    // 注意：这里已经包含了 article 前缀，不需要再拼接
    return `${appDataPath}/${options.path}`
  } else {
    // 自定义 workspace: options.path 已经是完整路径
    return options.path
  }
}

/**
 * 解析脚本的相对路径
 *
 * 处理两种情况：
 * 1. 绝对路径格式: "skills/pdf/scripts/example.py"
 * 2. 相对路径格式: "scripts/example.py" 或 "office/unpack.py"
 *
 * @param scriptPath - 脚本路径
 * @param skillBaseName - skill 目录名（如 "pdf"）
 * @returns 相对于 skill 目录的脚本路径
 */
export function resolveScriptRelativePath(
  scriptPath: string,
  skillBaseName: string
): string {
  // 尝试多种模式来提取相对路径
  const patterns = [
    // 匹配 "skills/{skillName}/" 开头的部分
    new RegExp(`^skills/${skillBaseName}/`),
    // 匹配 "skills/{skillName}" 开头的部分（不带末尾斜杠）
    new RegExp(`^skills/${skillBaseName}$`),
    // 匹配任意 "skills/xxx/" 开头的部分（更通用的模式）
    new RegExp(`^skills/[^/]+/`),
  ]

  for (const pattern of patterns) {
    const relativePath = scriptPath.replace(pattern, '')
    if (relativePath !== scriptPath) {
      return relativePath
    }
  }

  // 如果没有匹配任何模式，假设已经是相对路径
  return scriptPath
}

/**
 * 转义 shell 命令参数
 * 处理空格、引号等特殊字符
 *
 * @param arg - 原始参数
 * @returns 转义后的参数
 */
export function escapeShellArg(arg: string): string {
  // 简单安全字符直接返回
  if (/^[a-zA-Z0-9_./:-]+$/.test(arg)) {
    return arg
  }

  // 统一使用单引号包裹，并安全转义内部单引号
  return `'${arg.replace(/'/g, `'\"'\"'`)}'`
}

/**
 * 转义用于 shell 的路径。
 *
 * 与 escapeShellArg 同源，但语义上专用于目录/文件路径。此前这些位置直接用
 * 双引号包裹，导致路径中的 `$(...)`、反引号、`${}` 仍会被 shell 展开；而 Skills
 * 可从远程仓库安装，路径可被攻击者影响，属于供应链面。
 *
 * @param path - 原始路径
 * @returns 可安全嵌入 shell 命令的路径
 */
export function escapeShellPath(path: string): string {
  return escapeShellArg(path)
}

/**
 * 转义 `KEY=value` 形式的环境变量赋值。
 *
 * 只转义 value 部分；key 必须是合法标识符，否则抛错而非静默拼接。
 *
 * @param key - 环境变量名
 * @param value - 环境变量值
 * @returns 形如 `KEY='value'` 的可安全嵌入片段
 */
export function escapeShellEnvAssignment(key: string, value: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
    throw new Error(`非法环境变量名: ${key}`)
  }
  return `${key}=${escapeShellArg(value)}`
}

/**
 * 构建 shell 命令
 * 包含工作目录切换和参数转义
 *
 * @param workingDirectory - 工作目录（skill 目录）
 * @param moduleDir - 模块目录（用于查找 node_modules）
 * @param command - 命令
 * @param args - 参数数组
 * @returns 完整的 shell 命令字符串
 */
export function buildShellCommand(
  workingDirectory: string,
  moduleDir: string,
  command: string,
  args: string[]
): string {
  const escapedArgs = args.map(escapeShellArg)

  // 检查是否所有参数都是绝对路径
  // 如果是绝对路径，需要 cd 到脚本所在目录，但用 NODE_PATH 指向模块目录
  // 注意 args 为空时 every 恒真，必须显式排除，否则下面读 args[0] 会抛异常
  const allAbsolutePaths = args.length > 0 && args.every(arg => arg.startsWith('/'))

  if (allAbsolutePaths) {
    // 获取第一个绝对路径的目录作为工作目录
    // 例如：/path/to/article/generate.js -> /path/to/article
    const scriptDir = args[0].substring(0, args[0].lastIndexOf('/'))
    // 使用脚本所在目录作为工作目录，但用 NODE_PATH 指向 skill 的 node_modules
    return `cd ${escapeShellPath(scriptDir)} && ${escapeShellEnvAssignment('NODE_PATH', `${moduleDir}/node_modules`)} ${escapeShellArg(command)} ${escapedArgs.join(' ')}`
  }

  return `cd ${escapeShellPath(workingDirectory)} && ${escapeShellArg(command)} ${escapedArgs.join(' ')}`
}
