import { useCallback, useEffect, useRef, useState } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import { stage } from '../game/stage'
import HomePage from '../pages/HomePage'
import PlayPage from '../pages/PlayPage'
import RoomPage from '../pages/RoomPage'
import { useSettings } from '../state/settings'

// three's WebGLRenderer has required WebGL 2 since r163, so WebGL 1 alone is not enough.
function webglAvailable() {
  try {
    return Boolean(document.createElement('canvas').getContext('webgl2'))
  } catch { return false }
}

/** The 3D stage lives for the whole app; pages only swap what it shows. */
function StageCanvas({ onUnavailable }: { onUnavailable: () => void }) {
  const ref = useRef<HTMLCanvasElement>(null)
  const quality = useSettings((s) => s.quality)
  const sound = useSettings((s) => s.sound)
  useEffect(() => {
    if (!ref.current) return
    // The probe can pass and the real context still fail (blocklisted GPU, context limit).
    try { stage.mount(ref.current, quality) } catch { onUnavailable() }
    return () => stage.unmount()
  }, [quality, onUnavailable])
  useEffect(() => { stage.sound.enabled = sound }, [sound])
  useEffect(() => {
    const unlock = () => stage.sound.unlock()
    window.addEventListener('pointerdown', unlock)
    window.addEventListener('keydown', unlock)
    return () => { window.removeEventListener('pointerdown', unlock); window.removeEventListener('keydown', unlock) }
  }, [])
  // Remount the canvas with the quality so a fresh WebGL context is created.
  return <canvas key={quality} ref={ref} className="stage-canvas" aria-label="Table tennis court" />
}

export default function App() {
  const [supported, setSupported] = useState(webglAvailable)
  const onUnavailable = useCallback(() => setSupported(false), [])
  if (!supported) {
    return <main className="lobby"><h1>3D is unavailable</h1><p className="hint">This browser could not start WebGL 2. Enable hardware acceleration or try a current version of Chrome, Firefox, Safari or Edge.</p></main>
  }
  return <>
    <StageCanvas onUnavailable={onUnavailable} />
    <Routes>
      <Route path="/" element={<HomePage />} />
      <Route path="/play" element={<PlayPage />} />
      <Route path="/room/:code" element={<RoomPage />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  </>
}
