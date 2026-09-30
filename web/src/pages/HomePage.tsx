import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import type { Difficulty } from '@rally/core'
import { createRoom, joinRoom, saveTicket } from '../net/api'
import { SPEED_SCALE, useSettings, type Speed } from '../state/settings'
import { Segmented, SoundButton } from '../ui/Controls'
import { HelpSheet } from '../ui/Sheets'

type Panel = 'cpu' | 'online' | 'settings' | null

const DIFFICULTIES: Array<{ value: Difficulty; label: string }> = [
  { value: 'easy', label: 'Easy' }, { value: 'medium', label: 'Medium' }, { value: 'hard', label: 'Hard' }, { value: 'pro', label: 'Pro' },
]
const LENGTHS = [{ value: 1 as const, label: '1 game' }, { value: 3 as const, label: 'Best of 3' }, { value: 5 as const, label: 'Best of 5' }]
const SPEEDS: Array<{ value: Speed; label: string }> = [{ value: 'relaxed', label: 'Relaxed' }, { value: 'normal', label: 'Normal' }, { value: 'fast', label: 'Fast' }]

export default function HomePage() {
  const navigate = useNavigate()
  const settings = useSettings()
  const [panel, setPanel] = useState<Panel>(null)
  const [help, setHelp] = useState(false)
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const toggle = (next: Panel) => { setError(''); setPanel(panel === next ? null : next) }
  const difficultyLabel = DIFFICULTIES.find((d) => d.value === settings.difficulty)?.label

  const hostRoom = async () => {
    setBusy(true); setError('')
    try {
      const ticket = await createRoom({ name: settings.name, bestOf: settings.bestOf, timeScale: SPEED_SCALE[settings.speed] })
      saveTicket(ticket)
      navigate(`/room/${ticket.code}`)
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not create the room.') } finally { setBusy(false) }
  }

  const enterRoom = async (event: FormEvent) => {
    event.preventDefault()
    const trimmed = code.trim().toUpperCase()
    if (trimmed.length < 4) { setError('Enter the 5-letter room code.'); return }
    setBusy(true); setError('')
    try {
      const ticket = await joinRoom(trimmed, settings.name)
      saveTicket(ticket)
      navigate(`/room/${ticket.code}`)
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not join the room.') } finally { setBusy(false) }
  }

  return <>
    <div className="shade" />
    <div className="overlay">
      <main className="home">
        <h1 className="wordmark">Rally<span>.</span></h1>
        <p className="tagline">Table tennis with real spin, real bounces and a regulation table. Play the computer or a friend.</p>
        <nav className="menu" aria-label="Main menu">
          <button className="menu-item primary" aria-expanded={panel === 'cpu'} onClick={() => toggle('cpu')}>
            <strong>Play the computer</strong><small>{difficultyLabel}</small>
          </button>
          {panel === 'cpu' && (
            <div className="drawer">
              <Segmented label="Opponent" value={settings.difficulty} options={DIFFICULTIES} onChange={(difficulty) => settings.set({ difficulty })} />
              <Segmented label="Match length" value={settings.bestOf} options={LENGTHS} onChange={(bestOf) => settings.set({ bestOf })} />
              <Segmented label="Ball speed" value={settings.speed} options={SPEEDS} onChange={(speed) => settings.set({ speed })} />
              <div className="row"><button className="go" onClick={() => navigate('/play')}><span>Start match</span></button></div>
            </div>
          )}

          <button className="menu-item" aria-expanded={panel === 'online'} onClick={() => toggle('online')}>
            <strong>Play a friend online</strong><small>Private room</small>
          </button>
          {panel === 'online' && (
            <div className="drawer">
              <label className="field"><span>Your name</span>
                <input className="text-input" maxLength={16} value={settings.name} placeholder="Player" onChange={(e) => settings.set({ name: e.target.value })} />
              </label>
              <div className="row"><button className="go" disabled={busy} onClick={hostRoom}><span>Create a room</span></button></div>
              <form className="field" onSubmit={enterRoom}>
                <span>Have a code?</span>
                <div className="row">
                  <input className="text-input" aria-label="Room code" maxLength={5} value={code} placeholder="Room code" onChange={(e) => setCode(e.target.value.toUpperCase())} />
                  <button className="go secondary" disabled={busy} type="submit"><span>Join</span></button>
                </div>
              </form>
              {error && <p className="error" role="alert">{error}</p>}
            </div>
          )}

          <button className="menu-item" aria-expanded={panel === 'settings'} onClick={() => toggle('settings')}>
            <strong>Settings</strong><small>{settings.assist ? 'Assist on' : 'Assist off'}</small>
          </button>
          {panel === 'settings' && (
            <div className="drawer">
              <label className="toggle"><span>Assist: show where the ball will bounce and lift close shots over the net</span>
                <input type="checkbox" checked={settings.assist} onChange={(e) => settings.set({ assist: e.target.checked })} />
              </label>
              <label className="toggle"><span>Sound</span>
                <input type="checkbox" checked={settings.sound} onChange={(e) => settings.set({ sound: e.target.checked })} />
              </label>
              <Segmented label="Graphics" value={settings.quality} options={[{ value: 'high', label: 'High' }, { value: 'low', label: 'Fast' }]} onChange={(quality) => settings.set({ quality })} />
            </div>
          )}

          <button className="menu-item" onClick={() => setHelp(true)}>
            <strong>How to play</strong><small>Controls and rules</small>
          </button>
        </nav>
      </main>
      <div className="corner"><SoundButton /></div>
    </div>
    {help && <HelpSheet onClose={() => setHelp(false)} />}
  </>
}
