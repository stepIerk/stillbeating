import Phaser from 'phaser';
import { PLAYER_STATS } from '../config/balance';
import type RunState from '../state/RunState';
import { computeStats, type DerivedStats } from '../systems/DerivedStats';
import HealthBar from './HealthBar';

/** Игрок: здоровье/мана, атака по кулдауну, щит и берсерк, респавн */
export default class Player extends Phaser.Physics.Arcade.Image {
  isDead = false;

  // Статы (заполняются recalcFor)
  maxHp = 100;
  hp = 100;
  maxMana = 60;
  mana = 60;
  hpRegen = 1;
  manaRegen = 2.5;
  attackDamage = 12;
  attackInterval = 450;
  attackRange = 240;
  moveSpeed = 340;
  critChance = 0.06;
  critMultiplier = 1.6;

  // Щит (навык «Ледяной щит»): поглощает урон
  shieldHp = 0;
  private shieldUntil = 0;

  // Берсерк: множитель урона до момента времени
  private berserkMult = 1;
  private berserkUntil = 0;

  // Рывок (навык «Рывок»): слайд с уроном врагам на пути
  private dashing = false;
  private dashDir = new Phaser.Math.Vector2(0, 0);
  private dashLeft = 0;
  private dashSpeed = 0;
  private dashEndAt = 0;

  private nextAttackAt = 0;
  private invulnUntil = 0;
  private healthBar: HealthBar;
  private manaBar: HealthBar;
  private rangeCircle: Phaser.GameObjects.Arc;
  private lastDir = new Phaser.Math.Vector2(1, 0);

  constructor(scene: Phaser.Scene, x: number, y: number) {
    super(scene, x, y, 'player');
    scene.add.existing(this);
    scene.physics.add.existing(this);

    this.setDepth(10);

    const body = this.body as Phaser.Physics.Arcade.Body | null;
    body?.setCircle(PLAYER_STATS.radius);
    if (body) {
      // Игрока не толкают враги, иначе его нельзя «разжать» в толпе
      body.pushable = false;
    }
    this.setCollideWorldBounds(true);

    // Еле заметный радиус атаки — помогает держать дистанцию
    this.rangeCircle = scene.add
      .circle(x, y, this.attackRange, 0x4fc3f7, 0.05)
      .setStrokeStyle(1, 0x4fc3f7, 0.25)
      .setDepth(5);

    this.healthBar = new HealthBar(scene, {
      width: 60,
      height: 7,
      yOffset: -46,
      color: 0x4fc3f7,
      alwaysVisible: true,
    });
    this.manaBar = new HealthBar(scene, {
      width: 60,
      height: 4,
      yOffset: -38,
      color: 0xb39ddb,
      alwaysVisible: true,
    });
    this.healthBar.setValue(this.hp, this.maxHp);
    this.manaBar.setValue(this.mana, this.maxMana);
  }

  /** Пересчёт статов после изменения атрибутов/экипировки */
  recalcFor(run: RunState): void {
    const stats: DerivedStats = computeStats(run);
    const hpRatio = this.maxHp > 0 ? this.hp / this.maxHp : 1;

    this.maxHp = stats.maxHp;
    this.hp = Math.min(this.maxHp, Math.max(this.hp, Math.round(this.maxHp * hpRatio)));
    this.maxMana = stats.maxMana;
    this.mana = Math.min(this.mana, this.maxMana);
    this.hpRegen = stats.hpRegen;
    this.manaRegen = stats.manaRegen;
    this.attackDamage = stats.attackDamage;
    this.attackInterval = stats.attackInterval;
    this.attackRange = stats.attackRange;
    this.moveSpeed = stats.moveSpeed;
    this.critChance = stats.critChance;
    this.critMultiplier = stats.critMultiplier;

    this.rangeCircle.setRadius(this.attackRange);
    this.healthBar.setValue(this.hp, this.maxHp);
    this.manaBar.setValue(this.mana, this.maxMana);
  }

  // ---------- Движение ----------

  moveWithInput(dir: Phaser.Math.Vector2): void {
    if (this.isDead) {
      this.setVelocity(0, 0);
      return;
    }
    // Во время рывка джойстик не перебивает слайд
    if (this.dashing) {
      this.setVelocity(this.dashDir.x * this.dashSpeed, this.dashDir.y * this.dashSpeed);
      return;
    }
    this.setVelocity(dir.x * this.moveSpeed, dir.y * this.moveSpeed);
    if (dir.lengthSq() > 0.01) {
      this.lastDir.copy(dir).normalize();
    }
  }

  get facing(): Phaser.Math.Vector2 {
    return this.lastDir;
  }

  // ---------- Атака ----------

  canAttack(now: number): boolean {
    return !this.isDead && now >= this.nextAttackAt;
  }

  markAttacked(now: number): void {
    this.nextAttackAt = now + this.attackInterval;
  }

  /** Принудительная задержка следующего удара (напр. после выхода из лавки) */
  suppressAttack(durationMs: number): void {
    this.nextAttackAt = Math.max(this.nextAttackAt, this.scene.time.now + durationMs);
  }

  /** 1 — удар готов, 0 — только что ударил (для индикатора на кнопке) */
  cooldownRatio(now: number): number {
    const left = this.nextAttackAt - now;
    return Phaser.Math.Clamp(1 - left / this.attackInterval, 0, 1);
  }

  /** Урон с учётом берсерка */
  effectiveDamage(now: number): number {
    return Math.round(this.attackDamage * this.currentBerserkMult(now));
  }

  private currentBerserkMult(now: number): number {
    if (now < this.berserkUntil) {
      return this.berserkMult;
    }
    this.berserkMult = 1;
    return 1;
  }

  // ---------- Мана и навыки ----------

  spendMana(amount: number): boolean {
    if (this.mana < amount) {
      return false;
    }
    this.mana -= amount;
    this.manaBar.setValue(this.mana, this.maxMana);
    return true;
  }

  get manaRatio(): number {
    return this.maxMana > 0 ? this.mana / this.maxMana : 0;
  }

  activateShield(absorb: number, durationMs: number, now: number): void {
    this.shieldHp = Math.max(this.shieldHp, Math.round(absorb));
    this.shieldUntil = now + durationMs;
  }

  get shieldActive(): boolean {
    return this.shieldHp > 0;
  }

  activateBerserk(mult: number, durationMs: number, now: number): void {
    this.berserkMult = mult;
    this.berserkUntil = now + durationMs;
  }

  /** Старт рывка: на время слайда игрок неуязвим (invulnUntil) */
  startDash(dir: Phaser.Math.Vector2, distance: number, now: number): void {
    this.dashing = true;
    this.dashDir.copy(dir).normalize();
    this.dashLeft = distance;
    this.dashSpeed = distance / 0.22; // рывок занимает ~220 мс
    this.dashEndAt = now + 400;
    this.invulnUntil = Math.max(this.invulnUntil, now + 420);
  }

  /** Обновление рывка каждый кадр: сдвигает игрока. true — рывок был активен */
  updateDash(now: number, deltaMs: number): boolean {
    if (!this.dashing) {
      return false;
    }

    if (this.dashLeft <= 0 || now >= this.dashEndAt) {
      this.dashing = false;
      this.dashLeft = 0;
      return false;
    }

    const step = Math.min(this.dashLeft, (this.dashSpeed * deltaMs) / 1000);
    this.setX(this.x + this.dashDir.x * step);
    this.setY(this.y + this.dashDir.y * step);
    this.dashLeft -= step;

    if (this.dashLeft <= 0) {
      this.dashing = false;
    }
    return true;
  }

  /** Осталось пройти до конца рывка (для расчёта пройденного пути в сцене) */
  get dashDistanceLeft(): number {
    return this.dashLeft;
  }

  get isDashing(): boolean {
    return this.dashing;
  }

  /** Регенерация HP/маны, тик каждый кадр (delta в мс) */
  regenTick(deltaMs: number, now: number): void {
    if (this.isDead) {
      return;
    }
    if (this.shieldHp > 0 && now >= this.shieldUntil) {
      this.shieldHp = 0;
    }
    if (this.hp < this.maxHp) {
      this.hp = Math.min(this.maxHp, this.hp + (this.hpRegen * deltaMs) / 1000);
      this.healthBar.setValue(this.hp, this.maxHp);
    }
    if (this.mana < this.maxMana) {
      this.mana = Math.min(this.maxMana, this.mana + (this.manaRegen * deltaMs) / 1000);
      this.manaBar.setValue(this.mana, this.maxMana);
    }
  }

  // ---------- Жизнь ----------

  isInvulnerable(now: number): boolean {
    return now < this.invulnUntil;
  }

  /** Возвращает true, если игрок погиб */
  takeDamage(amount: number, now: number): boolean {
    if (this.isDead || this.isInvulnerable(now)) {
      return false;
    }

    // Сначала урон поглощает щит
    if (this.shieldHp > 0) {
      const absorbed = Math.min(this.shieldHp, amount);
      this.shieldHp -= absorbed;
      amount -= absorbed;
      if (amount <= 0) {
        return false;
      }
    }

    this.hp = Math.max(0, this.hp - amount);
    this.healthBar.setValue(this.hp, this.maxHp);

    this.setTint(0xffffff).setTintMode(Phaser.TintModes.FILL);
    this.scene.time.delayedCall(90, () => {
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

  heal(amount: number): void {
    this.hp = Math.min(this.maxHp, this.hp + amount);
    this.healthBar.setValue(this.hp, this.maxHp);
  }

  restoreMana(amount: number): void {
    this.mana = Math.min(this.maxMana, this.mana + amount);
    this.manaBar.setValue(this.mana, this.maxMana);
  }

  /**
   * Гибель по сценарию (урон уже применён сценой или смерть принудительная).
   * Нужна, чтобы сцена могла убить игрока, не дожидаясь обнуления HP.
   */
  kill(): void {
    if (this.isDead) {
      return;
    }
    this.hp = 0;
    this.healthBar.setValue(0, this.maxHp);
    this.die();
  }

  private die(): void {
    this.isDead = true;
    this.setVelocity(0, 0);
    this.dashing = false;
    this.dashLeft = 0;
    this.setVisible(false);
    this.rangeCircle.setVisible(false);
    this.healthBar.setVisible(false);
    this.manaBar.setVisible(false);
    this.shieldHp = 0;
    this.berserkMult = 1;
    this.berserkUntil = 0;
    const body = this.body as Phaser.Physics.Arcade.Body | null;
    if (body) {
      body.enable = false;
    }
  }

  respawn(x: number, y: number, now: number): void {
    this.isDead = false;
    this.hp = this.maxHp;
    this.mana = this.maxMana;
    this.setPosition(x, y);
    this.setVisible(true);
    this.rangeCircle.setVisible(true);
    this.healthBar.setValue(this.hp, this.maxHp);
    this.manaBar.setValue(this.mana, this.maxMana);
    this.invulnUntil = now + PLAYER_STATS.invulnTime;

    const body = this.body as Phaser.Physics.Arcade.Body | null;
    if (body) {
      body.enable = true;
      body.reset(x, y);
    }
  }

  /** Синхронизация визуала: полоски, круг атаки, мерцание неуязвимости */
  updateVisuals(now: number): void {
    if (this.isDead) {
      return;
    }
    this.healthBar.follow(this.x, this.y, -46);
    this.manaBar.follow(this.x, this.y, -38);
    this.rangeCircle.setPosition(this.x, this.y);
    this.setAlpha(this.isInvulnerable(now) && Math.floor(now / 120) % 2 === 0 ? 0.35 : 1);
  }
}
