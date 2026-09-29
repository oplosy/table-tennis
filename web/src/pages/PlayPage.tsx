import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { stage } from '../game/stage'
import { LocalSession } from '../game/session/LocalSession'
import { SPEED_SCALE, displayName, useSettings } from '../state/settings'
import { HelpButton, PauseButton, SoundButton } from '../ui/Controls'
import Hud from '../ui/Hud'
import { useScoreboard } from '../ui/hooks'
import { HelpSheet, ResultSheet, Sheet } from '../ui/Sheets'

const OPPONENT_NAMES = { easy: 'Rookie', medium: 'Club player', hard: 'Veteran', pro: 'Champion' } as const

/** Match against the computer. */
export default function PlayPage() {
  const navigate = useNavigate()
  const settings = useSettings()
  const [round, setRound] = useState(0)
  const [paused, setPaused] = useState(false)
  const [help, setHelp] = useState(!settings.seenTutorial)

  const session = useMemo(() => new LocalSession({
    difficulty: settings.difficulty,
    bestOf: settings.bestOf,
    timeScale: SPEED_SCALE[settings.speed],
    assist: settings.assist,
  // A new match only on explicit restart; settings changes apply to the next one.
  }), [round])

  useEffect(() => {
    stage.setSession(session)
    return () => stage.setSession(null)
  }, [session])

  const board = useScoreboard(session)
  const menuOpen = paused || help
  useEffect(() => { session.paused = menuOpen }, [session, menuOpen])

  const togglePause = useCallback(() => setPaused((value) => !value), [])
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape' || event.key.toLowerCase() === 'p') togglePause() }
    const onHidden = () => { if (document.hidden) setPaused(true) }
    window.addEventListener('keydown', onKey)
    document.addEventListener('visibilitychange', onHidden)
    return () => { window.removeEventListener('keydown', onKey); document.removeEventListener('visibilitychange', onHidden) }
  }, [togglePause])

  const names = { home: displayName(settings.name), away: OPPONENT_NAMES[settings.difficulty] }
  const closeHelp = () => { setHelp(false); settings.set({ seenTutorial: true }) }
  const restart = () => { setPaused(false); setRound((r) => r + 1) }

  return <>
    <div className="overlay">
      <Hud session={session} names={names} corner={<>
        <SoundButton />
        <HelpButton onClick={() => setHelp(true)} />
        <PauseButton paused={paused} onClick={togglePause} />
      </>} />
    </div>
    {help && <HelpSheet onClose={closeHelp} />}
    {paused && !help && (
      <Sheet title="Paused" onClose={() => setPaused(false)}>
        <p>The ball waits for you.</p>
        <div className="actions">
          <button className="go" onClick={() => setPaused(false)}><span>Resume</span></button>
          <button className="go secondary" onClick={restart}><span>Restart match</span></button>
          <button className="go quiet" onClick={() => navigate('/')}><span>Main menu</span></button>
        </div>
      </Sheet>
    )}
    {board?.phase === 'match_over' && (
      <ResultSheet winner={board.winner} me="home" names={names} games={board.games} points={board.points} bestOf={session.match.config.bestOf} actions={<>
        <button className="go" onClick={restart}><span>Play again</span></button>
        <button className="go quiet" onClick={() => navigate('/')}><span>Main menu</span></button>
      </>} />
    )}
  </>
}
