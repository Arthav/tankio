import { WebSocket } from 'ws';
import {
  addPlayer,
  createRoom,
  removePlayer,
  retryPlayer,
  setPlayerInput,
  snapshotForPlayer,
  summarizePlayer,
  updateRoom,
  upgradePlayerStat,
  upgradePlayerTank,
  type GameRoom,
  type MatchPlayer,
} from '../shared/simulation';
import type { ProfileDto, ServerMessage } from '../shared/protocol';
import { validateClientMessage } from '../shared/protocolValidation';
import type { ProfileStore } from './profiles';

interface ClientConnection {
  socket: WebSocket;
  room: GameRoom;
  playerId: string;
  token: string;
  profile: ProfileDto;
  mode: 'online' | 'bots';
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
  private readonly botRoom: GameRoom;
  private readonly rooms: GameRoom[];
  private readonly clients = new Map<WebSocket, ClientConnection>();
  private readonly playerSockets = new Map<string, WebSocket>();
  private tickHandle?: NodeJS.Timeout;
  private snapshotHandle?: NodeJS.Timeout;
  private botIndex = 0;

  constructor(private readonly store: ProfileStore) {
    this.room = createRoom('ffa-main');
    this.botRoom = createRoom('bot-practice');
    this.rooms = [this.room, this.botRoom];
  }

  start(): void {
    if (this.tickHandle) return;
    this.tickHandle = setInterval(() => {
      for (const room of this.rooms) {
        const deaths = updateRoom(room, 1000 / 30);
        for (const death of deaths) {
          if (death.victimProfileId) {
            void this.store.recordMatch({
              profileId: death.victimProfileId,
              roomId: room.id,
              finalScore: death.score,
              xpEarned: death.xpEarned,
              kills: death.kills,
              deaths: death.deaths,
              bestTankId: death.victimTankId,
              durationSeconds: death.durationSeconds,
            });
          }
        }
      }
      this.ensureBots(this.room, 12);
      this.ensureBots(this.botRoom, 18);
    }, 1000 / 30);

    this.snapshotHandle = setInterval(() => {
      for (const client of this.clients.values()) {
        this.send(client.socket, snapshotForPlayer(client.room, client.playerId));
      }
    }, 1000 / 20);
  }

  stop(): void {
    if (this.tickHandle) clearInterval(this.tickHandle);
    if (this.snapshotHandle) clearInterval(this.snapshotHandle);
  }

  async handleMessage(socket: WebSocket, rawMessage: string): Promise<void> {
    let raw: unknown;
    try {
      raw = JSON.parse(rawMessage) as unknown;
    } catch {
      this.send(socket, { type: 'error', message: 'Invalid message JSON.' });
      return;
    }

    const validation = validateClientMessage(raw);
    if (!validation.message) {
      this.send(socket, { type: 'error', message: validation.reason ?? 'Invalid client message.' });
      return;
    }
    const message = validation.message;

    if (message.type === 'join') {
      const profileResult = await this.store.getOrCreateGuest(message.token, message.name);
      const playerId = `u-${profileResult.profile.id}`;
      const existingSocket = this.playerSockets.get(playerId);
      if (existingSocket && existingSocket !== socket) {
        existingSocket.close(4000, 'Profile connected elsewhere.');
        this.disconnect(existingSocket);
      }
      const room = this.roomForMode(message.mode);
      const player = addPlayer(room, {
        id: playerId,
        profileId: profileResult.profile.id,
        name: profileResult.profile.displayName,
        color: profileResult.profile.bodyColor,
      });
      this.clients.set(socket, {
        socket,
        room,
        playerId: player.id,
        token: profileResult.token,
        profile: profileResult.profile,
        mode: message.mode,
      });
      this.playerSockets.set(player.id, socket);
      this.send(socket, {
        type: 'welcome',
        playerId: player.id,
        roomId: room.id,
        profile: profileResult.profile,
        token: profileResult.token,
      });
      this.ensureBots(room, message.mode === 'bots' ? 18 : 12);
      return;
    }

    const client = this.clients.get(socket);
    if (!client) {
      this.send(socket, { type: 'error', message: 'Join before sending gameplay input.' });
      return;
    }

    if (message.type === 'input') {
      setPlayerInput(client.room, client.playerId, message.input);
      return;
    }

    if (message.type === 'retry') {
      retryPlayer(client.room, client.playerId);
      return;
    }

    if (message.type === 'upgradeStat') {
      upgradePlayerStat(client.room, client.playerId, message.stat);
      return;
    }

    if (message.type === 'upgradeTank') {
      upgradePlayerTank(client.room, client.playerId, message.tankId);
    }
  }

  disconnect(socket: WebSocket): void {
    const client = this.clients.get(socket);
    if (!client) return;
    const player = removePlayer(client.room, client.playerId);
    if (player?.alive) this.persistDisconnect(client.room, player);
    this.clients.delete(socket);
    this.playerSockets.delete(client.playerId);
  }

  getRoomSummaries(): Array<{ id: string; players: number; humans: number; bots: number }> {
    return this.rooms.map((room) => {
      const players = [...room.players.values()];
      return {
        id: room.id,
        players: players.length,
        humans: players.filter((player) => !player.bot).length,
        bots: players.filter((player) => player.bot).length,
      };
    });
  }

  private persistDisconnect(room: GameRoom, player: MatchPlayer): void {
    if (!player.profileId) return;
    const summary = summarizePlayer(player, room);
    void this.store.recordMatch({
      profileId: player.profileId,
      roomId: room.id,
      finalScore: summary.score,
      xpEarned: summary.xpEarned,
      kills: summary.kills,
      deaths: summary.deaths,
      bestTankId: summary.victimTankId,
      durationSeconds: summary.durationSeconds,
    });
  }

  private ensureBots(room: GameRoom, botTarget: number): void {
    const humanCount = [...room.players.values()].filter((player) => !player.bot).length;
    const botCount = [...room.players.values()].filter((player) => player.bot).length;
    const desiredBots = humanCount === 0 ? 0 : Math.max(0, Math.min(botTarget, 24 - humanCount));
    if (botCount < desiredBots) {
      for (let index = botCount; index < desiredBots; index += 1) {
        this.addBot(room);
      }
    }
    if (botCount > desiredBots) {
      const extras = [...room.players.values()].filter((player) => player.bot).slice(0, botCount - desiredBots);
      for (const bot of extras) removePlayer(room, bot.id);
    }
  }

  private addBot(room: GameRoom): void {
    const name = BOT_NAMES[this.botIndex % BOT_NAMES.length];
    this.botIndex += 1;
    addPlayer(room, {
      id: `b-${this.botIndex}`,
      name,
      bot: true,
      color: '#ff6b7a',
    });
  }

  private roomForMode(mode: 'online' | 'bots'): GameRoom {
    return mode === 'bots' ? this.botRoom : this.room;
  }

  private send(socket: WebSocket, message: ServerMessage): void {
    if (socket.readyState !== socket.OPEN) return;
    socket.send(JSON.stringify(message));
  }
}
