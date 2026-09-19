import Phaser from 'phaser';
import { CRYSTAL_STATS } from '../config/balance';
import HealthBar from './HealthBar';

/** Кристалл — цель врагов. Игра проиграна, когда он разрушен */
export default class Crystal extends Phaser.Physics.Arcade.Image {
  maxHp = CRYSTAL_STATS.maxHp;
  hp = CRYSTAL_STATS.maxHp;
  isDestroyed = false;

  private healthBar: HealthBar;
  private readonly barOffset = -66;

  constructor(scene: Phaser.Scene, x: number, y: number) {
    super(scene, x, y, 'crystal');
    scene.add.existing(this);
    scene.physics.add.existing(this, true);

    this.setDepth(7);

    this.healthBar = new HealthBar(scene, {
      width: 130,
      height: 11,
      yOffset: this.barOffset,
      color: 0x4dd0e1,
      alwaysVisible: true,
    });
    this.healthBar.setValue(this.hp, this.maxHp);
    this.healthBar.follow(x, y, this.barOffset);

    // Пульсация, чтобы кристалл читался как важный объект
    scene.tweens.add({
      targets: this,
      scale: 1.06,
      duration: 1400,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut',
    });
  }

  /** Возвращает true, если кристалл разрушен */
  takeDamage(amount: number): boolean {
    if (this.isDestroyed) {
      return false;
    }
    this.hp = Math.max(0, this.hp - amount);
    this.healthBar.setValue(this.hp, this.maxHp);

    this.setTint(0xffffff).setTintMode(Phaser.TintModes.FILL);
    this.scene.time.delayedCall(80, () => {
      if (this.active) {
        this.clearTint();
      }
    });

    if (this.hp <= 0) {
      this.isDestroyed = true;
      const body = this.body as Phaser.Physics.Arcade.StaticBody | null;
      if (body) {
        body.enable = false;
      }
      return true;
    }
    return false;
  }

  repair(amount: number): void {
    if (this.isDestroyed) {
      return;
    }
    this.hp = Math.min(this.maxHp, this.hp + amount);
    this.healthBar.setValue(this.hp, this.maxHp);
  }

  addMaxHp(amount: number): void {
    if (this.isDestroyed) {
      return;
    }
    this.maxHp += amount;
    this.hp = Math.min(this.maxHp, this.hp + amount);
    this.healthBar.setValue(this.hp, this.maxHp);
  }

  /** Визуал разрушения: полоска гаснет, осколки разлетаются */
  playDestroyed(): void {
    this.healthBar.setVisible(false);
    this.scene.tweens.add({
      targets: this,
      scale: 0,
      alpha: 0,
      angle: 180,
      duration: 700,
      ease: 'Back.easeIn',
    });
  }
}
