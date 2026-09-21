import Phaser from 'phaser';
import { CRYSTAL_STATS } from '../config/balance';
import { HEART } from '../render/palette';
import { HEART_GLOW_SIZE, HEART_TEXTURE_SIZE } from '../render/textures';
import { burst } from '../ui/FloatingText';
import HealthBar from './HealthBar';

/**
 * Кристалл — цель врагов: сердце бога. Игра проиграна, когда оно разрушено.
 * Сердце крупное и живое: пульсирует в своём ритме, а из-под мышцы сочится
 * свет — аддитивное гало «crystal-glow», которое бьётся вместе с сердцем.
 */
export default class Crystal extends Phaser.Physics.Arcade.Image {
  maxHp = CRYSTAL_STATS.maxHp;
  hp = CRYSTAL_STATS.maxHp;
  isDestroyed = false;

  private healthBar: HealthBar;
  private readonly barOffset = -HEART_TEXTURE_SIZE / 2 - 18;
  /** Гало вокруг сердца: свет из мышцы */
  private glow: Phaser.GameObjects.Image;
  private glowTween?: Phaser.Tweens.Tween;
  /** Сердцебиение: цепочка твинов «сильный удар — слабый — пауза» */
  private beat?: Phaser.Tweens.TweenChain;

  constructor(scene: Phaser.Scene, x: number, y: number) {
    super(scene, x, y, 'crystal');
    scene.add.existing(this);
    scene.physics.add.existing(this, true);

    this.setDepth(7);

    this.glow = scene.add
      .image(x, y, 'crystal-glow')
      .setDepth(6)
      .setBlendMode(Phaser.BlendModes.ADD)
      .setScale((HEART_TEXTURE_SIZE * 1.55) / HEART_GLOW_SIZE)
      .setAlpha(0.5);

    // Тело статичное и по кругу радиуса цели: текстура сердца крупнее, и без
    // этого враги упирались бы в него раньше, чем смогли бы дотянуться ударом.
    const body = this.body as Phaser.Physics.Arcade.StaticBody | null;
    if (body) {
      body.setCircle(CRYSTAL_STATS.radius, this.width / 2 - CRYSTAL_STATS.radius, this.height / 2 - CRYSTAL_STATS.radius);
    }

    this.healthBar = new HealthBar(scene, {
      width: 130,
      height: 11,
      yOffset: this.barOffset,
      color: HEART.muscleHi,
      alwaysVisible: true,
    });
    this.healthBar.setValue(this.hp, this.maxHp);
    this.healthBar.follow(x, y, this.barOffset);

    // Сердце бьётся: сильный удар, слабый удар, пауза
    this.startBeat();
  }

  /**
   * Сердцебиение: сильный удар, слабый удар и пауза. Цепочка идёт бесконечно,
   * а скорость подстраивается под здоровье сердца (updateBeatSpeed).
   */
  private startBeat(): void {
    this.beat = this.scene.tweens.chain({
      targets: this,
      loop: -1,
      tweens: [
        { targets: this, scale: 1.08, duration: 120, ease: 'Sine.easeOut' },
        { targets: this, scale: 1, duration: 130, ease: 'Sine.easeIn' },
        { targets: this, scale: 1.05, duration: 100, ease: 'Sine.easeOut' },
        { targets: this, scale: 1, duration: 650, ease: 'Sine.easeInOut' },
      ],
    });

    // Свечение идёт за ударом: цикл твина совпадает с циклом сердцебиения,
    // поэтому достаточно менять у обоих общий множитель времени
    this.glowTween = this.scene.tweens.add({
      targets: this.glow,
      alpha: { from: 0.34, to: 0.74 },
      scale: { from: this.glow.scale * 0.96, to: this.glow.scale * 1.12 },
      duration: 500,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut',
    });

    this.updateBeatSpeed();
  }

  /** Чем меньше здоровья у сердца, тем чаще оно бьётся и ярче светит */
  private updateBeatSpeed(): void {
    const healthRatio = this.maxHp > 0 ? this.hp / this.maxHp : 0;
    const speed = 1 + (1 - healthRatio) * 1.6;
    if (this.beat) {
      this.beat.timeScale = speed;
    }
    if (this.glowTween) {
      this.glowTween.timeScale = speed;
    }
  }

  /** Возвращает true, если сердце разрушено */
  takeDamage(amount: number): boolean {
    if (this.isDestroyed) {
      return false;
    }
    this.hp = Math.max(0, this.hp - amount);
    this.healthBar.setValue(this.hp, this.maxHp);
    this.updateBeatSpeed();

    // Брызги крови из раны
    burst(this.scene, this.x, this.y - 12, HEART.muscleHi, 4, 60, 5);

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
    this.updateBeatSpeed();
  }

  addMaxHp(amount: number): void {
    if (this.isDestroyed) {
      return;
    }
    this.maxHp += amount;
    this.hp = Math.min(this.maxHp, this.hp + amount);
    this.healthBar.setValue(this.hp, this.maxHp);
    this.updateBeatSpeed();
  }

  /** Визуал разрушения: сердце сдувается, свет гаснет, полоска пропадает */
  playDestroyed(): void {
    this.healthBar.setVisible(false);
    this.beat?.stop();
    this.glowTween?.stop();

    this.scene.tweens.chain({
      targets: this,
      tweens: [
        {
          targets: [this, this.glow],
          scaleX: 1.25,
          scaleY: 0.3,
          alpha: 0.5,
          duration: 320,
          ease: 'Quad.easeOut',
        },
        {
          targets: [this, this.glow],
          scaleX: 0.15,
          scaleY: 0.08,
          alpha: 0,
          duration: 340,
          ease: 'Back.easeIn',
        },
      ],
    });
  }

  /** Гало живёт рядом с сердцем: уводим его вместе с сердцем */
  destroy(fromScene?: boolean): void {
    this.glow.destroy();
    super.destroy(fromScene);
  }
}
