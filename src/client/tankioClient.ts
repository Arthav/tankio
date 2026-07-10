import type { ClientInputPayload, GameSnapshot, ProfileDto, ServerMessage } from '../shared/protocol';
import type { StatKey } from '../shared/tankTypes';
import { clamp01 } from './math';
import { interpolateSnapshots } from './snapshotInterpolation';

export const SERVER_HTTP = import.meta.env.VITE_SERVER_URL ?? `http://${location.hostname}:3001`;
export const SERVER_WS = SERVER_HTTP.replace(/^http/, 'ws');
export const TOKEN_KEY = 'tankio2.guestToken';

const INTERPOLATION_DELAY_MS = 100;
const MAX_SNAPSHOT_HISTORY = 8;

interface TimedSnapshot {
  snapshot: GameSnapshot;
  receivedAt: number;
}

export interface GuestSession {
  profile: ProfileDto;
  token: string;
}

export class TankioClient {
  snapshot?: GameSnapshot;
  profile?: ProfileDto;
  token?: string;
  connected = false;
  joined = false;
  private socket?: WebSocket;
  private connectionId = 0;
  private readonly snapshotHistory: TimedSnapshot[] = [];

  async hydrateSavedProfile(name: string): Promise<GuestSession | undefined> {
    const existingToken = localStorage.getItem(TOKEN_KEY) ?? undefined;
    if (!existingToken) return undefined;
    return this.requestGuestProfile(name, existingToken);
  }

  async ensureGuestProfile(name: string): Promise<GuestSession> {
    const existingToken = localStorage.getItem(TOKEN_KEY) ?? undefined;
    return this.requestGuestProfile(name, existingToken);
  }

  async connect(name: string, mode: 'online' | 'bots'): Promise<void> {
    const guest = await this.ensureGuestProfile(name);
    this.disconnect();
    const connectionId = this.connectionId;
    this.joined = false;

    await new Promise<void>((resolve, reject) => {
      const socket = new WebSocket(`${SERVER_WS}/ws`);
      this.socket = socket;
      socket.addEventListener('open', () => {
        if (!this.isCurrentSocket(socket, connectionId)) return;
        this.connected = true;
        this.send({ type: 'join', token: guest.token, name, mode });
        resolve();
      });
      socket.addEventListener('message', (event) => {
        if (this.isCurrentSocket(socket, connectionId)) this.handleMessage(event.data.toString());
      });
      socket.addEventListener('close', () => {
        if (!this.isCurrentSocket(socket, connectionId)) return;
        this.connected = false;
        this.joined = false;
        this.socket = undefined;
      });
      socket.addEventListener('error', () => {
        if (this.isCurrentSocket(socket, connectionId)) reject(new Error('WebSocket connection failed.'));
      });
    });
  }

  disconnect(): void {
    const socket = this.socket;
    this.connectionId += 1;
    this.socket = undefined;
    this.connected = false;
    this.joined = false;
    this.snapshot = undefined;
    this.snapshotHistory.length = 0;

    if (socket && (socket.readyState === WebSocket.CONNECTING || socket.readyState === WebSocket.OPEN)) {
      socket.close(1000, 'Return to menu');
    }
  }

  send(message: object): void {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return;
    this.socket.send(JSON.stringify(message));
  }

  sendInput(input: ClientInputPayload): void {
    if (!this.joined || this.snapshot?.self.alive === false) return;
    this.send({ type: 'input', input });
  }

  retry(): void {
    if (!this.joined) return;
    this.send({ type: 'retry' });
  }

  upgradeStat(stat: StatKey): void {
    this.send({ type: 'upgradeStat', stat });
  }

  upgradeTank(tankId: string): void {
    this.send({ type: 'upgradeTank', tankId });
  }

  getRenderSnapshot(now = performance.now()): GameSnapshot | undefined {
    if (this.snapshotHistory.length < 2) return this.snapshot;

    const targetTime = now - INTERPOLATION_DELAY_MS;
    let previous = this.snapshotHistory[0];
    let next = this.snapshotHistory[this.snapshotHistory.length - 1];

    for (let index = 0; index < this.snapshotHistory.length - 1; index += 1) {
      const left = this.snapshotHistory[index];
      const right = this.snapshotHistory[index + 1];
      if (left.receivedAt <= targetTime && targetTime <= right.receivedAt) {
        previous = left;
        next = right;
        break;
      }
    }

    if (targetTime <= this.snapshotHistory[0].receivedAt) {
      return this.snapshotHistory[0].snapshot;
    }

    if (targetTime >= next.receivedAt) {
      return next.snapshot;
    }

    const alpha = clamp01((targetTime - previous.receivedAt) / Math.max(1, next.receivedAt - previous.receivedAt));
    return interpolateSnapshots(previous.snapshot, next.snapshot, alpha);
  }

  private handleMessage(raw: string): void {
    const message = JSON.parse(raw) as ServerMessage;
    if (message.type === 'snapshot') {
      this.snapshot = message;
      this.snapshotHistory.push({ snapshot: message, receivedAt: performance.now() });
      if (this.snapshotHistory.length > MAX_SNAPSHOT_HISTORY) this.snapshotHistory.shift();
      return;
    }
    if (message.type === 'welcome' || message.type === 'profile') {
      if (message.type === 'welcome') this.joined = true;
      this.profile = message.profile;
      this.token = message.token;
      localStorage.setItem(TOKEN_KEY, message.token);
      return;
    }
    if (message.type === 'error') {
      console.error(message.message);
    }
  }

  private isCurrentSocket(socket: WebSocket, connectionId: number): boolean {
    return this.socket === socket && this.connectionId === connectionId;
  }

  private async requestGuestProfile(name: string, token?: string): Promise<GuestSession> {
    const response = await fetch(`${SERVER_HTTP}/api/guest`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, name }),
    });
    if (!response.ok) throw new Error(`Guest profile request failed with ${response.status}.`);
    const guest = (await response.json()) as GuestSession;
    this.profile = guest.profile;
    this.token = guest.token;
    localStorage.setItem(TOKEN_KEY, guest.token);
    return guest;
  }
}
