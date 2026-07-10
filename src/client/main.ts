import Phaser from 'phaser';
import './styles.css';
import botArenaUrl from './assets/dashboard/bot-arena-ui.jpg';
import logoMascotUrl from './assets/dashboard/logo-mascot-ui.jpg';
import onlineArenaUrl from './assets/dashboard/online-arena-ui.jpg';
import profileAvatarUrl from './assets/dashboard/profile-avatar-ui.jpg';
import routeMapUrl from './assets/dashboard/route-map-ui.jpg';
import tankFlankGuardUrl from './assets/dashboard/tank-flank-guard-ui.jpg';
import tankMachineGunUrl from './assets/dashboard/tank-machine-gun-ui.jpg';
import tankSniperUrl from './assets/dashboard/tank-sniper-ui.jpg';
import tankTwinUrl from './assets/dashboard/tank-twin-ui.jpg';
import type {
  ClientInputPayload,
  CombatFeedbackEvent,
  GameSnapshot,
  LeaderboardEntry,
  SnapshotShape,
  SnapshotTank,
} from '../shared/protocol';
import { MAX_LEVEL, STAT_GAIN_LABELS, levelForXp, xpRequiredForLevel } from '../shared/progression';
import { TANK_DEX_ENTRIES, getTankDexEntry, tankDexPowerKeys, type TankDexEntry, type TankPowerKey } from '../shared/tankDex';
import { STAT_KEYS, type StatKey } from '../shared/tankTypes';
import { getTankClass, TANK_CLASSES, TANK_CLASSES_BY_ID } from '../shared/tanks';
import { clamp01, easeOutCubic, lerp } from './math';
import { drawTankDexPreview as drawTankDexPreviewCanvas } from './tankDexPreview';
import { TankioClient, TOKEN_KEY } from './tankioClient';

const ENABLE_RENDER_DIAGNOSTICS =
  new URLSearchParams(location.search).has('debugRender') || localStorage.getItem('tankio2.debugRender') === '1';
const MAX_SEEN_COMBAT_EVENTS = 700;
const MAX_IMPACT_PARTICLES = 280;
const NEARBY_SHAKE_DISTANCE = 620;

interface ClientInputState {
  autoFire: boolean;
  autoSpin: boolean;
}

interface ImpactParticle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  color: number;
  lifeMs: number;
  maxLifeMs: number;
}

interface ImpactRing {
  x: number;
  y: number;
  color: number;
  startRadius: number;
  endRadius: number;
  lineWidth: number;
  lifeMs: number;
  maxLifeMs: number;
}

type FlashTargetKind = 'player' | 'shape';

interface TargetFlash {
  targetKind: FlashTargetKind;
  targetId: string;
  color: number;
  lifeMs: number;
  maxLifeMs: number;
}

interface RewardFloat {
  x: number;
  y: number;
  label: Phaser.GameObjects.Text;
  lifeMs: number;
  maxLifeMs: number;
  strong: boolean;
}

type TankDexTierFilter = 'all' | '1' | '2' | '3' | '4';

const CUSTOM_BRANCH_UNLOCK_XP = 8000;
const STARTER_PATHS = TANK_CLASSES.filter((tankClass) => tankClass.unlockLevel === 15 && tankClass.parents.includes('basic'));
const DASHBOARD_ASSETS = {
  botArena: botArenaUrl,
  logoMascot: logoMascotUrl,
  onlineArena: onlineArenaUrl,
  profileAvatar: profileAvatarUrl,
  routeMap: routeMapUrl,
  tankFlankGuard: tankFlankGuardUrl,
  tankMachineGun: tankMachineGunUrl,
  tankSniper: tankSniperUrl,
  tankTwin: tankTwinUrl,
} as const;
const STARTER_PATH_ASSETS: Record<string, string> = {
  flank_guard: DASHBOARD_ASSETS.tankFlankGuard,
  machine_gun: DASHBOARD_ASSETS.tankMachineGun,
  sniper: DASHBOARD_ASSETS.tankSniper,
  twin: DASHBOARD_ASSETS.tankTwin,
};
const ACHIEVEMENT_LABELS: Record<string, string> = {
  first_destroy: 'First Destroy',
  first_upgrade: 'First Upgrade',
  score_2500: 'Score 2.5k',
  deep_run: 'Deep Run',
};
const TANK_DEX_TIER_FILTERS: { value: TankDexTierFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: '1', label: 'T1' },
  { value: '2', label: 'T2' },
  { value: '3', label: 'T3' },
  { value: '4', label: 'T4' },
];
const TANK_DEX_POWER_LABELS: Record<TankPowerKey, string> = {
  damage: 'Damage',
  fireRate: 'Fire Rate',
  range: 'Range',
  mobility: 'Mobility',
  survivability: 'Survival',
  utility: 'Utility',
};

class HudController {
  private readonly menu: HTMLDivElement;
  private readonly hud: HTMLDivElement;
  private readonly nameInput: HTMLInputElement;
  private readonly joinButtons: HTMLButtonElement[];
  private readonly profileStrip: HTMLDivElement;
  private readonly profileName: HTMLElement;
  private readonly profileLevel: HTMLElement;
  private readonly menuStatus: HTMLDivElement;
  private readonly routeSettingsButton: HTMLButtonElement;
  private readonly tankDexModal: HTMLElement;
  private readonly tankDexSearch: HTMLInputElement;
  private readonly tankDexTierButtons: HTMLButtonElement[];
  private readonly tankDexList: HTMLElement;
  private readonly tankDexDetail: HTMLElement;
  private readonly tankDexPreview: HTMLCanvasElement;
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
  private readonly xpText: HTMLElement;
  private readonly xpNeed: HTMLElement;
  private readonly xpFill: HTMLDivElement;
  private readonly deathScore: HTMLElement;
  private readonly deathXp: HTMLElement;
  private readonly deathRetryButton: HTMLButtonElement;
  private readonly deathMenuButton: HTMLButtonElement;
  private lastProfileKey = '';
  private lastStatusKey = '';
  private lastStatsKey = '';
  private lastUpgradesKey = '';
  private lastLeaderboardKey = '';
  private lastDeathKey = '';
  private lastAutoFire?: boolean;
  private tankDexOpen = false;
  private selectedTankDexId = 'basic';
  private tankDexTierFilter: TankDexTierFilter = 'all';
  private tankDexAnimationFrame?: number;

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
              <div class="brand-lockup">
                <img class="brand-mascot" src="${DASHBOARD_ASSETS.logoMascot}" width="192" height="192" decoding="async" alt="Blue Tankio2 tank mascot" />
                <h1>TANKIO2</h1>
              </div>
              <div class="mode-ribbon" aria-label="Selected arena mode">
                <span class="star-chip" aria-hidden="true"></span>
                <strong>FFA ARENA</strong>
                <span class="star-chip" aria-hidden="true"></span>
              </div>
              <div class="field pilot-field">
                <label for="pilot-name">Pilot</label>
                <div class="input-wrap">
                  <span class="pilot-icon" aria-hidden="true"></span>
                  <input id="pilot-name" maxlength="18" value="Pilot" autocomplete="off" />
                </div>
              </div>
              <div class="menu-actions">
                <button class="join-button join-button--online" data-join="online" type="button">
                  <img src="${DASHBOARD_ASSETS.onlineArena}" width="136" height="136" decoding="async" alt="" aria-hidden="true" />
                  <span class="join-copy">
                    <span>Online Arena</span>
                    <b>FFA room</b>
                  </span>
                  <span class="button-arrow" aria-hidden="true">&gt;</span>
                </button>
                <button class="join-button join-button--bots" data-join="bots" type="button">
                  <img src="${DASHBOARD_ASSETS.botArena}" width="136" height="136" decoding="async" alt="" aria-hidden="true" />
                  <span class="join-copy">
                    <span>Bot Arena</span>
                    <b>Practice run</b>
                  </span>
                  <span class="button-arrow" aria-hidden="true">&gt;</span>
                </button>
              </div>
              <div class="menu-status" role="status">Ready</div>
              <div class="landscape-strip" aria-hidden="true">
                <span></span>
                <span></span>
                <span></span>
              </div>
              <div class="quick-controls" aria-label="Combat controls">
                <span><i class="control-icon control-icon--dpad" aria-hidden="true"></i><b>WASD</b></span>
                <span><i class="control-icon control-icon--mouse" aria-hidden="true"></i><b>Mouse</b></span>
                <span><i class="control-icon control-icon--gear" aria-hidden="true"></i><b>E Auto</b></span>
                <span><i class="control-icon control-icon--spin" aria-hidden="true"></i><b>C Spin</b></span>
              </div>
            </aside>
            <section class="arena-showcase lobby-panel" aria-label="Tank routes">
              <div class="panel-heading">
                <h2><span class="leaf-chip" aria-hidden="true"></span>Tank Routes<span class="leaf-chip leaf-chip--right" aria-hidden="true"></span></h2>
                <strong>${TANK_CLASSES.length} classes</strong>
              </div>
              <div class="route-map">
                <img src="${DASHBOARD_ASSETS.routeMap}" width="1024" height="683" decoding="async" fetchpriority="high" alt="Cartoon meadow map showing tank upgrade routes" />
                <div class="route-node route-node--tier2">
                  <img src="${DASHBOARD_ASSETS.tankMachineGun}" width="224" height="224" loading="lazy" decoding="async" alt="" aria-hidden="true" />
                  <span>Tier 2</span>
                </div>
                <div class="route-node route-node--tier3">
                  <img src="${DASHBOARD_ASSETS.tankSniper}" width="224" height="168" loading="lazy" decoding="async" alt="" aria-hidden="true" />
                  <span>Tier 3</span>
                </div>
                <div class="route-node route-node--tier4">
                  <img src="${DASHBOARD_ASSETS.tankFlankGuard}" width="224" height="179" loading="lazy" decoding="async" alt="" aria-hidden="true" />
                  <span>Tier 4</span>
                </div>
                <button class="route-settings" type="button" aria-label="Open Tank Dex"><span></span></button>
              </div>
              <div class="upgrade-track">${renderUpgradeMilestones()}</div>
              <div class="starter-paths">${renderStarterPaths()}</div>
            </section>
            <aside class="progress-panel lobby-panel" aria-label="Saved profile">
              <div class="profile-titlebar">
                <span class="star-chip" aria-hidden="true"></span>
                <h2>Profile</h2>
                <span class="star-chip" aria-hidden="true"></span>
              </div>
              <div class="profile-hero">
                <div class="profile-avatar-wrap">
                  <img src="${DASHBOARD_ASSETS.profileAvatar}" width="208" height="208" decoding="async" alt="Blue tank pilot profile avatar" />
                  <span data-profile-level>1</span>
                </div>
                <div class="profile-strip"></div>
              </div>
              <div class="profile-name-row">
                <span>Pilot profile</span>
                <strong data-profile-name>Guest pilot</strong>
              </div>
              <div class="branch-meter">
                <div>
                  <span>Custom branch</span>
                  <strong data-branch-value>0 / ${CUSTOM_BRANCH_UNLOCK_XP.toLocaleString()} XP</strong>
                </div>
                <div class="meter"><div data-branch-fill></div></div>
                <small>0%</small>
              </div>
              <div class="badge-list"></div>
              <div class="tank-system">${renderTankSummary()}</div>
            </aside>
          </div>
        </section>
        <section class="tank-dex-modal" role="dialog" aria-modal="true" aria-hidden="true" aria-labelledby="tank-dex-title">
          <button class="tank-dex-backdrop" type="button" data-tank-dex-close aria-label="Close Tank Dex"></button>
          <div class="tank-dex-shell">
            <header class="tank-dex-header">
              <div>
                <span>Tank Dex</span>
                <h2 id="tank-dex-title">Tank Dex</h2>
              </div>
              <button class="tank-dex-close" type="button" data-tank-dex-close>Close</button>
            </header>
            <div class="tank-dex-tools">
              <label class="tank-dex-search-wrap">
                <span>Search</span>
                <input class="tank-dex-search" type="search" placeholder="Search tank, role, trait" autocomplete="off" />
              </label>
              <div class="tank-dex-tabs" role="tablist" aria-label="Tank tier filter">
                ${TANK_DEX_TIER_FILTERS.map(
                  (filter) =>
                    `<button class="tank-dex-tab${filter.value === 'all' ? ' active' : ''}" type="button" data-dex-tier="${filter.value}" aria-pressed="${filter.value === 'all'}">${filter.label}</button>`,
                ).join('')}
              </div>
            </div>
            <div class="tank-dex-body">
              <nav class="tank-dex-list" aria-label="Available tanks"></nav>
              <article class="tank-dex-detail" aria-live="polite">
                <canvas class="tank-dex-preview" width="720" height="360" aria-label="Selected tank animation preview"></canvas>
                <div class="tank-dex-detail-content"></div>
              </article>
            </div>
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
            <div class="bar health-bar"><div class="bar-fill"></div></div>
            <div class="xp-meter">
              <div class="xp-line">
                <span data-xp-text>0 / 0 XP</span>
                <strong data-xp-need>Need 0 XP</strong>
              </div>
              <div class="xp-track"><div data-xp-fill></div></div>
            </div>
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
          <div class="death" role="dialog" aria-modal="true" aria-labelledby="death-title">
            <strong id="death-title">Tank Destroyed</strong>
            <span class="death-summary">Run ended</span>
            <div class="death-stats">
              <span><b data-death-score>0</b><small>Score</small></span>
              <span><b data-death-xp>0</b><small>Run XP</small></span>
            </div>
            <div class="death-actions">
              <button class="death-button death-button--retry" type="button" data-death-retry>Retry</button>
              <button class="death-button death-button--menu" type="button" data-death-menu>Main Screen</button>
            </div>
          </div>
        </section>
      </div>
    `;

    this.menu = root.querySelector('.menu') as HTMLDivElement;
    this.hud = root.querySelector('.hud') as HTMLDivElement;
    this.nameInput = root.querySelector('#pilot-name') as HTMLInputElement;
    this.joinButtons = [...root.querySelectorAll<HTMLButtonElement>('[data-join]')];
    this.profileStrip = root.querySelector('.profile-strip') as HTMLDivElement;
    this.profileName = root.querySelector('[data-profile-name]') as HTMLElement;
    this.profileLevel = root.querySelector('[data-profile-level]') as HTMLElement;
    this.menuStatus = root.querySelector('.menu-status') as HTMLDivElement;
    this.routeSettingsButton = root.querySelector('.route-settings') as HTMLButtonElement;
    this.tankDexModal = root.querySelector('.tank-dex-modal') as HTMLElement;
    this.tankDexSearch = root.querySelector('.tank-dex-search') as HTMLInputElement;
    this.tankDexTierButtons = [...root.querySelectorAll<HTMLButtonElement>('[data-dex-tier]')];
    this.tankDexList = root.querySelector('.tank-dex-list') as HTMLElement;
    this.tankDexDetail = root.querySelector('.tank-dex-detail-content') as HTMLElement;
    this.tankDexPreview = root.querySelector('.tank-dex-preview') as HTMLCanvasElement;
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
    this.xpText = this.status.querySelector('[data-xp-text]') as HTMLElement;
    this.xpNeed = this.status.querySelector('[data-xp-need]') as HTMLElement;
    this.xpFill = this.status.querySelector('[data-xp-fill]') as HTMLDivElement;
    this.deathScore = this.death.querySelector('[data-death-score]') as HTMLElement;
    this.deathXp = this.death.querySelector('[data-death-xp]') as HTMLElement;
    this.deathRetryButton = this.death.querySelector('[data-death-retry]') as HTMLButtonElement;
    this.deathMenuButton = this.death.querySelector('[data-death-menu]') as HTMLButtonElement;

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

    this.routeSettingsButton.addEventListener('click', () => {
      this.openTankDex();
    });

    this.tankDexModal.addEventListener('click', (event) => {
      const target = event.target as HTMLElement;
      if (target.closest('[data-tank-dex-close]')) {
        this.closeTankDex();
        return;
      }

      const tierButton = target.closest<HTMLButtonElement>('[data-dex-tier]');
      if (tierButton) {
        this.tankDexTierFilter = (tierButton.dataset.dexTier ?? 'all') as TankDexTierFilter;
        this.renderTankDex();
        return;
      }

      const tankButton = target.closest<HTMLButtonElement>('[data-dex-tank]');
      if (tankButton?.dataset.dexTank) {
        this.selectTankDexEntry(tankButton.dataset.dexTank);
      }
    });

    this.tankDexSearch.addEventListener('input', () => {
      this.renderTankDex();
    });

    window.addEventListener('keydown', (event) => this.handleGlobalKeyDown(event));

    this.deathRetryButton.addEventListener('click', () => {
      this.client.retry();
    });

    this.deathMenuButton.addEventListener('click', () => {
      void this.returnToMainScreen();
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
    this.renderTankDex();
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
    const xpProgress = getLevelProgress(self.xp, self.level);

    const statusKey = `${tankClass.displayName}|${self.level}|${self.score}|${self.xp}|${healthPercent}`;
    if (statusKey !== this.lastStatusKey) {
      this.className.textContent = tankClass.displayName;
      this.score.textContent = `${self.score.toLocaleString()} score`;
      this.level.textContent = `LV ${self.level}`;
      this.healthFill.style.width = `${healthPercent}%`;
      this.xpText.textContent = xpProgress.isMaxLevel
        ? `${xpProgress.currentXp.toLocaleString()} XP`
        : `${xpProgress.currentXp.toLocaleString()} / ${xpProgress.nextXp.toLocaleString()} XP`;
      this.xpNeed.textContent = xpProgress.isMaxLevel ? 'MAX LEVEL' : `Need ${xpProgress.neededXp.toLocaleString()} XP`;
      this.xpFill.style.width = `${Math.round(xpProgress.progress * 100)}%`;
      this.lastStatusKey = statusKey;
    }

    const statsKey = `${STAT_KEYS.map((stat) => `${stat}:${self.stats[stat]}`).join('|')}|points:${self.availableStatPoints}`;
    if (statsKey !== this.lastStatsKey) {
      this.stats.innerHTML = STAT_KEYS.map((stat, index) => {
        const label = statLabels[stat];
        const value = self.stats[stat];
        const gain = STAT_GAIN_LABELS[stat];
        const disabled = self.availableStatPoints <= 0 ? 'disabled' : '';
        return `<button class="stat-button" data-stat="${stat}" ${disabled}><span class="stat-hotkey" aria-hidden="true">${index + 1}</span><b>${label}</b><span class="stat-value">${value} | ${gain}</span></button>`;
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

    const deathKey = `${self.alive}|${self.score}|${self.sessionXp}`;
    if (deathKey !== this.lastDeathKey) {
      this.death.classList.toggle('visible', !self.alive);
      this.deathScore.textContent = self.score.toLocaleString();
      this.deathXp.textContent = self.sessionXp.toLocaleString();
      this.lastDeathKey = deathKey;
    }
  }

  private openTankDex(): void {
    if (this.tankDexOpen) return;
    this.tankDexOpen = true;
    this.tankDexModal.classList.add('is-open');
    this.tankDexModal.setAttribute('aria-hidden', 'false');
    this.renderTankDex();
    this.startTankDexPreview();
    this.tankDexSearch.focus();
  }

  private closeTankDex(): void {
    if (!this.tankDexOpen) return;
    this.tankDexOpen = false;
    this.tankDexModal.classList.remove('is-open');
    this.tankDexModal.setAttribute('aria-hidden', 'true');
    this.stopTankDexPreview();
    this.routeSettingsButton.focus();
  }

  private renderTankDex(): void {
    const entries = this.filteredTankDexEntries();
    if (!entries.some((entry) => entry.tank.id === this.selectedTankDexId)) {
      this.selectedTankDexId = entries[0]?.tank.id ?? 'basic';
    }

    for (const button of this.tankDexTierButtons) {
      const isActive = button.dataset.dexTier === this.tankDexTierFilter;
      button.classList.toggle('active', isActive);
      button.setAttribute('aria-pressed', String(isActive));
    }

    this.tankDexList.innerHTML =
      entries.length === 0
        ? '<div class="tank-dex-empty">No tanks found</div>'
        : entries
            .map((entry) => {
              const isActive = entry.tank.id === this.selectedTankDexId;
              return `
                <button class="tank-dex-card${isActive ? ' active' : ''}" type="button" data-dex-tank="${entry.tank.id}" aria-pressed="${isActive}">
                  <span>Tier ${entry.tank.tier}</span>
                  <strong>${escapeHtml(entry.tank.displayName)}</strong>
                  <small>${escapeHtml(entry.metadata.role)}</small>
                  <b>${escapeHtml(renderTankDexRequirementShort(entry))}</b>
                </button>
              `;
            })
            .join('');

    this.renderTankDexDetail(getTankDexEntry(this.selectedTankDexId));
  }

  private filteredTankDexEntries(): TankDexEntry[] {
    const tier = this.tankDexTierFilter;
    const term = this.tankDexSearch.value.trim().toLowerCase();
    return TANK_DEX_ENTRIES.filter((entry) => {
      if (tier !== 'all' && entry.tank.tier !== Number(tier)) return false;
      if (!term) return true;
      const searchable = [
        entry.tank.id,
        entry.tank.displayName,
        entry.metadata.role,
        entry.metadata.description,
        entry.metadata.playstyle,
        entry.weaponSummary,
        entry.statCapSummary,
        ...entry.traits,
        ...entry.abilityLabels,
      ]
        .join(' ')
        .toLowerCase();
      return searchable.includes(term);
    });
  }

  private selectTankDexEntry(tankId: string): void {
    this.selectedTankDexId = tankId;
    this.renderTankDex();
  }

  private renderTankDexDetail(entry: TankDexEntry): void {
    const abilities = entry.abilityLabels.length > 0 ? entry.abilityLabels : ['No Special Ability'];
    const parentNames = entry.tank.parents.length > 0 ? entry.tank.parents.map((parentId) => getTankClass(parentId).displayName).join(', ') : 'Starter';
    this.tankDexDetail.innerHTML = `
      <div class="tank-dex-title-row">
        <div>
          <span>Tier ${entry.tank.tier} - ${escapeHtml(entry.metadata.role)}</span>
          <h3>${escapeHtml(entry.tank.displayName)}</h3>
        </div>
        <strong>${escapeHtml(renderTankDexRequirementShort(entry))}</strong>
      </div>
      <p class="tank-dex-description">${escapeHtml(entry.metadata.description)}</p>
      <p class="tank-dex-playstyle">${escapeHtml(entry.metadata.playstyle)}</p>
      <div class="tank-dex-power-grid">
        ${tankDexPowerKeys()
          .map(
            (key) => `
              <div class="tank-dex-power-row">
                <span>${TANK_DEX_POWER_LABELS[key]}</span>
                <div class="tank-dex-power-track"><div style="width: ${entry.power[key]}%"></div></div>
                <b>${entry.power[key]}</b>
              </div>
            `,
          )
          .join('')}
      </div>
      <div class="tank-dex-chip-group" aria-label="Tank abilities">
        ${abilities.map((ability) => `<span class="tank-dex-chip tank-dex-chip--ability">${escapeHtml(ability)}</span>`).join('')}
      </div>
      <div class="tank-dex-chip-group" aria-label="Tank traits">
        ${entry.traits.map((trait) => `<span class="tank-dex-chip">${escapeHtml(trait)}</span>`).join('')}
      </div>
      <div class="tank-dex-facts">
        <span><b>Weapons</b>${escapeHtml(entry.weaponSummary)}</span>
        <span><b>Parents</b>${escapeHtml(parentNames)}</span>
        <span><b>Stats</b>${escapeHtml(entry.statCapSummary)}</span>
      </div>
      <div class="tank-dex-paths">
        <h4>Requirements</h4>
        ${entry.paths.map((path) => renderTankDexPath(path)).join('')}
      </div>
    `;
  }

  private startTankDexPreview(): void {
    this.stopTankDexPreview();
    const animate = (now: number) => {
      this.drawTankDexPreview(now);
      if (this.tankDexOpen) this.tankDexAnimationFrame = requestAnimationFrame(animate);
    };
    this.tankDexAnimationFrame = requestAnimationFrame(animate);
  }

  private stopTankDexPreview(): void {
    if (this.tankDexAnimationFrame !== undefined) {
      cancelAnimationFrame(this.tankDexAnimationFrame);
      this.tankDexAnimationFrame = undefined;
    }
  }

  private drawTankDexPreview(now: number): void {
    drawTankDexPreviewCanvas(this.tankDexPreview, this.selectedTankDexId, now);
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
    this.profileLevel.textContent = String(getProfileDisplayLevel(profileXp)).padStart(2, '0');
    this.profileStrip.innerHTML = `
      <div class="profile-chip"><span>Badges</span><strong>${achievements.length}</strong></div>
      <div class="profile-chip"><span>Branches</span><strong>${branches.length}</strong></div>
    `;
    this.branchValue.textContent =
      branches.length > 0 ? 'Unlocked' : `${Math.min(profileXp, CUSTOM_BRANCH_UNLOCK_XP).toLocaleString()} / ${CUSTOM_BRANCH_UNLOCK_XP.toLocaleString()} XP`;
    this.branchFill.style.width = `${Math.round(branchProgress * 100)}%`;
    const branchPercent = this.branchFill.closest('.branch-meter')?.querySelector('small');
    if (branchPercent) branchPercent.textContent = `${Math.round(branchProgress * 100)}%`;
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
      this.death.classList.remove('visible');
      this.lastDeathKey = '';
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

  private async returnToMainScreen(): Promise<void> {
    this.client.disconnect();
    this.inputState.autoFire = false;
    this.inputState.autoSpin = false;
    this.lastAutoFire = undefined;
    this.lastDeathKey = '';
    this.death.classList.remove('visible');
    this.hud.classList.remove('visible');
    this.menu.classList.remove('hidden');
    this.renderCombatControls();
    this.setMenuBusy(false, 'Ready');
    await this.hydrateSavedProfile();
  }

  private renderCombatControls(): void {
    if (this.inputState.autoFire === this.lastAutoFire) return;
    this.autoFireButton.classList.toggle('active', this.inputState.autoFire);
    this.autoFireButton.setAttribute('aria-pressed', String(this.inputState.autoFire));
    this.autoFireState.textContent = this.inputState.autoFire ? 'On' : 'Off';
    this.lastAutoFire = this.inputState.autoFire;
  }

  private handleGlobalKeyDown(event: KeyboardEvent): void {
    if (event.key === 'Escape' && this.tankDexOpen) {
      this.closeTankDex();
      return;
    }

    const stat = statKeyForHotkey(event);
    if (!stat || event.repeat || isTypingTarget(event.target)) return;

    const snapshot = this.client.snapshot;
    if (!this.client.joined || !snapshot || !snapshot.self.alive || snapshot.self.availableStatPoints <= 0) return;

    event.preventDefault();
    this.client.upgradeStat(stat);
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
  private readonly seenCombatEventIds = new Set<string>();
  private readonly seenCombatEventOrder: string[] = [];
  private readonly impactParticles: ImpactParticle[] = [];
  private readonly impactRings: ImpactRing[] = [];
  private readonly targetFlashes = new Map<string, TargetFlash>();
  private readonly rewardFloats: RewardFloat[] = [];
  private lastCombatRoomId = '';
  private shakeTrauma = 0;

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
      this.clearCombatVisuals();
      this.renderMenuBackdrop(time);
      return;
    }
    this.renderWorld(delta);
    const snapshot = this.client.getRenderSnapshot();
    if (snapshot?.self.alive === false) {
      this.fire = false;
      this.altFire = false;
      return;
    }
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

  private renderWorld(delta: number): void {
    const snapshot = this.client.getRenderSnapshot();
    const width = this.scale.width;
    const height = this.scale.height;
    this.activeNameLabelIndex = 0;
    this.graphics.clear();
    this.graphics.fillStyle(0x0b1116, 1);
    this.graphics.fillRect(0, 0, width, height);
    const self = snapshot?.players.find((player) => player.id === snapshot.selfId);
    if (snapshot) this.ingestCombatEvents(snapshot, self);
    const baseCameraX = self?.x ?? (snapshot ? snapshot.world.width / 2 : 2100);
    const baseCameraY = self?.y ?? (snapshot ? snapshot.world.height / 2 : 2100);
    const shakeOffset = this.getCameraShakeOffset(delta);
    const cameraX = baseCameraX + shakeOffset.x;
    const cameraY = baseCameraY + shakeOffset.y;
    const localAim = self ? this.getPointerAim(self.x, self.y, cameraX, cameraY).angle ?? self.aim : undefined;
    this.drawGrid(cameraX, cameraY);
    if (!snapshot) {
      this.hideUnusedNameLabels();
      return;
    }

    for (const shape of snapshot.shapes) {
      this.drawShape(shape, cameraX, cameraY);
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
    this.drawCombatEffects(cameraX, cameraY, delta);
    this.hideUnusedNameLabels();
  }

  private drawShape(shape: SnapshotShape, cameraX: number, cameraY: number): void {
    const point = this.worldToScreen(shape.x, shape.y, cameraX, cameraY);
    const color = shape.shape === 'square' ? 0xffe45c : shape.shape === 'triangle' ? 0xff6b7a : shape.shape === 'pentagon' ? 0x5f8cff : 0x8f6bff;
    this.graphics.lineStyle(4, 0x172530, 1);
    this.graphics.fillStyle(color, 0.94);
    this.drawShapePolygon(shape, point.x, point.y);

    const flash = this.getTargetFlash('shape', shape.id);
    if (!flash) return;
    const alpha = this.flashAlpha(flash);
    this.graphics.fillStyle(flash.color, 0.18 * alpha);
    this.graphics.lineStyle(5, flash.color, 0.85 * alpha);
    this.drawShapePolygon(shape, point.x, point.y);
  }

  private drawShapePolygon(shape: SnapshotShape, x: number, y: number): void {
    if (shape.shape === 'square') {
      this.drawRegularPolygon(x, y, shape.radius, 4, shape.rotation + Math.PI / 4);
    } else if (shape.shape === 'triangle') {
      this.drawRegularPolygon(x, y, shape.radius, 3, shape.rotation);
    } else {
      this.drawRegularPolygon(x, y, shape.radius, 5, shape.rotation);
    }
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
    this.drawTankBodyShape(tankClass.bodyShape, point.x, point.y, player.radius, aim);

    const flash = this.getTargetFlash('player', player.id);
    if (flash) {
      const alpha = this.flashAlpha(flash);
      this.graphics.fillStyle(flash.color, 0.16 * alpha);
      this.graphics.lineStyle(isSelf ? 7 : 6, flash.color, 0.82 * alpha);
      this.drawTankBodyShape(tankClass.bodyShape, point.x, point.y, player.radius + 1.5, aim);
    }

    const healthWidth = 54;
    this.graphics.fillStyle(0x111d24, 0.92);
    this.graphics.fillRect(point.x - healthWidth / 2, point.y + player.radius + 10, healthWidth, 6);
    this.graphics.fillStyle(isSelf ? 0x35d0ff : 0xff6b7a, 0.95);
    this.graphics.fillRect(point.x - healthWidth / 2, point.y + player.radius + 10, healthWidth * Math.max(0, player.health / player.maxHealth), 6);
    this.addNameLabel(point.x, point.y - player.radius - 20, player.name);
  }

  private drawTankBodyShape(bodyShape: ReturnType<typeof getTankClass>['bodyShape'], x: number, y: number, radius: number, aim: number): void {
    if (bodyShape === 'square') {
      this.drawRegularPolygon(x, y, radius, 4, Math.PI / 4);
    } else if (bodyShape === 'spiked') {
      this.drawSpiked(x, y, radius);
    } else if (bodyShape === 'hex') {
      this.drawRegularPolygon(x, y, radius, 6, aim);
    } else {
      this.graphics.fillCircle(x, y, radius);
      this.graphics.strokeCircle(x, y, radius);
    }
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

  private ingestCombatEvents(snapshot: GameSnapshot, self: SnapshotTank | undefined): void {
    if (this.lastCombatRoomId !== snapshot.roomId) {
      this.clearCombatVisuals();
      this.lastCombatRoomId = snapshot.roomId;
    }

    for (const event of snapshot.combatEvents) {
      if (this.seenCombatEventIds.has(event.id)) continue;
      this.rememberCombatEventId(event.id);
      this.spawnCombatEffect(event, snapshot, self);
    }
  }

  private rememberCombatEventId(id: string): void {
    this.seenCombatEventIds.add(id);
    this.seenCombatEventOrder.push(id);
    while (this.seenCombatEventOrder.length > MAX_SEEN_COMBAT_EVENTS) {
      const staleId = this.seenCombatEventOrder.shift();
      if (staleId) this.seenCombatEventIds.delete(staleId);
    }
  }

  private spawnCombatEffect(event: CombatFeedbackEvent, snapshot: GameSnapshot, self: SnapshotTank | undefined): void {
    const color = this.combatEventColor(event, snapshot);
    const angle = event.angle ?? 0;

    if (event.targetKind && event.targetId) {
      const flashColor = event.kind === 'body_player' || event.kind === 'projectile_player' || event.kind === 'player_destroyed' ? 0xfff1a8 : color;
      this.flashTarget(event.targetKind, event.targetId, flashColor, event.kind.includes('destroyed') ? 230 : 150);
    }
    if (event.kind === 'body_player' && event.sourceId) {
      this.flashTarget('player', event.sourceId, 0xfff1a8, 140);
    }

    if (event.kind === 'shot') {
      this.spawnRing(event.x, event.y, color, 3, 24 + event.strength * 8, 3, 120);
      this.spawnBurst(event, 7, color, 250, 115, 3.1, angle, 0.85);
    } else if (event.kind === 'projectile_shape') {
      this.spawnRing(event.x, event.y, 0xfff1a8, 5, 34 + event.strength * 8, 3, 160);
      this.spawnBurst(event, 11, 0xfff1a8, 290, 170, 3.5, angle + Math.PI, 1.45);
    } else if (event.kind === 'projectile_player') {
      this.spawnRing(event.x, event.y, 0xfff1a8, 6, 40 + event.strength * 10, 4, 170);
      this.spawnBurst(event, 15, 0xfff1a8, 340, 185, 3.8, angle + Math.PI, 1.65);
    } else if (event.kind === 'body_shape') {
      this.spawnRing(event.x, event.y, 0xffb84d, 9, 44 + event.strength * 12, 5, 180);
      this.spawnBurst(event, 12, 0xffb84d, 230, 210, 4.4, angle, 2.3);
    } else if (event.kind === 'body_player') {
      this.spawnRing(event.x, event.y, 0xeefaff, 10, 50 + event.strength * 12, 5, 185);
      this.spawnBurst(event, 16, 0xeefaff, 270, 210, 4.6, angle, 2.5);
    } else if (event.kind === 'shape_destroyed') {
      this.spawnRing(event.x, event.y, 0xfff1a8, 12, 72 + event.strength * 18, 5, 260);
      this.spawnRing(event.x, event.y, color, 4, 46 + event.strength * 14, 3, 190);
      this.spawnBurst(event, 28, color, 360, 290, 4.4);
    } else if (event.kind === 'player_destroyed') {
      this.spawnRing(event.x, event.y, 0xeefaff, 14, 84 + event.strength * 20, 6, 280);
      this.spawnRing(event.x, event.y, color, 6, 52 + event.strength * 16, 4, 210);
      this.spawnBurst(event, 34, color, 430, 320, 4.8);
    }

    this.spawnRewardFeedback(event, self);
    this.applyShakeForEvent(event, self);
  }

  private spawnRewardFeedback(event: CombatFeedbackEvent, self: SnapshotTank | undefined): void {
    if (!self || event.sourceId !== self.id || event.xpGain === undefined || event.xpGain <= 0) return;
    const xpGain = Math.floor(event.xpGain);
    const xpAfter = event.xpAfter ?? xpGain;
    const levelAfter = event.levelAfter ?? levelForXp(xpAfter);
    const levelBefore = levelForXp(Math.max(0, xpAfter - xpGain));

    this.spawnRewardFloat(event.x, event.y, `+${xpGain.toLocaleString()} XP`, '#fff15a', false, 920);
    if (levelAfter > levelBefore) {
      this.spawnRewardFloat(event.x, event.y - 34, `LEVEL ${levelAfter}`, '#42d7ff', true, 1120);
    }
  }

  private spawnRewardFloat(x: number, y: number, text: string, color: string, strong: boolean, lifeMs: number): void {
    const label = this.add.text(0, 0, text, {
      fontFamily: '"Trebuchet MS", "Arial Rounded MT Bold", Arial, sans-serif',
      fontSize: strong ? '25px' : '18px',
      fontStyle: '900',
      color,
      stroke: '#06325f',
      strokeThickness: strong ? 7 : 5,
      shadow: {
        offsetX: 0,
        offsetY: 3,
        color: 'rgba(0, 0, 0, 0.28)',
        blur: 0,
        fill: true,
      },
    });
    label.setOrigin(0.5);
    label.setDepth(strong ? 48 : 44);
    this.rewardFloats.push({ x, y, label, lifeMs, maxLifeMs: lifeMs, strong });
    while (this.rewardFloats.length > 26) {
      this.rewardFloats.shift()?.label.destroy();
    }
  }

  private spawnBurst(
    event: CombatFeedbackEvent,
    count: number,
    color: number,
    speed: number,
    lifeMs: number,
    radius: number,
    angle?: number,
    spread = Math.PI * 2,
  ): void {
    for (let index = 0; index < count; index += 1) {
      const theta = angle === undefined ? Math.random() * Math.PI * 2 : angle + (Math.random() - 0.5) * spread;
      const particleSpeed = speed * event.strength * (0.42 + Math.random() * 0.78);
      this.impactParticles.push({
        x: event.x,
        y: event.y,
        vx: Math.cos(theta) * particleSpeed,
        vy: Math.sin(theta) * particleSpeed,
        radius: radius * (0.65 + Math.random() * 0.65),
        color,
        lifeMs: lifeMs * (0.72 + Math.random() * 0.5),
        maxLifeMs: lifeMs,
      });
    }
    if (this.impactParticles.length > MAX_IMPACT_PARTICLES) {
      this.impactParticles.splice(0, this.impactParticles.length - MAX_IMPACT_PARTICLES);
    }
  }

  private spawnRing(x: number, y: number, color: number, startRadius: number, endRadius: number, lineWidth: number, lifeMs: number): void {
    this.impactRings.push({
      x,
      y,
      color,
      startRadius,
      endRadius,
      lineWidth,
      lifeMs,
      maxLifeMs: lifeMs,
    });
    if (this.impactRings.length > 80) this.impactRings.splice(0, this.impactRings.length - 80);
  }

  private flashTarget(targetKind: FlashTargetKind, targetId: string, color: number, lifeMs: number): void {
    this.targetFlashes.set(`${targetKind}:${targetId}`, {
      targetKind,
      targetId,
      color,
      lifeMs,
      maxLifeMs: lifeMs,
    });
  }

  private getTargetFlash(targetKind: FlashTargetKind, targetId: string): TargetFlash | undefined {
    return this.targetFlashes.get(`${targetKind}:${targetId}`);
  }

  private flashAlpha(flash: TargetFlash): number {
    return clamp01(flash.lifeMs / flash.maxLifeMs);
  }

  private drawCombatEffects(cameraX: number, cameraY: number, delta: number): void {
    const safeDelta = Math.min(64, delta);
    const dt = safeDelta / 1000;

    for (let index = this.impactRings.length - 1; index >= 0; index -= 1) {
      const ring = this.impactRings[index];
      ring.lifeMs -= safeDelta;
      if (ring.lifeMs <= 0) {
        this.impactRings.splice(index, 1);
        continue;
      }
      const progress = 1 - ring.lifeMs / ring.maxLifeMs;
      const alpha = (1 - progress) * 0.78;
      const radius = lerp(ring.startRadius, ring.endRadius, easeOutCubic(progress));
      const point = this.worldToScreen(ring.x, ring.y, cameraX, cameraY);
      this.graphics.lineStyle(ring.lineWidth * (1 - progress * 0.45), ring.color, alpha);
      this.graphics.strokeCircle(point.x, point.y, radius);
    }

    for (let index = this.impactParticles.length - 1; index >= 0; index -= 1) {
      const particle = this.impactParticles[index];
      particle.lifeMs -= safeDelta;
      if (particle.lifeMs <= 0) {
        this.impactParticles.splice(index, 1);
        continue;
      }
      particle.x += particle.vx * dt;
      particle.y += particle.vy * dt;
      particle.vx *= 0.9;
      particle.vy *= 0.9;
      const alpha = clamp01(particle.lifeMs / particle.maxLifeMs);
      const point = this.worldToScreen(particle.x, particle.y, cameraX, cameraY);
      this.graphics.fillStyle(particle.color, alpha);
      this.graphics.fillCircle(point.x, point.y, particle.radius * (0.75 + alpha * 0.35));
    }

    for (let index = this.rewardFloats.length - 1; index >= 0; index -= 1) {
      const reward = this.rewardFloats[index];
      reward.lifeMs -= safeDelta;
      if (reward.lifeMs <= 0) {
        reward.label.destroy();
        this.rewardFloats.splice(index, 1);
        continue;
      }
      const progress = 1 - reward.lifeMs / reward.maxLifeMs;
      const rise = reward.strong ? 78 : 54;
      const point = this.worldToScreen(reward.x, reward.y - easeOutCubic(progress) * rise, cameraX, cameraY);
      const fadeIn = Math.min(1, progress / 0.16);
      const fadeOut = clamp01(reward.lifeMs / 240);
      reward.label.setPosition(point.x, point.y);
      reward.label.setAlpha(Math.min(fadeIn, fadeOut));
      reward.label.setScale(reward.strong ? 1.06 + (1 - progress) * 0.18 : 1);
    }

    for (const [key, flash] of this.targetFlashes) {
      flash.lifeMs -= safeDelta;
      if (flash.lifeMs <= 0) this.targetFlashes.delete(key);
    }
  }

  private applyShakeForEvent(event: CombatFeedbackEvent, self: SnapshotTank | undefined): void {
    if (!self) return;
    const selfInvolved = event.sourceId === self.id || event.targetId === self.id;
    const impactDistance = Math.hypot(event.x - self.x, event.y - self.y);
    if (!selfInvolved && (event.kind === 'shot' || impactDistance > NEARBY_SHAKE_DISTANCE)) return;

    const falloff = selfInvolved ? 1 : 1 - impactDistance / NEARBY_SHAKE_DISTANCE;
    const weight =
      event.kind === 'shot'
        ? 0.09
        : event.kind === 'projectile_shape'
          ? 0.13
          : event.kind === 'projectile_player'
            ? 0.16
            : event.kind === 'body_shape'
              ? 0.18
              : event.kind === 'body_player'
                ? 0.22
                : event.kind === 'shape_destroyed'
                  ? 0.26
                  : 0.34;
    this.shakeTrauma = Math.min(0.72, this.shakeTrauma + weight * event.strength * Math.max(0, falloff));
  }

  private getCameraShakeOffset(delta: number): { x: number; y: number } {
    this.shakeTrauma = Math.max(0, this.shakeTrauma - delta / 280);
    if (this.shakeTrauma <= 0) return { x: 0, y: 0 };
    const amount = this.shakeTrauma * this.shakeTrauma * 18;
    const time = this.game.loop.time;
    return {
      x: Math.sin(time * 0.073) * amount + Math.sin(time * 0.041) * amount * 0.35,
      y: Math.cos(time * 0.061) * amount + Math.sin(time * 0.053) * amount * 0.35,
    };
  }

  private combatEventColor(event: CombatFeedbackEvent, snapshot: GameSnapshot): number {
    if (event.kind === 'projectile_shape' || event.kind === 'body_shape' || event.kind === 'shape_destroyed') {
      const shape = event.targetId ? snapshot.shapes.find((entry) => entry.id === event.targetId) : undefined;
      if (shape) return shape.shape === 'square' ? 0xffe45c : shape.shape === 'triangle' ? 0xff6b7a : shape.shape === 'pentagon' ? 0x5f8cff : 0x8f6bff;
      return 0xffe45c;
    }

    const player = event.targetId
      ? snapshot.players.find((entry) => entry.id === event.targetId)
      : event.sourceId
        ? snapshot.players.find((entry) => entry.id === event.sourceId)
        : undefined;
    return player ? parseColor(player.color) : 0x35d0ff;
  }

  private clearCombatVisuals(): void {
    this.seenCombatEventIds.clear();
    this.seenCombatEventOrder.length = 0;
    this.impactParticles.length = 0;
    this.impactRings.length = 0;
    this.targetFlashes.clear();
    for (const reward of this.rewardFloats) {
      reward.label.destroy();
    }
    this.rewardFloats.length = 0;
    this.lastCombatRoomId = '';
    this.shakeTrauma = 0;
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
    const distance = Math.hypot(x, y);
    const angle = distance > 0.001 ? Math.atan2(y, x) : undefined;
    // Send a unit vector because raw pixel deltas get axis-clamped by the server and skew shallow mouse angles.
    const aimX = angle === undefined ? 0 : x / distance;
    const aimY = angle === undefined ? 0 : y / distance;
    return {
      x: aimX,
      y: aimY,
      angle,
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

function statKeyForHotkey(event: KeyboardEvent): StatKey | undefined {
  const match = /^(?:Digit|Numpad)([1-8])$/.exec(event.code);
  if (!match) return undefined;
  return STAT_KEYS[Number(match[1]) - 1];
}

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement;
}

function getLevelProgress(xp: number, level: number): {
  currentXp: number;
  nextXp: number;
  neededXp: number;
  progress: number;
  isMaxLevel: boolean;
} {
  const currentXp = Math.max(0, Math.floor(xp));
  if (level >= MAX_LEVEL) {
    return {
      currentXp,
      nextXp: currentXp,
      neededXp: 0,
      progress: 1,
      isMaxLevel: true,
    };
  }

  const levelStartXp = xpRequiredForLevel(level);
  const nextXp = xpRequiredForLevel(level + 1);
  const levelRange = Math.max(1, nextXp - levelStartXp);
  return {
    currentXp,
    nextXp,
    neededXp: Math.max(0, nextXp - currentXp),
    progress: clamp01((currentXp - levelStartXp) / levelRange),
    isMaxLevel: false,
  };
}

function keyDown(key?: Phaser.Input.Keyboard.Key): boolean {
  return key?.isDown ?? false;
}

function parseColor(value: string): number {
  return Number.parseInt(value.replace('#', ''), 16);
}

function renderTankDexRequirementShort(entry: TankDexEntry): string {
  if (entry.tank.tier === 1) return 'Starter';
  const requiredLevel = entry.tank.unlockLevel;
  const hasSkippedUpgrade = entry.paths.some((path) => path.segments.some((segment) => segment.requiresSkippedUpgrade));
  return `LV ${requiredLevel}${hasSkippedUpgrade ? ' skip' : ''}`;
}

function renderTankDexPath(path: TankDexEntry['paths'][number]): string {
  if (path.segments.length === 0) {
    return '<div class="tank-dex-path"><strong>Basic</strong><small>Starter tank</small></div>';
  }

  const segmentLabels = path.segments
    .map((segment) => {
      const skip = segment.requiresSkippedUpgrade ? ' skipped upgrade' : '';
      return `LV ${segment.requiredLevel} ${escapeHtml(segment.toDisplayName)}${skip}`;
    })
    .join(' / ');

  return `
    <div class="tank-dex-path">
      <strong>${path.displayNames.map((name) => escapeHtml(name)).join(' > ')}</strong>
      <small>${segmentLabels}</small>
    </div>
  `;
}

function renderLeaderboardRow(entry: LeaderboardEntry, index: number): string {
  const tankClass = getTankClass(entry.tankId);
  return `
    <div class="leader-row">
      <span class="leader-rank">${index + 1}</span>
      <b>${escapeHtml(entry.name)}</b>
      <span>${entry.score.toLocaleString()}</span>
      <small>${escapeHtml(tankClass.displayName)}</small>
    </div>
  `;
}

function renderUpgradeMilestones(): string {
  return [15, 30, 45]
    .map((level) => {
      const count = TANK_CLASSES.filter((tankClass) => tankClass.unlockLevel === level).length;
      const tier = level === 15 ? 'Tier 2' : level === 30 ? 'Tier 3' : 'Tier 4';
      const className = level === 15 ? 'milestone--tier2' : level === 30 ? 'milestone--tier3' : 'milestone--tier4';
      return `
        <div class="milestone ${className}">
          <div>
            <span>LV ${level}</span>
            <strong>${tier}</strong>
            <small>${count} picks</small>
          </div>
          <span class="milestone-star" aria-hidden="true"></span>
        </div>
      `;
    })
    .join('');
}

function renderStarterPaths(): string {
  return STARTER_PATHS.map((tankClass) => {
    const tags = tankClass.tags.slice(0, 2).map((tag) => tag.replace('-', ' ')).join(' / ');
    const asset = STARTER_PATH_ASSETS[tankClass.id] ?? DASHBOARD_ASSETS.tankTwin;
    const cardClass = `path-card--${tankClass.id.replace(/_/g, '-')}`;
    return `
      <div class="path-card ${cardClass}">
        <span class="path-card-corner" aria-hidden="true"></span>
        <img src="${asset}" loading="lazy" decoding="async" alt="${escapeHtml(tankClass.displayName)} tank class icon" />
        <strong>${escapeHtml(tankClass.displayName)}</strong>
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
    <div class="system-row system-row--classes"><span><i aria-hidden="true"></i>Tank classes</span><strong>${TANK_CLASSES.length}</strong></div>
    <div class="system-row system-row--tier"><span><i aria-hidden="true"></i>Tier 4 picks</span><strong>${tierFourCount}</strong></div>
    <div class="system-row system-row--auto"><span><i aria-hidden="true"></i>Auto builds</span><strong>${autoCount}</strong></div>
    <div class="system-row system-row--drone"><span><i aria-hidden="true"></i>Drone builds</span><strong>${droneCount}</strong></div>
  `;
}

function renderAchievementBadges(achievementIds: string[]): string {
  if (achievementIds.length === 0) {
    return '<div class="empty-badge"><span aria-hidden="true"></span><b>No badges yet</b></div>';
  }
  return achievementIds
    .map((achievementId) => `<div class="badge-pill"><span aria-hidden="true"></span>${escapeHtml(ACHIEVEMENT_LABELS[achievementId] ?? achievementId)}</div>`)
    .join('');
}

function getProfileDisplayLevel(profileXp: number): number {
  return Math.max(1, Math.min(99, Math.floor(profileXp / 180) + 1));
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
