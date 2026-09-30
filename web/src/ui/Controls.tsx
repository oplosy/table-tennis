import { CircleHelp, Pause, Play, Volume2, VolumeX } from 'lucide-react'
import { useSettings } from '../state/settings'

export function SoundButton() {
  const sound = useSettings((s) => s.sound)
  const set = useSettings((s) => s.set)
  return (
    <button className="icon" aria-label={sound ? 'Mute sound' : 'Turn sound on'} aria-pressed={!sound} onClick={() => set({ sound: !sound })}>
      {sound ? <Volume2 size={18} /> : <VolumeX size={18} />}
    </button>
  )
}

export function HelpButton({ onClick }: { onClick: () => void }) {
  return <button className="icon" aria-label="How to play" onClick={onClick}><CircleHelp size={18} /></button>
}

export function PauseButton({ paused, onClick }: { paused: boolean; onClick: () => void }) {
  return (
    <button className="icon" aria-label={paused ? 'Resume' : 'Pause'} onClick={onClick}>
      {paused ? <Play size={18} /> : <Pause size={18} />}
    </button>
  )
}

export function Segmented<T extends string | number>({ value, options, onChange, label }: {
  value: T
  options: Array<{ value: T; label: string }>
  onChange: (value: T) => void
  label: string
}) {
  return (
    <div className="field">
      <span>{label}</span>
      <div className="segmented" role="group" aria-label={label}>
        {options.map((option) => (
          <button key={String(option.value)} type="button" aria-pressed={option.value === value} onClick={() => onChange(option.value)}>{option.label}</button>
        ))}
      </div>
    </div>
  )
}
