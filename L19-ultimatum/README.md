# L19 — Ultimatum Game (Behavioral Economics)

Standalone real-time classroom Ultimatum game. Students are paired; one proposes how to
split a fixed pot (default 20), the other accepts or rejects. Rejections pay both zero.
Used in Lecture 19 (Behavioral Economics).

Extracted from the `pricing-game` codebase into its own app so it can be deployed and run
independently. Same stack: Node/Express/Socket.io server + Vite/React client.

## Run locally

```bash
# backend (port 4002)
cd server && npm install && npm start

# frontend (separate terminal)
cd client && npm install && npm run dev
```

Then open the client (Vite prints the URL, default http://localhost:5173):
- Instructor: `/instructor`
- Students: `/` (or the session link the instructor shares)

The client talks to the server via `VITE_SOCKET_URL` (default `http://localhost:4002`).
Set `VITE_API_URL` / `VITE_SOCKET_URL` in the client env when deploying.

## Deploy

- **Backend (Render):** service defined in the monorepo root `render.yaml`
  (`ultimatum-game-server`, `rootDir: L19-ultimatum/server`).
- **Frontend (Vercel):** project with Root Directory `L19-ultimatum/client`, env
  `VITE_SOCKET_URL` = the Render backend URL.

## Game config (instructor-adjustable)

`rounds`, `proposeTime`, `respondTime`, `resultRevealTime`, `totalAmount` (pot),
`minOffer`, `maxOffer`. Defaults live in `server/ultimatumGame.js`.
