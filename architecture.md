# Architecture

## Overview

The project is an npm workspace with three packages, all written in TypeScript.
The heart of the game runs as **the same code** in the browser and on the
server.

```text
             ┌──────────────────────────┐
             │      packages/core       │  deterministic simulation
             │ physics · shot · match   │
             │ ai · timeline · protocol │
             └──────┬─────────────┬─────┘
                    │             │
        ┌───────────▼───┐   ┌─────▼──────────────┐
        │     web       │   │      server        │
        │ React + three │◄─►│ Node + ws          │
        │ LocalSession  │ WS│ Room · MatchSession│
        │ OnlineSession │   │ (authoritative)    │
        └───────────────┘   └────────────────────┘
```

The Go server of the previous version was removed. The physics had to be
written twice, in Go on the server and in TypeScript on the client, and the
client could only show the ball by interpolating 100 ms behind. Now a single
simulation runs everywhere, which allows lag-free play against the computer and
shows the ball immediately online.

## Coordinates and units

- Metres and seconds. The origin is directly under the net, on the floor.
- `x` is the width of the table, `y` is up, `z` is the length of the table.
- The `home` player defends the `z > 0` half, the `away` player the `z < 0`
  half.
- The simulation advances at **240 ticks per real second**. Each tick is
  `timeScale / 240` simulated seconds; `timeScale < 1` slows the game down
  without changing trajectories (Relaxed / Normal / Fast).

## Physics (`physics.ts`)

- Gravity, air drag proportional to the square of the speed, the Magnus force
  (`ω × v`), and spin that decays over time.
- Collisions with the table, net and floor are **swept** against the previous
  position, so a fast ball cannot tunnel through.
- Table bounce: a vertical restitution coefficient plus a friction-based
  sliding model for a thin-walled sphere. Topspin pushes the ball forward,
  backspin brakes it.
- Net: a ball that hits the body loses its speed; a ball that touches the tape
  (cord) reflects around its normal vector, so net-cord deflections emerge on
  their own.
- Only `+ - * / sqrt` are used; V8 (browser and Node) produces bit-identical
  results.

## Strokes (`shot.ts`)

Controllers (mouse, AI, network) never produce a velocity vector; they produce
only an **intent** (`ShotIntent`: target x, depth, power, spin, side spin).

`planShot` turns the intent into a target point, sets the horizontal speed from
the power, and solves the vertical speed with **forward simulation and bisection
on the same integrator**, so the ball lands exactly on the target. The error
model:

- the incoming ball's speed and spin, contact away from the paddle centre and
  high power increase the deviation;
- occasionally there is a "mishit" (into the net or long);
- `netAssist` lifts shots that would only just clip the net.

`planServe` finds a legal serve trajectory, first bouncing on the server's own
half and then on the opponent's, by scanning and narrowing.

## Rules (`match.ts`)

`Match` is a fully deterministic state machine:

```text
pre_serve → toss → rally → dead → (pre_serve | game_over → pre_serve | match_over)
```

During a rally, the `expect` field holds the next legal event (`server_side`,
`receiver_side`, `hit`). Contacts with the table, net and floor are turned into
points according to that expectation: serve fault, net, out, double bounce, own
half, missed ball, let. A point is awarded after a 1.25 s "dead ball" period;
this window lets late-arriving strokes still be accepted online. If a player
stays idle, a serve is made automatically after 10 s.

## Contact (`paddle.ts`, `driver.ts`)

The paddle is treated as a vertical plane on the half the ball is coming to.
Contact occurs when the ball and the paddle plane cross each other within one
tick and the horizontal distance is within reach (`sweepContact`). The paddle
height is only visual; it rises to the ball by itself. For every tick,
`tickWithControllers` updates the controllers → applies serve requests →
advances the match → turns contacts into strokes.

## AI (`ai.ts`)

It simulates the incoming ball forward with the same physics, picks the peak
after the bounce on its own half, moves there at a limited speed after its
reaction time, and aims away from the opponent's paddle. The difficulty levels
differ in reaction time, speed, positioning error, power range and accuracy.
Balance is measured with `npm run bench` (e.g. medium vs medium: about 7
strokes per point).

## Online (`timeline.ts`, `server/`, `OnlineSession.ts`)

- The server has a global tick clock; clients estimate it with ping/pong (the
  median of the lowest-RTT samples, with gentle correction).
- Only **actions** go over the wire: `serve` and `hit`, with the tick at which
  they happened. Paddle positions are sent at 30 Hz for visuals only.
- `Timeline` keeps the states and the action log of the last 1.5 s. If an action
  arrives for a past tick, the timeline rewinds to that tick, applies the
  action, and replays up to the present.
- The client that makes a stroke sees its own paddle without delay and applies
  the stroke immediately; the server validates the same action on its own
  timeline (order, how close the contact point is to the ball, field bounds)
  and forwards it to the opponent. If it is rejected, a `sync` is sent to the
  client. The server also sends the full state every 0.5 s.
- If a player disconnects, the match is paused (the match clock is offset); if
  they do not return within 30 s, they forfeit.
- When the opponent's stroke arrives late, the jump in the ball's image is
  hidden with a short blend.

## Client (`web/`)

- **Single stage:** `stage.ts` keeps one WebGL renderer for the whole
  application; pages only swap the session. Behind the main menu, a demo match
  between two AIs is running.
- **Visual world (`game/world/`):** the table, paddle and hall are GLBs modelled
  in Blender (`src/assets/models/`); `assets.ts` loads them without holding up
  the game. Until the models arrive, and for any part that fails to load, their
  procedural counterparts from the same files are shown. The net cloth, ball,
  ball trail and hit effects are procedural; the court floor, barrier lettering
  and screens are drawn on canvases.
  - **The hall is unlit:** its lighting is baked in Blender. Large surfaces read
    a shared lightmap through a second UV channel; multi-part objects such as
    seats and truss beams carry the light in vertex colours. Real-time lights
    cost the hall nothing.
  - **Shadows:** the table's shadow on the floor is in the lightmap; the shadows
    of the ball and paddles are shown by a transparent shadow catcher above the
    court. The catcher has a hole the size of the table's projection onto the
    floor along the main light; otherwise the ball and paddle shadows would pass
    through the table and fall on the floor beneath it. If the hall model fails
    to load, the table casts its own shadow in real time.
  - **Score:** `scoreboard.ts` draws the live score on the end screens and the
    umpire's board; pages announce the names with `stage.setNames`. Outside a
    match (menus, the demo rally) the tournament title is shown.
  - **The table and paddle are lit:** a WTT broadcast-style rig (a single
    shadow-casting overhead key, a court wash, rims) lights them; the table's
    AO is in its vertex colours. The paddle is a single model, coloured per
    player in code.
- **Asset pipeline (`tools/blender/`):** the source is `rally_assets.blend`
  (modelled by hand). `export.py` writes each collection to a meshopt-compressed
  GLB, `bake.py` bakes the hall's lighting and the table's AO, and
  `render_env.py` renders the hall's 360° environment map. When run with trial
  settings (`RALLY_BAKE_SIZE`, `RALLY_BAKE_SAMPLES`, `RALLY_ENV_SAMPLES`), the
  output goes to a temporary folder; the game's files and the `.blend` do not
  change. `models.test.ts` checks the GLBs against the `packages/core`
  dimensions (±1 mm), the naming contract and a 6 MB budget.
- **Rendering (`game/render/`):** `profile.ts` defines the quality tier (pixel
  ratio, shadows, MSAA/FXAA, AO, bloom, grading). `environment.ts` turns the
  HDRI into a PMREM; until it loads, and on failure, it uses `RoomEnvironment`.
  `postfx.ts` is the pmndrs `postprocessing` chain: N8AO (High only) → bloom +
  AgX + grading in a single pass → FXAA (Fast only). Grading is our own small
  effect (`grading.ts`): it clamps the result at zero, because negative values
  turn into NaN in the next effect's colour-space conversion. Drawing is skipped
  while the canvas has no layout size. `budget.ts` watches frame times; if the
  average exceeds 18 ms (integrated GPUs), AO is turned off for the rest of the
  session. During development, `rally.renderer.postfx.enabled = false` turns
  the chain off.
- **Camera:** behind the player, following the paddle slightly; on a portrait
  screen it pulls back to widen the field of view.
- **Control (`MouseController`):** the pointer is cast onto a horizontal plane
  slightly above the table; the paddle velocity of the last ~80 ms is turned
  into the stroke intent. On touch, the paddle is held slightly ahead of the
  finger.
- **Sound:** synthesised with Web Audio (table "thud", paddle "pok", net, crowd
  applause, set/match chords).
- **UI:** React; per-frame data never enters React, and the HUD re-renders only
  on match events.

## Tests

- `packages/core`: serve order, legal serves, stroke accuracy, determinism, a
  full match, rejection of invalid strokes, and late actions giving exactly the
  same result through rollback.
- `server`: the room API, match start and action relay, disconnect/pause, input
  sanitising.
- `web`: how often mouse strokes stay on the table against the AI.

## Status and known limitations

The project is complete (1.1.0 is the final release). What was left out:

- Player characters with IK (phase 3 of the visual overhaul) were never started.
- Texture work for the floor and the table was not done; they use plain
  materials.
- The `high` tier's ambient occlusion exceeds the frame budget on the integrated
  GPU it was measured on, so `budget.ts` disables it automatically. A discrete
  GPU was not measured.
- The `low` tier's post chain costs about 2 ms/frame, above the ≲ 1 ms goal in
  the phase 1 spec.
