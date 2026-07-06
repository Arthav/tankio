import 'dotenv/config';
import http from 'node:http';
import { WebSocket, WebSocketServer } from 'ws';
import { createPool } from './db/client';
import { MemoryProfileStore, PostgresProfileStore, type ProfileStore } from './profiles';
import { RoomManager } from './roomManager';

const port = Number(process.env.PORT ?? 3001);
const clientOrigin = process.env.CLIENT_ORIGIN ?? 'http://localhost:5173';

async function createStore(): Promise<ProfileStore> {
  if (!process.env.DATABASE_URL) {
    console.warn('DATABASE_URL is not set. Using in-memory profile store.');
    return new MemoryProfileStore();
  }

  try {
    const pool = createPool();
    await pool.query('SELECT 1');
    return new PostgresProfileStore(pool);
  } catch (error) {
    if (process.env.TANKIO_ALLOW_MEMORY_STORE === 'true') {
      console.warn('Postgres is unavailable. Using in-memory profile store for local play only.');
      console.warn(error);
      return new MemoryProfileStore();
    }
    throw error;
  }
}

const store = await createStore();
const roomManager = new RoomManager(store);
roomManager.start();

const server = http.createServer(async (request, response) => {
  setCors(response);

  if (request.method === 'OPTIONS') {
    response.writeHead(204);
    response.end();
    return;
  }

  if (request.url === '/api/health') {
    sendJson(response, 200, {
      ok: true,
      roomId: roomManager.room.id,
      players: roomManager.room.players.size,
    });
    return;
  }

  if (request.url === '/api/guest' && request.method === 'POST') {
    const body = await readJson<{ token?: string; name?: string }>(request);
    const profileResult = await store.getOrCreateGuest(body.token, body.name ?? 'Pilot');
    sendJson(response, 200, profileResult);
    return;
  }

  sendJson(response, 404, { error: 'Not found.' });
});

const wss = new WebSocketServer({ noServer: true });

server.on('upgrade', (request, socket, head) => {
  if (!request.url?.startsWith('/ws')) {
    socket.destroy();
    return;
  }

  wss.handleUpgrade(request, socket, head, (ws) => {
    wss.emit('connection', ws, request);
  });
});

wss.on('connection', (socket) => {
  socket.on('message', (message) => {
    void roomManager.handleMessage(socket, message.toString()).catch((error) => {
      console.error(error);
      if (socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type: 'error', message: 'Server failed to process message.' }));
      }
    });
  });
  socket.on('close', () => roomManager.disconnect(socket));
});

server.listen(port, () => {
  console.log(`Tankio2 server listening on http://localhost:${port}`);
  console.log(`Allowed client origin: ${clientOrigin}`);
});

async function shutdown(): Promise<void> {
  roomManager.stop();
  wss.close();
  server.close();
  await store.close();
}

process.on('SIGINT', () => {
  void shutdown().finally(() => process.exit(0));
});

process.on('SIGTERM', () => {
  void shutdown().finally(() => process.exit(0));
});

function setCors(response: http.ServerResponse): void {
  response.setHeader('Access-Control-Allow-Origin', clientOrigin);
  response.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  response.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

function sendJson(response: http.ServerResponse, status: number, data: unknown): void {
  response.writeHead(status, { 'Content-Type': 'application/json' });
  response.end(JSON.stringify(data));
}

async function readJson<T>(request: http.IncomingMessage): Promise<T> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  if (chunks.length === 0) return {} as T;
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as T;
}
