import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const sourcePath = join(repoRoot, 'src/components/app-status.tsx')
const source = await readFile(sourcePath, 'utf8')
const effects = []
const syncStates = []
const errorCalls = []
const warningCalls = []

const settingState = {
  accessToken: 'configured-token',
  giteeAccessToken: '',
  gitlabAccessToken: '',
  giteaAccessToken: '',
  primaryBackupMethod: 'github',
  setGithubUsername() {},
  setGitlabUsername() {},
  setGiteaUsername() {},
}

const syncState = {
  setUserInfo() {},
  setGiteeUserInfo() {},
  setGitlabUserInfo() {},
  setGiteaUserInfo() {},
  setSyncRepoState(state) {
    syncStates.push(state)
  },
  setSyncRepoInfo() {},
  setGiteeSyncRepoState() {},
  setGiteeSyncRepoInfo() {},
  setGitlabSyncProjectState() {},
  setGitlabSyncProjectInfo() {},
  setGiteaSyncRepoState() {},
  setGiteaSyncRepoInfo() {},
}

const moduleMocks = {
  '@/lib/sync/github': {
    async getUserInfo() {
      return { data: { login: 'Ye-hey1' } }
    },
    async checkSyncRepoState() {
      throw new Error('error sending request for url')
    },
  },
  react: {
    useEffect(effect) {
      effects.push(effect)
    },
  },
  '@/stores/setting': {
    __esModule: true,
    default: () => settingState,
  },
  '@/lib/sync/github.types': {
    SyncStateEnum: {
      checking: 'checking',
      success: 'success',
      fail: 'fail',
    },
  },
  '@/stores/sync': {
    __esModule: true,
    default: () => syncState,
  },
  '@/lib/sync/repo-utils': {
    async getSyncRepoName() {
      return 'LingMo-sync'
    },
  },
}

const output = ts.transpileModule(source, {
  compilerOptions: {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.CommonJS,
    esModuleInterop: true,
    jsx: ts.JsxEmit.ReactJSX,
    strict: true,
  },
  fileName: sourcePath,
}).outputText

const module = { exports: {} }
new Function('require', 'module', 'exports', output)((specifier) => {
  if (specifier in moduleMocks) return moduleMocks[specifier]
  throw new Error(`Unexpected dependency in app-status.tsx: ${specifier}`)
}, module, module.exports)

const originalError = console.error
const originalWarn = console.warn
console.error = (...args) => errorCalls.push(args)
console.warn = (...args) => warningCalls.push(args)

try {
  module.exports.default()
  assert.equal(effects.length, 1, 'AppStatus should register one background status effect')
  effects[0]()

  const deadline = Date.now() + 500
  while (!syncStates.includes('fail') && Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, 5))
  }
} finally {
  console.error = originalError
  console.warn = originalWarn
}

assert.deepEqual(syncStates, ['checking', 'fail'])
assert.equal(errorCalls.length, 0, 'recoverable background sync failures must not call console.error')
assert.equal(warningCalls.length, 1, 'background sync failures should remain diagnosable as warnings')
assert.match(String(warningCalls[0][0]), /Failed to check GitHub repos/)
assert.doesNotMatch(source, /console\.error/, 'AppStatus is a background checker and must not trigger the Next.js error overlay')

console.log('app status background check tests passed')
