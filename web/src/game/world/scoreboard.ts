import * as THREE from 'three'
import { SIDES, type MatchState, type Side } from '@rally/core'

/** What the hall's screens and the umpire's flip board show. */
export interface ScoreView {
  names: Record<Side, string>
  points: Record<Side, number>
  games: Record<Side, number>
  /** Whose serve it is; nobody's once the match is over. */
  server: Side | null
  winner: Side | null
}

const MAX_NAME = 14

/** Board lettering: upper case, cut to fit with an ellipsis. */
export function shortName(name: string) {
  const clean = name.trim().toUpperCase()
  if (!clean) return '—'
  return clean.length > MAX_NAME ? `${clean.slice(0, MAX_NAME - 1)}…` : clean
}

export function scoreView(state: MatchState, names: Record<Side, string>): ScoreView {
  return {
    names: { home: shortName(names.home), away: shortName(names.away) },
    points: { ...state.points },
    games: { ...state.games },
    server: state.winner ? null : state.server,
    winner: state.winner,
  }
}

const FONT = '"Barlow Condensed", "Arial Narrow", sans-serif'
const SCREEN = { width: 1024, height: 512 }
const DIGIT = { width: 256, height: 192 }

/** `flipY` false suits glTF UVs (the model's screens); three's own planes want it true. */
function canvasTexture(width: number, height: number, flipY: boolean) {
  const element = document.createElement('canvas')
  element.width = width
  element.height = height
  const context = element.getContext('2d')
  if (!context) throw new Error('2D canvas unavailable')
  const texture = new THREE.CanvasTexture(element)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.anisotropy = 8
  texture.flipY = flipY
  return { context, texture }
}

/**
 * Paints the live score onto the LED screens behind each end and the flip
 * board on the umpire's desk. Without a match to show it displays the
 * tournament wordmark.
 */
export class Scoreboard {
  readonly screen: THREE.CanvasTexture
  readonly digits: Record<Side, THREE.CanvasTexture>
  private readonly screenContext: CanvasRenderingContext2D
  private readonly digitContexts: Record<Side, CanvasRenderingContext2D>

  constructor() {
    const screen = canvasTexture(SCREEN.width, SCREEN.height, false)
    const home = canvasTexture(DIGIT.width, DIGIT.height, true)
    const away = canvasTexture(DIGIT.width, DIGIT.height, true)
    this.screen = screen.texture
    this.screenContext = screen.context
    this.digits = { home: home.texture, away: away.texture }
    this.digitContexts = { home: home.context, away: away.context }
    this.show(null)
  }

  show(view: ScoreView | null) {
    if (view) this.paintScore(view)
    else this.paintIdle()
    this.screen.needsUpdate = true
    for (const side of SIDES) {
      this.paintDigit(this.digitContexts[side], view ? String(view.points[side]) : '')
      this.digits[side].needsUpdate = true
    }
  }

  dispose() {
    this.screen.dispose()
    for (const side of SIDES) this.digits[side].dispose()
  }

  private background() {
    const context = this.screenContext
    const gradient = context.createLinearGradient(0, 0, SCREEN.width, SCREEN.height)
    gradient.addColorStop(0, '#0a1f52')
    gradient.addColorStop(1, '#123a8f')
    context.fillStyle = gradient
    context.fillRect(0, 0, SCREEN.width, SCREEN.height)
    context.fillStyle = '#ff6a3d'
    context.fillRect(0, SCREEN.height - 44, SCREEN.width, 12)
    context.textBaseline = 'middle'
    return context
  }

  private paintIdle() {
    const context = this.background()
    context.textAlign = 'center'
    context.fillStyle = '#ffffff'
    context.font = `800 230px ${FONT}`
    context.fillText('RALLY', SCREEN.width / 2, 220)
    context.fillStyle = '#9fc0ff'
    context.font = `600 56px ${FONT}`
    context.fillText('TABLE TENNIS OPEN 2026', SCREEN.width / 2, 390)
  }

  private paintScore(view: ScoreView) {
    const context = this.background()
    context.textAlign = 'center'
    context.fillStyle = '#9fc0ff'
    context.font = `600 40px ${FONT}`
    context.fillText(view.winner ? 'FINAL' : 'RALLY OPEN 2026', SCREEN.width / 2, 52)

    SIDES.forEach((side, row) => {
      const y = 170 + row * 170
      const leading = view.winner === side
      context.fillStyle = leading ? 'rgba(255,255,255,0.16)' : 'rgba(255,255,255,0.07)'
      context.fillRect(48, y - 70, SCREEN.width - 96, 140)
      if (view.server === side) {
        context.fillStyle = '#ff6a3d'
        context.beginPath()
        context.arc(86, y, 14, 0, Math.PI * 2)
        context.fill()
      }
      context.textAlign = 'left'
      context.fillStyle = '#ffffff'
      context.font = `700 84px ${FONT}`
      context.fillText(view.names[side], 122, y + 4)
      context.textAlign = 'center'
      context.fillStyle = '#9fc0ff'
      context.font = `700 76px ${FONT}`
      context.fillText(String(view.games[side]), 720, y + 4)
      context.fillStyle = '#ffffff'
      context.font = `800 128px ${FONT}`
      context.fillText(String(view.points[side]), 880, y + 6)
    })
  }

  private paintDigit(context: CanvasRenderingContext2D, text: string) {
    context.fillStyle = '#eef0f2'
    context.fillRect(0, 0, DIGIT.width, DIGIT.height)
    context.fillStyle = '#14171c'
    context.textAlign = 'center'
    context.textBaseline = 'middle'
    context.font = `800 170px ${FONT}`
    context.fillText(text, DIGIT.width / 2, DIGIT.height / 2 + 8)
  }
}
