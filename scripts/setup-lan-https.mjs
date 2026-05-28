import { existsSync, mkdirSync } from 'node:fs'
import { networkInterfaces } from 'node:os'
import { resolve } from 'node:path'
import { spawnSync } from 'node:child_process'

const workspaceRoot = resolve(import.meta.dirname, '..')
const certDir = resolve(workspaceRoot, '.cert')
const keyPath = resolve(certDir, 'dev-key.pem')
const certPath = resolve(certDir, 'dev-cert.pem')

mkdirSync(certDir, { recursive: true })

if (!commandExists('mkcert')) {
  console.error('mkcert is not installed. Install it with: brew install mkcert')
  process.exit(1)
}

const subjectAltNames = [
  'localhost',
  '127.0.0.1',
  '::1',
  ...getLanHostnames(),
  ...getLanIps(),
]

run('mkcert', ['-install'])
run('mkcert', ['-key-file', keyPath, '-cert-file', certPath, ...subjectAltNames])

console.log(`Generated LAN HTTPS certificate:`)
console.log(`- ${certPath}`)
console.log(`- ${keyPath}`)
console.log('Clients on the same LAN must trust the mkcert root CA before camera access will work over HTTPS.')

function commandExists(command) {
  const result = spawnSync('which', [command], { stdio: 'ignore' })
  return result.status === 0
}

function getLanIps() {
  const nets = networkInterfaces()
  const ips = new Set()

  for (const entries of Object.values(nets)) {
    for (const entry of entries ?? []) {
      if (entry.family === 'IPv4' && !entry.internal) {
        ips.add(entry.address)
      }
    }
  }

  return [...ips]
}

function getLanHostnames() {
  const result = new Set([process.env.HOSTNAME].filter(Boolean))
  const scutilHostname = spawnSync('scutil', ['--get', 'LocalHostName'], { encoding: 'utf8' })

  if (scutilHostname.status === 0) {
    const localHostName = scutilHostname.stdout.trim()

    if (localHostName) {
      result.add(localHostName)
      result.add(`${localHostName}.local`)
    }
  }

  return [...result]
}

function run(command, args) {
  const result = spawnSync(command, args, { stdio: 'inherit' })

  if (result.status !== 0) {
    process.exit(result.status ?? 1)
  }
}