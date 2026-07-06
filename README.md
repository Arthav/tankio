# Tankio2

Tankio2 is a greenfield multiplayer browser tank arena. It uses a Phaser canvas client, a custom Node/WebSocket authoritative server, shared TypeScript simulation code, and Postgres-backed guest progress.

## Local Development

1. Install dependencies:

   ```powershell
   npm install
   ```

2. Start Postgres:

   ```powershell
   docker compose up -d postgres
   ```

3. Copy `.env.example` to `.env`, then apply migrations:

   ```powershell
   npm run migrate
   ```

4. Run the client and server:

   ```powershell
   npm run dev
   ```

Client: `http://localhost:5173`

Server: `http://localhost:3001`

If Postgres is not available and `TANKIO_ALLOW_MEMORY_STORE=true`, the server falls back to an in-memory profile store so gameplay still boots. That fallback is for local iteration only; durable saved progress requires Postgres.

The compose database maps host port `55433` to container port `5432` to avoid colliding with existing local Postgres installs.
It also uses host `trust` auth because this database is local-only development infrastructure.
