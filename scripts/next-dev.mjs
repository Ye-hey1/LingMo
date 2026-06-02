import { execFile, spawn } from 'node:child_process'
import fs from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const workspace = path.resolve(__dirname, '..')
const nextDir = path.join(workspace, '.next')
const require = createRequire(import.meta.url)
const devPort = process.env.NEXT_DEV_PORT || '3456'
const devHost = process.env.NEXT_DEV_HOST || '0.0.0.0'

function execFileText(command, args) {
  return new Promise((resolve) => {
    execFile(command, args, { windowsHide: true }, (error, stdout) => {
      resolve(error ? '' : stdout.trim())
    })
  })
}

async function listPortOwners(port) {
  const powershellOwners = await execFileText('powershell.exe', [
    '-NoProfile',
    '-Command',
    `Get-NetTCPConnection -LocalPort ${port} -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess`,
  ])

  const owners = powershellOwners
    .split(/\s+/)
    .map((value) => Number(value))
    .filter(Boolean)

  if (owners.length > 0) {
    return [...new Set(owners)]
  }

  const netstatOutput = await execFileText('netstat.exe', ['-ano', '-p', 'TCP'])
  const netstatOwners = netstatOutput
    .split(/\r?\n/)
    .filter((line) => line.includes('LISTENING'))
    .filter((line) => line.split(/\s+/).some((part) => part.endsWith(`:${port}`)))
    .map((line) => Number(line.trim().split(/\s+/).at(-1)))
    .filter(Boolean)

  return [...new Set(netstatOwners)]
}

async function getCommandLine(pid) {
  return execFileText('powershell.exe', [
    '-NoProfile',
    '-Command',
    `(Get-CimInstance Win32_Process -Filter "ProcessId = ${pid}").CommandLine`,
  ])
}

function normalizeForCompare(value) {
  return value.replace(/\\/g, '/').toLowerCase()
}

function isCurrentWorkspaceNextProcess(commandLine) {
  if (!commandLine) {
    return false
  }

  const normalizedCommandLine = normalizeForCompare(commandLine)
  const normalizedWorkspace = normalizeForCompare(workspace)

  return (
    normalizedCommandLine.includes(normalizedWorkspace) &&
    /next-dev\.mjs|next[\\/]+dist[\\/]+bin[\\/]+next|next dev|start-server/i.test(commandLine)
  )
}

function taskkill(pid) {
  return new Promise((resolve) => {
    execFile('taskkill.exe', ['/PID', String(pid), '/F'], { windowsHide: true }, () => resolve())
  })
}

async function stopStaleCurrentWorkspaceNext(port) {
  const owners = await listPortOwners(port)
  if (owners.length === 0) {
    return
  }

  const unknownOwners = []

  for (const pid of owners) {
    if (pid === process.pid) {
      continue
    }

    const commandLine = await getCommandLine(pid)
    if (isCurrentWorkspaceNextProcess(commandLine)) {
      console.warn(`[next-dev] Stopping stale LingMo Next process on port ${port}: PID ${pid}`)
      await taskkill(pid)
    } else {
      unknownOwners.push({ pid, commandLine })
    }
  }

  const remainingOwners = await listPortOwners(port)
  const blockingOwners = remainingOwners.filter((pid) => pid !== process.pid)
  if (blockingOwners.length > 0) {
    const details = blockingOwners
      .map((pid) => {
        const known = unknownOwners.find((owner) => owner.pid === pid)
        return known?.commandLine ? `PID ${pid}: ${known.commandLine}` : `PID ${pid}`
      })
      .join('\n')

    throw new Error(
      `[next-dev] Port ${port} is already in use.\n${details}\n` +
      `[next-dev] Stop that process, or set NEXT_DEV_PORT to another port and update Tauri devUrl to match.`
    )
  }
}

function existsInNext(relativePath) {
  return fs.existsSync(path.join(nextDir, relativePath))
}

function hasProductionAppRuntime() {
  const appPage = path.join(nextDir, 'server', 'app', 'page.js')
  if (!fs.existsSync(appPage)) {
    return false
  }

  const source = fs.readFileSync(appPage, 'utf8')
  return source.includes('app-page.runtime.prod')
}

function getStaleBuildMarkers() {
  if (!fs.existsSync(nextDir)) {
    return []
  }

  const markers = [
    'required-server-files.json',
    'export-marker.json',
    'export-detail.json',
    'next-server.js.nft.json',
    'next-minimal-server.js.nft.json',
    'cache/webpack/client-production',
    'cache/webpack/server-production',
  ].filter(existsInNext)

  if (hasProductionAppRuntime()) {
    markers.push('server/app/page.js:prod-runtime')
  }

  if (
    fs.existsSync(path.join(nextDir, 'server', 'app')) &&
    !existsInNext('routes-manifest.json')
  ) {
    markers.push('routes-manifest.json:missing')
  }

  return markers
}

function removeNextDir(markers) {
  const resolvedWorkspace = path.resolve(workspace)
  const resolvedNextDir = path.resolve(nextDir)
  const isSafeNextDir =
    path.basename(resolvedNextDir) === '.next' &&
    resolvedNextDir.startsWith(`${resolvedWorkspace}${path.sep}`)

  if (!isSafeNextDir) {
    throw new Error(`Refusing to remove unexpected path: ${resolvedNextDir}`)
  }

  console.warn(`[next-dev] Removing stale .next before dev startup: ${markers.join(', ')}`)
  fs.rmSync(resolvedNextDir, { recursive: true, force: true })
}

await stopStaleCurrentWorkspaceNext(devPort)

const markers = getStaleBuildMarkers()
if (markers.length > 0) {
  removeNextDir(markers)
}

const nextBin = require.resolve('next/dist/bin/next')
const nextArgs = [
  'dev',
  '-p',
  devPort,
  '-H',
  devHost,
  ...process.argv.slice(2),
]

const child = spawn(process.execPath, [nextBin, ...nextArgs], {
  cwd: workspace,
  env: process.env,
  stdio: 'inherit',
  windowsHide: true,
})

child.on('error', (error) => {
  console.error(error)
  process.exit(1)
})

child.on('exit', (code, signal) => {
  if (signal) {
    process.exit(1)
  }
  process.exit(code ?? 0)
})

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    child.kill(signal)
  })
}
