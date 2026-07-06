import Phaser from 'phaser';
import './styles.css';
import type {
  ClientInputPayload,
  GameSnapshot,
  LeaderboardEntry,
  ProfileDto,
  ServerMessage,
  SnapshotProjectile,
  SnapshotShape,
  SnapshotTank,
} from '../shared/protocol';
import { STAT_KEYS, type StatKey } from '../shared/tankTypes';
import { getTankClass, TANK_CLASSES, TANK_CLASSES_BY_ID } from '../shared/tanks';

const SERVER_HTTP = import.meta.env.VITE_SERVER_URL ?? `http://${location.hostname}:3001`;
const SERVER_WS = SERVER_HTTP.replace(/^http/, 'ws');
const TOKEN_KEY = 'tankio2.guestToken';
const INTERPOLATION_DELAY_MS = 100;
const MAX_SNAPSHOT_HISTORY = 8;
const ENABLE_RENDER_DIAGNOSTICS =
  new URLSearchParams(location.search).has('debugRender') || localStorage.getItem('tankio2.debugRender') === '1';

interface TimedSnapshot {
  snapshot: GameSnapshot;
  receivedAt: number;
}

interface ClientInputState {
  autoFire: boolean;
  autoSpin: boolean;
}

interface GuestSession {
  profile: ProfileDto;
  token: string;
}

const CUSTOM_BRANCH_UNLOCK_XP = 8000;
const STARTER_PATHS = TANK_CLASSES.filter((tankClass) => tankClass.unlockLevel === 15 && tankClass.parents.includes('basic'));
const ACHIEVEMENT_LABELS: Record<string, string> = {
  first_destroy: 'First Destroy',
  first_upgrade: 'First Upgrade',
  score_2500: 'Score 2.5k',
  deep_run: 'Deep Run',
};

class TankioClient {
  snapshot?: GameSnapshot;
  profile?: ProfileDto;
  token?: string;
  connected = false;
  joined = false;
  private socket?: WebSocket;
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
    this.joined = false;

    await new Promise<void>((resolve, reject) => {
      const socket = new WebSocket(`${SERVER_WS}/ws`);
      this.socket = socket;
      socket.addEventListener('open', () => {
        this.connected = true;
        this.send({ type: 'join', token: guest.token, name, mode });
        resolve();
      });
      socket.addEventListener('message', (event) => this.handleMessage(event.data.toString()));
      socket.addEventListener('close', () => {
        this.connected = false;
      });
      socket.addEventListener('error', () => reject(new Error('WebSocket connection failed.')));
    });
  }

  send(message: object): void {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return;
    this.socket.send(JSON.stringify(message));
  }

  sendInput(input: ClientInputPayload): void {
    if (!this.joined) return;
    this.send({ type: 'input', input });
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

class HudController {
  private readonly menu: HTMLDivElement;
  private readonly hud: HTMLDivElement;
  private readonly nameInput: HTMLInputElement;
  private readonly joinButtons: HTMLButtonElement[];
  private readonly profileStrip: HTMLDivElement;
  private readonly profileName: HTMLElement;
  private readonly menuStatus: HTMLDivElement;
  private readonly branchValue: HTMLElement;
  private readonly branchFill: HTMLDivElement;
  private readonly badgeList: HTMLDivElement;
  private readonly status: HTMLDivElement;
  private readonly stats: HTMLDivElement;
  private readonly upgrades: HTMLDivElement;
  private readonly leaderboard: HTMLDivElement;
  private readonly death: HTMLDivElement;
  private readonly combatPanel: HTMLDivElement;
  private readonly autoFireButton: HTMLButtonElement;
  private readonly autoFireState: HTMLElement;
  private readonly className: HTMLDivElement;
  private readonly score: HTMLDivElement;
  private readonly level: HTMLDivElement;
  private readonly healthFill: HTMLDivElement;
  private readonly deathTimer: HTMLSpanElement;
  private lastProfileKey = '';
  private lastStatusKey = '';
  private lastStatsKey = '';
  private lastUpgradesKey = '';
  private lastLeaderboardKey = '';
  private lastDeathKey = '';
  private lastAutoFire?: boolean;

  constructor(
    private readonly client: TankioClient,
    private readonly inputState: ClientInputState,
  ) {
    const root = document.querySelector<HTMLDivElement>('#ui-root');
    if (!root) throw new Error('Missing #ui-root');
    root.innerHTML = `
      <div class="shell">
        <section class="menu start-lobby" aria-label="Tankio2 start lobby">
          <div class="lobby-grid">
            <aside class="play-dock lobby-panel">
              <div class="brand">
                <div class="brand-mark"></div>
                <div>
                  <p class="brand-kicker">FFA arena</p>
                  <h1>Tankio2</h1>
                </div>
              </div>
              <div class="field">
                <label for="pilot-name">Pilot</label>
                <input id="pilot-name" maxlength="18" value="Pilot" autocomplete="off" />
              </div>
              <div class="menu-actions">
                <button class="primary join-button" data-join="online" type="button">
                  <span>Online Arena</span>
                  <b>FFA room</b>
                </button>
                <button class="secondary join-button" data-join="bots" type="button">
                  <span>Bot Arena</span>
                  <b>Practice run</b>
                </button>
              </div>
              <div class="menu-status" role="status">Ready</div>
              <div class="quick-controls" aria-label="Combat controls">
                <span>WASD</span>
                <span>Mouse</span>
                <span>E Auto</span>
                <span>C Spin</span>
              </div>
            </aside>
            <section class="arena-showcase lobby-panel" aria-label="Tank routes">
              <div class="panel-heading">
                <span>Tank Routes</span>
                <strong>${TANK_CLASSES.length} classes</strong>
              </div>
              <div class="tank-hero" aria-hidden="true">
                <div class="preview-tank preview-tank--main">
                  <span class="preview-barrel"></span>
                  <span class="preview-body"></span>
                </div>
                <div class="preview-tank preview-tank--left">
                  <span class="preview-barrel"></span>
                  <span class="preview-body"></span>
                </div>
                <div class="preview-tank preview-tank--right">
                  <span class="preview-barrel"></span>
                  <span class="preview-body"></span>
                </div>
              </div>
              <div class="upgrade-track">${renderUpgradeMilestones()}</div>
              <div class="starter-paths">${renderStarterPaths()}</div>
            </section>
            <aside class="progress-panel lobby-panel" aria-label="Saved profile">
              <div class="panel-heading">
                <span>Profile</span>
                <strong data-profile-name>Guest pilot</strong>
              </div>
              <div class="profile-strip"></div>
              <div class="branch-meter">
                <div>
                  <span>Custom branch</span>
                  <strong data-branch-value>0 / ${CUSTOM_BRANCH_UNLOCK_XP.toLocaleString()} XP</strong>
                </div>
                <div class="meter"><div data-branch-fill></div></div>
              </div>
              <div class="badge-list"></div>
              <div class="tank-system">${renderTankSummary()}</div>
            </aside>
          </div>
        </section>
        <section class="hud">
          <div class="status">
            <div class="status-top">
              <div>
                <div class="class-name"></div>
                <div class="score-line"></div>
              </div>
              <div class="level-pill"></div>
            </div>
            <div class="bar"><div class="bar-fill"></div></div>
          </div>
          <div class="leaderboard"></div>
          <div class="combat-panel">
            <button class="toggle-button" type="button" data-auto-fire aria-pressed="false">
              <span>Auto Shoot</span>
              <b>Off</b>
            </button>
          </div>
          <div class="stat-panel"></div>
          <div class="upgrade-panel"></div>
          <div class="death"><strong>Rebuilding</strong><span></span></div>
        </section>
      </div>
    `;

    this.menu = root.querySelector('.menu') as HTMLDivElement;
    this.hud = root.querySelector('.hud') as HTMLDivElement;
    this.nameInput = root.querySelector('#pilot-name') as HTMLInputElement;
    this.joinButtons = [...root.querySelectorAll<HTMLButtonElement>('[data-join]')];
    this.profileStrip = root.querySelector('.profile-strip') as HTMLDivElement;
    this.profileName = root.querySelector('[data-profile-name]') as HTMLElement;
    this.menuStatus = root.querySelector('.menu-status') as HTMLDivElement;
    this.branchValue = root.querySelector('[data-branch-value]') as HTMLElement;
    this.branchFill = root.querySelector('[data-branch-fill]') as HTMLDivElement;
    this.badgeList = root.querySelector('.badge-list') as HTMLDivElement;
    this.status = root.querySelector('.status') as HTMLDivElement;
    this.stats = root.querySelector('.stat-panel') as HTMLDivElement;
    this.upgrades = root.querySelector('.upgrade-panel') as HTMLDivElement;
    this.leaderboard = root.querySelector('.leaderboard') as HTMLDivElement;
    this.death = root.querySelector('.death') as HTMLDivElement;
    this.combatPanel = root.querySelector('.combat-panel') as HTMLDivElement;
    this.autoFireButton = this.combatPanel.querySelector('[data-auto-fire]') as HTMLButtonElement;
    this.autoFireState = this.autoFireButton.querySelector('b') as HTMLElement;
    this.className = this.status.querySelector('.class-name') as HTMLDivElement;
    this.score = this.status.querySelector('.score-line') as HTMLDivElement;
    this.level = this.status.querySelector('.level-pill') as HTMLDivElement;
    this.healthFill = this.status.querySelector('.bar-fill') as HTMLDivElement;
    this.deathTimer = this.death.querySelector('span') as HTMLSpanElement;

    this.joinButtons.forEach((button) => {
      button.addEventListener('click', () => {
        const mode = button.dataset.join === 'bots' ? 'bots' : 'online';
        void this.join(mode);
      });
    });

    this.autoFireButton.addEventListener('click', () => {
      this.inputState.autoFire = !this.inputState.autoFire;
      this.renderCombatControls();
    });

    this.stats.addEventListener('click', (event) => {
      const button = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-stat]');
      if (!button || button.disabled) return;
      this.client.upgradeStat(button.dataset.stat as StatKey);
    });

    this.upgrades.addEventListener('click', (event) => {
      const button = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-tank]');
      if (!button) return;
      this.client.upgradeTank(button.dataset.tank ?? 'basic');
    });

    this.renderProfile();
    void this.hydrateSavedProfile();
  }

  update(): void {
    this.renderProfile();
    this.renderCombatControls();
    const snapshot = this.client.snapshot;
    if (!snapshot) return;
    const self = snapshot.self;
    const tankClass = getTankClass(self.tankId);
    const player = snapshot.players.find((candidate) => candidate.id === snapshot.selfId);
    const healthRatio = player ? Math.max(0, player.health / player.maxHealth) : 0;
    const healthPercent = Math.round(healthRatio * 100);

    const statusKey = `${tankClass.displayName}|${self.level}|${self.score}|${healthPercent}`;
    if (statusKey !== this.lastStatusKey) {
      this.className.textContent = tankClass.displayName;
      this.score.textContent = `${self.score.toLocaleString()} score`;
      this.level.textContent = `LV ${self.level}`;
      this.healthFill.style.width = `${healthPercent}%`;
      this.lastStatusKey = statusKey;
    }

    const statsKey = `${STAT_KEYS.map((stat) => `${stat}:${self.stats[stat]}`).join('|')}|points:${self.availableStatPoints}`;
    if (statsKey !== this.lastStatsKey) {
      this.stats.innerHTML = STAT_KEYS.map((stat) => {
        const label = statLabels[stat];
        const value = self.stats[stat];
        const disabled = self.availableStatPoints <= 0 ? 'disabled' : '';
        return `<button class="stat-button" data-stat="${stat}" ${disabled}><b>${label}</b><span>${value} / +</span></button>`;
      }).join('');
      this.lastStatsKey = statsKey;
    }

    const upgradeKey = self.upgradeOptions.join('|');
    if (upgradeKey !== this.lastUpgradesKey) {
      this.upgrades.innerHTML = self.upgradeOptions
        .map((tankId) => {
          const option = TANK_CLASSES_BY_ID[tankId];
          return `<button class="upgrade-button" data-tank="${tankId}">${escapeHtml(option.displayName)}</button>`;
        })
        .join('');
      this.lastUpgradesKey = upgradeKey;
    }

    const leaderboardKey = snapshot.leaderboard.map((entry) => `${entry.id}:${entry.score}:${entry.level}:${entry.tankId}`).join('|');
    if (leaderboardKey !== this.lastLeaderboardKey) {
      this.leaderboard.innerHTML = `
        <h2>Leaderboard</h2>
        ${snapshot.leaderboard.map((entry, index) => renderLeaderboardRow(entry, index)).join('')}
      `;
      this.lastLeaderboardKey = leaderboardKey;
    }

    const respawnSeconds = Math.ceil(self.respawnMs / 1000);
    const deathKey = `${self.alive}|${respawnSeconds}`;
    if (deathKey !== this.lastDeathKey) {
      this.death.classList.toggle('visible', !self.alive);
      this.deathTimer.textContent = `${respawnSeconds}s`;
      this.lastDeathKey = deathKey;
    }
  }

  private renderProfile(): void {
    const profile = this.client.profile;
    const achievements = profile?.achievements ?? [];
    const branches = profile?.customBranchUnlocks ?? [];
    const profileXp = profile?.profileXp ?? 0;
    const branchProgress = clamp01(profileXp / CUSTOM_BRANCH_UNLOCK_XP);
    const profileKey = `${profile?.displayName ?? 'Guest pilot'}|${profileXp}|${achievements.join(',')}|${branches.join(',')}`;
    if (profileKey === this.lastProfileKey) return;
    this.profileName.textContent = profile?.displayName ?? 'Guest pilot';
    this.profileStrip.innerHTML = `
      <div class="profile-chip"><span>Profile XP</span><strong>${profileXp.toLocaleString()}</strong></div>
      <div class="profile-chip"><span>Badges</span><strong>${achievements.length}</strong></div>
      <div class="profile-chip"><span>Branches</span><strong>${branches.length}</strong></div>
    `;
    this.branchValue.textContent =
      branches.length > 0 ? 'Unlocked' : `${Math.min(profileXp, CUSTOM_BRANCH_UNLOCK_XP).toLocaleString()} / ${CUSTOM_BRANCH_UNLOCK_XP.toLocaleString()} XP`;
    this.branchFill.style.width = `${Math.round(branchProgress * 100)}%`;
    this.badgeList.innerHTML = renderAchievementBadges(achievements);
    this.lastProfileKey = profileKey;
  }

  private async hydrateSavedProfile(): Promise<void> {
    if (!localStorage.getItem(TOKEN_KEY)) {
      this.renderProfile();
      return;
    }
    this.setMenuBusy(true, 'Loading saved profile');
    try {
      await this.client.hydrateSavedProfile(this.nameInput.value);
      this.renderProfile();
      this.setMenuStatus('Saved profile loaded');
    } catch (error) {
      console.error(error);
      this.setMenuStatus('Saved profile unavailable');
    } finally {
      this.setMenuBusy(false);
    }
  }

  private async join(mode: 'online' | 'bots'): Promise<void> {
    this.setMenuBusy(true, mode === 'bots' ? 'Starting bot arena' : 'Joining online arena');
    try {
      await this.client.connect(this.nameInput.value, mode);
      this.menu.classList.add('hidden');
      this.hud.classList.add('visible');
    } catch (error) {
      console.error(error);
      this.setMenuStatus('Connection failed');
      this.setMenuBusy(false);
    }
  }

  private setMenuBusy(isBusy: boolean, status?: string): void {
    this.menu.classList.toggle('is-loading', isBusy);
    for (const button of this.joinButtons) {
      button.disabled = isBusy;
    }
    if (status) this.setMenuStatus(status);
  }

  private setMenuStatus(status: string): void {
    this.menuStatus.textContent = status;
  }

  private renderCombatControls(): void {
    if (this.inputState.autoFire === this.lastAutoFire) return;
    this.autoFireButton.classList.toggle('active', this.inputState.autoFire);
    this.autoFireButton.setAttribute('aria-pressed', String(this.inputState.autoFire));
    this.autoFireState.textContent = this.inputState.autoFire ? 'On' : 'Off';
    this.lastAutoFire = this.inputState.autoFire;
  }
}

class ArenaScene extends Phaser.Scene {
  private graphics!: Phaser.GameObjects.Graphics;
  private cursors!: Record<string, Phaser.Input.Keyboard.Key>;
  private lastInputSent = 0;
  private fire = false;
  private altFire = false;
  private readonly nameLabels: Phaser.GameObjects.Text[] = [];
  private activeNameLabelIndex = 0;
  private diagnosticsElement?: HTMLDivElement;
  private readonly frameDeltas: number[] = [];
  private lastDiagnosticsUpdate = 0;

  constructor(
    private readonly client: TankioClient,
    private readonly hud: HudController,
    private readonly inputState: ClientInputState,
  ) {
    super('arena');
  }

  create(): void {
    this.graphics = this.add.graphics();
    this.cursors = this.input.keyboard!.addKeys('W,A,S,D,UP,DOWN,LEFT,RIGHT,E,C') as Record<string, Phaser.Input.Keyboard.Key>;
    this.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      if (pointer.rightButtonDown()) this.altFire = true;
      else this.fire = true;
    });
    this.input.on('pointerup', (pointer: Phaser.Input.Pointer) => {
      if (pointer.button === 2) this.altFire = false;
      else this.fire = false;
    });
    this.input.mouse?.disableContextMenu();
    this.cursors.E.on('down', () => {
      this.inputState.autoFire = !this.inputState.autoFire;
    });
    this.cursors.C.on('down', () => {
      this.inputState.autoSpin = !this.inputState.autoSpin;
    });

    if (ENABLE_RENDER_DIAGNOSTICS) {
      this.diagnosticsElement = document.createElement('div');
      this.diagnosticsElement.className = 'diagnostics';
      document.querySelector('#ui-root')?.appendChild(this.diagnosticsElement);
    }
  }

  override update(time: number, delta: number): void {
    this.updateDiagnostics(delta);
    this.hud.update();
    if (!this.client.joined) {
      this.renderMenuBackdrop(time);
      return;
    }
    this.renderWorld();
    if (time - this.lastInputSent > 33) {
      this.lastInputSent = time;
      this.client.sendInput(this.buildInput());
    }
  }

  private buildInput(): ClientInputPayload {
    const snapshot = this.client.getRenderSnapshot();
    const self = snapshot?.players.find((player) => player.id === snapshot.selfId);
    const camera = self ?? { x: 2100, y: 2100 };
    const aim = this.getPointerAim(camera.x, camera.y, camera.x, camera.y);
    const moveX = keyDown(this.cursors.D) || keyDown(this.cursors.RIGHT) ? 1 : keyDown(this.cursors.A) || keyDown(this.cursors.LEFT) ? -1 : 0;
    const moveY = keyDown(this.cursors.S) || keyDown(this.cursors.DOWN) ? 1 : keyDown(this.cursors.W) || keyDown(this.cursors.UP) ? -1 : 0;
    return {
      moveX,
      moveY,
      aimX: aim.x,
      aimY: aim.y,
      fire: this.fire,
      altFire: this.altFire,
      autoFire: this.inputState.autoFire,
      autoSpin: this.inputState.autoSpin,
    };
  }

  private renderMenuBackdrop(time: number): void {
    const width = this.scale.width;
    const height = this.scale.height;
    const t = time / 1000;
    this.activeNameLabelIndex = 0;
    this.graphics.clear();
    this.graphics.fillStyle(0x071015, 1);
    this.graphics.fillRect(0, 0, width, height);

    const spacing = 72;
    const offsetX = (t * 18) % spacing;
    const offsetY = (t * 10) % spacing;
    this.graphics.lineStyle(1, 0x18303a, 0.62);
    for (let x = -spacing + offsetX; x < width + spacing; x += spacing) this.graphics.lineBetween(x, 0, x, height);
    for (let y = -spacing + offsetY; y < height + spacing; y += spacing) this.graphics.lineBetween(0, y, width, y);

    this.graphics.lineStyle(2, 0x35d0ff, 0.1);
    for (let lane = 0; lane < 5; lane += 1) {
      const y = height * (0.18 + lane * 0.17) + Math.sin(t * 0.6 + lane) * 20;
      this.graphics.lineBetween(width * 0.1, y, width * 0.9, y - 90);
    }

    const shapeColors = [0xffe45c, 0xff6b7a, 0x5f8cff, 0x8f6bff];
    for (let index = 0; index < 18; index += 1) {
      const sides = index % 5 === 0 ? 5 : index % 3 === 0 ? 3 : 4;
      const x = ((index * 151 + t * (18 + index * 0.5)) % (width + 260)) - 130;
      const y = height * (0.12 + ((index * 37) % 74) / 100) + Math.sin(t * 0.9 + index) * 26;
      const radius = 11 + (index % 4) * 4;
      this.graphics.lineStyle(3, 0x101d24, 0.82);
      this.graphics.fillStyle(shapeColors[index % shapeColors.length], 0.68);
      this.drawRegularPolygon(x, y, radius, sides, t * 0.7 + index);
    }

    for (let index = 0; index < 10; index += 1) {
      const x = ((index * 173 + t * 260) % (width + 180)) - 90;
      const y = height * (0.22 + ((index * 11) % 54) / 100);
      const drift = Math.sin(t * 1.4 + index) * 18;
      this.graphics.lineStyle(3, index % 2 === 0 ? 0x35d0ff : 0xffe45c, 0.24);
      this.graphics.lineBetween(x, y + drift, x + 88, y + drift - 24);
      this.graphics.fillStyle(index % 2 === 0 ? 0x35d0ff : 0xffe45c, 0.82);
      this.graphics.fillCircle(x + 92, y + drift - 26, 4);
    }

    this.drawDemoTank(width * 0.48 + Math.sin(t * 0.7) * 24, height * 0.44, 31, 0x35d0ff, -0.18 + Math.sin(t) * 0.16, [0]);
    this.drawDemoTank(width * 0.64, height * 0.32 + Math.cos(t * 0.8) * 24, 22, 0xffe45c, Math.PI * 0.72, [-10, 10]);
    this.drawDemoTank(width * 0.58, height * 0.68 + Math.sin(t * 0.9) * 18, 25, 0xff6b7a, -Math.PI * 0.42, [-18, 0, 18]);
    this.drawDemoTank(width * 0.82, height * 0.58 + Math.cos(t) * 24, 22, 0x8f6bff, Math.PI, [0, 120, 240]);
    this.hideUnusedNameLabels();
  }

  private renderWorld(): void {
    const snapshot = this.client.getRenderSnapshot();
    const width = this.scale.width;
    const height = this.scale.height;
    this.activeNameLabelIndex = 0;
    this.graphics.clear();
    this.graphics.fillStyle(0x0b1116, 1);
    this.graphics.fillRect(0, 0, width, height);
    const self = snapshot?.players.find((player) => player.id === snapshot.selfId);
    const cameraX = self?.x ?? (snapshot ? snapshot.world.width / 2 : 2100);
    const cameraY = self?.y ?? (snapshot ? snapshot.world.height / 2 : 2100);
    const localAim = self ? this.getPointerAim(self.x, self.y, cameraX, cameraY).angle ?? self.aim : undefined;
    this.drawGrid(cameraX, cameraY);
    if (!snapshot) {
      this.hideUnusedNameLabels();
      return;
    }

    for (const shape of snapshot.shapes) {
      const point = this.worldToScreen(shape.x, shape.y, cameraX, cameraY);
      const color = shape.shape === 'square' ? 0xffe45c : shape.shape === 'triangle' ? 0xff6b7a : shape.shape === 'pentagon' ? 0x5f8cff : 0x8f6bff;
      this.graphics.lineStyle(4, 0x172530, 1);
      this.graphics.fillStyle(color, 0.94);
      if (shape.shape === 'square') {
        this.drawRegularPolygon(point.x, point.y, shape.radius, 4, shape.rotation + Math.PI / 4);
      } else if (shape.shape === 'triangle') {
        this.drawRegularPolygon(point.x, point.y, shape.radius, 3, shape.rotation);
      } else {
        this.drawRegularPolygon(point.x, point.y, shape.radius, 5, shape.rotation);
      }
    }

    for (const projectile of snapshot.projectiles) {
      const point = this.worldToScreen(projectile.x, projectile.y, cameraX, cameraY);
      this.graphics.fillStyle(parseColor(projectile.color), 0.95);
      this.graphics.lineStyle(2, 0x182832, 1);
      if (projectile.kind === 'trap') {
        this.drawRegularPolygon(point.x, point.y, projectile.radius, 3, -Math.PI / 2);
      } else if (projectile.kind === 'drone' || projectile.kind === 'minion') {
        this.drawRegularPolygon(point.x, point.y, projectile.radius, 4, Math.PI / 4);
      } else {
        this.graphics.fillCircle(point.x, point.y, projectile.radius);
        this.graphics.strokeCircle(point.x, point.y, projectile.radius);
      }
    }

    for (const player of snapshot.players) {
      if (player.invisible) continue;
      const isSelf = player.id === snapshot.selfId;
      this.drawTank(player, cameraX, cameraY, isSelf, isSelf ? localAim : undefined);
    }
    this.hideUnusedNameLabels();
  }

  private drawTank(player: SnapshotTank, cameraX: number, cameraY: number, isSelf: boolean, aimOverride?: number): void {
    const point = this.worldToScreen(player.x, player.y, cameraX, cameraY);
    const tankClass = getTankClass(player.tankId);
    const bodyColor = parseColor(player.color);
    const outline = isSelf ? 0xeefaff : 0x172530;
    const aim = aimOverride ?? player.aim;

    for (const weapon of tankClass.weaponLayout) {
      const angle = aim + Phaser.Math.DegToRad(weapon.angleDeg);
      const cx = point.x + Math.cos(angle) * (player.radius + weapon.length * 0.18);
      const cy = point.y + Math.sin(angle) * (player.radius + weapon.length * 0.18);
      this.graphics.save();
      this.graphics.translateCanvas(cx, cy);
      this.graphics.rotateCanvas(angle);
      this.graphics.fillStyle(0x52626b, 1);
      this.graphics.lineStyle(3, 0x24323a, 1);
      this.graphics.fillRoundedRect(0, -weapon.width / 2, weapon.length, weapon.width, 2);
      this.graphics.strokeRoundedRect(0, -weapon.width / 2, weapon.length, weapon.width, 2);
      this.graphics.restore();
    }

    this.graphics.fillStyle(bodyColor, 1);
    this.graphics.lineStyle(isSelf ? 5 : 4, outline, 1);
    if (tankClass.bodyShape === 'square') {
      this.drawRegularPolygon(point.x, point.y, player.radius, 4, Math.PI / 4);
    } else if (tankClass.bodyShape === 'spiked') {
      this.drawSpiked(point.x, point.y, player.radius);
    } else if (tankClass.bodyShape === 'hex') {
      this.drawRegularPolygon(point.x, point.y, player.radius, 6, aim);
    } else {
      this.graphics.fillCircle(point.x, point.y, player.radius);
      this.graphics.strokeCircle(point.x, point.y, player.radius);
    }

    const healthWidth = 54;
    this.graphics.fillStyle(0x111d24, 0.92);
    this.graphics.fillRect(point.x - healthWidth / 2, point.y + player.radius + 10, healthWidth, 6);
    this.graphics.fillStyle(isSelf ? 0x35d0ff : 0xff6b7a, 0.95);
    this.graphics.fillRect(point.x - healthWidth / 2, point.y + player.radius + 10, healthWidth * Math.max(0, player.health / player.maxHealth), 6);
    this.addNameLabel(point.x, point.y - player.radius - 20, player.name);
  }

  private addNameLabel(x: number, y: number, name: string): void {
    this.graphics.fillStyle(0x0b1116, 0.56);
    const width = Math.min(120, Math.max(42, name.length * 7 + 14));
    this.graphics.fillRoundedRect(x - width / 2, y - 9, width, 18, 6);

    let label = this.nameLabels[this.activeNameLabelIndex];
    if (!label) {
      label = this.add.text(0, 0, '', {
        fontFamily: 'Inter, Arial',
        fontSize: '11px',
        color: '#edf7ff',
      });
      label.setOrigin(0.5);
      label.setDepth(10);
      this.nameLabels.push(label);
    }
    label.setText(name);
    label.setPosition(x, y);
    label.setVisible(true);
    this.activeNameLabelIndex += 1;
  }

  private hideUnusedNameLabels(): void {
    for (let index = this.activeNameLabelIndex; index < this.nameLabels.length; index += 1) {
      this.nameLabels[index].setVisible(false);
    }
  }

  private drawGrid(cameraX: number, cameraY: number): void {
    const width = this.scale.width;
    const height = this.scale.height;
    const spacing = 64;
    const offsetX = ((-cameraX + width / 2) % spacing) - spacing;
    const offsetY = ((-cameraY + height / 2) % spacing) - spacing;
    this.graphics.lineStyle(1, 0x17232b, 0.7);
    for (let x = offsetX; x < width + spacing; x += spacing) this.graphics.lineBetween(x, 0, x, height);
    for (let y = offsetY; y < height + spacing; y += spacing) this.graphics.lineBetween(0, y, width, y);
  }

  private drawRegularPolygon(x: number, y: number, radius: number, sides: number, rotation: number): void {
    this.graphics.beginPath();
    for (let index = 0; index < sides; index += 1) {
      const angle = rotation + (Math.PI * 2 * index) / sides;
      const px = x + Math.cos(angle) * radius;
      const py = y + Math.sin(angle) * radius;
      if (index === 0) this.graphics.moveTo(px, py);
      else this.graphics.lineTo(px, py);
    }
    this.graphics.closePath();
    this.graphics.fillPath();
    this.graphics.strokePath();
  }

  private drawSpiked(x: number, y: number, radius: number): void {
    this.graphics.beginPath();
    for (let index = 0; index < 24; index += 1) {
      const angle = (Math.PI * 2 * index) / 24;
      const r = index % 2 === 0 ? radius * 1.18 : radius * 0.82;
      const px = x + Math.cos(angle) * r;
      const py = y + Math.sin(angle) * r;
      if (index === 0) this.graphics.moveTo(px, py);
      else this.graphics.lineTo(px, py);
    }
    this.graphics.closePath();
    this.graphics.fillPath();
    this.graphics.strokePath();
  }

  private drawDemoTank(x: number, y: number, radius: number, bodyColor: number, aim: number, weaponAnglesDeg: number[]): void {
    for (const weaponAngle of weaponAnglesDeg) {
      const angle = aim + Phaser.Math.DegToRad(weaponAngle);
      const barrelX = x + Math.cos(angle) * radius * 0.3;
      const barrelY = y + Math.sin(angle) * radius * 0.3;
      this.graphics.save();
      this.graphics.translateCanvas(barrelX, barrelY);
      this.graphics.rotateCanvas(angle);
      this.graphics.fillStyle(0x566a72, 0.92);
      this.graphics.lineStyle(3, 0x1f3038, 0.92);
      this.graphics.fillRoundedRect(0, -radius * 0.24, radius * 1.55, radius * 0.48, 3);
      this.graphics.strokeRoundedRect(0, -radius * 0.24, radius * 1.55, radius * 0.48, 3);
      this.graphics.restore();
    }
    this.graphics.fillStyle(bodyColor, 0.94);
    this.graphics.lineStyle(5, 0xeefaff, 0.62);
    this.graphics.fillCircle(x, y, radius);
    this.graphics.strokeCircle(x, y, radius);
    this.graphics.lineStyle(2, 0x071015, 0.26);
    this.graphics.strokeCircle(x, y, radius * 0.58);
  }

  private worldToScreen(x: number, y: number, cameraX: number, cameraY: number): { x: number; y: number } {
    return {
      x: this.scale.width / 2 + (x - cameraX),
      y: this.scale.height / 2 + (y - cameraY),
    };
  }

  private screenToWorld(x: number, y: number, cameraX: number, cameraY: number): { x: number; y: number } {
    return {
      x: cameraX + (x - this.scale.width / 2),
      y: cameraY + (y - this.scale.height / 2),
    };
  }

  private getPointerAim(originX: number, originY: number, cameraX: number, cameraY: number): { x: number; y: number; angle?: number } {
    const pointer = this.input.activePointer;
    const worldPointer = this.screenToWorld(pointer.x, pointer.y, cameraX, cameraY);
    const x = worldPointer.x - originX;
    const y = worldPointer.y - originY;
    return {
      x,
      y,
      angle: x * x + y * y > 0.001 ? Math.atan2(y, x) : undefined,
    };
  }

  private updateDiagnostics(delta: number): void {
    if (!this.diagnosticsElement) return;
    this.frameDeltas.push(delta);
    if (this.frameDeltas.length > 120) this.frameDeltas.shift();
    const now = performance.now();
    if (now - this.lastDiagnosticsUpdate < 250) return;
    this.lastDiagnosticsUpdate = now;
    const sorted = [...this.frameDeltas].sort((a, b) => a - b);
    const avg = this.frameDeltas.reduce((sum, value) => sum + value, 0) / Math.max(1, this.frameDeltas.length);
    const p95 = sorted[Math.floor(sorted.length * 0.95)] ?? 0;
    const max = sorted[sorted.length - 1] ?? 0;
    this.diagnosticsElement.textContent = `frame avg ${avg.toFixed(1)}ms\np95 ${p95.toFixed(1)}ms\nmax ${max.toFixed(1)}ms`;
  }
}

const inputState: ClientInputState = {
  autoFire: false,
  autoSpin: false,
};
const client = new TankioClient();
const hud = new HudController(client, inputState);

new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'game-canvas',
  backgroundColor: '#0b1116',
  scale: {
    mode: Phaser.Scale.RESIZE,
    width: window.innerWidth,
    height: window.innerHeight,
  },
  scene: [new ArenaScene(client, hud, inputState)],
  render: {
    antialias: true,
  },
});

const statLabels: Record<StatKey, string> = {
  healthRegen: 'Regen',
  maxHealth: 'Health',
  bodyDamage: 'Body',
  bulletSpeed: 'Speed',
  bulletPenetration: 'Pierce',
  bulletDamage: 'Damage',
  reload: 'Reload',
  movementSpeed: 'Move',
};

function interpolateSnapshots(previous: GameSnapshot, next: GameSnapshot, alpha: number): GameSnapshot {
  const previousPlayers = keyed(previous.players);
  const previousProjectiles = keyed(previous.projectiles);
  const previousShapes = keyed(previous.shapes);

  return {
    ...next,
    now: lerp(previous.now, next.now, alpha),
    players: next.players.map((player) => interpolateTank(previousPlayers.get(player.id), player, alpha)),
    projectiles: next.projectiles.map((projectile) => interpolateProjectile(previousProjectiles.get(projectile.id), projectile, alpha)),
    shapes: next.shapes.map((shape) => interpolateShape(previousShapes.get(shape.id), shape, alpha)),
  };
}

function interpolateTank(previous: SnapshotTank | undefined, next: SnapshotTank, alpha: number): SnapshotTank {
  if (!previous) return next;
  return {
    ...next,
    x: lerp(previous.x, next.x, alpha),
    y: lerp(previous.y, next.y, alpha),
    aim: lerpAngle(previous.aim, next.aim, alpha),
    radius: lerp(previous.radius, next.radius, alpha),
    health: lerp(previous.health, next.health, alpha),
    maxHealth: lerp(previous.maxHealth, next.maxHealth, alpha),
  };
}

function interpolateProjectile(previous: SnapshotProjectile | undefined, next: SnapshotProjectile, alpha: number): SnapshotProjectile {
  if (!previous || previous.kind !== next.kind) return next;
  return {
    ...next,
    x: lerp(previous.x, next.x, alpha),
    y: lerp(previous.y, next.y, alpha),
    radius: lerp(previous.radius, next.radius, alpha),
  };
}

function interpolateShape(previous: SnapshotShape | undefined, next: SnapshotShape, alpha: number): SnapshotShape {
  if (!previous || previous.shape !== next.shape) return next;
  return {
    ...next,
    x: lerp(previous.x, next.x, alpha),
    y: lerp(previous.y, next.y, alpha),
    hp: lerp(previous.hp, next.hp, alpha),
    rotation: lerpAngle(previous.rotation, next.rotation, alpha),
  };
}

function keyed<T extends { id: string }>(items: T[]): Map<string, T> {
  return new Map(items.map((item) => [item.id, item]));
}

function lerp(a: number, b: number, alpha: number): number {
  return a + (b - a) * alpha;
}

function lerpAngle(a: number, b: number, alpha: number): number {
  const delta = Math.atan2(Math.sin(b - a), Math.cos(b - a));
  return a + delta * alpha;
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function keyDown(key?: Phaser.Input.Keyboard.Key): boolean {
  return key?.isDown ?? false;
}

function parseColor(value: string): number {
  return Number.parseInt(value.replace('#', ''), 16);
}

function renderLeaderboardRow(entry: LeaderboardEntry, index: number): string {
  return `
    <div class="leader-row">
      <span>${index + 1}</span>
      <b>${escapeHtml(entry.name)}</b>
      <span>${entry.score.toLocaleString()}</span>
    </div>
  `;
}

function renderUpgradeMilestones(): string {
  return [15, 30, 45]
    .map((level) => {
      const count = TANK_CLASSES.filter((tankClass) => tankClass.unlockLevel === level).length;
      const tier = level === 15 ? 'Tier 2' : level === 30 ? 'Tier 3' : 'Tier 4';
      return `
        <div class="milestone">
          <span>LV ${level}</span>
          <strong>${tier}</strong>
          <small>${count} picks</small>
        </div>
      `;
    })
    .join('');
}

function renderStarterPaths(): string {
  return STARTER_PATHS.map((tankClass) => {
    const tags = tankClass.tags.slice(0, 2).map((tag) => tag.replace('-', ' ')).join(' / ');
    return `
      <div class="path-card">
        <span>${escapeHtml(tankClass.displayName)}</span>
        <b>${escapeHtml(tags)}</b>
      </div>
    `;
  }).join('');
}

function renderTankSummary(): string {
  const tierFourCount = TANK_CLASSES.filter((tankClass) => tankClass.tier === 4).length;
  const autoCount = TANK_CLASSES.filter((tankClass) => tankClass.abilities.includes('auto-turret')).length;
  const droneCount = TANK_CLASSES.filter((tankClass) => tankClass.abilities.includes('drone-control')).length;
  return `
    <div class="system-row"><span>Tank classes</span><strong>${TANK_CLASSES.length}</strong></div>
    <div class="system-row"><span>Tier 4 picks</span><strong>${tierFourCount}</strong></div>
    <div class="system-row"><span>Auto builds</span><strong>${autoCount}</strong></div>
    <div class="system-row"><span>Drone builds</span><strong>${droneCount}</strong></div>
  `;
}

function renderAchievementBadges(achievementIds: string[]): string {
  if (achievementIds.length === 0) {
    return '<div class="empty-badge">No badges yet</div>';
  }
  return achievementIds
    .map((achievementId) => `<div class="badge-pill">${escapeHtml(ACHIEVEMENT_LABELS[achievementId] ?? achievementId)}</div>`)
    .join('');
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
