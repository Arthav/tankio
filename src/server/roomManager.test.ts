import type { WebSocket } from 'ws';
import { describe, expect, it } from 'vitest';
import { MemoryProfileStore } from './profiles';
import { RoomManager } from './roomManager';

describe('RoomManager', () => {
  it('rejects malformed gameplay messages before they reach simulation', async () => {
    const manager = new RoomManager(new MemoryProfileStore());
    const socket = new FakeSocket();

    await manager.handleMessage(socket.asWebSocket(), JSON.stringify({ type: 'input', input: { moveX: Number.NaN } }));

    expect(socket.messages()).toContainEqual({
      type: 'error',
      message: 'Input message has an invalid payload.',
    });
  });

  it('keeps online and bot-practice arenas separated', async () => {
    const manager = new RoomManager(new MemoryProfileStore());
    const onlineSocket = new FakeSocket();
    const botSocket = new FakeSocket();

    await manager.handleMessage(onlineSocket.asWebSocket(), JSON.stringify({ type: 'join', name: 'Online', mode: 'online' }));
    await manager.handleMessage(botSocket.asWebSocket(), JSON.stringify({ type: 'join', name: 'Practice', mode: 'bots' }));

    expect(onlineSocket.messages().find((message) => message.type === 'welcome')).toMatchObject({ roomId: 'ffa-main' });
    expect(botSocket.messages().find((message) => message.type === 'welcome')).toMatchObject({ roomId: 'bot-practice' });
    expect(manager.getRoomSummaries()).toEqual(
      expect.arrayContaining([
        { id: 'ffa-main', players: 13, humans: 1, bots: 12 },
        { id: 'bot-practice', players: 19, humans: 1, bots: 18 },
      ]),
    );
  });
});

class FakeSocket {
  readonly OPEN = 1;
  readyState = this.OPEN;
  private readonly sent: string[] = [];

  send(message: string): void {
    this.sent.push(message);
  }

  close(): void {
    this.readyState = 3;
  }

  messages(): Array<Record<string, unknown>> {
    return this.sent.map((message) => JSON.parse(message) as Record<string, unknown>);
  }

  asWebSocket(): WebSocket {
    return this as unknown as WebSocket;
  }
}
