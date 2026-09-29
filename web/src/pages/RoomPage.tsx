import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Check, Copy } from 'lucide-react'
import { useNavigate, useParams } from 'react-router-dom'
import { other, type RoomInfo, type RoomTicket, type Side } from '@rally/core'
import { stage } from '../game/stage'
import { OnlineSession } from '../game/session/OnlineSession'
import { joinRoom, loadTicket, saveTicket } from '../net/api'
import { Connection, type ConnectionStatus } from '../net/connection'
import { displayName, useSettings } from '../state/settings'
import { HelpButton, SoundButton } from '../ui/Controls'
import Hud from '../ui/Hud'
import { useScoreboard } from '../ui/hooks'
import { HelpSheet, ResultSheet } from '../ui/Sheets'

/** Private online room: join form, lobby, match and rematch. */
export default function RoomPage() {
  const { code = '' } = useParams()
  const [ticket, setTicket] = useState<RoomTicket | null>(() => loadTicket(code))
  return ticket ? <Room ticket={ticket} /> : <JoinForm code={code.toUpperCase()} onJoined={setTicket} />
}

function JoinForm({ code, onJoined }: { code: string; onJoined: (ticket: RoomTicket) => void }) {
  const navigate = useNavigate()
  const settings = useSettings()
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setBusy(true); setError('')
    try {
      const ticket = await joinRoom(code, settings.name)
      saveTicket(ticket)
      onJoined(ticket)
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not join the room.') } finally { setBusy(false) }
  }
  return <>
    <div className="shade" />
    <div className="overlay">
      <form className="lobby" onSubmit={submit}>
        <h1>You're invited</h1>
        <p className="hint">Room {code}. Pick a name and take the far side of the table.</p>
        <label className="field"><span>Your name</span>
          <input className="text-input" autoFocus maxLength={16} value={settings.name} placeholder="Player" onChange={(e) => settings.set({ name: e.target.value })} />
        </label>
        <div className="row">
          <button className="go" disabled={busy} type="submit"><span>Join the room</span></button>
          <button className="go quiet" type="button" onClick={() => navigate('/')}><span>Main menu</span></button>
        </div>
        {error && <p className="error" role="alert">{error}</p>}
      </form>
    </div>
  </>
}

function Room({ ticket }: { ticket: RoomTicket }) {
  const [connection, setConnection] = useState<Connection | null>(null)
  useEffect(() => {
    const next = new Connection(ticket)
    setConnection(next)
    return () => { next.close(); stage.setSession(null) }
  }, [ticket])
  return connection ? <ConnectedRoom ticket={ticket} connection={connection} /> : null
}

function ConnectedRoom({ ticket, connection }: { ticket: RoomTicket; connection: Connection }) {
  const navigate = useNavigate()
  const assist = useSettings((s) => s.assist)
  const sessionRef = useRef<OnlineSession | null>(null)
  const [status, setStatus] = useState<ConnectionStatus>('connecting')
  const [room, setRoom] = useState<RoomInfo | null>(null)
  const [session, setSession] = useState<OnlineSession | null>(null)
  const [error, setError] = useState('')
  const [copied, setCopied] = useState(false)
  const [ready, setReady] = useState(false)
  const [rematch, setRematch] = useState(false)
  const [help, setHelp] = useState(false)
  const [paused, setPaused] = useState(false)

  useEffect(() => {
    const offStatus = connection.onStatus(setStatus)
    const off = connection.subscribe((message) => {
      if (message.type === 'welcome' || message.type === 'room') setRoom(message.room)
      if (message.type === 'error') setError(message.message)
      if (message.type === 'sync') setPaused(message.clock.paused)
      if (message.type === 'start') {
        setReady(false)
        setRematch(false)
        setPaused(message.clock.paused)
        const current = sessionRef.current
        // A reconnect replays the running match: resync instead of restarting.
        if (current && current.match.config.seed === message.config.seed) {
          current.timeline.resync(message.state)
          return
        }
        const next = new OnlineSession(connection, ticket.side, message.config, message.state, message.clock, assist)
        next.onRemoteHit = (side, power) => stage.renderer?.swing(side, power)
        sessionRef.current = next
        stage.setSession(next)
        setSession(next)
      }
    })
    return () => { off(); offStatus() }
  }, [assist, connection, ticket.side])

  const board = useScoreboard(session)
  const me = ticket.side
  const nameOf = (side: Side) => room?.players.find((p) => p.side === side)?.name ?? (side === me ? 'You' : 'Opponent')
  const names = { [me]: displayName(nameOf(me)), [other(me)]: nameOf(other(me)) } as Record<Side, string>
  const opponent = room?.players.find((p) => p.side !== me)
  const inviteLink = `${window.location.origin}/room/${ticket.code}`

  const copy = async () => {
    try { await navigator.clipboard.writeText(inviteLink); setCopied(true); window.setTimeout(() => setCopied(false), 1500) } catch { /* clipboard blocked */ }
  }
  const sendReady = () => { setReady(true); connection.send({ type: 'ready', ready: true }) }
  const leave = () => navigate('/')
  const playing = session && room?.status !== 'lobby'
  const netDot = status !== 'open' ? 'down' : connection.clock.rtt > 150 ? 'warn' : ''

  if (!playing) {
    return <>
      <div className="shade" />
      <div className="overlay">
        <main className="lobby">
          <h1>{opponent ? 'Ready when you are' : 'Waiting for a friend'}</h1>
          <p className="hint">Send the link or the code. The match starts when both players are ready.</p>
          <div className="code">
            <strong aria-label="Room code">{ticket.code}</strong>
            <button className="go secondary" onClick={copy}><span>{copied ? <><Check size={16} /> Copied</> : <><Copy size={16} /> Copy invite link</>}</span></button>
          </div>
          <div className="seats">
            {(['home', 'away'] as const).map((side) => {
              const player = room?.players.find((p) => p.side === side)
              return (
                <div className="seat" key={side}>
                  <span>{player ? player.name : 'Open seat'}{side === me ? ' (you)' : ''}</span>
                  <small className={player?.ready ? 'ok' : ''}>{!player ? 'Not joined' : !player.connected ? 'Offline' : player.ready ? 'Ready' : 'Not ready'}</small>
                </div>
              )
            })}
          </div>
          <div className="row">
            <button className="go" disabled={ready || !opponent?.connected || status !== 'open'} onClick={sendReady}><span>{ready ? 'Waiting for opponent' : "I'm ready"}</span></button>
            <button className="go quiet" onClick={leave}><span>Leave</span></button>
          </div>
          {status !== 'open' && <p className="hint">{status === 'reconnecting' ? 'Reconnecting to the server…' : 'Connecting…'}</p>}
          {error && <p className="error" role="alert">{error}</p>}
        </main>
      </div>
    </>
  }

  const finished = room?.status === 'finished' || board?.phase === 'match_over'
  return <>
    <div className="overlay">
      <Hud session={session} names={names} corner={<>
        <span className="net-status"><i className={`net-dot ${netDot}`} />{status === 'open' ? `${Math.round(connection.clock.rtt)} ms` : 'Offline'}</span>
        <SoundButton />
        <HelpButton onClick={() => setHelp(true)} />
      </>} />
    </div>
    {paused && !finished && <div className="pause-veil"><p>{status === 'open' ? `${opponent?.name ?? 'Opponent'} disconnected. Waiting for them to return…` : 'Reconnecting…'}</p></div>}
    {help && <HelpSheet onClose={() => setHelp(false)} />}
    {finished && board && (
      <ResultSheet winner={board.winner} me={me} names={names} games={board.games} points={board.points} bestOf={session.match.config.bestOf} actions={<>
        <button className="go" disabled={rematch || !opponent?.connected} onClick={() => { setRematch(true); connection.send({ type: 'rematch' }) }}>
          <span>{rematch ? 'Waiting for opponent' : 'Rematch'}</span>
        </button>
        <button className="go quiet" onClick={leave}><span>Main menu</span></button>
      </>} />
    )}
  </>
}
