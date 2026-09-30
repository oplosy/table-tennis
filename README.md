# Rally — Table Tennis

3D table tennis with real physics, running in the browser. Play against the
computer or online with a friend.

- **Real dimensions and physics:** ITTF table (2.74 × 1.525 m, net 15.25 cm),
  40 mm ball; gravity, air drag, the Magnus effect (topspin/backspin/sidespin),
  bounces with friction on the table, balls that clip the net tape and roll
  over.
- **Stroke control:** the paddle follows the mouse/finger; paddle speed at the
  moment of contact sets power and spin, sideways movement sets direction. Pull
  back for a chop, hit a high ball hard for a smash.
- **Rules:** games to 11, win by 2; service changes every two serves, and every
  point after 10–10; net serves (let), double bounces, balls landing on your
  own half, outs.
- **Opponents:** Easy / Medium / Hard / Pro. The AI predicts the ball's path
  with the same physics, moves at a limited speed, and makes mistakes.
- **Online:** room code or invite link; the server is authoritative, clients
  run the same deterministic simulation, and late strokes are placed on the
  correct tick by rolling back.

## Setup

Requires Node.js 20+.

```powershell
npm install
npm run dev
```

`npm run dev` starts the game server (`:8080`) and Vite (`:5173`) together.
Open <http://localhost:5173> in the browser. Playing against the computer works
without the server; online play needs it.

## Commands

| Command | What it does |
| --- | --- |
| `npm run dev` | Server + client in development mode |
| `npm test` | Core, server and client tests |
| `npm run typecheck` | TypeScript check across all packages |
| `npm run build` | Produces `web/dist` and `server/dist/server.js` |
| `npm start` | Starts the built server; also serves `web/dist` |
| `npm run bench -- hard medium 20` | Balance measurement with AI matches |

## Deployment

A single process is enough: the server serves the API/WebSocket as well as the
built client.

```powershell
npm run build
$env:PORT = "8080"
npm start
```

or with Docker:

```powershell
docker build -t rally .
docker run -p 8080:8080 rally
```

If the client will connect to a server at a different address, set
`VITE_SERVER_URL` before building (e.g. `https://rally.example.com`).

## Project structure

```text
packages/core   Shared deterministic simulation: physics, stroke solver,
                rules, AI, rollback timeline, protocol types
server          Node.js + ws: rooms, authoritative match loop, HTTP API, static files
web             React + three.js: 3D hall, camera, controls, HUD and menus
```

See [architecture.md](architecture.md) for details.
