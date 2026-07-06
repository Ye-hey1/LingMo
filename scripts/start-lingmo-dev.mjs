import { spawn, execFile } from 'node:child_process'
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const workspace = path.resolve(__dirname, '..')
const logDir = path.join(workspace, '.codex-temp')
const devPort = process.env.NEXT_DEV_PORT || '3457'
const devUrl = process.env.NEXT_DEV_URL || `http://127.0.0.1:${devPort}`
const debugExe = path.join(workspace, 'src-tauri', 'target', 'debug', 'lingmo.exe')
const tauriCwd = path.join(workspace, 'src-tauri')
const reuseConfig = path.join(workspace, 'src-tauri', 'tauri.reuse-dev.conf.json')
const args = new Set(process.argv.slice(2))
const rebuildTauri = args.has('--rebuild-tauri')
const noLaunch = args.has('--no-launch')
const isWindows = process.platform === 'win32'

fs.mkdirSync(logDir, { recursive: true })

process.env.Path = [
  path.join(process.env.APPDATA || '', 'npm'),
  path.join(process.env.USERPROFILE || '', '.cargo', 'bin'),
  process.env.Path || '',
].filter(Boolean).join(';')

function request(url, timeoutMs = 5000) {
  return new Promise((resolve) => {
    const req = http.get(url, (res) => {
      res.resume()
      resolve(res.statusCode >= 200 && res.statusCode < 500)
    })
    req.on('error', () => resolve(false))
    req.setTimeout(timeoutMs, () => {
      req.destroy()
      resolve(false)
    })
  })
}

function requestOk(url, timeoutMs = 5000) {
  return new Promise((resolve) => {
    const req = http.get(url, (res) => {
      res.resume()
      resolve(res.statusCode >= 200 && res.statusCode < 400)
    })
    req.on('error', () => resolve(false))
    req.setTimeout(timeoutMs, () => {
      req.destroy()
      resolve(false)
    })
  })
}

async function waitForServer(timeoutMs = 120000) {
  const startedAt = Date.now()
  while (Date.now() - startedAt < timeoutMs) {
    if (await request(devUrl)) return true
    await new Promise((resolve) => setTimeout(resolve, 1000))
  }
  return false
}

async function warmDevServer() {
  const warmups = [
    '/',
    '/_next/static/chunks/app/layout.js',
  ]

  for (const route of warmups) {
    const url = `${devUrl}${route}`
    const ok = await requestOk(url, 300000)
    if (!ok) {
      throw new Error(`LingMo dev server warmup failed: ${url}`)
    }
  }
}

function spawnDetached(command, commandArgs, options = {}) {
  const child = spawn(command, commandArgs, {
    cwd: workspace,
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
    shell: options.shell ?? false,
    ...options,
  })
  child.unref()
  return child
}

function spawnWithLogs(command, commandArgs, outLog, errLog, options = {}) {
  const out = fs.openSync(outLog, 'a')
  const err = fs.openSync(errLog, 'a')
  const child = spawn(command, commandArgs, {
    cwd: workspace,
    detached: true,
    stdio: ['ignore', out, err],
    windowsHide: true,
    shell: options.shell ?? false,
    ...options,
  })
  child.unref()
  return child
}

function getPnpmCommand() {
  return process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'
}

function openDebugExe() {
  spawnDetached(debugExe, [], { cwd: tauriCwd })
}

function runTauriDev() {
  const outLog = path.join(logDir, 'lingmo-tauri-dev.out.log')
  const errLog = path.join(logDir, 'lingmo-tauri-dev.err.log')
  fs.rmSync(outLog, { force: true })
  fs.rmSync(errLog, { force: true })
  spawnWithLogs(getPnpmCommand(), ['tauri', 'dev', '--config', reuseConfig], outLog, errLog, {
    shell: isWindows,
  })
  console.log(`LingMo Tauri dev is starting. Logs:\n${outLog}\n${errLog}`)
}

function startNextDev() {
  const outLog = path.join(logDir, 'lingmo-next-dev.out.log')
  const errLog = path.join(logDir, 'lingmo-next-dev.err.log')
  fs.rmSync(outLog, { force: true })
  fs.rmSync(errLog, { force: true })
  spawnWithLogs(getPnpmCommand(), ['dev'], outLog, errLog, {
    shell: isWindows,
  })
  return { outLog, errLog }
}

function taskkill(pid) {
  return new Promise((resolve) => {
    execFile('taskkill.exe', ['/PID', String(pid), '/F'], () => resolve())
  })
}

function listPortOwners() {
  return new Promise((resolve) => {
    execFile('powershell.exe', [
      '-NoProfile',
      '-Command',
      `Get-NetTCPConnection -LocalPort ${devPort} -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess`,
    ], { windowsHide: true }, (error, stdout) => {
      if (error) {
        resolve([])
        return
      }
      resolve(stdout.split(/\s+/).map((value) => Number(value)).filter(Boolean))
    })
  })
}

function getCommandLine(pid) {
  return new Promise((resolve) => {
    execFile('powershell.exe', [
      '-NoProfile',
      '-Command',
      `(Get-CimInstance Win32_Process -Filter "ProcessId = ${pid}").CommandLine`,
    ], { windowsHide: true }, (error, stdout) => {
      resolve(error ? '' : stdout.trim())
    })
  })
}

async function stopStaleLingMoNext() {
  const owners = await listPortOwners()
  for (const pid of owners) {
    const commandLine = await getCommandLine(pid)
    if (commandLine.includes(workspace) && /next|start-server|node/i.test(commandLine)) {
      await taskkill(pid)
    }
  }
}

async function main() {
  let ready = await request(devUrl)
  if (!ready) {
    await stopStaleLingMoNext()
    const { outLog, errLog } = startNextDev()
    ready = await waitForServer()
    if (!ready) {
      console.error(`LingMo dev server failed to start. Logs:\n${outLog}\n${errLog}`)
      process.exit(1)
    }
  }

  try {
    await warmDevServer()
  } catch (error) {
    console.error(error instanceof Error ? error.message : error)
    process.exit(1)
  }

  if (noLaunch) {
    console.log(`LingMo dev server is ready: ${devUrl}`)
    return
  }

  if (rebuildTauri || !fs.existsSync(debugExe)) {
    runTauriDev()
    return
  }

  openDebugExe()
  console.log(`LingMo opened with dev server: ${devUrl}`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
