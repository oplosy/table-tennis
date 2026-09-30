import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createApp } from './app'

const here = dirname(fileURLToPath(import.meta.url))
const port = Number(process.env.PORT ?? 8080)
const staticDir = process.env.STATIC_DIR ?? resolve(here, '../../web/dist')

const app = createApp({ staticDir })
app.server.listen(port, () => {
  console.log(`rally server listening on http://localhost:${port}`)
})

const shutdown = () => { void app.close().then(() => process.exit(0)) }
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
