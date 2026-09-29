import type { MatchEvent, Side } from '@rally/core'

/**
 * Procedural sound effects: every sound is synthesised with Web Audio, so
 * there are no audio files to load. The context unlocks on the first gesture.
 */
export class Sound {
  private context: AudioContext | null = null
  private master: GainNode | null = null
  private noise: AudioBuffer | null = null
  enabled = true

  unlock() {
    if (typeof window === 'undefined') return
    if (!this.context) {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
      if (!Ctor) return
      this.context = new Ctor()
      this.master = this.context.createGain()
      this.master.gain.value = 0.8
      this.master.connect(this.context.destination)
      const length = this.context.sampleRate * 1.5
      this.noise = this.context.createBuffer(1, length, this.context.sampleRate)
      const data = this.noise.getChannelData(0)
      for (let i = 0; i < length; i += 1) data[i] = Math.random() * 2 - 1
    }
    if (this.context.state === 'suspended') void this.context.resume()
  }

  /** Plays the sound for match events. `listener` is the side we hear from (for win/lose stings). */
  play(events: MatchEvent[], listener: Side | null) {
    if (!this.enabled || !this.context || this.context.state !== 'running') return
    for (const event of events) {
      switch (event.type) {
        case 'bounce': this.knock(1150 + Math.random() * 90, 0.32 * Math.min(1, 0.35 + event.speed / 9), 0.05); break
        case 'hit': this.pock(event.power, event.smash); break
        case 'serve': this.pock(0.35, false); break
        case 'net': this.thud(event.cord ? 0.25 : 0.18); break
        case 'floor': this.knock(620, 0.12 * Math.min(1, event.speed / 5), 0.07); break
        case 'point': this.applause(0.35, listener === null || event.winner === listener); break
        case 'game': this.chord(listener === null || event.winner === listener ? [523.25, 659.25, 783.99] : [392, 466.16, 587.33], 0.09); break
        case 'match': this.chord(listener === null || event.winner === listener ? [523.25, 659.25, 783.99, 1046.5] : [349.23, 415.3, 523.25], 0.12); this.applause(0.9, true); break
      }
    }
  }

  /** Short tonal click: plastic ball on wood. */
  private knock(frequency: number, gain: number, length: number) {
    const ctx = this.context!
    const now = ctx.currentTime
    const tone = ctx.createOscillator()
    tone.type = 'sine'
    tone.frequency.setValueAtTime(frequency, now)
    tone.frequency.exponentialRampToValueAtTime(frequency * 0.7, now + length)
    const env = ctx.createGain()
    env.gain.setValueAtTime(gain, now)
    env.gain.exponentialRampToValueAtTime(0.0001, now + length)
    tone.connect(env).connect(this.master!)
    tone.start(now)
    tone.stop(now + length + 0.01)
    this.burst(2800, 2, gain * 0.9, 0.012)
  }

  /** Rubber on ball: a thump plus a bright click that grows with power. */
  private pock(power: number, smash: boolean) {
    const ctx = this.context!
    const now = ctx.currentTime
    const tone = ctx.createOscillator()
    tone.type = 'triangle'
    const base = 430 + power * 160
    tone.frequency.setValueAtTime(base, now)
    tone.frequency.exponentialRampToValueAtTime(base * 0.5, now + 0.07)
    const env = ctx.createGain()
    const level = 0.28 + power * 0.25 + (smash ? 0.15 : 0)
    env.gain.setValueAtTime(level, now)
    env.gain.exponentialRampToValueAtTime(0.0001, now + 0.08)
    tone.connect(env).connect(this.master!)
    tone.start(now)
    tone.stop(now + 0.09)
    this.burst(1200 + power * 1400, 1.2, level, 0.03)
  }

  private thud(gain: number) { this.burst(380, 0.8, gain, 0.09) }

  private burst(frequency: number, q: number, gain: number, length: number) {
    const ctx = this.context!
    const now = ctx.currentTime
    const source = ctx.createBufferSource()
    source.buffer = this.noise
    const filter = ctx.createBiquadFilter()
    filter.type = 'bandpass'
    filter.frequency.value = frequency
    filter.Q.value = q
    const env = ctx.createGain()
    env.gain.setValueAtTime(gain, now)
    env.gain.exponentialRampToValueAtTime(0.0001, now + length)
    source.connect(filter).connect(env).connect(this.master!)
    source.start(now, Math.random())
    source.stop(now + length + 0.01)
  }

  /** Crowd reaction: many overlapping filtered claps. */
  private applause(strength: number, cheer: boolean) {
    const ctx = this.context!
    const now = ctx.currentTime
    const claps = Math.round(30 * strength) + (cheer ? 18 : 0)
    for (let i = 0; i < claps; i += 1) {
      const at = now + Math.random() * (0.7 + strength * 0.8)
      const source = ctx.createBufferSource()
      source.buffer = this.noise
      const filter = ctx.createBiquadFilter()
      filter.type = 'bandpass'
      filter.frequency.value = 900 + Math.random() * 1600
      filter.Q.value = 0.9
      const env = ctx.createGain()
      const level = 0.035 * (0.5 + Math.random())
      env.gain.setValueAtTime(0.0001, now)
      env.gain.setValueAtTime(level, at)
      env.gain.exponentialRampToValueAtTime(0.0001, at + 0.05)
      source.connect(filter).connect(env).connect(this.master!)
      source.start(at, Math.random())
      source.stop(at + 0.06)
    }
  }

  private chord(notes: number[], gain: number) {
    const ctx = this.context!
    const now = ctx.currentTime
    notes.forEach((frequency, index) => {
      const start = now + index * 0.09
      const tone = ctx.createOscillator()
      tone.type = 'sine'
      tone.frequency.value = frequency
      const env = ctx.createGain()
      env.gain.setValueAtTime(0.0001, start)
      env.gain.exponentialRampToValueAtTime(gain, start + 0.02)
      env.gain.exponentialRampToValueAtTime(0.0001, start + 0.6)
      tone.connect(env).connect(this.master!)
      tone.start(start)
      tone.stop(start + 0.65)
    })
  }

  dispose() {
    void this.context?.close()
    this.context = null
  }
}
