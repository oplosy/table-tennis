import { createReadStream, existsSync, statSync } from 'node:fs'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { extname, join, normalize, resolve, sep } from 'node:path'
import { WebSocketServer, type WebSocket } from 'ws'
import { PROTOCOL_VERSION, type ClientMessage, type RoomTicket } from '@rally/core'
import { LOOP_INTERVAL_MS, RoomRegistry, cleanName, type Room, type Seat } from './room'

const MAX_BODY = 4 * 1024
const MAX_MESSAGE = 4 * 1024
const MAX_MESSAGES_PER_SECOND = 240

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon', '.json': 'application/json',
  '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8', '.webmanifest': 'application/manifest+json',
}

export interface AppOptions { staticDir?: string }

export interface App {
  server: Server
  rooms: RoomRegistry
  close(): Promise<void>
}

function json(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
  res.end(JSON.stringify(body))
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  let size = 0
  const chunks: Buffer[] = []
  for await (const chunk of req) {
    size += (chunk as Buffer).length
    if (size > MAX_BODY) throw new Error('body too large')
    chunks.push(chunk as Buffer)
  }
  if (chunks.length === 0) return {}
  const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'))
  return parsed && typeof parsed === 'object' ? parsed : {}
}

function serveStatic(root: string, req: IncomingMessage, res: ServerResponse) {
  const url = new URL(req.url ?? '/', 'http://localhost')
  const requested = normalize(decodeURIComponent(url.pathname)).replace(/^([/\\])+/, '')
  let file = resolve(root, requested)
  if (!file.startsWith(resolve(root) + sep) && file !== resolve(root)) { res.writeHead(403).end(); return }
  if (!existsSync(file) || statSync(file).isDirectory()) file = join(root, 'index.html')
  if (!existsSync(file)) { res.writeHead(404).end('Not found'); return }
  const immutable = file.includes(`${sep}assets${sep}`)
  res.writeHead(200, {
    'Content-Type': MIME[extname(file)] ?? 'application/octet-stream',
    'Cache-Control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
  })
  createReadStream(file).pipe(res)
}

export function createApp(options: AppOptions = {}): App {
  const rooms = new RoomRegistry()
  const staticDir = options.staticDir && existsSync(options.staticDir) ? options.staticDir : null

  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost')
    const path = url.pathname
    try {
      if (path === '/api/health') return json(res, 200, { status: 'ok', rooms: rooms.size })
      if (path === '/api/rooms' && req.method === 'POST') {
        const body = await readJson(req)
        const room = rooms.create({ bestOf: Number(body.bestOf), timeScale: Number(body.timeScale) })
        const seat = room.claimSeat(cleanName(body.name, 'Player 1'))!
        return json(res, 201, { code: room.code, token: seat.token, side: seat.side } satisfies RoomTicket)
      }
      const match = path.match(/^\/api\/rooms\/([A-Za-z0-9]{4,8})(\/join)?$/)
      if (match) {
        const room = rooms.get(match[1])
        if (!room) return json(res, 404, { error: 'Room not found' })
        if (!match[2] && req.method === 'GET') return json(res, 200, room.info())
        if (match[2] && req.method === 'POST') {
          const body = await readJson(req)
          const seat = room.claimSeat(cleanName(body.name, 'Player 2'))
          if (!seat) return json(res, 409, { error: 'Room is full' })
          return json(res, 200, { code: room.code, token: seat.token, side: seat.side } satisfies RoomTicket)
        }
      }
      if (path.startsWith('/api/')) return json(res, 404, { error: 'Not found' })
      if (staticDir && (req.method === 'GET' || req.method === 'HEAD')) return serveStatic(staticDir, req, res)
      res.writeHead(404).end('Not found')
    } catch {
      json(res, 400, { error: 'Bad request' })
    }
  })

  const wss = new WebSocketServer({ server, path: '/ws', maxPayload: MAX_MESSAGE })
  wss.on('connection', (socket: WebSocket) => {
    let room: Room | null = null
    let seat: Seat | null = null
    let windowStart = Date.now()
    let count = 0
    const helloTimer = setTimeout(() => socket.close(4001, 'hello expected'), 5000)

    socket.on('message', (data) => {
      const now = Date.now()
      if (now - windowStart > 1000) { windowStart = now; count = 0 }
      if (++count > MAX_MESSAGES_PER_SECOND) return
      let message: ClientMessage
      try { message = JSON.parse(data.toString()) } catch { return }
      if (!message || typeof message !== 'object') return
      if (!seat || !room) {
        if (message.type !== 'hello') return
        if (message.v !== PROTOCOL_VERSION) { socket.send(JSON.stringify({ type: 'error', message: 'Please reload: the game was updated.' })); socket.close(); return }
        const found = typeof message.code === 'string' ? rooms.get(message.code) : null
        const claimed = found && typeof message.token === 'string' ? found.seatForToken(message.token) : null
        if (!found || !claimed) { socket.send(JSON.stringify({ type: 'error', message: 'Room not found or seat expired.' })); socket.close(); return }
        clearTimeout(helloTimer)
        room = found
        seat = claimed
        room.attach(seat, socket)
        return
      }
      room.handle(seat, message)
    })
    socket.on('close', () => {
      clearTimeout(helloTimer)
      if (room && seat) room.detach(seat, socket)
    })
    socket.on('error', () => socket.close())
  })

  const loop = setInterval(() => { for (const room of rooms.all()) room.update() }, LOOP_INTERVAL_MS)
  const janitor = setInterval(() => rooms.prune(), 60_000)

  return {
    server,
    rooms,
    close: () => new Promise((done) => {
      clearInterval(loop)
      clearInterval(janitor)
      for (const client of wss.clients) client.terminate()
      wss.close(() => server.close(() => done()))
    }),
  }
}
