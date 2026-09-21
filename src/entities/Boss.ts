import Phaser from 'phaser';
import {
  BOSS_TARGETING,
  CRYSTAL_STATS,
  PLAYER_STATS,
  type BossAttackDef,
  type BossDef,
} from '../config/balance';
import {
  bossNextPhase,
  bossPhaseDuration,
  bossStatsForChapter,
  pickBossAttack,
  selectBossTarget,
  type BossPhase,
  type BossTarget,
} from '../systems/BossAi';
import { VESSEL } from '../render/palette';
import HealthBar from './HealthBar';

/** Скорость доворота корпуса (рад за кадр) */
const TURN_STEP = 0.12;

/**
 * Босс главы: один на волну, крупный, с полосой HP и набором атак.
 * Каждая атака имеет телеграф — характерное движение, по которому видно,
 * что сейчас будет. Урон наносит сцена (как и у обычных врагов).
 */
export default class Boss extends Phaser.Physics.Arcade.Image {
  readonly def: BossDef;
  readonly chapter: number;
  readonly maxHp: number;
  readonly damage: number;
  readonly speed: number;
  readonly xpReward: number;
  readonly goldReward: number;

  hp: number;
  isDead = false;
  target: BossTarget = 'player';

  /** Текущая фаза атаки */
  phase: BossPhase = 'chase';
  /** Атака, которая готовится/идёт (null в фазе преследования) */
  currentAttack: BossAttackDef | null = null;

  private phaseUntil = 0;
  /** Сколько мс до следующей попытки атаки после паузы */
  private nextAttackAt = 0;
  private healthBar: HealthBar;
  private facing = 1;
  private tween?: Phaser.Tweens.Tween;
  /** Первый кадр фазы active — сцена наносит урон именно тогда */
  private phaseJustStarted = false;

  constructor(scene: Phaser.Scene, x: number, y: number, def: BossDef, chapter: number) {
    super(scene, x, y, 'enemy-boss');
    this.def = def;
    this.chapter = chapter;

    const stats = bossStatsForChapter(def, chapter);
    this.maxHp = stats.maxHp;
    this.hp = this.maxHp;
    this.damage = stats.damage;
    this.speed = stats.speed;
    this.xpReward = stats.xp;
    this.goldReward = stats.gold;

    scene.add.existing(this);
    scene.physics.add.existing(this);

    this.setDepth(10);
    this.setScale(this.baseScale());
    this.setTint(def.color).setTintMode(Phaser.TintModes.FILL);

    const body = this.body as Phaser.Physics.Arcade.Body | null;
    body?.setCircle(def.radius);
    if (body) {
      body.setBounce(0, 0);
      body.pushable = false;
    }
    this.setCollideWorldBounds(true);

    this.healthBar = new HealthBar(scene, {
      width: 220,
      height: 12,
      yOffset: -def.radius - 18,
      color: VESSEL.wound,
      alwaysVisible: true,
    });
    this.healthBar.setValue(this.hp, this.maxHp);

    // Появление: босс выползает из ворот
    this.scene.tweens.add({
      targets: this,
      alpha: { from: 0, to: 1 },
      duration: 420,
      ease: 'Quad.easeOut',
    });
  }

  get attackReach(): number {
    const targetRadius = this.target === 'player' ? PLAYER_STATS.radius : CRYSTAL_STATS.radius;
    return this.def.radius + targetRadius + BOSS_TARGETING.attackPad;
  }

  /** Радиус тела (для попаданий игрока по боссу) */
  get radius(): number {
    return this.def.radius;
  }

  /** Радиус для коллизий снарядов: тело с небольшим запасом */
  get hitRadius(): number {
    return this.def.radius;
  }

  private baseScale(): number {
    return this.def.radius / 46;
  }

  /**
   * Кадр босса: выбор цели, преследование в фазе chase и продвижение фаз атаки.
   * Возвращает true в первый кадр фазы active — сцена в этот момент наносит урон.
   */
  update(
    now: number,
    playerX: number,
    playerY: number,
    playerAlive: boolean,
    crystalX: number,
    crystalY: number,
  ): boolean {
    if (this.isDead) {
      return false;
    }

    this.advancePhase(now);

    const distToPlayer = Phaser.Math.Distance.Between(this.x, this.y, playerX, playerY);
    const distToCrystal = Phaser.Math.Distance.Between(this.x, this.y, crystalX, crystalY);
    this.target = selectBossTarget(playerAlive, distToPlayer, distToCrystal);

    const tx = this.target === 'player' ? playerX : crystalX;
    const ty = this.target === 'player' ? playerY : crystalY;

    let startedAttack = false;
    if (this.phase === 'chase') {
      this.moveTowards(tx, ty, distToPlayer, distToCrystal, now);
    } else if (this.phase === 'telegraph') {
      // Телеграф: босс замирает и «замахивается» — видно, что будет удар
      this.setVelocity(0, 0);
      this.faceTowards(tx, ty);
      this.playTelegraph();
    } else if (this.phase === 'active') {
      startedAttack = this.phaseJustStarted;
    } else {
      this.setVelocity(0, 0);
    }

    this.phaseJustStarted = false;
    this.healthBar.follow(this.x, this.y, -this.def.radius - 18);
    return startedAttack;
  }

  /** Продвижение по фазам атаки по таймеру */
  private advancePhase(now: number): void {
    if (this.phase === 'chase') {
      if (now >= this.nextAttackAt) {
        this.beginAttack(now);
      }
      return;
    }

    if (now < this.phaseUntil) {
      return;
    }

    const next = bossNextPhase(this.phase);
    this.phase = next;
    this.phaseJustStarted = true;
    this.stopTween();

    if (!this.currentAttack) {
      return;
    }
    if (next === 'active') {
      this.phaseUntil = now + bossPhaseDuration('active', this.currentAttack);
    } else if (next === 'recover') {
      this.phaseUntil = now + bossPhaseDuration('recover', this.currentAttack);
    } else {
      // recover закончился: пауза до следующей атаки
      this.nextAttackAt = now + 320;
      this.currentAttack = null;
    }
  }

  /** Начало новой атаки: телеграф */
  private beginAttack(now: number): void {
    const attack = pickBossAttack(this.def.attacks, Math.random());
    this.currentAttack = attack;
    this.phase = 'telegraph';
    this.phaseJustStarted = true;
    this.phaseUntil = now + bossPhaseDuration('telegraph', attack);
  }

  /** Преследование цели: в упор — стоп и удар, иначе движение и доворот */
  private moveTowards(
    tx: number,
    ty: number,
    distToPlayer: number,
    distToCrystal: number,
    now: number,
  ): void {
    const dist = this.target === 'player' ? distToPlayer : distToCrystal;
    if (dist <= this.attackReach) {
      this.setVelocity(0, 0);
      if (now >= this.nextAttackAt) {
        this.beginAttack(now);
      }
      return;
    }
    const angle = Math.atan2(ty - this.y, tx - this.x);
    this.setVelocity(Math.cos(angle) * this.speed, Math.sin(angle) * this.speed);
    this.rotation = Phaser.Math.Angle.RotateTo(this.rotation, angle, TURN_STEP);
    this.facing = Math.cos(angle) >= 0 ? 1 : -1;
  }

  /** Поворот к цели во время замаха (медленнее движения) */
  private faceTowards(tx: number, ty: number): void {
    const angle = Math.atan2(ty - this.y, tx - this.x);
    this.rotation = Phaser.Math.Angle.RotateTo(this.rotation, angle, TURN_STEP * 0.5);
    this.facing = Math.cos(angle) >= 0 ? 1 : -1;
  }

  /**
   * Характерное движение перед ударом — по нему игрок понимает, какая
   * атака будет. Каждой атаке соответствует свой замах.
   */
  private playTelegraph(): void {
    if (this.tween || !this.currentAttack) {
      return;
    }
    const attack = this.currentAttack;
    const base = this.baseScale();
    this.setTint(0xffffff).setTintMode(Phaser.TintModes.FILL);

    if (attack.id === 'charge') {
      // Рывок: оттягивается назад — «разбег»
      this.tween = this.scene.tweens.add({
        targets: this,
        x: this.x - this.facing * 30,
        duration: attack.telegraphMs * 0.7,
        yoyo: true,
        ease: 'Quad.easeOut',
        onComplete: () => this.endTelegraph(),
      });
    } else if (attack.id === 'spikes') {
      // Шипы: сжимается внутрь, «надуваясь»
      this.tween = this.scene.tweens.add({
        targets: this,
        scale: base * 0.82,
        duration: attack.telegraphMs * 0.6,
        yoyo: true,
        repeat: 1,
        ease: 'Sine.easeInOut',
        onComplete: () => this.endTelegraph(),
      });
    } else if (attack.id === 'slam') {
      // Сильный удар: раздувается и приподнимается
      this.tween = this.scene.tweens.add({
        targets: this,
        scale: base * 1.22,
        duration: attack.telegraphMs,
        yoyo: true,
        ease: 'Quad.easeOut',
        onComplete: () => this.endTelegraph(),
      });
    } else {
      // Удар по территории: мигает, «вгрызаясь» в пол
      this.tween = this.scene.tweens.add({
        targets: this,
        alpha: 0.5,
        duration: attack.telegraphMs * 0.25,
        yoyo: true,
        repeat: 2,
        ease: 'Sine.easeInOut',
        onComplete: () => this.endTelegraph(),
      });
    }
  }

  private stopTween(): void {
    this.tween?.stop();
    this.tween = undefined;
  }

  private endTelegraph(): void {
    this.tween = undefined;
    if (this.active) {
      this.setAlpha(1).setScale(this.baseScale());
      this.clearTint().setTint(this.def.color).setTintMode(Phaser.TintModes.FILL);
    }
  }

  /** Возвращает true, если босс погиб */
  takeDamage(amount: number): boolean {
    if (this.isDead) {
      return false;
    }
    this.hp -= amount;
    this.healthBar.setValue(Math.max(0, this.hp), this.maxHp);

    this.setTint(0xffffff).setTintMode(Phaser.TintModes.FILL);
    this.scene.time.delayedCall(70, () => {
      if (this.active) {
        this.clearTint().setTint(this.def.color).setTintMode(Phaser.TintModes.FILL);
      }
    });

    if (this.hp <= 0) {
      this.die();
      return true;
    }
    return false;
  }

  private die(): void {
    this.isDead = true;
    this.setVelocity(0, 0);
    this.stopTween();
    this.healthBar.destroy();

    const body = this.body as Phaser.Physics.Arcade.Body | null;
    if (body) {
      body.enable = false;
    }

    this.setDepth(8);
    this.scene.tweens.add({
      targets: this,
      scale: this.baseScale() * 1.6,
      alpha: 0,
      duration: 460,
      ease: 'Back.easeIn',
      onComplete: () => this.destroy(),
    });
  }
}
