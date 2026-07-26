# 15.010 — Interactive Apps

Single repo hosting all in-class interactive apps for 15.010 (Economic Analysis for
Business Decisions). Each lecture app lives in its own top-level folder. Static apps are
plain HTML/JS; the game apps are Vite (React) clients with Node/Express/Socket.io servers.

| Folder | Lecture | Concept | Type | Deploy |
|--------|---------|---------|------|--------|
| `L11-supply-curve` | L11 | Oil supply curve / equilibrium | Static | open `index.html` |
| `L11-tariff` | L11 | Tariffs, pass-through, deadweight loss | Static | open `index.html` |
| `L12-commons-game` | L12 | Tragedy of the commons (fishing) | Client + server | Vercel + Render |
| `L15-airline` | L15 | Vertical differentiation (Ryan Air vs BA) | Static | open `index.html` |
| `L16-pricing-game` | L16 | Bertrand price competition | Client + server | Vercel + Render |
| `L19-ultimatum` | L19 | Ultimatum game (behavioral) | Client + server | Vercel + Render |

## Running a static app

Open the folder's `index.html` in any browser. No build step.

## Running a game app (commons / pricing / ultimatum)

```bash
cd <app>/server && npm install && npm start     # backend
cd <app>/client && npm install && npm run dev    # frontend (separate terminal)
```

## Deployment

Backends deploy to Render from the root `render.yaml` blueprint (three services, one per
game, each with its own `rootDir`). Frontends deploy to Vercel as three projects, each with
Root Directory set to `<app>/client`. See `render.yaml` and each `client/vercel.json`.

History for each app was merged in via `git subtree`, preserving the original commit trail
from the standalone repos (`supply_curve`, `tariff_lab`, `vertical-dif`, `commons-game`,
`pricing-game`).
