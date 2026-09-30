import * as THREE from 'three'
import { SIDES, type Match, type MatchState, type Side } from '@rally/core'

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

/**
 * What the hall should show: the score of a match somebody is playing, or
 * nothing (the wordmark) behind menus, where only the demo rally runs.
 */
export function boardFor(session: { localSide: Side | null; match: Pick<Match, 'state'> } | null, names: Record<Side, string> | null): ScoreView | null {
  return session?.localSide && names ? scoreView(session.match.state, names) : null
}

export function sameScore(a: ScoreView | null, b: ScoreView | null) {
  if (!a || !b) return a === b
  return a.server === b.server && a.winner === b.winner
    && SIDES.every((side) => a.names[side] === b.names[side] && a.points[side] === b.points[side] && a.games[side] === b.games[side])
}

const FAMILY = 'Barlow Condensed'
const FONT = `"${FAMILY}", "Arial Narrow", sans-serif`
/** Room for a name before the games column; longer names are squeezed, not spilled. */
const NAME_WIDTH = 540
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
  private shown: ScoreView | null = null
  private painted = false
  private disposed = false

  constructor() {
    const screen = canvasTexture(SCREEN.width, SCREEN.height, false)
    const home = canvasTexture(DIGIT.width, DIGIT.height, true)
    const away = canvasTexture(DIGIT.width, DIGIT.height, true)
    this.screen = screen.texture
    this.screenContext = screen.context
    this.digits = { home: home.texture, away: away.texture }
    this.digitContexts = { home: home.context, away: away.context }
    this.show(null)
    // The web font may still be loading: what was painted in the fallback face is redone once it arrives.
    void document.fonts?.load(`800 100px "${FAMILY}"`).then(() => { if (!this.disposed) this.paint() }).catch(() => {})
  }

  /** Cheap to call every frame: it only repaints when something on the board changed. */
  show(view: ScoreView | null) {
    if (this.painted && sameScore(view, this.shown)) return
    this.shown = view
    this.paint()
  }

  private paint() {
    const view = this.shown
    this.painted = true
    if (view) this.paintScore(view)
    else this.paintIdle()
    this.screen.needsUpdate = true
    for (const side of SIDES) {
      this.paintDigit(this.digitContexts[side], view ? String(view.points[side]) : '')
      this.digits[side].needsUpdate = true
    }
  }

  dispose() {
    this.disposed = true
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
      context.fillText(view.names[side], 122, y + 4, NAME_WIDTH)
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
