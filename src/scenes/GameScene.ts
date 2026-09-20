import Phaser from 'phaser';
import {
  CONTROLS_HEIGHT,
  CRYSTAL_STATS,
  DROPS,
  ENEMY_TIERS,
  GOLD,
  PLAYER_STATS,
  SHOP,
  SHOP_LEVELS,
  SKILLS,
  WALL_THICKNESS,
  WEAPONS,
  WORLD_SIZE,
  type AttrId,
  type EnemyTierId,
  type SkillDef,
} from '../config/balance';
import Crystal from '../entities/Crystal';
import Enemy from '../entities/Enemy';
import Player from '../entities/Player';
import Shop from '../entities/Shop';
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
import RunState from '../state/RunState';
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
import { skillAtLevel, describeSkillNumbers, skillById } from '../systems/Skills';
import WaveSystem from '../systems/WaveSystem';
import { burst, showFloatingText } from '../ui/FloatingText';
import type UIScene from './UIScene';

/** Насколько глубоко внутрь карты от стены появляются враги */
const GATE_OFFSET = 42;
/** Через сколько мс после разрушения кристалла игра вернётся в меню */
const GAME_OVER_DELAY = 4200;

/** Скейлинг зума камеры под размер экрана */
function computeZoom(width: number, height: number): number {
  const minSide = Math.min(width, height);
  if (minSide >= 1100) return 1;
  if (minSide >= 800) return 0.7;
  return 0.55;
}

export default class GameScene extends Phaser.Scene {
  private player!: Player;
  private crystal!: Crystal;
  private shop!: Shop;
  private walls: Phaser.GameObjects.Rectangle[] = [];
  private enemies: Enemy[] = [];
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
    this.coins = [];
    this.walls = [];
    this.gates = [];
    this.shopOffers = [];
    this.enemyShots = [];
    this.run = new RunState();
    // Поле-инициализация срабатывает только при первом конструировании сцены,
    // поэтому при повторном забеге сбрасываем накопленное состояние вручную
    this.skillCooldowns = [0, 0, 0];
    this.dashHitIds.clear();
    this.dashDamageMult = 1;
    this.freezeUntil = 0;

    // World переиспользуется между забегами и не сбрасывает паузу сам:
    // после game-over физику нужно явно вернуть в рабочее состояние.
    this.physics.world.resume();

    this.cameras.main.setBackgroundColor('#14141b');

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
/** Текстуры из простых фигур: игрок, кристалл, монета, тиры врагов */
  private createTextures(): void {
    if (this.textures.exists('player')) {
      return;
    }
    const g = this.make.graphics({ x: 0, y: 0 }, false);

    // Игрок — круг со «зрачком»
    g.fillStyle(0x4fc3f7, 1);
    g.fillCircle(30, 30, 28);
    g.fillStyle(0xffffff, 1);
    g.fillCircle(38, 30, 9);
    g.generateTexture('player', 60, 60);
    g.clear();

    // Кристалл — ромб с бликом
    const size = 96;
    const c = size / 2;
    g.fillStyle(0x26c6da, 1);
    g.fillPoints(
      [
        new Phaser.Math.Vector2(c, c - 42),
        new Phaser.Math.Vector2(c + 30, c),
        new Phaser.Math.Vector2(c, c + 42),
        new Phaser.Math.Vector2(c - 30, c),
      ],
      true,
    );
    g.fillStyle(0x9ceaf3, 1);
    g.fillPoints(
      [
        new Phaser.Math.Vector2(c, c - 24),
        new Phaser.Math.Vector2(c + 16, c),
        new Phaser.Math.Vector2(c, c + 24),
        new Phaser.Math.Vector2(c - 16, c),
      ],
      true,
    );
    g.generateTexture('crystal', size, size);
    g.clear();

    // Монета
    g.fillStyle(0xffca28, 1);
    g.fillCircle(10, 10, 9);
    g.lineStyle(2, 0xb28704, 1);
    g.strokeCircle(10, 10, 8);
    g.generateTexture('coin', 20, 20);
    g.clear();

    // Лут: очко характеристик (зелёный ромб)
    g.fillStyle(0x8bc34a, 1);
    g.fillPoints(
      [new Phaser.Math.Vector2(12, 2), new Phaser.Math.Vector2(22, 12), new Phaser.Math.Vector2(12, 22), new Phaser.Math.Vector2(2, 12)],
      true,
    );
    g.lineStyle(2, 0x33691e, 1);
    g.strokePoints(
      [new Phaser.Math.Vector2(12, 2), new Phaser.Math.Vector2(22, 12), new Phaser.Math.Vector2(12, 22), new Phaser.Math.Vector2(2, 12)],
      true,
    );
    g.generateTexture('loot-point', 24, 24);
    g.clear();

    // Лут: оружие (оранжевый квадрат с мечом-полосой)
    g.fillStyle(0xef6c00, 1);
    g.fillRect(2, 2, 20, 20);
    g.lineStyle(2, 0xffffff, 0.8);
    g.strokeRect(2, 2, 20, 20);
    g.fillStyle(0xfff8e1, 1);
    g.fillRect(10, 5, 4, 12);
    g.fillTriangle(8, 17, 16, 17, 12, 22);
    g.generateTexture('loot-weapon', 24, 24);
    g.clear();

    // Лут: навык (фиолетовый треугольник)
    g.fillStyle(0xb39ddb, 1);
    g.fillTriangle(12, 2, 23, 22, 1, 22);
    g.lineStyle(2, 0x4527a0, 1);
    g.strokeTriangle(12, 2, 23, 22, 1, 22);
    g.generateTexture('loot-skill', 24, 24);
    g.clear();

    // Лавка: корпус, крыша, монета-вывеска
    g.fillStyle(0x6d4c41, 1);
    g.fillRect(10, 42, 96, 46);
    g.fillStyle(0xef6c00, 1);
    g.fillTriangle(0, 46, 116, 46, 58, 2);
    g.fillStyle(0xffd54f, 1);
    g.fillCircle(58, 64, 15);
    g.lineStyle(3, 0x8d6e63, 1);
    g.strokeRect(10, 42, 96, 46);
    g.generateTexture('shop', 116, 96);
    g.clear();

    // Враги по тирам (размер = диаметр тира)
    for (const tier of ENEMY_TIERS) {
      const r = tier.radius;
      g.fillStyle(tier.color, 1);
      g.fillCircle(r, r, r);
      g.lineStyle(3, 0x000000, 0.3);
      g.strokeCircle(r, r, r - 1.5);
      g.fillStyle(0xffffff, 0.9);
      g.fillCircle(r + r * 0.3, r - r * 0.15, Math.max(2, r * 0.22));
      if (tier.id === 'shooter') {
        // Отличимая внешность: «дуло» в центре корпуса
        g.fillStyle(0x004d40, 1);
        g.fillCircle(r, r, Math.max(3, r * 0.4));
        g.fillStyle(0xb2fef7, 1);
        g.fillCircle(r, r, Math.max(2, r * 0.22));
      }
      g.generateTexture(`enemy-${tier.id}`, r * 2, r * 2);
      g.clear();
    }

    // Заряд стрелка: светящийся шар с ярким ядром
    g.fillStyle(0xff8a65, 1);
    g.fillCircle(8, 8, 8);
    g.fillStyle(0xff5252, 1);
    g.fillCircle(8, 8, 6);
    g.fillStyle(0xfff3e0, 1);
    g.fillCircle(8, 8, 3);
    g.generateTexture('enemy-shot', 16, 16);
    g.clear();

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

  /** Карта: сетка, стены-коробка и ворота спавна врагов */
  private buildWorld(): void {
    this.physics.world.setBounds(0, 0, WORLD_SIZE, WORLD_SIZE);

    const grid = this.add.graphics();
    grid.lineStyle(1, 0xffffff, 0.05);
    for (let i = 0; i <= WORLD_SIZE; i += 120) {
      grid.lineBetween(i, 0, i, WORLD_SIZE);
      grid.lineBetween(0, i, WORLD_SIZE, i);
    }
    grid.setDepth(-2);

    const half = WALL_THICKNESS / 2;
    const wallSpecs = [
      { x: WORLD_SIZE / 2, y: half, w: WORLD_SIZE, h: WALL_THICKNESS },
      { x: WORLD_SIZE / 2, y: WORLD_SIZE - half, w: WORLD_SIZE, h: WALL_THICKNESS },
      { x: half, y: WORLD_SIZE / 2, w: WALL_THICKNESS, h: WORLD_SIZE },
      { x: WORLD_SIZE - half, y: WORLD_SIZE / 2, w: WALL_THICKNESS, h: WORLD_SIZE },
    ];

    this.walls = wallSpecs.map((s) => {
      const wall = this.add.rectangle(s.x, s.y, s.w, s.h, 0x3a3a44);
      wall.setDepth(-1);
      this.physics.add.existing(wall, true);
      return wall;
    });

    // Ворота: середина верхней, левой и правой стены (внизу кристалл)
    this.gates = [
      new Phaser.Math.Vector2(WORLD_SIZE / 2, WALL_THICKNESS + GATE_OFFSET),
      new Phaser.Math.Vector2(WALL_THICKNESS + GATE_OFFSET, WORLD_SIZE / 2),
      new Phaser.Math.Vector2(WORLD_SIZE - WALL_THICKNESS - GATE_OFFSET, WORLD_SIZE / 2),
    ];

    const gateTiles = [
      { x: WORLD_SIZE / 2, y: half, w: 180, h: WALL_THICKNESS },
      { x: half, y: WORLD_SIZE / 2, w: WALL_THICKNESS, h: 180 },
      { x: WORLD_SIZE - half, y: WORLD_SIZE / 2, w: WALL_THICKNESS, h: 180 },
    ];
    for (const t of gateTiles) {
      this.add.rectangle(t.x, t.y, t.w, t.h, 0x120b0b, 0.85).setDepth(-1);
    }
    for (const gate of this.gates) {
      const glow = this.add.circle(gate.x, gate.y, 46, 0xff5252, 0.1).setDepth(4);
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
   * fallback-измерение в safeArea.ts. Фон бара в UIScene при этом дотянут до
   * края канваса, так что зона индикатора перекрыта баром, а не пустотой.
   */
  private positionCameraViewport(): void {
    const { width, height } = this.scale;
    const safeBottom = getSafeAreaInsets().bottom;
    this.cameras.main.setViewport(0, 0, width, height - CONTROLS_HEIGHT - safeBottom);
  }

  /** Компенсация границ при zoom != 1, чтобы камера не выходила за карту */
  private applyCameraBounds(): void {
    const cam = this.cameras.main;
    const zoom = cam.zoom;
    const extraX = (1 / zoom - 1) * this.scale.width;
    const extraY = (1 / zoom - 1) * this.scale.height;
    cam.setBounds(-extraX / 2, -extraY / 2, WORLD_SIZE + extraX, WORLD_SIZE + extraY);
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

  /** Атака игрока: удар направлен в ближайшего врага в радиусе */
  private tryPlayerAttack(now: number): void {
    if (!this.player.canAttack(now)) {
      return;
    }
    this.player.markAttacked(now);

    const target = this.findNearestEnemy(this.player.x, this.player.y, this.player.attackRange);

    // Врагов рядом нет — удар по лавке открывает магазин
    if (!target) {
      if (this.isNearShop()) {
        const toShop = new Phaser.Math.Vector2(
          this.shop.x - this.player.x,
          this.shop.y - this.player.y,
        ).normalize();
        this.drawAttackArc(toShop);
        this.openShop();
        return;
      }
      this.drawAttackArc(this.player.facing.clone());
      return;
    }

    const dir = new Phaser.Math.Vector2(
      target.x - this.player.x,
      target.y - this.player.y,
    ).normalize();
    this.drawAttackArc(dir);

    // Крит: шанс от удачи, урон × множитель
    const isCrit = Math.random() < this.player.critChance;
    const damage = isCrit
      ? Math.round(this.player.effectiveDamage(now) * this.player.critMultiplier)
      : this.player.effectiveDamage(now);

    const died = target.takeDamage(damage);
    showFloatingText(
      this,
      target.x,
      target.y - 24,
      isCrit ? `${damage}!` : `${damage}`,
      isCrit ? '#ff7043' : '#ffd54f',
      isCrit ? 20 : 16,
    );

    // Микроотброс, чтобы врагов можно было «кайтить»
    target.setPosition(target.x + dir.x * 8, target.y + dir.y * 8);

    if (died) {
      this.onEnemyKilled(target);
    }
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
    for (const enemy of [...this.enemies]) {
      if (enemy.isDead || this.dashHitIds.has(enemy)) {
        continue;
      }
      const dist = Phaser.Math.Distance.Between(this.player.x, this.player.y, enemy.x, enemy.y);
      if (dist <= PLAYER_STATS.radius + 42) {
        this.dashHitIds.add(enemy);
        const died = enemy.takeDamage(damage);
        showFloatingText(this, enemy.x, enemy.y - 24, `${damage}`, '#80cbc4', 15);
        if (died) {
          this.onEnemyKilled(enemy);
        }
      }
    }
  }

  /** Цепная молния: бьёт ближайшего врага и перескакивает на соседних */
  private castChain(targets: number, damageMult: number, now: number): void {
    const CHAIN_RANGE_FIRST = 420;
    const CHAIN_RANGE_HOP = 260;

    const hit: Enemy[] = [];
    let from = new Phaser.Math.Vector2(this.player.x, this.player.y);
    let range = CHAIN_RANGE_FIRST;

    for (let i = 0; i < targets; i++) {
      let best: Enemy | null = null;
      let bestDist = range;
      for (const enemy of this.enemies) {
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
      const died = enemy.takeDamage(damage);
      showFloatingText(this, enemy.x, enemy.y - 24, `${damage}`, '#80deea', 15);
      if (died) {
        this.onEnemyKilled(enemy);
      }
    }
  }

  /** Визуал молнии: ломаная с лёгким дрожанием, быстро гаснет */
  private drawLightning(from: Phaser.Math.Vector2, to: Phaser.Math.Vector2): void {
    const line = this.add.graphics().setDepth(11);
    line.lineStyle(3, 0x80deea, 0.9);
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
    // Визуал: расширяющееся кольцо
    const ring = this.add.circle(this.player.x, this.player.y, 30, 0xb39ddb, 0.35).setDepth(11);
    this.tweens.add({
      targets: ring,
      radius,
      alpha: 0,
      duration: 320,
      onComplete: () => ring.destroy(),
    });

    const damage = Math.round(this.player.effectiveDamage(now) * damageMult);
    for (const enemy of [...this.enemies]) {
      if (enemy.isDead) {
        continue;
      }
      if (Phaser.Math.Distance.Between(this.player.x, this.player.y, enemy.x, enemy.y) <= radius) {
        const died = enemy.takeDamage(damage);
        showFloatingText(this, enemy.x, enemy.y - 24, `${damage}`, '#b39ddb', 15);
        if (died) {
          this.onEnemyKilled(enemy);
        }
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
    const left = (this.skillCooldowns[slot] ?? 0) - now;
    return left <= 0 ? 1 : Math.max(0, 1 - left / skill.cooldown);
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
    }
  }

  /** Экипировка/снятие оружия (вызывается из инвентаря) */
  public toggleEquipItem(uid: string): void {
    if (this.run.toggleEquip(uid)) {
      this.player.recalcFor(this.run);
      this.refreshInventory();
      this.emitStats();
    }
  }

  /** Продажа предмета из инвентаря */
  public sellInventoryItem(uid: string): void {
    const value = this.run.sellItem(uid, DROPS.sellRatio);
    if (value > 0) {
      this.player.recalcFor(this.run);
      this.refreshInventory();
      this.emitStats();
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

  /** Визуал удара: короткая дуга в сторону цели */
  private drawAttackArc(dir: Phaser.Math.Vector2): void {
    const angle = Math.atan2(dir.y, dir.x);
    const arc = this.add.graphics({ x: this.player.x, y: this.player.y });
    arc.fillStyle(0x4fc3f7, 0.35);
    arc.slice(0, 0, this.player.attackRange * 0.55, angle - 0.55, angle + 0.55, false);
    arc.fillPath();
    arc.setDepth(11);

    this.tweens.add({
      targets: arc,
      alpha: 0,
      duration: 170,
      onComplete: () => arc.destroy(),
    });
  }

  /** Враг дотянулся до цели: урон игроку или кристаллу */
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

    burst(this, this.player.x, this.player.y, 0x4fc3f7, 12);
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

    burst(this, this.crystalSpawn.x, this.crystalSpawn.y, 0x4fc3f7, 10);
    this.events.emit('player-respawned');
    this.emitStats();
  }

  // ---------- Конец забега: кристалл разрушен ----------

  private gameOver(): void {
    if (this.isGameOver) {
      return;
    }
    this.isGameOver = true;
    this.setPaused(true);

    this.crystal.playDestroyed();
    burst(this, this.crystal.x, this.crystal.y, 0x4dd0e1, 16);
    this.cameras.main.shake(600, 0.02);
    this.cameras.main.flash(500, 120, 220, 255);

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
      this.player.moveWithInput(ui?.moveVector ?? this.zeroDir);
      if (ui?.attackHeld) {
        this.tryPlayerAttack(time);
      }
    }
    this.player.regenTick(delta, time);
    this.player.updateVisuals(time);

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

    this.updateEnemyShots(time);
    this.updateCoins(time);

    // Подсветка лавки, когда игрок может её открыть
    this.shop.setHighlight(this.isNearShop());

    // Волны: интермиссия, постепенный спавн, зачистка
    this.waveSystem.update(delta, this.enemies.length);

    if (time - this.lastStatsAt > 120) {
      this.lastStatsAt = time;
      this.emitStats();
    }
  }
}