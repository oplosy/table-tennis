import type { CreateRoomRequest, RoomInfo, RoomTicket } from '@rally/core'

const base = ((import.meta.env.VITE_SERVER_URL as string | undefined) ?? '').replace(/\/$/, '')

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response
  try {
    response = await fetch(`${base}${path}`, { headers: { 'Content-Type': 'application/json' }, ...init })
  } catch {
    throw new Error('The game server is not reachable.')
  }
  const body = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error((body as { error?: string }).error ?? 'Request failed')
  return body as T
}

export const createRoom = (options: CreateRoomRequest) => request<RoomTicket>('/api/rooms', { method: 'POST', body: JSON.stringify(options) })
export const joinRoom = (code: string, name: string) => request<RoomTicket>(`/api/rooms/${encodeURIComponent(code)}/join`, { method: 'POST', body: JSON.stringify({ name }) })
export const getRoom = (code: string) => request<RoomInfo>(`/api/rooms/${encodeURIComponent(code)}`)

const ticketKey = (code: string) => `rally-ticket-${code.toUpperCase()}`
export function saveTicket(ticket: RoomTicket) {
  try { sessionStorage.setItem(ticketKey(ticket.code), JSON.stringify(ticket)) } catch { /* private mode */ }
}
export function loadTicket(code: string): RoomTicket | null {
  try {
    const raw = sessionStorage.getItem(ticketKey(code))
    return raw ? (JSON.parse(raw) as RoomTicket) : null
  } catch { return null }
}
