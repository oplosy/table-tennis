import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { stage } from '../game/stage'
import App from './App'

function stubContexts(available: string[]) {
  const getContext = (type: string) => (available.includes(type) ? {} : null)
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(getContext as never)
}

const renderApp = () => render(<MemoryRouter><App /></MemoryRouter>)

describe('App without usable WebGL 2', () => {
  afterEach(() => { cleanup(); vi.restoreAllMocks() })

  it('shows the unavailable screen on a WebGL1-only browser', () => {
    stubContexts(['webgl'])
    const mount = vi.spyOn(stage, 'mount')

    renderApp()

    expect(screen.getByRole('heading', { name: '3D is unavailable' })).toBeInTheDocument()
    expect(screen.getByText(/could not start WebGL 2/)).toBeInTheDocument()
    expect(mount).not.toHaveBeenCalled()
  })

  it('falls back to the unavailable screen when the renderer cannot be created', () => {
    stubContexts(['webgl2'])
    vi.spyOn(stage, 'mount').mockImplementation(() => { throw new Error('Error creating WebGL context.') })

    renderApp()

    expect(screen.getByRole('heading', { name: '3D is unavailable' })).toBeInTheDocument()
  })
})
