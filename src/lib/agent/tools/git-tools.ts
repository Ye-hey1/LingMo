import type { Tool, ToolResult } from '../types'
import { appDataDir, join } from '@tauri-apps/api/path'
import { Command } from '@tauri-apps/plugin-shell'
import { getWorkspacePath, normalizeWorkspaceRelativePath } from '@/lib/workspace'

const DEFAULT_MAX_CHARS = 20000
const MAX_OUTPUT_CHARS = 80000
const GIT_TIMEOUT_SECONDS = 12

const PYTHON_GIT_RUNNER = String.raw`
import json
import os
import subprocess
import sys

cwd = sys.argv[1]
args = json.loads(sys.argv[2])
timeout = float(sys.argv[3])

try:
    if not os.path.isdir(cwd):
        print(json.dumps({"runner_error": "Repository path does not exist", "cwd": cwd}, ensure_ascii=False))
        sys.exit(0)
    completed = subprocess.run(
        ["git", *args],
        cwd=cwd,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        timeout=timeout,
        encoding="utf-8",
        errors="replace",
        shell=False,
    )
    print(json.dumps({
        "code": completed.returncode,
        "stdout": completed.stdout,
        "stderr": completed.stderr,
        "cwd": cwd,
    }, ensure_ascii=False))
except subprocess.TimeoutExpired:
    print(json.dumps({"runner_error": "Git command timed out", "cwd": cwd}, ensure_ascii=False))
except FileNotFoundError:
    print(json.dumps({"runner_error": "git executable was not found", "cwd": cwd}, ensure_ascii=False))
except Exception as exc:
    print(json.dumps({"runner_error": str(exc), "cwd": cwd}, ensure_ascii=False))
`

interface GitCommandResult {
  code: number
  stdout: string
  stderr: string
  cwd: string
}

function clampNumber(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(parsed)) {
    return fallback
  }

  return Math.min(max, Math.max(min, Math.floor(parsed)))
}

function assertNotAborted(signal?: AbortSignal) {
  signal?.throwIfAborted()
}

function truncateText(value: string, maxChars: number) {
  if (value.length <= maxChars) {
    return {
      text: value,
      truncated: false,
      totalChars: value.length,
    }
  }

  return {
    text: `${value.slice(0, maxChars)}\n\n[truncated ${value.length - maxChars} chars]`,
    truncated: true,
    totalChars: value.length,
  }
}

function normalizeNewlines(value: string): string {
  return value.replace(/\r\n/g, '\n')
}

function validateRevision(value: unknown): string {
  const revision = typeof value === 'string' && value.trim() ? value.trim() : 'HEAD'
  if (revision.startsWith('-')) {
    throw new Error('revision cannot start with "-"')
  }
  if (!/^[A-Za-z0-9._/@~^:+-]{1,120}$/.test(revision)) {
    throw new Error('revision contains unsupported characters')
  }
  return revision
}

async function normalizeOptionalRepoPath(value: unknown): Promise<string | undefined> {
  if (typeof value !== 'string' || !value.trim()) {
    return undefined
  }

  const normalized = await normalizeWorkspaceRelativePath(value)
  if (!normalized) {
    return undefined
  }
  if (normalized.startsWith('/') || /^[a-zA-Z]:\//.test(normalized)) {
    throw new Error('path must be workspace-relative')
  }
  if (normalized.split('/').some(segment => segment === '..')) {
    throw new Error('path cannot contain ..')
  }
  return normalized
}

async function getGitWorkingDirectory(): Promise<string> {
  const workspace = await getWorkspacePath()
  if (workspace.isCustom) {
    return workspace.path
  }

  return await join(await appDataDir(), 'article')
}

async function executePythonGit(args: string[], signal?: AbortSignal): Promise<GitCommandResult> {
  assertNotAborted(signal)
  const cwd = await getGitWorkingDirectory()
  let lastError: unknown

  for (const commandName of ['python', 'python3']) {
    try {
      const result = await Command.create(commandName, [
        '-c',
        PYTHON_GIT_RUNNER,
        cwd,
        JSON.stringify(args),
        String(GIT_TIMEOUT_SECONDS),
      ], {
        encoding: 'utf-8',
        env: {
          PYTHONIOENCODING: 'utf-8',
          PYTHONUTF8: '1',
        },
      }).execute()
      assertNotAborted(signal)

      const stdout = normalizeNewlines(String(result.stdout || '')).trim()
      const stderr = normalizeNewlines(String(result.stderr || '')).trim()
      const parsed = stdout ? JSON.parse(stdout) : null
      if (!parsed || typeof parsed !== 'object') {
        throw new Error(stderr || 'Git runner returned no structured output')
      }
      if (parsed.runner_error) {
        throw new Error(String(parsed.runner_error))
      }

      return {
        code: Number(parsed.code || 0),
        stdout: normalizeNewlines(String(parsed.stdout || '')),
        stderr: normalizeNewlines(String(parsed.stderr || '')),
        cwd: String(parsed.cwd || cwd),
      }
    } catch (error) {
      lastError = error
    }
  }

  throw new Error(lastError instanceof Error ? lastError.message : String(lastError))
}

async function runGitTool(args: string[], maxChars: number, signal?: AbortSignal): Promise<ToolResult> {
  const result = await executePythonGit(args, signal)
  const output = result.stdout || result.stderr
  const truncated = truncateText(output, maxChars)
  const success = result.code === 0

  return {
    success,
    status: success ? 'success' : 'blocked',
    data: {
      args,
      repositoryPath: result.cwd,
      exitCode: result.code,
      stdout: truncateText(result.stdout, maxChars).text,
      stderr: truncateText(result.stderr, Math.min(maxChars, 12000)).text,
      output: truncated.text,
      truncated: truncated.truncated,
      totalChars: truncated.totalChars,
    },
    message: success
      ? (truncated.text || 'Git command completed with no output.')
      : `Git command failed with exit code ${result.code}.\n${truncated.text}`,
    error: success ? undefined : (result.stderr || result.stdout || `git exited with code ${result.code}`),
  }
}

function appendPath(args: string[], path?: string): string[] {
  return path ? [...args, '--', path] : args
}

export const gitTools: Tool[] = [
  {
    name: 'git_status',
    description: 'Read Git working tree status for the current workspace repository.',
    category: 'system',
    requiresConfirmation: false,
    risk: 'low',
    capabilities: ['read'],
    parameters: [
      {
        name: 'maxChars',
        type: 'number',
        description: 'Maximum output characters. Default 20000, max 80000.',
        required: false,
        default: DEFAULT_MAX_CHARS,
      },
    ],
    execute: async (params, context): Promise<ToolResult> => {
      try {
        assertNotAborted(context?.abortSignal)
        const maxChars = clampNumber(params.maxChars, DEFAULT_MAX_CHARS, 1000, MAX_OUTPUT_CHARS)
        return await runGitTool(['status', '--short', '--branch', '--untracked-files=all'], maxChars, context?.abortSignal)
      } catch (error) {
        return {
          success: false,
          status: 'blocked',
          error: `Failed to read git status: ${error instanceof Error ? error.message : String(error)}`,
        }
      }
    },
  },
  {
    name: 'git_diff',
    description: 'Read Git diff for the current workspace repository. Supports unstaged or staged diff and an optional workspace-relative path.',
    category: 'system',
    requiresConfirmation: false,
    risk: 'low',
    capabilities: ['read'],
    parameters: [
      {
        name: 'path',
        type: 'string',
        description: 'Optional workspace-relative path to limit the diff.',
        required: false,
      },
      {
        name: 'cached',
        type: 'boolean',
        description: 'Whether to show staged changes. Default false.',
        required: false,
        default: false,
      },
      {
        name: 'contextLines',
        type: 'number',
        description: 'Number of unified diff context lines. Default 3, max 20.',
        required: false,
        default: 3,
      },
      {
        name: 'maxChars',
        type: 'number',
        description: 'Maximum output characters. Default 20000, max 80000.',
        required: false,
        default: DEFAULT_MAX_CHARS,
      },
    ],
    execute: async (params, context): Promise<ToolResult> => {
      try {
        assertNotAborted(context?.abortSignal)
        const path = await normalizeOptionalRepoPath(params.path)
        const contextLines = clampNumber(params.contextLines, 3, 0, 20)
        const maxChars = clampNumber(params.maxChars, DEFAULT_MAX_CHARS, 1000, MAX_OUTPUT_CHARS)
        const args = ['diff', '--no-ext-diff', '--no-color', `--unified=${contextLines}`]
        if (params.cached === true) args.push('--cached')
        return await runGitTool(appendPath(args, path), maxChars, context?.abortSignal)
      } catch (error) {
        return {
          success: false,
          status: 'blocked',
          error: `Failed to read git diff: ${error instanceof Error ? error.message : String(error)}`,
        }
      }
    },
  },
  {
    name: 'git_log',
    description: 'Read recent Git commit history for the current workspace repository.',
    category: 'system',
    requiresConfirmation: false,
    risk: 'low',
    capabilities: ['read'],
    parameters: [
      {
        name: 'limit',
        type: 'number',
        description: 'Maximum commits to return. Default 10, max 50.',
        required: false,
        default: 10,
      },
      {
        name: 'path',
        type: 'string',
        description: 'Optional workspace-relative path to limit history.',
        required: false,
      },
      {
        name: 'maxChars',
        type: 'number',
        description: 'Maximum output characters. Default 20000, max 80000.',
        required: false,
        default: DEFAULT_MAX_CHARS,
      },
    ],
    execute: async (params, context): Promise<ToolResult> => {
      try {
        assertNotAborted(context?.abortSignal)
        const limit = clampNumber(params.limit, 10, 1, 50)
        const path = await normalizeOptionalRepoPath(params.path)
        const maxChars = clampNumber(params.maxChars, DEFAULT_MAX_CHARS, 1000, MAX_OUTPUT_CHARS)
        return await runGitTool(appendPath([
          'log',
          '--date=short',
          `-n${limit}`,
          '--pretty=format:%h %ad %an %s',
        ], path), maxChars, context?.abortSignal)
      } catch (error) {
        return {
          success: false,
          status: 'blocked',
          error: `Failed to read git log: ${error instanceof Error ? error.message : String(error)}`,
        }
      }
    },
  },
  {
    name: 'git_show',
    description: 'Read one Git revision with stat and patch for the current workspace repository.',
    category: 'system',
    requiresConfirmation: false,
    risk: 'low',
    capabilities: ['read'],
    parameters: [
      {
        name: 'revision',
        type: 'string',
        description: 'Git revision to show. Default HEAD. Supports refs such as HEAD~1 or commit hashes.',
        required: false,
        default: 'HEAD',
      },
      {
        name: 'path',
        type: 'string',
        description: 'Optional workspace-relative path to limit the shown revision.',
        required: false,
      },
      {
        name: 'maxChars',
        type: 'number',
        description: 'Maximum output characters. Default 20000, max 80000.',
        required: false,
        default: DEFAULT_MAX_CHARS,
      },
    ],
    execute: async (params, context): Promise<ToolResult> => {
      try {
        assertNotAborted(context?.abortSignal)
        const revision = validateRevision(params.revision)
        const path = await normalizeOptionalRepoPath(params.path)
        const maxChars = clampNumber(params.maxChars, DEFAULT_MAX_CHARS, 1000, MAX_OUTPUT_CHARS)
        return await runGitTool(appendPath([
          'show',
          '--no-ext-diff',
          '--no-color',
          '--stat',
          '--patch',
          '--max-count=1',
          revision,
        ], path), maxChars, context?.abortSignal)
      } catch (error) {
        return {
          success: false,
          status: 'blocked',
          error: `Failed to read git show: ${error instanceof Error ? error.message : String(error)}`,
        }
      }
    },
  },
  {
    name: 'git_blame',
    description: 'Read Git blame for a workspace-relative file in the current workspace repository.',
    category: 'system',
    requiresConfirmation: false,
    risk: 'low',
    capabilities: ['read'],
    parameters: [
      {
        name: 'path',
        type: 'string',
        description: 'Workspace-relative file path to blame.',
        required: true,
      },
      {
        name: 'startLine',
        type: 'number',
        description: 'Optional starting line. Default 1.',
        required: false,
        default: 1,
      },
      {
        name: 'endLine',
        type: 'number',
        description: 'Optional ending line. Defaults to startLine + 199.',
        required: false,
      },
      {
        name: 'maxChars',
        type: 'number',
        description: 'Maximum output characters. Default 20000, max 80000.',
        required: false,
        default: DEFAULT_MAX_CHARS,
      },
    ],
    execute: async (params, context): Promise<ToolResult> => {
      try {
        assertNotAborted(context?.abortSignal)
        const path = await normalizeOptionalRepoPath(params.path)
        if (!path) {
          return {
            success: false,
            error: 'path is required',
          }
        }

        const startLine = clampNumber(params.startLine, 1, 1, 1000000)
        const endLine = clampNumber(params.endLine, startLine + 199, startLine, startLine + 499)
        const maxChars = clampNumber(params.maxChars, DEFAULT_MAX_CHARS, 1000, MAX_OUTPUT_CHARS)
        return await runGitTool([
          'blame',
          '--date=short',
          '-L',
          `${startLine},${endLine}`,
          '--',
          path,
        ], maxChars, context?.abortSignal)
      } catch (error) {
        return {
          success: false,
          status: 'blocked',
          error: `Failed to read git blame: ${error instanceof Error ? error.message : String(error)}`,
        }
      }
    },
  },
]
