import { PROTOCOL_VERSION, TICK_RATE, type ClientMessage, type RoomTicket, type ServerMessage } from '@rally/core'

export type ConnectionStatus = 'connecting' | 'open' | 'reconnecting' | 'closed'

const wsUrl = () => {
  const explicit = import.meta.env.VITE_SERVER_URL as string | undefined
  if (explicit) return `${explicit.replace(/^http/, 'ws').replace(/\/$/, '')}/ws`
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${protocol}//${window.location.host}/ws`
}

/**
 * Estimates the server's tick clock. Each ping measures a round trip; the
 * samples with the shortest round trips give the most trustworthy offsets.
 */
export class ServerClock {
  private samples: Array<{ offset: number; rtt: number }> = []
  private offset = 0
  private target = 0
  rtt = 0

  get synced() { return this.samples.length >= 3 }

  sample(sentAt: number, serverTick: number, receivedAt = performance.now()) {
    const rtt = receivedAt - sentAt
    const midpoint = (sentAt + receivedAt) / 2
    this.samples.push({ offset: serverTick - (midpoint * TICK_RATE) / 1000, rtt })
    if (this.samples.length > 12) this.samples.shift()
    const best = [...this.samples].sort((a, b) => a.rtt - b.rtt).slice(0, Math.max(1, Math.ceil(this.samples.length / 2)))
    const offsets = best.map((s) => s.offset).sort((a, b) => a - b)
    this.target = offsets[Math.floor(offsets.length / 2)]
    this.rtt = best[0].rtt
    if (this.samples.length === 1 || Math.abs(this.target - this.offset) > TICK_RATE * 0.25) this.offset = this.target
  }

  /** Server tick (fractional) at local time `now`; slews gently towards new estimates. */
  tick(now = performance.now()) {
    const diff = this.target - this.offset
    this.offset += Math.max(-0.25, Math.min(0.25, diff))
    return (now * TICK_RATE) / 1000 + this.offset
  }
}

/** WebSocket to the room with automatic reconnect and clock sync. */
export class Connection {
  readonly ticket: RoomTicket
  readonly clock = new ServerClock()
  status: ConnectionStatus = 'connecting'
  private socket: WebSocket | null = null
  private listeners = new Set<(message: ServerMessage) => void>()
  private statusListeners = new Set<(status: ConnectionStatus) => void>()
  private pingTimer = 0
  private retryTimer = 0
  private attempts = 0
  private closed = false
  private pings = 0
  private latest = new Map<string, ServerMessage>()

  constructor(ticket: RoomTicket) {
    this.ticket = ticket
    this.open()
  }

  private open() {
    if (this.closed) return
    this.setStatus(this.attempts === 0 ? 'connecting' : 'reconnecting')
    const socket = new WebSocket(wsUrl())
    this.socket = socket
    socket.onopen = () => {
      if (this.socket !== socket) return
      this.attempts = 0
      this.pings = 0
      this.sendNow({ type: 'hello', v: PROTOCOL_VERSION, code: this.ticket.code, token: this.ticket.token })
      this.setStatus('open')
      this.schedulePing(0)
    }
    socket.onmessage = (event) => {
      let message: ServerMessage
      try { message = JSON.parse(event.data as string) as ServerMessage } catch { return }
      if (message.type === 'pong') this.clock.sample(message.t, message.tick)
      if (message.type === 'welcome' || message.type === 'room' || message.type === 'start') this.latest.set(message.type === 'welcome' ? 'room' : message.type, message)
      for (const listener of this.listeners) listener(message)
    }
    socket.onclose = () => {
      if (this.socket !== socket) return
      this.socket = null
      window.clearTimeout(this.pingTimer)
      if (this.closed) { this.setStatus('closed'); return }
      this.attempts += 1
      this.setStatus('reconnecting')
      this.retryTimer = window.setTimeout(() => this.open(), Math.min(4000, 400 * 2 ** this.attempts))
    }
  }

  private schedulePing(delay: number) {
    window.clearTimeout(this.pingTimer)
    this.pingTimer = window.setTimeout(() => {
      this.send({ type: 'ping', t: performance.now() })
      this.pings += 1
      this.schedulePing(this.pings < 6 ? 120 : 1000)
    }, delay)
  }

  send(message: ClientMessage) {
    if (this.socket?.readyState === WebSocket.OPEN) this.sendNow(message)
  }

  private sendNow(message: ClientMessage) { this.socket?.send(JSON.stringify(message)) }

  /** Subscribes and replays the latest room/start message so late subscribers catch up. */
  subscribe(listener: (message: ServerMessage) => void, replay = true) {
    this.listeners.add(listener)
    if (replay) for (const message of this.latest.values()) listener(message)
    return () => { this.listeners.delete(listener) }
  }

  onStatus(listener: (status: ConnectionStatus) => void) {
    this.statusListeners.add(listener)
    listener(this.status)
    return () => { this.statusListeners.delete(listener) }
  }

  private setStatus(status: ConnectionStatus) {
    this.status = status
    for (const listener of this.statusListeners) listener(status)
  }

  close() {
    this.closed = true
    window.clearTimeout(this.pingTimer)
    window.clearTimeout(this.retryTimer)
    const socket = this.socket
    this.socket = null
    socket?.close()
    this.setStatus('closed')
  }
}
