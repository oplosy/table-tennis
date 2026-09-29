import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import type { Difficulty } from '@rally/core'

export type Speed = 'relaxed' | 'normal' | 'fast'
export type Quality = 'low' | 'high'

export const SPEED_SCALE: Record<Speed, number> = { relaxed: 0.48, normal: 0.6, fast: 0.74 }

export interface Settings {
  name: string
  difficulty: Difficulty
  speed: Speed
  bestOf: 1 | 3 | 5
  sound: boolean
  /** Shows where the incoming ball will bounce and lifts marginal shots over the net. */
  assist: boolean
  quality: Quality
  seenTutorial: boolean
  set: (patch: Partial<Omit<Settings, 'set'>>) => void
}

const safeStorage = () => {
  try { return window.localStorage } catch { return undefined as unknown as Storage }
}

export const useSettings = create<Settings>()(persist((set) => ({
  name: '',
  difficulty: 'medium',
  speed: 'normal',
  bestOf: 3,
  sound: true,
  assist: true,
  quality: 'high',
  seenTutorial: false,
  set: (patch) => set(patch),
}), { name: 'rally-settings', version: 1, storage: createJSONStorage(safeStorage) }))

export const displayName = (name: string) => name.trim() || 'You'
