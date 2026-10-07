# Changelog

1.1.0 is the final release; the project is complete and no further versions
are planned.

## 1.1.0 — 2026-09-30

- Broadcast-style lighting: HDRI image-based lighting, overhead key light,
  court wash and rim lights.
- Post-processing with pmndrs `postprocessing`: N8AO ambient occlusion
  (High), bloom on the ceiling lamps, AgX tone mapping and light grading.
- Touch devices start on the Fast graphics tier; the choice is still saved.
- Ambient occlusion switches itself off when the frame rate cannot be held.
- Table, paddle and hall modelled in Blender: a regulation table on a
  rollaway frame, a layered paddle, padded surround boards, seated stands, a
  lighting rig, and a backstage with LED screens and stage spots at each end.
- The hall's lighting is baked (lightmap and vertex colours), so real-time
  lights no longer pay for it; the ball and paddles still cast live shadows.
- The hall's LED screens and the umpire's flip board show the live score.

## 1.0.0 — full rewrite

- Replaced the Go server with a Node.js/TypeScript server that runs the same
  simulation as the browser (`packages/core`).
- Real-scale physics: ITTF table, net and 40 mm ball; gravity, drag, Magnus
  spin, swept table/net/floor contacts, net-cord deflections.
- Stroke model: paddle velocity at contact drives pace, spin and direction;
  chops, smashes, off-centre and pressure errors.
- Full rules: legal serves, lets, faults, double bounce, games to 11 by two,
  service rotation, best-of-N matches, auto serve for idle players.
- Computer opponent with four levels that plays with the same physics.
- Online rooms with invite links, clock sync, rollback for late actions,
  pause on disconnect and forfeit after 30 s, rematches.
- New three.js arena, procedural paddles, ball trail and contact shadow,
  follow camera, broadcast-style HUD, synthesised sound, mobile touch support.
- Single-process production build and Dockerfile.

## 0.x

- Early MVP: normalised 2D rally rules on a Go server with a Three.js view.
