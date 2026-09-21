import Phaser from 'phaser';
import {
  CRYSTAL_STATS,
  ENEMY_ATTACK_PAD,
  ENEMY_TIERS,
  PLAYER_STATS,
  WAVES,
  type EnemyTier,
  type EnemyTierId,
} from '../config/balance';
import { chooseTarget, type EnemyRole, type EnemyTarget } from '../systems/Targeting';
import { VESSEL } from '../render/palette';
import HealthBar from './HealthBar';

export type { EnemyRole, EnemyTarget };

/** Радианов за кадр, на которые враг доворачивает корпус по курсу движения */
const TURN_STEP = 0.16;

/**
 * Враг. Две вариации поведения:
 *  - hunter — преследует игрока, а если игрок мёртв, идёт ломать кристалл;
 *  - sieger — сразу идёт к кристаллу и игрока игнорирует.
 */
export default class Enemy extends Phaser.Physics.Arcade.Image {
  readonly tier: EnemyTier;
  readonly role: EnemyRole;
  readonly maxHp: number;
  readonly damage: number;
  readonly speed: number;
  readonly attackInterval: number;
  readonly xpReward: number;
  readonly goldReward: number;
  isDead = false;
  target: EnemyTarget = 'player';

  hp: number;
  private nextAttackAt = 0;
  private inRange = false;
  private healthBar: HealthBar;

  constructor(scene: Phaser.Scene, x: number, y: number, tierId: EnemyTierId, wave: number) {
    const tier = ENEMY_TIERS.find((t) => t.id === tierId) ?? ENEMY_TIERS[0];
    super(scene, x, y, `enemy-${tier.id}`);

    this.tier = tier;
    // Бесконечное усиление с волной: экспоненциальный рост HP и урона,
    // скорость растёт линейно до потолка speedCap
    this.maxHp = Math.round(tier.hp * Math.pow(1 + WAVES.hpScalePerWave, wave - 1));
    this.hp = this.maxHp;
    this.damage = Math.round(tier.damage * Math.pow(1 + WAVES.damageScalePerWave, wave - 1));
    const speedMult = Math.min(WAVES.speedCap, 1 + WAVES.speedScalePerWave * (wave - 1));
    this.speed = Math.round(tier.speed * speedMult);
    this.attackInterval = tier.attackInterval;
    this.xpReward = tier.xp;
    this.goldReward = tier.gold;
    this.role = Phaser.Math.FloatBetween(0, 1) < tier.siegeChance ? 'sieger' : 'hunter';

    scene.add.existing(this);
    scene.physics.add.existing(this);

    this.setDepth(9);

    const body = this.body as Phaser.Physics.Arcade.Body | null;
    body?.setCircle(tier.radius);
    if (body) {
      // Отскок от стен не нужен: враг должен упираться и скользить вдоль стены
      body.setBounce(0, 0);
    }
    this.setCollideWorldBounds(true);

    this.healthBar = new HealthBar(scene, {
      width: Math.max(26, tier.radius * 2),
      height: 5,
      yOffset: -tier.radius - 12,
      color: VESSEL.wound,
    });
  }

  get attackReach(): number {
    // Стрелок останавливается на дистанции стрельбы, остальные — в упор
    if (this.tier.shootRange) {
      const targetRadius = this.target === 'player' ? PLAYER_STATS.radius : CRYSTAL_STATS.radius;
      return this.tier.shootRange + targetRadius;
    }
    const targetRadius = this.target === 'player' ? PLAYER_STATS.radius : CRYSTAL_STATS.radius;
    return this.tier.radius + targetRadius + ENEMY_ATTACK_PAD;
  }

  /** Стрелок: стреляет зарядами, вместо удара в упор */
  get isRanged(): boolean {
    return this.tier.shootRange !== undefined && this.tier.projectileSpeed !== undefined;
  }

  /** Выбор цели и движение к ней */
  moveTowardsTarget(
    playerX: number,
    playerY: number,
    playerAlive: boolean,
    crystalX: number,
    crystalY: number,
  ): void {
    if (this.isDead) {
      return;
    }

    // Выбор цели: см. chooseTarget() — осадник и враги при мёртвом игроке идут
    // к кристаллу, а hunter переключается на кристалл, если тот ближе игрока.
    const distToPlayer = Phaser.Math.Distance.Between(this.x, this.y, playerX, playerY);
    const distToCrystal = Phaser.Math.Distance.Between(this.x, this.y, crystalX, crystalY);
    this.target = chooseTarget(this.role, playerAlive, distToPlayer, distToCrystal);
    const tx = this.target === 'player' ? playerX : crystalX;
    const ty = this.target === 'player' ? playerY : crystalY;

    const dist = this.target === 'player' ? distToPlayer : distToCrystal;
    if (dist <= this.attackReach) {
      this.inRange = true;
      this.setVelocity(0, 0);
    } else {
      this.inRange = false;
      const angle = Math.atan2(ty - this.y, tx - this.x);
      this.setVelocity(Math.cos(angle) * this.speed, Math.sin(angle) * this.speed);
      this.turnTowardsMovement(angle);
    }

    this.healthBar.follow(this.x, this.y, -this.tier.radius - 12);
  }

  /**
   * Доворот корпуса по курсу движения. Текстуры нарисованы «носом вправо»
   * (0 рад), поэтому хвост-жгутик бактерии и хоботок стрелка смотрят назад —
   * против хода. Поворот плавный (TURN_STEP за кадр), без рывков на поворотах.
   */
  private turnTowardsMovement(angle: number): void {
    this.rotation = Phaser.Math.Angle.RotateTo(this.rotation, angle, TURN_STEP);
  }

  /** Готов ли враг ударить прямо сейчас (урон наносит сцена) */
  tryAttack(now: number): boolean {
    if (this.isDead || !this.inRange || now < this.nextAttackAt) {
      return false;
    }
    this.nextAttackAt = now + this.attackInterval;

    if (this.isRanged) {
      // Стрелок: вспышка «дула» вместо выпада
      this.setTint(0xffffff).setTintMode(Phaser.TintModes.FILL);
      this.scene.time.delayedCall(90, () => {
        if (this.active) {
          this.clearTint();
        }
      });
      return true;
    }

    // Выпад в сторону цели
    this.scene.tweens.add({
      targets: this,
      scale: 1.2,
      duration: 90,
      yoyo: true,
      ease: 'Quad.easeOut',
    });
    return true;
  }

  /** Возвращает true, если враг погиб */
  takeDamage(amount: number): boolean {
    if (this.isDead) {
      return false;
    }
    this.hp -= amount;
    this.healthBar.setValue(Math.max(0, this.hp), this.maxHp);

    this.setTint(0xffffff).setTintMode(Phaser.TintModes.FILL);
    this.scene.time.delayedCall(70, () => {
      if (this.active) {
        this.clearTint();
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
    this.healthBar.destroy();

    const body = this.body as Phaser.Physics.Arcade.Body | null;
    if (body) {
      body.enable = false;
    }

    this.setDepth(8);
    this.scene.tweens.add({
      targets: this,
      scale: 0,
      alpha: 0,
      duration: 260,
      ease: 'Back.easeIn',
      onComplete: () => this.destroy(),
    });
  }
}
