import type { AddressInfo } from 'node:net'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { WebSocket } from 'ws'
import { NEUTRAL_INTENT, PROTOCOL_VERSION, type ClientMessage, type RoomTicket, type ServerMessage } from '@rally/core'
import { createApp, type App } from '../src/app'
import { sanitizeAction } from '../src/room'

let app: App
let base: string

beforeEach(async () => {
  app = createApp()
  await new Promise<void>((done) => app.server.listen(0, done))
  base = `127.0.0.1:${(app.server.address() as AddressInfo).port}`
})
afterEach(() => app.close())

const post = async (path: string, body: unknown = {}) => {
  const res = await fetch(`http://${base}${path}`, { method: 'POST', body: JSON.stringify(body) })
  return { status: res.status, body: (await res.json()) as RoomTicket }
}

class Client {
  socket: WebSocket
  inbox: ServerMessage[] = []
  private waiters: Array<{ type: string; resolve: (m: ServerMessage) => void }> = []
  constructor(url: string) {
    this.socket = new WebSocket(url)
    this.socket.on('message', (data) => {
      const message = JSON.parse(data.toString()) as ServerMessage
      const index = this.waiters.findIndex((w) => w.type === message.type)
      if (index >= 0) this.waiters.splice(index, 1)[0].resolve(message)
      else this.inbox.push(message)
    })
  }
  open() { return new Promise((done) => this.socket.once('open', done)) }
  send(message: ClientMessage) { this.socket.send(JSON.stringify(message)) }
  next<T extends ServerMessage['type']>(type: T): Promise<Extract<ServerMessage, { type: T }>> {
    const index = this.inbox.findIndex((m) => m.type === type)
    if (index >= 0) return Promise.resolve(this.inbox.splice(index, 1)[0] as Extract<ServerMessage, { type: T }>)
    return new Promise((resolve) => this.waiters.push({ type, resolve: resolve as (m: ServerMessage) => void }))
  }
}

async function connect(ticket: RoomTicket) {
  const client = new Client(`ws://${base}/ws`)
  await client.open()
  client.send({ type: 'hello', v: PROTOCOL_VERSION, code: ticket.code, token: ticket.token })
  await client.next('welcome')
  return client
}

describe('rooms api', () => {
  it('creates, joins and rejects a third player', async () => {
    const created = await post('/api/rooms', { name: 'Ada' })
    expect(created.status).toBe(201)
    expect(created.body.side).toBe('home')
    const joined = await post(`/api/rooms/${created.body.code}/join`, { name: 'Lin' })
    expect(joined.body.side).toBe('away')
    expect((await post(`/api/rooms/${created.body.code}/join`)).status).toBe(409)
    expect((await post('/api/rooms/ZZZZZ/join')).status).toBe(404)
  })
})

describe('realtime', () => {
  it('starts a match when both players are ready and relays actions', async () => {
    const home = (await post('/api/rooms', { name: 'Ada' })).body as RoomTicket
    const away = (await post(`/api/rooms/${home.code}/join`, { name: 'Lin' })).body as RoomTicket
    const a = await connect(home)
    const b = await connect(away)
    a.send({ type: 'ready', ready: true })
    b.send({ type: 'ready', ready: true })
    const [startA, startB] = await Promise.all([a.next('start'), b.next('start')])
    expect(startA.state).toEqual(startB.state)

    const server = startA.state.server
    const [serverClient, receiver] = server === 'home' ? [a, b] : [b, a]
    const tick = startA.state.tick + 5
    serverClient.send({ type: 'action', tick, action: { kind: 'serve', side: server, x: 0, intent: NEUTRAL_INTENT } })
    const relayed = await receiver.next('action')
    expect(relayed).toMatchObject({ tick, action: { kind: 'serve', side: server } })

    // The receiver may not act for the server, and nonsense is answered with a sync.
    receiver.send({ type: 'action', tick: 1, action: { kind: 'hit', side: server, contact: { x: 0, y: 1, z: 0 }, intent: NEUTRAL_INTENT, offCenter: 0 } })
    expect((await receiver.next('sync')).state.phase).toBeDefined()

    a.send({ type: 'paddle', tick, pose: { x: 0.2, y: 0.9, z: 1.8 } })
    expect(await b.next('paddle')).toMatchObject({ side: 'home', pose: { x: 0.2 } })
  })

  it('pauses when a player drops and resumes on reconnect', async () => {
    const home = (await post('/api/rooms')).body as RoomTicket
    const away = (await post(`/api/rooms/${home.code}/join`)).body as RoomTicket
    const a = await connect(home)
    const b = await connect(away)
    a.send({ type: 'ready', ready: true })
    b.send({ type: 'ready', ready: true })
    await a.next('start')
    b.socket.close()
    let sync = await a.next('sync')
    while (!sync.clock.paused) sync = await a.next('sync')
    const back = await connect(away)
    await back.next('start')
    let resumed = await a.next('sync')
    while (resumed.clock.paused) resumed = await a.next('sync')
    expect(resumed.clock.offset).toBeGreaterThanOrEqual(0)
  })
})

describe('sanitizeAction', () => {
  it('forces the sender side and clamps fields', () => {
    const action = sanitizeAction({ kind: 'hit', side: 'away', contact: { x: 0, y: 1, z: 1 }, intent: { power: 9 }, offCenter: 4 }, 'home')
    expect(action).toMatchObject({ side: 'home', intent: { power: 1 }, offCenter: 1 })
    expect(sanitizeAction({ kind: 'hit', contact: { x: 'a' } }, 'home')).toBeNull()
    expect(sanitizeAction({ kind: 'teleport' }, 'home')).toBeNull()
  })
})
