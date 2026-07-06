import { WebSocket } from 'ws';
import {
  addPlayer,
  createRoom,
  removePlayer,
  setPlayerInput,
  snapshotForPlayer,
  summarizePlayer,
  updateRoom,
  upgradePlayerStat,
  upgradePlayerTank,
  type GameRoom,
  type MatchPlayer,
} from '../shared/simulation';
import type { ClientMessage, ProfileDto, ServerMessage } from '../shared/protocol';
import type { StatKey } from '../shared/tankTypes';
import type { ProfileStore } from './profiles';

interface ClientConnection {
  socket: WebSocket;
  playerId: string;
  token: string;
  profile: ProfileDto;
}

const BOT_NAMES = [
  'Vector',
  'Latch',
  'Prism',
  'Cobalt',
  'Drift',
  'Volt',
  'Spindle',
  'Kite',
  'Axis',
  'Nova',
  'Quill',
  'Patch',
  'Rivet',
  'Warden',
  'Trace',
  'Mica',
  'Fuse',
  'Glint',
];

export class RoomManager {
  readonly room: GameRoom;
  private readonly clients = new Map<WebSocket, ClientConnection>();
  private readonly playerSockets = new Map<string, WebSocket>();
  private tickHandle?: NodeJS.Timeout;
  private snapshotHandle?: NodeJS.Timeout;
  private botIndex = 0;
  private botTarget = 12;

  constructor(private readonly store: ProfileStore) {
    this.room = createRoom('ffa-main');
  }

  start(): void {
    if (this.tickHandle) return;
    this.tickHandle = setInterval(() => {
      const deaths = updateRoom(this.room, 1000 / 30);
      for (const death of deaths) {
        if (death.victimProfileId) {
          void this.store.recordMatch({
            profileId: death.victimProfileId,
            roomId: this.room.id,
            finalScore: death.score,
            xpEarned: death.xpEarned,
            kills: death.kills,
            deaths: death.deaths,
            bestTankId: death.victimTankId,
            durationSeconds: death.durationSeconds,
          });
        }
      }
      this.ensureBots();
    }, 1000 / 30);

    this.snapshotHandle = setInterval(() => {
      for (const client of this.clients.values()) {
        this.send(client.socket, snapshotForPlayer(this.room, client.playerId));
      }
    }, 1000 / 20);
  }

  stop(): void {
    if (this.tickHandle) clearInterval(this.tickHandle);
    if (this.snapshotHandle) clearInterval(this.snapshotHandle);
  }

  async handleMessage(socket: WebSocket, rawMessage: string): Promise<void> {
    let message: ClientMessage;
    try {
      message = JSON.parse(rawMessage) as ClientMessage;
    } catch {
      this.send(socket, { type: 'error', message: 'Invalid message JSON.' });
      return;
    }

    if (message.type === 'join') {
      const profileResult = await this.store.getOrCreateGuest(message.token, message.name);
      const playerId = `u-${profileResult.profile.id}`;
      const existingSocket = this.playerSockets.get(playerId);
      if (existingSocket && existingSocket !== socket) {
        existingSocket.close(4000, 'Profile connected elsewhere.');
        this.disconnect(existingSocket);
      }
      const player = addPlayer(this.room, {
        id: playerId,
        profileId: profileResult.profile.id,
        name: profileResult.profile.displayName,
        color: profileResult.profile.bodyColor,
      });
      this.clients.set(socket, {
        socket,
        playerId: player.id,
        token: profileResult.token,
        profile: profileResult.profile,
      });
      this.playerSockets.set(player.id, socket);
      this.send(socket, {
        type: 'welcome',
        playerId: player.id,
        roomId: this.room.id,
        profile: profileResult.profile,
        token: profileResult.token,
      });
      this.botTarget = Math.max(this.botTarget, message.mode === 'bots' ? 18 : 12);
      this.ensureBots();
      return;
    }

    const client = this.clients.get(socket);
    if (!client) {
      this.send(socket, { type: 'error', message: 'Join before sending gameplay input.' });
      return;
    }

    if (message.type === 'input') {
      setPlayerInput(this.room, client.playerId, message.input);
      return;
    }

    if (message.type === 'upgradeStat') {
      upgradePlayerStat(this.room, client.playerId, message.stat as StatKey);
      return;
    }

    if (message.type === 'upgradeTank') {
      upgradePlayerTank(this.room, client.playerId, message.tankId);
    }
  }

  disconnect(socket: WebSocket): void {
    const client = this.clients.get(socket);
    if (!client) return;
    const player = removePlayer(this.room, client.playerId);
    if (player) this.persistDisconnect(player);
    this.clients.delete(socket);
    this.playerSockets.delete(client.playerId);
  }

  private persistDisconnect(player: MatchPlayer): void {
    if (!player.profileId) return;
    const summary = summarizePlayer(player, this.room);
    void this.store.recordMatch({
      profileId: player.profileId,
      roomId: this.room.id,
      finalScore: summary.score,
      xpEarned: summary.xpEarned,
      kills: summary.kills,
      deaths: summary.deaths,
      bestTankId: summary.victimTankId,
      durationSeconds: summary.durationSeconds,
    });
  }

  private ensureBots(): void {
    const humanCount = [...this.room.players.values()].filter((player) => !player.bot).length;
    const botCount = [...this.room.players.values()].filter((player) => player.bot).length;
    const desiredBots = humanCount === 0 ? 0 : Math.max(0, Math.min(this.botTarget, 24 - humanCount));
    if (botCount < desiredBots) {
      for (let index = botCount; index < desiredBots; index += 1) {
        this.addBot();
      }
    }
    if (botCount > desiredBots) {
      const extras = [...this.room.players.values()].filter((player) => player.bot).slice(0, botCount - desiredBots);
      for (const bot of extras) removePlayer(this.room, bot.id);
    }
  }

  private addBot(): void {
    const name = BOT_NAMES[this.botIndex % BOT_NAMES.length];
    this.botIndex += 1;
    addPlayer(this.room, {
      id: `b-${this.botIndex}`,
      name,
      bot: true,
      color: '#ff6b7a',
    });
  }

  private send(socket: WebSocket, message: ServerMessage): void {
    if (socket.readyState !== socket.OPEN) return;
    socket.send(JSON.stringify(message));
  }
}
