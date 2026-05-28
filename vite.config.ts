import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { defineConfig } from 'vite'

const devKeyPath = resolve(__dirname, '.cert/dev-key.pem')
const devCertPath = resolve(__dirname, '.cert/dev-cert.pem')

function getLanHttpsConfig() {
  if (process.env.VITE_LAN_HTTPS !== '1') {
    return undefined
  }

  if (!existsSync(devKeyPath) || !existsSync(devCertPath)) {
    throw new Error('Missing LAN HTTPS certificate files. Run "npm run cert:lan" first.')
  }

  return {
    key: readFileSync(devKeyPath),
    cert: readFileSync(devCertPath),
  }
}

const lanHttps = getLanHttpsConfig()

export default defineConfig({
  server: lanHttps
    ? {
        host: '0.0.0.0',
        port: 4173,
        https: lanHttps,
      }
    : undefined,
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        demo: resolve(__dirname, 'demo.html'),
      },
    },
  },
})