import Phaser from 'phaser';
import {
  CONTROLS_HEIGHT,
  CRYSTAL_STATS,
  DROPS,
  GOLD,
  PLAYER_ATTACK_FX,
  PLAYER_STATS,
  SHOP,
  SHOP_LEVELS,
  SKILLS,
  WALL_THICKNESS,
  WEAPONS,
  WORLD_SIZE,
  WORLD_VISUALS,
  type AttrId,
  type EnemyTierId,
  type SkillDef,
} from '../config/balance';
import { BOTTOM_EXTRA_LIFT } from '../config/uiLayout';
import {
  BOSS_SCALING,
  bossForChapter,
} from '../config/balance';
import Boss from '../entities/Boss';
import Crystal from '../entities/Crystal';
import Enemy from '../entities/Enemy';
import Player from '../entities/Player';
import Shop from '../entities/Shop';
import { BODY, CELL, FLUID, HEART, VESSEL, VITAL, VOID_CSS } from '../render/palette';
import {
  buildDropTextures,
  buildHeartGlowTexture,
  buildHeartTexture,
  buildParasiteTextures,
  buildPlayerTextures,
  buildProjectileTextures,
  buildShopTexture,
  buildWorldTextures,
} from '../render/textures';
import { getSafeAreaInsets } from '../utils/safeArea';

/** Летящий заряд стрелка */
interface EnemyShot {
  image: Phaser.GameObjects.Image;
  damage: number;
  /** Цель заряда: игрок или кристалл (проверка попадания различается) */
  target: 'player' | 'crystal';
  bornAt: number;
  ttl: number;
}

/**
 * Цель, по которой может попасть атака игрока: обычный враг или босс главы.
 * Оба умеют получать урон и имеют радиус тела, поэтому сцена работает с ними
 * единообразно.
 */
type DamageTarget = Enemy | Boss;

/**
 * Сфера атаки игрока: летит от героя, доворачивается к цели и разлетается
 * брызгами при попадании или на пределе радиуса атаки.
 */
interface PlayerShot {
  image: Phaser.GameObjects.Image;
  /** Текущее направление полёта (единичный вектор) */
  dir: Phaser.Math.Vector2;
  speed: number;
  /** Сколько уже пролетела (px) */
  traveled: number;
  /** Радиус атаки на момент выстрела (px) */
  maxDistance: number;
  /** Цель сферы (null — выстрел в пустоту) */
  target: DamageTarget | null;
  damage: number;
  isCrit: boolean;
  /** Сфера летит в лавку: попадёт — откроет магазин */
  hitShop: boolean;
  /** Когда последний раз оставлен отпечаток «хвоста» */
  lastTrailAt: number;
}
import RunState from '../state/RunState';
import { loadRun, saveRun, clearRun, maybeSaveBest } from '../state/Save';
import { rollDrops } from '../systems/Drops';
import { computeStats } from '../systems/DerivedStats';
import {
  describeWeapon,
  pickShopOffers,
  consumeStockSlot,
  serviceRange,
  type ShopOffer,
  type ShopTabId,
} from '../systems/Shop';
import { bossAttackDamage, bossStatsForChapter } from '../systems/BossAi';
import { skillAtLevel, describeSkillNumbers, skillById } from '../systems/Skills';
import WaveSystem from '../systems/WaveSystem';
import { burst, showFloatingText } from '../ui/FloatingText';
import type UIScene from './UIScene';

/** Насколько глубоко внутрь карты от стены появляются враги */
const GATE_OFFSET = 42;
/** Через сколько мс после разрушения кристалла игра вернётся в меню */
const GAME_OVER_DELAY = 4200;
/** Как часто автосохранение забега обновляется (мс) */
const AUTOSAVE_INTERVAL = 2000;

/** Скейлинг зума камеры под размер экрана */
function computeZoom(width: number, height: number): number {
  const minSide = Math.min(width, height);
  if (minSide >= 1100) return 1;
  if (minSide >= 800) return 0.5;
  return 0.4;
}

export default class GameScene extends Phaser.Scene {
  private player!: Player;
  private crystal!: Crystal;
  private shop!: Shop;
  private walls: Phaser.GameObjects.Rectangle[] = [];
  private enemies: Enemy[] = [];
  /** Босс текущей главы (не более одного одновременно) */
  private boss: Boss | null = null;
  private coins: Phaser.Physics.Arcade.Image[] = [];
  private waveSystem!: WaveSystem;
  private run = new RunState();
  private uiSceneRef?: Phaser.Scene;

  private gates: Phaser.Math.Vector2[] = [];
  private crystalSpawn = new Phaser.Math.Vector2();

  private isGameOver = false;
  private paused = false;
  private respawnAt = 0;
  private lastStatsAt = 0;
  private lastSaveAt = 0;

  private shopOffers: ShopOffer[] = [];
  /** Заморозка врагов (услуга лавки): враги не двигаются и не бьют до этого времени */
  private freezeUntil = 0;
  /** Кулдаун-метки слотов навыков */
  private skillCooldowns: number[] = [0, 0, 0];
  /** Рывок: враги, которых уже задел текущий рывок, и множитель его урона */
  private dashHitIds = new Set<Enemy>();
  private dashDamageMult = 1;

  /** Заряды стрелков: летящие снаряды с уроном по игроку/кристаллу */
  private enemyShots: EnemyShot[] = [];

  /** Сферы атаки игрока: летят от героя и разлетаются брызгами */
  private playerShots: PlayerShot[] = [];

  private readonly zeroDir = new Phaser.Math.Vector2(0, 0);

  constructor() {
    super('Game');
  }

  create(): void {
    this.isGameOver = false;
    this.paused = false;
    this.respawnAt = 0;
    this.lastStatsAt = 0;
    this.enemies = [];
    this.boss = null;
    this.coins = [];
    this.walls = [];
    this.gates = [];
    this.shopOffers = [];
    this.enemyShots = [];
    this.playerShots = [];
    this.run = new RunState();
    this.lastSaveAt = 0;
    // Поле-инициализация срабатывает только при первом конструировании сцены,
    // поэтому при повторном забеге сбрасываем накопленное состояние вручную
    this.skillCooldowns = [0, 0, 0];
    this.dashHitIds.clear();
    this.dashDamageMult = 1;
    this.freezeUntil = 0;

    // World переиспользуется между забегами и не сбрасывает паузу сам:
    // после game-over физику нужно явно вернуть в рабочее состояние.
    this.physics.world.resume();

    this.cameras.main.setBackgroundColor(VOID_CSS);

    this.uiSceneRef = this.scene.get('UI');

    this.createTextures();
    this.buildWorld();
    this.createCrystal();
    this.createShop();
    this.createPlayer();
    this.setupCollisions();
    this.setupWaveSystem();
    this.setupCamera();

    this.run.startedAt = this.time.now;
    this.restoreSavedRun();

    // UI-сцена: джойстик, кнопка атаки, характеристики, панели выбора
    if (this.scene.isActive('UI')) {
      this.scene.stop('UI');
    }
    this.scene.launch('UI');

    this.scale.on('resize', this.handleResize, this);
    this.events.once('shutdown', () => {
      this.scale.off('resize', this.handleResize, this);
      this.scene.stop('UI');
    });
  }

  /**
   * Текстуры из простых фигур: мир-плоть, лейкоцит-игрок, сердце бога,
   * лут, лавка и паразиты. Фигуры рисуются в render/textures.ts, сцена
   * только раскладывает их по местам.
   */
  private createTextures(): void {
    const g = this.make.graphics({ x: 0, y: 0 }, false);

    // Мир внутри бога: тайлы плоти, вен и стен — у них свой ключ-признак,
    // поэтому проверяем их отдельно от фигур персонажей и врагов.
    if (!this.textures.exists('floor-cells')) {
      buildWorldTextures(g);
    }

    if (this.textures.exists('player')) {
      g.destroy();
      return;
    }

    buildPlayerTextures(g);
    buildProjectileTextures(g);
    buildHeartTexture(g);
    buildHeartGlowTexture(g);
    buildDropTextures(g);
    buildShopTexture(g);
    buildParasiteTextures(g);

    g.destroy();
  }

  private createCrystal(): void {
    const y = WORLD_SIZE - WALL_THICKNESS - CRYSTAL_STATS.offsetFromBottom;
    this.crystal = new Crystal(this, WORLD_SIZE / 2, y);
    this.crystalSpawn.set(WORLD_SIZE / 2, y - 130);
  }

  /** Лавка у нижней стены: в неё игрок «входит» ударом, там тратится золото */
  private createShop(): void {
    const x = WORLD_SIZE / 2 + SHOP.offsetX;
    const y = WORLD_SIZE - WALL_THICKNESS - SHOP.offsetFromBottom;
    this.shop = new Shop(this, x, y);
  }

  private createPlayer(): void {
    this.player = new Player(this, this.crystalSpawn.x, this.crystalSpawn.y);
  }

  /** Карта внутри бога: пол-ткань с венами, мышцы-стены и ворота-«раны» */
  private buildWorld(): void {
    this.physics.world.setBounds(0, 0, WORLD_SIZE, WORLD_SIZE);

    // Пол: бесшовные тайлы плоти с клетками и поверх — слой вен
    this.add
      .tileSprite(0, 0, WORLD_SIZE, WORLD_SIZE, 'floor-cells')
      .setOrigin(0)
      .setDepth(-4);
    this.add
      .tileSprite(0, 0, WORLD_SIZE, WORLD_SIZE, 'floor-veins')
      .setOrigin(0)
      .setTileScale(WORLD_VISUALS.veinScale)
      .setAlpha(WORLD_VISUALS.veinAlpha)
      .setDepth(-3);

    this.drawVessels();

    const half = WALL_THICKNESS / 2;
    const wallSpecs = [
      { x: WORLD_SIZE / 2, y: half, w: WORLD_SIZE, h: WALL_THICKNESS },
      { x: WORLD_SIZE / 2, y: WORLD_SIZE - half, w: WORLD_SIZE, h: WALL_THICKNESS },
      { x: half, y: WORLD_SIZE / 2, w: WALL_THICKNESS, h: WORLD_SIZE },
      { x: WORLD_SIZE - half, y: WORLD_SIZE / 2, w: WALL_THICKNESS, h: WORLD_SIZE },
    ];

    this.walls = wallSpecs.map((s) => {
      // Прямоугольник остаётся только физическим телом — поверх рисуем тайл мышцы
      const wall = this.add.rectangle(s.x, s.y, s.w, s.h, BODY.wallBase);
      wall.setDepth(-1);
      wall.setVisible(false);
      this.physics.add.existing(wall, true);

      // Волокна мышцы идут вдоль стены, поэтому тайл зависит от ориентации
      const wallFlesh = s.w > s.h ? 'wall-flesh-h' : 'wall-flesh-v';
      this.add.tileSprite(s.x, s.y, s.w, s.h, wallFlesh).setDepth(-1);
      this.drawWallMembrane(s);

      return wall;
    });

    // Ворота: середина верхней, левой и правой стены (внизу кристалл)
    this.gates = [
      new Phaser.Math.Vector2(WORLD_SIZE / 2, WALL_THICKNESS + GATE_OFFSET),
      new Phaser.Math.Vector2(WALL_THICKNESS + GATE_OFFSET, WORLD_SIZE / 2),
      new Phaser.Math.Vector2(WORLD_SIZE - WALL_THICKNESS - GATE_OFFSET, WORLD_SIZE / 2),
    ];

    for (const gate of this.gates) {
      // Верхние ворота стоят на горизонтальной стене, боковые — на вертикальной
      this.drawGatePore(gate, gate.x === WORLD_SIZE / 2);

      const glow = this.add.circle(gate.x, gate.y, WORLD_VISUALS.poreRadius, VESSEL.wound, 0.1).setDepth(4);
      this.tweens.add({
        targets: glow,
        alpha: 0.32,
        scale: 1.15,
        duration: 1100,
        yoyo: true,
        repeat: -1,
      });
    }
  }

  /** Крупные сосуды: тянутся от сердца к верхней части тела бога */
  private drawVessels(): void {
    const g = this.add.graphics().setDepth(-2);
    const heartX = WORLD_SIZE / 2;
    const heartY = WORLD_SIZE - WALL_THICKNESS - CRYSTAL_STATS.offsetFromBottom;

    for (let i = 0; i < WORLD_VISUALS.vesselCount; i++) {
      const endX = Phaser.Math.Between(WALL_THICKNESS * 2, WORLD_SIZE - WALL_THICKNESS * 2);
      const endY = Phaser.Math.Between(WALL_THICKNESS * 2, Math.round(WORLD_SIZE * 0.42));
      this.strokeVessel(
        g,
        heartX + Phaser.Math.Between(-70, 70),
        heartY,
        endX,
        endY,
        WORLD_VISUALS.vesselWidth,
        WORLD_VISUALS.vesselBranchDepth,
      );
    }
  }

  /** Один сосуд: толстая артерия со светлым бликом и ответвлением */
  private strokeVessel(
    g: Phaser.GameObjects.Graphics,
    startX: number,
    startY: number,
    endX: number,
    endY: number,
    width: number,
    depth: number,
  ): void {
    const steps = 16;
    const sway = Phaser.Math.Between(50, 170) * (Math.random() < 0.5 ? -1 : 1);
    const points: Array<{ x: number; y: number }> = [];

    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const bulge = Math.sin(t * Math.PI);
      points.push({
        x: startX + (endX - startX) * t + bulge * sway,
        y: startY + (endY - startY) * t - bulge * width * 2,
      });
    }

    const stroke = (color: number, alpha: number, lineWidth: number) => {
      g.lineStyle(lineWidth, color, alpha);
      g.beginPath();
      g.moveTo(points[0].x, points[0].y);
      for (let i = 1; i < points.length; i++) {
        g.lineTo(points[i].x, points[i].y);
      }
      g.strokePath();
    };

    stroke(VESSEL.artery, 0.85, width);
    stroke(VESSEL.veinHi, 0.3, Math.max(1, width * 0.35));

    if (depth > 0) {
      const branch = points[Math.round(points.length * 0.55)];
      this.strokeVessel(
        g,
        branch.x,
        branch.y,
        branch.x + Phaser.Math.Between(-280, 280),
        branch.y - Phaser.Math.Between(120, 340),
        Math.max(3, width * 0.45),
        depth - 1,
      );
    }
  }

  /** Светлая мембрана по внутреннему краю стены: отделяет плоть от прохода */
  private drawWallMembrane(spec: { x: number; y: number; w: number; h: number }): void {
    const g = this.add.graphics().setDepth(-1);
    const inset = WORLD_VISUALS.wallMembraneInset;
    g.lineStyle(3, BODY.wallMembrane, WORLD_VISUALS.wallMembraneAlpha);

    if (spec.w > spec.h) {
      const y = spec.y < WORLD_SIZE / 2 ? spec.y + spec.h / 2 - inset : spec.y - spec.h / 2 + inset;
      g.lineBetween(0, y, WORLD_SIZE, y);
    } else {
      const x = spec.x < WORLD_SIZE / 2 ? spec.x + spec.w / 2 - inset : spec.x - spec.w / 2 + inset;
      g.lineBetween(x, 0, x, WORLD_SIZE);
    }
  }

  /**
   * Ворота-«рана»: мягкий овальный рот в стене и яма-пора на полу перед ним.
   * Никаких прямоугольников — только вложенные овалы и круги.
   */
  private drawGatePore(gate: Phaser.Math.Vector2, horizontal: boolean): void {
    const r = WORLD_VISUALS.poreRadius;
    const g = this.add.graphics().setDepth(-1);
    const wallHalf = WALL_THICKNESS / 2;

    // Рот в стене: вложенные овалы дают мягкий край, последний — самый тёмный
    const mouthX = horizontal ? gate.x : gate.x < WORLD_SIZE / 2 ? wallHalf : WORLD_SIZE - wallHalf;
    const mouthY = horizontal ? wallHalf : gate.y;
    const along = WORLD_VISUALS.poreMouthLength;
    const across = WALL_THICKNESS * 2.1;
    for (let i = 0; i < WORLD_VISUALS.poreMouthLayers; i++) {
      const k = 1 - i * 0.14;
      g.fillStyle(VESSEL.woundDeep, 0.2 + i * 0.2);
      if (horizontal) {
        g.fillEllipse(mouthX, mouthY, along * k, across * k);
      } else {
        g.fillEllipse(mouthX, mouthY, across * k, along * k);
      }
    }

    // Яма-пора на полу перед воротами: провал и кольца раны
    g.fillStyle(VESSEL.woundDeep, 1);
    g.fillCircle(gate.x, gate.y, r);

    for (let i = 0; i < WORLD_VISUALS.poreRings; i++) {
      const k = 1 - i / (WORLD_VISUALS.poreRings + 1);
      g.lineStyle(3 - i, VESSEL.wound, 0.5 - i * 0.12);
      g.strokeCircle(gate.x, gate.y, r * k);
    }

    // Жилы, стягивающиеся к ране: ломаные, а не прямые спицы
    for (let i = 0; i < WORLD_VISUALS.poreVeins; i++) {
      const angle = (i / WORLD_VISUALS.poreVeins) * Math.PI * 2 + 0.4;
      const length = Phaser.Math.Between(Math.round(r * 1.2), Math.round(r * 2.2));
      const bend = Phaser.Math.FloatBetween(-0.4, 0.4);

      g.lineStyle(2, VESSEL.vein, 0.5);
      g.beginPath();
      g.moveTo(gate.x, gate.y);
      for (let s = 1; s <= 3; s++) {
        const k = s / 3;
        const a = angle + bend * k;
        g.lineTo(gate.x + Math.cos(a) * length * k, gate.y + Math.sin(a) * length * k);
      }
      g.strokePath();
    }
  }

  private setupCollisions(): void {
    // Через стены нельзя пройти
    this.physics.add.collider(this.player, this.walls);
    this.physics.add.collider(this.enemies, this.walls);
    // Враги мягко расталкивают друг друга, чтобы не складывались в одну точку
    this.physics.add.collider(this.enemies, this.enemies);
    // Враги блокируют игрока, но не толкают его (body.pushable = false)
    this.physics.add.collider(this.player, this.enemies);
    // Кристалл — препятствие для врагов, атакуют его в упор
    this.physics.add.collider(this.enemies, this.crystal);
  }

  private setupWaveSystem(): void {
    this.waveSystem = new WaveSystem({
      onWaveStart: (wave, count) => {
        this.events.emit('wave-start', { wave, count });
      },
      onSpawn: (tier) => this.spawnEnemy(tier),
      onWaveClear: (wave) => this.onWaveClear(wave),
      onIntermissionTick: (secondsLeft) => {
        this.events.emit('intermission', {
          secondsLeft,
          wave: this.waveSystem.wave + 1,
        });
      },
    });
  }

  /** Спавн врага из ворот: у ворот по одному, с анимацией выхода */
  private spawnEnemy(tierId: EnemyTierId): void {
    if (tierId === 'boss') {
      // Босс — отдельная сущность с набором атак (см. spawnBoss)
      this.spawnBoss();
      return;
    }
    const gate = Phaser.Utils.Array.GetRandom(this.gates);
    const enemy = new Enemy(this, gate.x, gate.y, tierId, this.waveSystem.wave);
    this.enemies.push(enemy);

    enemy.setScale(0.2);
    const body = enemy.body as Phaser.Physics.Arcade.Body | null;
    if (body) {
      body.enable = false;
    }
    this.tweens.add({
      targets: enemy,
      scale: 1,
      duration: 260,
      ease: 'Back.easeOut',
      onComplete: () => {
        const b = enemy.body as Phaser.Physics.Arcade.Body | null;
        if (b && enemy.active) {
          b.enable = true;
        }
      },
    });
  }

  // ---------- Босс главы ----------

  /** Спавн босса главы: один на волну, из случайных ворот */
  private spawnBoss(): void {
    if (this.boss && !this.boss.isDead) {
      return;
    }
    const chapter = this.run.chapter;
    const def = bossForChapter(chapter);
    const gate = Phaser.Utils.Array.GetRandom(this.gates);
    this.boss = new Boss(this, gate.x, gate.y, def, chapter);

    // Босс — препятствие для игрока, но не толкается
    this.physics.add.collider(this.player, this.boss);
    this.physics.add.collider(this.boss, this.crystal);

    this.events.emit('boss-spawn', {
      name: def.name,
      chapter,
      maxHp: this.boss.maxHp,
      hp: this.boss.hp,
    });
    showFloatingText(this, gate.x, gate.y - 60, def.name, '#ff5252', 22);
  }

  /**
   * Кадр босса: движение и атаки. Урон наносится в первый кадр фазы active —
   * то есть после телеграфа, так что игрок видит, что будет.
   */
  private updateBoss(time: number): void {
    const boss = this.boss;
    if (!boss || boss.isDead) {
      return;
    }

    const startedAttack = boss.update(
      time,
      this.player.x,
      this.player.y,
      !this.player.isDead,
      this.crystal.x,
      this.crystal.y,
    );

    this.events.emit('boss-hp', { hp: Math.ceil(boss.hp), maxHp: boss.maxHp });

    if (startedAttack) {
      this.resolveBossAttack(boss, time);
    }
  }

  /** Применение атаки босса в момент её активной фазы */
  private resolveBossAttack(boss: Boss, time: number): void {
    const attack = boss.currentAttack;
    if (!attack) {
      return;
    }
    const damage = bossAttackDamage(boss.damage, attack);
    const radius = attack.radius ?? 140;

    this.cameras.main.shake(240, 0.008);

    if (attack.id === 'charge') {
      // Рывок: босс бросается к цели и бьёт всех на пути
      const tx = boss.target === 'player' ? this.player.x : this.crystal.x;
      const ty = boss.target === 'player' ? this.player.y : this.crystal.y;
      const angle = Math.atan2(ty - boss.y, tx - boss.x);
      const dist = Math.min(attack.distance ?? 420, Phaser.Math.Distance.Between(boss.x, boss.y, tx, ty));
      const body = boss.body as Phaser.Physics.Arcade.Body | null;
      body?.reset(boss.x + Math.cos(angle) * dist, boss.y + Math.sin(angle) * dist);
      boss.setVelocity(0, 0);
      burst(this, boss.x, boss.y, boss.def.color, 10, 110, 6);
      this.applyBossAreaDamage(boss, damage, radius, boss.x, boss.y);
      return;
    }

    if (attack.id === 'spikes') {
      // Шипы во все стороны: урон по кругу вокруг босса
      burst(this, boss.x, boss.y, 0xffd54f, 16, 220, 7);
      this.applyBossAreaDamage(boss, damage, radius, boss.x, boss.y);
      return;
    }

    if (attack.id === 'slam') {
      // Один сильный удар по текущей цели
      burst(this, boss.x, boss.y, 0xff5252, 12, 120, 6);
      this.applyBossTargetDamage(boss, damage);
      return;
    }

    // groundAoe: удар по территории под целью
    const tx = boss.target === 'player' ? this.player.x : this.crystal.x;
    const ty = boss.target === 'player' ? this.player.y : this.crystal.y;
    burst(this, tx, ty, 0xff7043, 18, 200, 8);
    this.cameras.main.shake(300, 0.01);
    this.applyBossAreaDamage(boss, damage, radius, tx, ty);
    void time;
  }

  /** Урон по площади: цель задета, если она в радиусе удара */
  private applyBossAreaDamage(boss: Boss, damage: number, radius: number, x: number, y: number): void {
    const now = this.time.now;

    if (!this.player.isDead && !this.player.isInvulnerable(now)) {
      const dist = Phaser.Math.Distance.Between(x, y, this.player.x, this.player.y);
      if (dist <= radius + PLAYER_STATS.radius) {
        const died = this.player.takeDamage(damage, now);
        showFloatingText(this, this.player.x, this.player.y - 52, `-${damage}`, '#ff5252', 16);
        if (died) {
          this.killPlayer();
        }
      }
    }

    const distToCrystal = Phaser.Math.Distance.Between(x, y, this.crystal.x, this.crystal.y);
    if (distToCrystal <= radius + CRYSTAL_STATS.radius) {
      const destroyed = this.crystal.takeDamage(damage);
      showFloatingText(this, this.crystal.x, this.crystal.y - 70, `-${damage}`, '#ff8a65', 14);
      if (destroyed) {
        this.gameOver();
      }
    }
    void boss;
  }

  /** Одиночный удар босса по игроку или сердцу */
  private applyBossTargetDamage(boss: Boss, damage: number): void {
    const now = this.time.now;
    if (boss.target === 'player') {
      if (this.player.isDead || this.player.isInvulnerable(now)) {
        return;
      }
      const died = this.player.takeDamage(damage, now);
      showFloatingText(this, this.player.x, this.player.y - 52, `-${damage}`, '#ff5252', 17);
      if (died) {
        this.killPlayer();
      }
      return;
    }

    const destroyed = this.crystal.takeDamage(damage);
    showFloatingText(this, this.crystal.x, this.crystal.y - 70, `-${damage}`, '#ff8a65', 15);
    if (destroyed) {
      this.gameOver();
    }
  }

  // ---------- Камера ----------

  private setupCamera(): void {
    const cam = this.cameras.main;
    cam.setZoom(computeZoom(this.scale.width, this.scale.height));
    this.positionCameraViewport();
    this.applyCameraBounds();

    cam.startFollow(this.player, false, 0.12, 0.12);
    cam.setDeadzone(80, 80);
  }

  /**
   * Viewport камеры — весь экран минус глухой нижний бар (мир под бар не заходит).
   * Нижний safe-area (home-индикатор) учитывается: в Safari его отдаёт env(),
   * а в standalone env() врёт (0px, WebKit bug 254868) — его компенсирует
   * fallback-измерение в safeArea.ts; сверху добавлен BOTTOM_EXTRA_LIFT —
   * тот же доп. подъём, что у бара в UIScene (см. config/uiLayout.ts).
   * Фон бара в UIScene дотянут до края канваса, так что зона индикатора
   * перекрыта баром, а не пустотой.
   */
  private positionCameraViewport(): void {
    const { width, height } = this.scale;
    const safeBottom = getSafeAreaInsets().bottom + BOTTOM_EXTRA_LIFT;
    this.cameras.main.setViewport(0, 0, width, height - CONTROLS_HEIGHT - safeBottom);
  }

  /** Компенсация границ при zoom != 1, чтобы камера не выходила за карту */
  private applyCameraBounds(): void {
    const cam = this.cameras.main;
    // const zoom = cam.zoom;
    // const extraX = (1 / zoom - 1) * this.scale.width;
    // const extraY = (1 / zoom - 1) * this.scale.height;
    // cam.setBounds(-extraX / 2, -extraY / 2, WORLD_SIZE + extraX, WORLD_SIZE + extraY);
    cam.setBounds(0, 0, WORLD_SIZE, WORLD_SIZE);
  }

  private handleResize(): void {
    this.cameras.main.setZoom(computeZoom(this.scale.width, this.scale.height));
    this.positionCameraViewport();
    this.applyCameraBounds();
  }

  // ---------- Волны ----------

  /** Волна зачищена: награды не выдаются — всё покупается в лавке */
  private onWaveClear(wave: number): void {
    showFloatingText(
      this,
      this.crystal.x,
      this.crystal.y - 120,
      `ВОЛНА ${wave} ЗАЧИЩЕНА`,
      '#8bc34a',
      16,
    );
  }

  // ---------- Лавка ----------

  /** Игрок ударил по лавке: игра на паузе, открывается окно покупок */
  private openShop(): void {
    this.shopOffers = pickShopOffers(this.run);
    // Игра встанет на паузу — летящие сферы не должны замереть в воздухе
    this.clearPlayerShots();
    this.setPaused(true);
    this.emitShopOffers();
  }

  private emitShopOffers(): void {
    // Группируем офферы по вкладкам в стабильном порядке
    const tabOrder: ShopTabId[] = ['goods', 'services', 'skills', 'shop'];
    const tabs = tabOrder
      .map((tabId) => ({
        id: tabId,
        offers: this.shopOffers
          .filter((offer) => offer.tab === tabId)
          .map((offer) => ({
            id: offer.id,
            title: offer.title,
            desc: offer.desc,
            tab: offer.tab,
            cost: offer.cost,
            disabled: offer.disabled,
            soldOut: offer.soldOut,
            rarity: offer.rarity,
            level: offer.level,
            maxLevel: offer.maxLevel,
          })),
      }))
      .filter((tab) => tab.offers.length > 0);

    this.events.emit('shop-offer', {
      gold: this.run.gold,
      shopLevel: this.run.shopLevel,
      nextUpgradeCost:
        this.run.shopLevel < SHOP_LEVELS.maxLevel
          ? SHOP_LEVELS.upgradeCosts[this.run.shopLevel - 1]
          : null,
      tabs,
    });
  }

  /** Покупка в лавке (вызывается из UI) */
  public buyShopItem(id: string): void {
    const offer = this.shopOffers.find((o) => o.id === id);
    if (!offer || offer.disabled || offer.soldOut) {
      return;
    }

    if (!this.run.spendGold(offer.cost)) {
      this.refreshShop();
      return;
    }
    this.run.registerPurchase(offer.id);
    this.applyShopOffer(offer);

    // Товар из стока: слот заменяется следующим той же редкости
    if (offer.slotIndex !== undefined) {
      consumeStockSlot(this.run, offer.slotIndex);
    }

    showFloatingText(this, this.player.x, this.player.y - 60, offer.title, '#ffd54f', 15);
    this.shopOffers = pickShopOffers(this.run);
    this.emitShopOffers();
    this.emitStats();
    // Покупки происходят на паузе — сейвим сразу, а не по автотроттлингу
    this.persistRun(this.time.now, true);
  }

  /** Применение эффекта покупки */
  private applyShopOffer(offer: ShopOffer): void {
    const payload = offer.payload ?? {};

    if (payload.points) {
      this.run.addStatPoints(payload.points);
      this.player.recalcFor(this.run);
    }

    if (payload.crystalHp) {
      this.crystal.addMaxHp(payload.crystalHp);
    }

    if (payload.skillId) {
      if (payload.skillTargetLevel) {
        // Улучшение изученного навыка до следующего уровня.
        // Золото уже списано в buyShopItem — передаём cost 0, чтобы
        // upgradeSkillLevel не пытался списать его повторно.
        const def = skillById(payload.skillId);
        if (def) {
          this.run.upgradeSkillLevel(payload.skillId, 0, def.maxLevel);
        }
      } else {
        this.run.learnSkill(payload.skillId);
      }
      this.events.emit('skills-changed');
    }

    if (payload.weaponId) {
      const result = this.run.addWeapon(payload.weaponId);
      if (result === 'full') {
        // Инвентарь полон: оружие сразу продаётся
        const def = WEAPONS.find((w) => w.id === payload.weaponId);
        const value = Math.max(1, Math.round((def?.shopCost ?? 5) * DROPS.sellRatio));
        this.run.addGold(value);
        showFloatingText(this, this.player.x, this.player.y - 84, `ИНВЕНТАРЬ ПОЛОН +${value}G`, '#ff8a65', 14);
      } else {
        this.player.recalcFor(this.run);
        this.events.emit('skills-changed');
      }
    }

    if (payload.serviceId) {
      this.applyService(payload.serviceId);
    }

    if (offer.kind === 'upgrade') {
      // Золото уже списано в buyShopItem — второй раз не списываем,
      // иначе upgradeShop возвращал false и уровень лавки не рос.
      this.run.upgradeShop(0);
      // stockShopLevel сбрасывается в RunState — pickShopOffers создаст новый сток
    }
  }

  /** Услуга: случайный эффект в диапазоне, зависящем от уровня лавки */
  private applyService(
    serviceId: 'heal' | 'crystalRepair' | 'mana' | 'freeze',
  ): void {
    const range = serviceRange(serviceId, this.run.shopLevel);

    if (serviceId === 'heal') {
      const amount = Math.round(Phaser.Math.Between(range.min, range.max));
      this.player.heal(amount);
      showFloatingText(this, this.player.x, this.player.y - 84, `+${amount} HP`, '#8bc34a', 15);
      return;
    }

    if (serviceId === 'crystalRepair') {
      const amount = Math.round(Phaser.Math.Between(range.min, range.max));
      this.crystal.repair(amount);
      showFloatingText(this, this.crystal.x, this.crystal.y - 90, `+${amount} HP`, '#4dd0e1', 15);
      return;
    }

    if (serviceId === 'mana') {
      const amount = Math.round(Phaser.Math.Between(range.min, range.max));
      this.player.restoreMana(amount);
      showFloatingText(this, this.player.x, this.player.y - 84, `+${amount} MP`, '#b39ddb', 15);
      return;
    }

    // freeze: заморозка всех врагов на N секунд
    const seconds = Phaser.Math.FloatBetween(range.min, range.max);
    this.freezeUntil = this.time.now + seconds * 1000;
    for (const enemy of this.enemies) {
      enemy.setVelocity(0, 0);
    }
    showFloatingText(this, this.player.x, this.player.y - 84, `ЗАМОРОЗКА ${seconds.toFixed(1)} С`, '#b3e5fc', 15);
  }

  private refreshShop(): void {
    this.shopOffers = pickShopOffers(this.run);
    this.emitShopOffers();
  }

  /** UI закрывает лавку: игра продолжается, отсчёт до волны идёт дальше */
  public closeShop(): void {
    // Небольшая задержка, чтобы удержание кнопки атаки не открыло лавку снова
    this.player.suppressAttack(600);
    this.setPaused(false);
    this.events.emit('shop-closed');
  }

  /** Игрок достаточно близко, чтобы ударом открыть лавку */
  private isNearShop(): boolean {
    if (!this.player || this.player.isDead) {
      return false;
    }
    return (
      Phaser.Math.Distance.Between(this.player.x, this.player.y, this.shop.x, this.shop.y) <=
      SHOP.interactRange
    );
  }

  // ---------- Бой ----------

  /**
   * Атака игрока: белая сфера летит в ближайшего врага в радиусе атаки.
   * Урон наносится в момент попадания сферы (см. updatePlayerShots).
   */
  private tryPlayerAttack(now: number): void {
    if (!this.player.canAttack(now)) {
      return;
    }
    this.player.markAttacked(now);

    const target = this.findNearestTarget(this.player.x, this.player.y, this.player.attackRange);

    // Врагов рядом нет: сфера летит вперёд, а удар по лавке открывает магазин
    if (!target) {
      if (this.isNearShop()) {
        const toShop = new Phaser.Math.Vector2(
          this.shop.x - this.player.x,
          this.shop.y - this.player.y,
        ).normalize();
        this.player.faceAttack(toShop, now);
        this.spawnPlayerShot(toShop, null, 0, false, true);
        return;
      }
      const dir = this.player.facing.clone();
      this.player.faceAttack(dir, now);
      this.spawnPlayerShot(dir, null, 0, false, false);
      return;
    }

    const dir = new Phaser.Math.Vector2(
      target.x - this.player.x,
      target.y - this.player.y,
    ).normalize();
    // Смотрим в сторону атаки: у неё приоритет над направлением движения
    this.player.faceAttack(dir, now);

    // Крит: шанс от удачи, урон × множитель
    const isCrit = Math.random() < this.player.critChance;
    const damage = isCrit
      ? Math.round(this.player.effectiveDamage(now) * this.player.critMultiplier)
      : this.player.effectiveDamage(now);

    this.spawnPlayerShot(dir, target, damage, isCrit, false);
  }

  /** Запуск сферы атаки из тела игрока в заданном направлении */
  private spawnPlayerShot(
    dir: Phaser.Math.Vector2,
    target: DamageTarget | null,
    damage: number,
    isCrit: boolean,
    hitShop: boolean,
  ): void {
    // Сфера появляется на краю тела героя, а не в его центре
    const head = PLAYER_STATS.radius - 6;
    const image = this.add
      .image(this.player.x + dir.x * head, this.player.y + dir.y * head, 'player-shot')
      .setDepth(13)
      .setScale(0.45);
    this.tweens.add({ targets: image, scale: 1, duration: 90, ease: 'Quad.easeOut' });
    // Лёгкая отдача: герой подаётся назад от направления выстрела
    this.player.attackRecoil(dir);

    this.playerShots.push({
      image,
      dir: dir.clone().normalize(),
      // Скорость такая, что всю дистанцию атаки сфера пролетает за flightMs
      speed: this.player.attackRange / (PLAYER_ATTACK_FX.flightMs / 1000),
      traveled: head,
      maxDistance: this.player.attackRange,
      target,
      damage,
      isCrit,
      hitShop,
      lastTrailAt: this.time.now,
    });
  }

  /** Полёт сфер: самонаведение, попадание в цель/лавку и взрыв брызгами */
  private updatePlayerShots(now: number, deltaMs: number): void {
    const dt = deltaMs / 1000;

    for (const shot of this.playerShots) {
      if (!shot.image.active) {
        continue;
      }

      // Лёгкое самонаведение: доворачиваем сферу к цели, чтобы попадать в бегущих
      if (shot.target && !shot.target.isDead) {
        const want = Math.atan2(shot.target.y - shot.image.y, shot.target.x - shot.image.x);
        const current = Math.atan2(shot.dir.y, shot.dir.x);
        const maxTurn = PLAYER_ATTACK_FX.homingTurn * dt;
        const turn = Phaser.Math.Clamp(Phaser.Math.Angle.Wrap(want - current), -maxTurn, maxTurn);
        shot.dir.setToPolar(current + turn, 1);
      }

      const step = shot.speed * dt;
      shot.image.x += shot.dir.x * step;
      shot.image.y += shot.dir.y * step;
      shot.traveled += step;

      // Попадание в цель
      const target = shot.target;
      if (
        target &&
        !target.isDead &&
        Phaser.Math.Distance.Between(shot.image.x, shot.image.y, target.x, target.y) <=
          PLAYER_ATTACK_FX.hitRadius + target.hitRadius
      ) {
        this.splashAt(shot.image.x, shot.image.y);
        this.applyPlayerHit(target, shot.dir, shot.damage, shot.isCrit);
        shot.image.destroy();
        continue;
      }

      // Попадание в лавку: сфера гаснет, магазин открывается
      if (
        shot.hitShop &&
        Phaser.Math.Distance.Between(shot.image.x, shot.image.y, this.shop.x, this.shop.y) <= SHOP.glowRadius
      ) {
        this.splashAt(this.shop.x, this.shop.y - 24);
        shot.image.destroy();
        this.openShop();
        continue;
      }

      // Радиус атаки закончился — сфера разлетается в воздухе
      if (shot.traveled >= shot.maxDistance) {
        this.splashAt(shot.image.x, shot.image.y);
        shot.image.destroy();
        continue;
      }

      // Отпечаток «хвоста» — сфера выглядит как комета
      if (now - shot.lastTrailAt >= PLAYER_ATTACK_FX.trailEveryMs) {
        shot.lastTrailAt = now;
        this.spawnShotTrail(shot.image.x, shot.image.y);
      }
    }

    this.playerShots = this.playerShots.filter((shot) => shot.image.active);
  }

  /** Урон сферы по врагу: цифры урона, микроотброс и обработка смерти */
  private applyPlayerHit(
    target: DamageTarget,
    dir: Phaser.Math.Vector2,
    damage: number,
    isCrit: boolean,
  ): void {
    if (target.isDead) {
      return;
    }

    showFloatingText(
      this,
      target.x,
      target.y - 24,
      isCrit ? `${damage}!` : `${damage}`,
      isCrit ? '#ff7043' : '#ffd54f',
      isCrit ? 20 : 16,
    );

    // Микроотброс, чтобы врагов можно было «кайтить» (босс не отбрасывается)
    if (target instanceof Enemy) {
      target.setPosition(target.x + dir.x * 8, target.y + dir.y * 8);
    }

    this.damageTarget(target, damage);
  }

  /** Взрыв сферы: мягкая белая вспышка и разлетающиеся брызги */
  private splashAt(x: number, y: number): void {
    // Мягкая вспышка — та же текстура сферы, но крупнее, ярче и быстро гаснет
    const flash = this.add
      .image(x, y, 'player-shot')
      .setDepth(112)
      .setScale(0.6)
      .setAlpha(0.85);
    this.tweens.add({
      targets: flash,
      scale: (PLAYER_ATTACK_FX.splashSpread / PLAYER_ATTACK_FX.shotRadius) * 0.8,
      alpha: 0,
      duration: 180,
      ease: 'Quad.easeOut',
      onComplete: () => flash.destroy(),
    });

    // Брызги-капли плазмы
    burst(this, x, y, CELL.body, PLAYER_ATTACK_FX.splashCount, PLAYER_ATTACK_FX.splashSpread, 5);
  }

  /** Отпечаток «хвоста» сферы: уменьшается и гаснет */
  private spawnShotTrail(x: number, y: number): void {
    const ghost = this.add
      .image(x, y, 'player-shot')
      .setDepth(12)
      .setScale(Phaser.Math.FloatBetween(0.34, 0.52))
      .setAlpha(0.6);
    this.tweens.add({
      targets: ghost,
      scale: 0.08,
      alpha: 0,
      duration: PLAYER_ATTACK_FX.trailFadeMs,
      ease: 'Quad.easeOut',
      onComplete: () => ghost.destroy(),
    });
  }

  /** Убрать все летящие сферы игрока (пауза, конец забега) */
  private clearPlayerShots(): void {
    for (const shot of this.playerShots) {
      shot.image.destroy();
    }
    this.playerShots = [];
  }

  /** Применение навыка из кнопки-креста (вызывается из UIScene) */
  public castSkill(slot: number): void {
    const skillId = this.run.skillSlots[slot];
    if (!skillId || this.player.isDead || this.isGameOver || this.paused) {
      return;
    }
    const base = SKILLS.find((s) => s.id === skillId) as SkillDef | undefined;
    if (!base) {
      return;
    }

    // Эффективные параметры с учётом уровня прокачки навыка
    const skill = skillAtLevel(base, this.run.skillLevelOf(skillId));

    const now = this.time.now;
    const readyAt = this.skillCooldowns[slot] ?? 0;
    if (now < readyAt || !this.player.spendMana(skill.manaCost)) {
      if (now < readyAt) {
        return;
      }
      showFloatingText(this, this.player.x, this.player.y - 70, 'НЕТ МАНЫ', '#b39ddb', 13);
      return;
    }

    this.skillCooldowns[slot] = now + skill.cooldown;

    if (skillId === 'nova' && skill.radius && skill.damageMult) {
      this.castNova(skill.radius, skill.damageMult, now);
    } else if (skillId === 'dash' && skill.dashDistance && skill.damageMult !== undefined) {
      this.castDash(skill.dashDistance, skill.damageMult, now);
    } else if (skillId === 'chain' && skill.chainTargets && skill.damageMult) {
      this.castChain(skill.chainTargets, skill.damageMult, now);
    } else if (skillId === 'shield' && skill.shieldHpPct && skill.duration) {
      this.player.activateShield(this.player.maxHp * skill.shieldHpPct, skill.duration, now);
      showFloatingText(this, this.player.x, this.player.y - 70, 'ЩИТ', '#81d4fa', 15);
    } else if (skillId === 'berserk' && skill.berserkMult && skill.duration) {
      this.player.activateBerserk(skill.berserkMult, skill.duration, now);
      showFloatingText(this, this.player.x, this.player.y - 70, 'БЕРСЕРК!', '#ff7043', 16);
    }
  }

  /**
   * Рывок: быстрый слайд в направлении движения (или последнего направления).
   * Урон всем врагам на пути, на время рывка игрок неуязвим.
   */
  private castDash(distance: number, damageMult: number, now: number): void {
    const ui = this.uiSceneRef as UIScene | undefined;
    const move = ui?.moveVector ?? this.zeroDir;
    const dir =
      move.lengthSq() > 0.01
        ? move.clone().normalize()
        : this.player.facing.clone().normalize();

    this.dashHitIds.clear();
    this.dashDamageMult = damageMult;
    this.player.startDash(dir, distance, now);
    showFloatingText(this, this.player.x, this.player.y - 70, 'РЫВОК!', '#80cbc4', 15);
  }

  /** Кадр рывка: двигает игрока и бьёт врагов на пути (по одному разу за рывок) */
  private updatePlayerDash(now: number, deltaMs: number): void {
    if (!this.player.isDashing) {
      return;
    }

    const wasLeft = this.player.dashDistanceLeft;
    this.player.updateDash(now, deltaMs);
    const moved = wasLeft - this.player.dashDistanceLeft;

    if (moved <= 0) {
      return;
    }

    const damage = Math.round(this.player.effectiveDamage(now) * this.dashDamageMult);
    const dashTargets: DamageTarget[] = [...this.enemies];
    const boss = this.boss;
    if (boss && !boss.isDead && !this.dashHitIds.has(boss as unknown as Enemy)) {
      dashTargets.push(boss);
    }
    for (const enemy of dashTargets) {
      const hitKey = enemy as unknown as Enemy;
      if (enemy.isDead || this.dashHitIds.has(hitKey)) {
        continue;
      }
      const dist = Phaser.Math.Distance.Between(this.player.x, this.player.y, enemy.x, enemy.y);
      if (dist <= PLAYER_STATS.radius + 42 + (enemy instanceof Boss ? enemy.radius : 0)) {
        this.dashHitIds.add(hitKey);
        showFloatingText(this, enemy.x, enemy.y - 24, `${damage}`, '#80cbc4', 15);
        this.damageTarget(enemy, damage);
      }
    }
  }

  /** Цепная молния: бьёт ближайшего врага и перескакивает на соседних */
  private castChain(targets: number, damageMult: number, now: number): void {
    const CHAIN_RANGE_FIRST = 420;
    const CHAIN_RANGE_HOP = 260;

    const hit: DamageTarget[] = [];
    let from = new Phaser.Math.Vector2(this.player.x, this.player.y);
    let range = CHAIN_RANGE_FIRST;
    const candidates: DamageTarget[] = [...this.enemies];
    if (this.boss && !this.boss.isDead) {
      candidates.push(this.boss);
    }

    for (let i = 0; i < targets; i++) {
      let best: DamageTarget | null = null;
      let bestDist = range;
      for (const enemy of candidates) {
        if (enemy.isDead || hit.includes(enemy)) {
          continue;
        }
        const dist = Phaser.Math.Distance.Between(from.x, from.y, enemy.x, enemy.y);
        if (dist <= bestDist) {
          bestDist = dist;
          best = enemy;
        }
      }
      if (!best) {
        break;
      }

      hit.push(best);
      this.drawLightning(from, new Phaser.Math.Vector2(best.x, best.y));
      from = new Phaser.Math.Vector2(best.x, best.y);
      range = CHAIN_RANGE_HOP;
    }

    if (hit.length === 0) {
      showFloatingText(this, this.player.x, this.player.y - 70, 'НЕТ ЦЕЛЕЙ', '#b39ddb', 13);
      return;
    }

    const damage = Math.round(this.player.effectiveDamage(now) * damageMult);
    for (const enemy of hit) {
      showFloatingText(this, enemy.x, enemy.y - 24, `${damage}`, '#80deea', 15);
      this.damageTarget(enemy, damage);
    }
  }

  /** Визуал молнии: ломаная с лёгким дрожанием, быстро гаснет */
  private drawLightning(from: Phaser.Math.Vector2, to: Phaser.Math.Vector2): void {
    const line = this.add.graphics().setDepth(11);
    line.lineStyle(3, FLUID.plasmaTrail, 0.9);
    line.beginPath();
    line.moveTo(from.x, from.y);
    const steps = 4;
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      const jitterX = i < steps ? Phaser.Math.Between(-14, 14) : 0;
      const jitterY = i < steps ? Phaser.Math.Between(-14, 14) : 0;
      line.lineTo(
        from.x + (to.x - from.x) * t + jitterX,
        from.y + (to.y - from.y) * t + jitterY,
      );
    }
    line.strokePath();

    this.tweens.add({
      targets: line,
      alpha: 0,
      duration: 220,
      onComplete: () => line.destroy(),
    });
  }

  /** Нова: урон всем врагам в радиусе */
  private castNova(radius: number, damageMult: number, now: number): void {
    // Визуал: расширяющееся кольцо энергии
    const ring = this.add.circle(this.player.x, this.player.y, 30, VITAL.mana, 0.35).setDepth(11);
    this.tweens.add({
      targets: ring,
      radius,
      alpha: 0,
      duration: 320,
      onComplete: () => ring.destroy(),
    });

    const damage = Math.round(this.player.effectiveDamage(now) * damageMult);
    const novaTargets: DamageTarget[] = [...this.enemies];
    if (this.boss && !this.boss.isDead) {
      novaTargets.push(this.boss);
    }
    for (const enemy of novaTargets) {
      if (enemy.isDead) {
        continue;
      }
      if (Phaser.Math.Distance.Between(this.player.x, this.player.y, enemy.x, enemy.y) <= radius) {
        showFloatingText(this, enemy.x, enemy.y - 24, `${damage}`, '#b39ddb', 15);
        this.damageTarget(enemy, damage);
      }
    }
  }

  /** Кулдауны слотов навыков (для индикаторов в UI) */
  public getSkillCooldownRatio(slot: number, now: number): number {
    const skillId = this.run.skillSlots[slot];
    if (!skillId) {
      return -1;
    }
    const skill = SKILLS.find((s) => s.id === skillId);
    if (!skill) {
      return -1;
    }
    // Нормируем по эффективному КД (снижается с уровнем навыка)
    const eff = skillAtLevel(skill, this.run.skillLevelOf(skillId));
    const left = (this.skillCooldowns[slot] ?? 0) - now;
    return left <= 0 ? 1 : Math.max(0, 1 - left / eff.cooldown);
  }

  /** Открытие инвентаря из UI (пауза) */
  public openInventory(): void {
    this.setPaused(true);
    this.events.emit('inventory-open', this.buildInventoryPayload());
  }

  public refreshInventory(): void {
    this.events.emit('inventory-open', this.buildInventoryPayload());
  }

  /** Слоты навыков (для подписей кнопок креста в UI) */
  public get skillSlots(): Array<string | null> {
    return this.run.skillSlots;
  }

  /** Уровень прокачки навыка (для бейджа на кнопке в UI) */
  public skillLevel(skillId: string): number {
    return this.run.skillLevelOf(skillId);
  }

  private buildInventoryPayload() {
    const stats = computeStats(this.run);
    return {
      level: this.run.level,
      gold: this.run.gold,
      statPoints: this.run.statPoints,
      attrs: { ...this.run.attrs },
      skillSlots: [...this.run.skillSlots],
      learnedSkills: this.run.learnedSkills.map((id) => {
        const base = SKILLS.find((s) => s.id === id);
        const level = this.run.skillLevelOf(id);
        const effective = base ? skillAtLevel(base, level) : undefined;
        return {
          id,
          name: base?.name ?? id,
          level,
          maxLevel: base?.maxLevel ?? 1,
          desc: effective ? describeSkillNumbers(effective) : '',
          manaCost: effective?.manaCost ?? 0,
          cooldown: effective?.cooldown ?? 0,
        };
      }),
      equippedUid: this.run.equippedWeaponUid,
      items: this.run.inventory.map((item) => {
        const def = WEAPONS.find((w) => w.id === item.weaponId);
        return {
          uid: item.uid,
          name: def?.name ?? item.weaponId,
          rarity: def?.rarity ?? ('common' as const),
          desc: def ? describeWeapon(def) : '',
        };
      }),
      stats,
    };
  }

  /** Закрытие инвентаря (вызывается из UI, панель скрывает себя) */
  public closeInventory(): void {
    this.player.suppressAttack(500);
    this.setPaused(false);
  }

  /** Трата очка характеристик (вызывается из инвентаря) */
  public spendStatPoint(attr: AttrId): void {
    if (this.run.spendStatPoint(attr)) {
      this.player.recalcFor(this.run);
      this.refreshInventory();
      this.emitStats();
      this.persistRun(this.time.now, true);
    }
  }

  /** Экипировка/снятие оружия (вызывается из инвентаря) */
  public toggleEquipItem(uid: string): void {
    if (this.run.toggleEquip(uid)) {
      this.player.recalcFor(this.run);
      this.refreshInventory();
      this.emitStats();
      this.persistRun(this.time.now, true);
    }
  }

  /** Продажа предмета из инвентаря */
  public sellInventoryItem(uid: string): void {
    const value = this.run.sellItem(uid, DROPS.sellRatio);
    if (value > 0) {
      this.player.recalcFor(this.run);
      this.refreshInventory();
      this.emitStats();
      this.persistRun(this.time.now, true);
    }
  }

  /** Назначение навыка на слот креста ('' — снять со слота) */
  public assignSkill(skillId: string, slot: number): void {
    const previous = this.run.skillSlots[slot];
    if (previous) {
      this.run.unassignSkill(previous);
    }
    if (skillId) {
      this.run.unassignSkill(skillId);
      this.run.skillSlots[slot] = skillId;
      this.events.emit('skills-changed');
    }
    this.refreshInventory();
    this.persistRun(this.time.now, true);
  }

  private findNearestEnemy(x: number, y: number, range: number): Enemy | null {
    let best: Enemy | null = null;
    let bestDist = range;

    for (const enemy of this.enemies) {
      if (enemy.isDead) {
        continue;
      }
      const dist = Phaser.Math.Distance.Between(x, y, enemy.x, enemy.y);
      if (dist <= bestDist) {
        bestDist = dist;
        best = enemy;
      }
    }
    return best;
  }

  /** Ближайшая цель атаки с учётом босса: обычные враги и босс главы */
  private findNearestTarget(x: number, y: number, range: number): DamageTarget | null {
    let best: DamageTarget | null = this.findNearestEnemy(x, y, range);
    let bestDist = best ? Phaser.Math.Distance.Between(x, y, best.x, best.y) : range;

    const boss = this.boss;
    if (boss && !boss.isDead) {
      const dist = Phaser.Math.Distance.Between(x, y, boss.x, boss.y) - boss.radius;
      if (dist <= bestDist) {
        best = boss;
      }
    }
    return best;
  }

  /** Урон по цели игрока (враг или босс) с обработкой смерти */
  private damageTarget(target: DamageTarget, damage: number): boolean {
    if (target instanceof Boss) {
      const died = target.takeDamage(damage);
      if (died) {
        this.onBossKilled(target);
      }
      return died;
    }
    const died = target.takeDamage(damage);
    if (died) {
      this.onEnemyKilled(target);
    }
    return died;
  }

  /** Выстрел стрелка: заряд летит в текущую цель (игрок или кристалл) */
  private spawnEnemyShot(enemy: Enemy, now: number): void {
    const tier = enemy.tier;
    if (!tier.projectileSpeed) {
      return;
    }
    const tx = enemy.target === 'player' ? this.player.x : this.crystal.x;
    const ty = enemy.target === 'player' ? this.player.y : this.crystal.y;
    const angle = Math.atan2(ty - enemy.y, tx - enemy.x);

    const image = this.physics.add
      .image(enemy.x + Math.cos(angle) * tier.radius, enemy.y + Math.sin(angle) * tier.radius, 'enemy-shot')
      .setDepth(11);
    const speedMult = 1 + 0.01 * Math.min(30, this.waveSystem.wave - 1); // чуть быстрее на поздних волнах
    (image.body as Phaser.Physics.Arcade.Body).setVelocity(
      Math.cos(angle) * tier.projectileSpeed * speedMult,
      Math.sin(angle) * tier.projectileSpeed * speedMult,
    );

    this.enemyShots.push({
      image,
      damage: enemy.damage,
      target: enemy.target,
      bornAt: now,
      ttl: 3500,
    });
  }

  /** Полёт зарядов: попадания в игрока/кристалл, стена, срок жизни */
  private updateEnemyShots(now: number): void {
    for (const shot of this.enemyShots) {
      if (!shot.image.active) {
        continue;
      }
      const expired = now - shot.bornAt > shot.ttl;
      const outOfWorld =
        shot.image.x < 0 ||
        shot.image.y < 0 ||
        shot.image.x > WORLD_SIZE ||
        shot.image.y > WORLD_SIZE;

      if (expired || outOfWorld) {
        shot.image.destroy();
        continue;
      }

      if (shot.target === 'player') {
        if (this.player.isDead) {
          continue;
        }
        const dist = Phaser.Math.Distance.Between(
          shot.image.x, shot.image.y, this.player.x, this.player.y,
        );
        if (dist <= PLAYER_STATS.radius + 8) {
          if (!this.player.isInvulnerable(now)) {
            const died = this.player.takeDamage(shot.damage, now);
            showFloatingText(this, this.player.x, this.player.y - 52, `-${shot.damage}`, '#ff5252', 16);
            this.cameras.main.shake(100, 0.005);
            if (died) {
              this.killPlayer();
            }
          }
          shot.image.destroy();
        }
        continue;
      }

      const dist = Phaser.Math.Distance.Between(
        shot.image.x, shot.image.y, this.crystal.x, this.crystal.y,
      );
      if (dist <= CRYSTAL_STATS.radius + 8) {
        const destroyed = this.crystal.takeDamage(shot.damage);
        showFloatingText(this, this.crystal.x, this.crystal.y - 70, `-${shot.damage}`, '#ff8a65', 14);
        this.cameras.main.shake(110, 0.004);
        if (destroyed) {
          this.gameOver();
        }
        shot.image.destroy();
      }
    }
    this.enemyShots = this.enemyShots.filter((s) => s.image.active);
  }

  private applyEnemyAttack(enemy: Enemy, now: number): void {
    if (enemy.target === 'player') {
      if (this.player.isDead || this.player.isInvulnerable(now)) {
        return;
      }
      const died = this.player.takeDamage(enemy.damage, now);
      showFloatingText(this, this.player.x, this.player.y - 52, `-${enemy.damage}`, '#ff5252', 16);
      this.cameras.main.shake(120, 0.006);
      if (died) {
        this.killPlayer();
      }
      return;
    }

    const destroyed = this.crystal.takeDamage(enemy.damage);
    showFloatingText(this, enemy.x, enemy.y - 24, `-${enemy.damage}`, '#ff8a65', 15);
    this.cameras.main.shake(140, 0.005);
    if (destroyed) {
      this.gameOver();
    }
  }

  // ---------- Гибель игрока и респавн ----------

  private killPlayer(): void {
    if (this.isGameOver || this.respawnAt > this.time.now) {
      return; // смерть уже обработана — не дублируем оверлей и отсчёт
    }

    // Обычный путь: Player.takeDamage() уже пометил игрока мёртвым.
    // Прямой вызов (сценарная смерть) — убиваем сущность здесь,
    // иначе враги продолжали бы видеть «живого» игрока и не шли к кристаллу.
    this.player.kill();
    this.respawnAt = this.time.now + PLAYER_STATS.respawnDelay;

    // Гибель лейкоцита: ошмётки белой клетки разлетаются
    burst(this, this.player.x, this.player.y, CELL.membrane, 12);
    this.cameras.main.shake(320, 0.012);
    this.cameras.main.flash(300, 255, 60, 60);

    this.events.emit('player-died', { respawnIn: PLAYER_STATS.respawnDelay / 1000 });
    this.emitStats();
  }

  private respawnPlayer(): void {
    this.player.respawn(this.crystalSpawn.x, this.crystalSpawn.y, this.time.now);

    // Отодвигаем врагов от точки возрождения, чтобы не убили сразу
    for (const enemy of this.enemies) {
      const dist = Phaser.Math.Distance.Between(
        enemy.x,
        enemy.y,
        this.crystalSpawn.x,
        this.crystalSpawn.y,
      );
      if (dist < 160) {
        const angle = Math.atan2(
          enemy.y - this.crystalSpawn.y,
          enemy.x - this.crystalSpawn.x,
        );
        enemy.setPosition(
          this.crystalSpawn.x + Math.cos(angle) * 200,
          this.crystalSpawn.y + Math.sin(angle) * 200,
        );
        const body = enemy.body as Phaser.Physics.Arcade.Body | null;
        body?.reset(enemy.x, enemy.y);
      }
    }

    // Возрождение у сердца: вспышка белых телец
    burst(this, this.crystalSpawn.x, this.crystalSpawn.y, CELL.membrane, 10);
    this.events.emit('player-respawned');
    this.emitStats();
  }

  // ---------- Сохранение забега ----------

  /** Полный бонус к макс. HP сердца, накопленный покупками в лавке */
  private crystalBonusHp(): number {
    return Math.max(0, this.crystal.maxHp - CRYSTAL_STATS.maxHp);
  }

  /** Автосохранение: троттлится, не пишем в хранилище чаще 1 раза в 2с */
  private persistRun(now: number, force = false): void {
    if (this.isGameOver || (!force && now - this.lastSaveAt < AUTOSAVE_INTERVAL)) {
      return;
    }
    this.lastSaveAt = now;
    saveRun(this.run, this.waveSystem.wave, this.crystalBonusHp());
  }

  /**
   * Восстановление забега из localStorage: если сейв есть, продолжаем его —
   * волна, на которой игра оборвалась, начинается заново.
   */
  private restoreSavedRun(): void {
    const saved = loadRun();
    if (!saved) {
      return;
    }

    this.run.restore(saved);
    this.waveSystem.restartAtWave(saved.wave);
    if (saved.crystalBonusHp > 0) {
      this.crystal.addMaxHp(saved.crystalBonusHp);
    }
    this.player.recalcFor(this.run);
  }

  // ---------- Конец забега: кристалл разрушен ----------

  private gameOver(): void {
    if (this.isGameOver) {
      return;
    }
    this.isGameOver = true;
    this.setPaused(true);
    this.clearPlayerShots();

    // Забег окончен: сейв удаляется, результат идёт в рекорд
    clearRun();
    maybeSaveBest({
      wave: this.waveSystem.wave,
      level: this.run.level,
      kills: this.run.kills,
      time: this.run.getElapsedSeconds(this.time.now),
    });

    this.crystal.playDestroyed();
    // Сердце лопается: кровь разлетается, камера «краснеет»
    burst(this, this.crystal.x, this.crystal.y, HEART.muscleHi, 14);
    burst(this, this.crystal.x, this.crystal.y, HEART.muscleDeep, 12);
    this.cameras.main.shake(600, 0.02);
    this.cameras.main.flash(500, 150, 25, 35);

    this.events.emit('game-over', {
      wave: this.waveSystem.wave,
      kills: this.run.kills,
      level: this.run.level,
      gold: this.run.gold,
      time: this.run.getElapsedSeconds(this.time.now),
    });

    this.time.delayedCall(GAME_OVER_DELAY, () => {
      this.scene.start('Start');
    });
  }

  // ---------- Награды: убийства, монеты ----------

  private onEnemyKilled(enemy: Enemy): void {
    this.run.kills++;
    burst(this, enemy.x, enemy.y, enemy.tier.color, 7);
    this.spawnCoins(enemy.x, enemy.y, enemy.goldReward);
    this.rollLoot(enemy);
    this.grantXp(enemy.xpReward, enemy.x, enemy.y - 34);
    this.removeEnemy(enemy);
  }

  /**
   * Награда за убийство босса: много опыта, щедрое золото, гарантированные
   * очки характеристик и улучшенный лут. Боссы следующих глав сильнее и
   * награждают больше (bossStatsForChapter).
   */
  private onBossKilled(boss: Boss): void {
    const chapter = boss.chapter;
    const reward = bossStatsForChapter(boss.def, chapter);

    burst(this, boss.x, boss.y, boss.def.color, 22, 200, 9);
    burst(this, boss.x, boss.y, HEART.muscleHi, 16, 160, 7);
    this.cameras.main.shake(420, 0.014);
    this.cameras.main.flash(320, 255, 200, 120);

    // Много золота: часть монетами (сами притянутся к игроку), часть сразу
    const coinTotal = Math.round(reward.gold * BOSS_SCALING.coinShare);
    const coinCount = 12;
    const perCoin = Math.max(1, Math.round(coinTotal / coinCount));
    for (let i = 0; i < coinCount; i++) {
      const angle = (i / coinCount) * Math.PI * 2;
      this.spawnCoins(boss.x + Math.cos(angle) * 46, boss.y + Math.sin(angle) * 46, perCoin);
    }
    const directGold = reward.gold - coinTotal;
    if (directGold > 0) {
      this.run.addGold(directGold);
    }

    // Гарантированные очки характеристик и много опыта (сразу несколько уровней)
    this.run.addStatPoints(BOSS_SCALING.statPoints);
    this.grantXp(reward.xp, boss.x, boss.y - 60);
    // Инвентарь мог упереться в предел — пересчитываем статы в любом случае
    this.player.recalcFor(this.run);

    // Улучшенный лут (босс даёт бонус к шансам — см. rollDrops)
    const notLearned = SKILLS.filter((s) => !this.run.learnedSkills.includes(s.id)).map((s) => s.id);
    for (const drop of rollDrops(this.run, true, notLearned)) {
      if (drop.kind === 'weapon') {
        const result = this.run.addWeapon(drop.weaponId ?? 'rusty');
        if (result === 'full') {
          const def = WEAPONS.find((w) => w.id === (drop.weaponId ?? 'rusty'));
          this.run.addGold(Math.max(1, Math.round((def?.shopCost ?? 5) * 0.2)));
        }
      }
    }

    showFloatingText(this, boss.x, boss.y - 96, `ГЛАВА ${chapter} ПРОЙДЕНА!`, '#ffd54f', 24);
    showFloatingText(this, this.player.x, this.player.y - 92, `+${reward.gold} G`, '#ffd54f', 20);

    this.events.emit('boss-dead', { chapter, name: boss.def.name });
    this.boss = null;
    this.emitStats();
    this.persistRun(this.time.now, true);
  }

  /**
   * Ролл дополнительного лута: очко характеристик, оружие и/или навык.
   * Каждый вид лута проверяется независимо, поэтому за одно убийство
   * может выпасть сразу несколько предметов.
   */
  private rollLoot(enemy: Enemy): void {
    const notLearned = SKILLS.filter((s) => !this.run.learnedSkills.includes(s.id)).map((s) => s.id);
    const drops = rollDrops(this.run, enemy.tier.id === 'boss', notLearned);

    // Разносим пикапы, чтобы они не наложились друг на друга
    drops.forEach((drop, index) => {
      const angle = (index / Math.max(1, drops.length)) * Math.PI * 2;
      const x = enemy.x + Math.cos(angle) * 26;
      const y = enemy.y + Math.sin(angle) * 26;

      if (drop.kind === 'statPoint') {
        this.spawnPickup(x, y, 'loot-point', () => {
          this.run.addStatPoints(1);
          showFloatingText(this, this.player.x, this.player.y - 70, '+1 ОЧКО!', '#8bc34a', 16);
          this.emitStats();
        });
        return;
      }

      if (drop.kind === 'weapon' && drop.weaponId) {
        const weaponId = drop.weaponId;
        this.spawnPickup(x, y, 'loot-weapon', () => {
          const result = this.run.addWeapon(weaponId);
          const def = WEAPONS.find((w) => w.id === weaponId);
          if (result === 'full') {
            // Инвентарь полон: оружие конвертируется в золото
            const value = Math.max(1, Math.round((def?.shopCost ?? 5) * DROPS.sellRatio));
            this.run.addGold(value);
            showFloatingText(this, this.player.x, this.player.y - 70, `СУМКА ПОЛНА +${value}G`, '#ff8a65', 14);
          } else {
            showFloatingText(this, this.player.x, this.player.y - 70, def?.name ?? 'ОРУЖИЕ', '#ffd54f', 15);
            this.player.recalcFor(this.run);
          }
          this.emitStats();
        });
        return;
      }

      if (drop.kind === 'skill' && drop.skillId) {
        const skillId = drop.skillId;
        this.spawnPickup(x, y, 'loot-skill', () => {
          if (this.run.learnSkill(skillId)) {
            const def = SKILLS.find((s) => s.id === skillId);
            showFloatingText(this, this.player.x, this.player.y - 70, `НАВЫК: ${def?.name ?? ''}`, '#b39ddb', 16);
            this.events.emit('skills-changed');
          }
          this.emitStats();
        });
      }
    });
  }

  /**
   * Пикап лута: лежит на месте, затем летит к игроку (магнит) и применяет эффект.
   * Текстуры 'loot-point' | 'loot-weapon' | 'loot-skill' создаются в createTextures.
   */
  private spawnPickup(
    x: number,
    y: number,
    texture: string,
    onCollect: () => void,
  ): void {
    const pickup = this.physics.add.image(x, y, texture);
    pickup.setDepth(6);
    pickup.setData('spawnedAt', this.time.now);
    pickup.setData('collect', onCollect);

    const body = pickup.body as Phaser.Physics.Arcade.Body | null;
    body?.setCircle(12);
    pickup.setVelocity(Phaser.Math.Between(-60, 60), Phaser.Math.Between(-60, 60));
    pickup.setDrag(140);
    this.coins.push(pickup as unknown as Phaser.Physics.Arcade.Image);
  }

  private removeEnemy(enemy: Enemy): void {
    const index = this.enemies.indexOf(enemy);
    if (index >= 0) {
      this.enemies.splice(index, 1);
    }
  }

  private spawnCoins(x: number, y: number, total: number): void {
    const count = Phaser.Math.Clamp(Math.round(total / 3), 1, 3);
    const value = Math.max(1, Math.round(total / count));

    for (let i = 0; i < count; i++) {
      const coin = this.physics.add.image(
        x + Phaser.Math.Between(-18, 18),
        y + Phaser.Math.Between(-18, 18),
        'coin',
      );
      coin.setDepth(6);
      coin.setData('value', value);
      coin.setData('spawnedAt', this.time.now);

      const body = coin.body as Phaser.Physics.Arcade.Body | null;
      body?.setCircle(GOLD.coinRadius + 2);

      coin.setVelocity(Phaser.Math.Between(-70, 70), Phaser.Math.Between(-70, 70));
      coin.setDrag(140);
      this.coins.push(coin);
    }
  }

  /** Монеты и пикапы лута сами подлетают к игроку (мобильный UX) */
  private updateCoins(now: number): void {
    for (let i = this.coins.length - 1; i >= 0; i--) {
      const coin = this.coins[i];
      const dist = Phaser.Math.Distance.Between(coin.x, coin.y, this.player.x, this.player.y);
      const spawnedAt = coin.getData('spawnedAt') as number;
      const magnet = now - spawnedAt > GOLD.pickupDelay || dist < GOLD.magnetRadius;

      if (!this.player.isDead && magnet) {
        const angle = Math.atan2(this.player.y - coin.y, this.player.x - coin.x);
        coin.setVelocity(Math.cos(angle) * 460, Math.sin(angle) * 460);
      }

      if (!this.player.isDead && dist < GOLD.collectRadius + PLAYER_STATS.radius) {
        // Монета имеет value, пикап лута — collect-колбэк
        const collect = coin.getData('collect') as (() => void) | undefined;
        if (collect) {
          collect();
        } else {
          const value = coin.getData('value') as number;
          this.run.addGold(value);
          showFloatingText(this, coin.x, coin.y, `+${value}G`, '#ffd54f', 13);
        }
        coin.destroy();
        this.coins.splice(i, 1);
      }
    }
  }

  // ---------- Опыт и уровни ----------

  /**
   * Опыт только приближает уровень. Уровень не выдаёт награду:
   * он расширяет ассортимент лавки (см. minLevel у товаров).
   */
  private grantXp(amount: number, x: number, y: number): void {
    const levels = this.run.addXp(amount);
    showFloatingText(this, x, y, `+${amount} XP`, '#b39ddb', 14);

    if (levels > 0) {
      this.onLevelUp();
    }
  }

  /** Левелап: очко характеристик + баннер */
  private onLevelUp(): void {
    this.run.addStatPoints(1);
    this.player.recalcFor(this.run);
    this.events.emit('level-up', {
      level: this.run.level,
      statPoints: this.run.statPoints,
    });
  }

  // ---------- Пауза, статистика, игровой цикл ----------

  /** Пауза только для лавки: физика и таймеры волн замирают */
  private setPaused(value: boolean): void {
    this.paused = value;
    if (value) {
      this.player.setVelocity(0, 0);
      for (const enemy of this.enemies) {
        enemy.setVelocity(0, 0);
      }
      this.physics.world.pause();
    } else {
      this.physics.world.resume();
    }
  }

  /** Готовность атаки (1 — можно бить): индикатор на кнопке в UI */
  public getAttackCooldownRatio(): number {
    return this.player ? this.player.cooldownRatio(this.time.now) : 1;
  }

  public get isRunFinished(): boolean {
    return this.isGameOver;
  }

  /** Пакет характеристик для нижней панели UI */
  private emitStats(): void {
    this.events.emit('stats', {
      hp: Math.ceil(this.player.hp),
      maxHp: this.player.maxHp,
      mana: Math.ceil(this.player.mana),
      maxMana: this.player.maxMana,
      statPoints: this.run.statPoints,
      damage: this.player.attackDamage,
      attacksPerSec: 1000 / this.player.attackInterval,
      range: this.player.attackRange,
      critChance: this.player.critChance,
      level: this.run.level,
      xp: this.run.xp,
      xpToNext: this.run.xpToNext(),
      gold: this.run.gold,
      wave: this.waveSystem.wave,
      chapter: this.run.chapter,
      enemiesLeft: this.enemies.length,
      kills: this.run.kills,
      crystalHp: Math.ceil(this.crystal.hp),
      crystalMaxHp: this.crystal.maxHp,
      time: this.run.getElapsedSeconds(this.time.now),
      respawnIn: this.player.isDead ? Math.max(0, (this.respawnAt - this.time.now) / 1000) : 0,
      phase: this.waveSystem.phaseName,
      nearShop: this.isNearShop(),
    });
  }

  update(time: number, delta: number): void {
    if (this.isGameOver || this.paused) {
      this.player.setVelocity(0, 0);
      return;
    }

    const ui = this.uiSceneRef as UIScene | undefined;

    // Игрок: движение, атака, возрождение после гибели
    if (this.player.isDead) {
      this.player.setVelocity(0, 0);
      if (time >= this.respawnAt) {
        this.respawnPlayer();
      }
    } else {
      this.updatePlayerDash(time, delta);
      this.player.moveWithInput(ui?.moveVector ?? this.zeroDir, time);
      if (ui?.attackHeld) {
        this.tryPlayerAttack(time);
      }
    }
    this.player.regenTick(delta, time);
    this.player.updateVisuals(time, delta);
    this.updatePlayerShots(time, delta);

    // Враги: идут к цели (игрок или кристалл) и бьют в упор
    const frozen = time < this.freezeUntil;
    for (const enemy of this.enemies) {
      if (enemy.isDead) {
        continue;
      }
      if (frozen) {
        enemy.setVelocity(0, 0);
        continue;
      }
      enemy.moveTowardsTarget(
        this.player.x,
        this.player.y,
        !this.player.isDead,
        this.crystal.x,
        this.crystal.y,
      );
      if (enemy.tryAttack(time)) {
        if (enemy.isRanged) {
          this.spawnEnemyShot(enemy, time);
        } else {
          this.applyEnemyAttack(enemy, time);
        }
      }
    }

    this.updateBoss(time);
    this.updateEnemyShots(time);
    this.updateCoins(time);

    // Подсветка лавки, когда игрок может её открыть
    this.shop.setHighlight(this.isNearShop());

    // Волны: интермиссия, постепенный спавн, зачистка.
    // Босс считается живым врагом — боссовая волна закрывается только после его смерти.
    const aliveEnemies = this.enemies.length + (this.boss && !this.boss.isDead ? 1 : 0);
    this.waveSystem.update(delta, aliveEnemies);

    if (time - this.lastStatsAt > 120) {
      this.lastStatsAt = time;
      this.emitStats();
    }

    this.persistRun(time);
  }
}