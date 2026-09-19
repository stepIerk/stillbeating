import Phaser from 'phaser';

export interface HealthBarOptions {
  width: number;
  height: number;
  /** Смещение над владельцем (отрицательное = выше) */
  yOffset: number;
  color: number;
  /** Показывать всегда, а не только после получения урона */
  alwaysVisible?: boolean;
}

/** Мини-полоска здоровья над сущностью (два прямоугольника) */
export default class HealthBar {
  private bg: Phaser.GameObjects.Rectangle;
  private fill: Phaser.GameObjects.Rectangle;
  private width: number;
  private alwaysVisible: boolean;
  private visible = false;

  constructor(scene: Phaser.Scene, options: HealthBarOptions) {
    this.width = options.width;
    this.alwaysVisible = options.alwaysVisible ?? false;

    this.bg = scene.add
      .rectangle(0, 0, options.width, options.height, 0x000000, 0.65)
      .setOrigin(0.5)
      .setDepth(20)
      .setVisible(false);

    this.fill = scene.add
      .rectangle(0, 0, options.width - 2, options.height - 2, options.color, 1)
      .setOrigin(0, 0.5)
      .setDepth(21)
      .setVisible(false);
  }

  setValue(current: number, max: number): void {
    const ratio = Phaser.Math.Clamp(max > 0 ? current / max : 0, 0, 1);
    this.fill.scaleX = Math.max(0.001, ratio);
    this.setVisible(this.alwaysVisible || ratio < 1);
  }

  setVisible(value: boolean): void {
    this.visible = value;
    this.bg.setVisible(value);
    this.fill.setVisible(value);
  }

  /** Ставит полоску относительно владельца */
  follow(x: number, y: number, yOffset: number): void {
    if (!this.visible) {
      return;
    }
    this.bg.setPosition(x, y + yOffset);
    this.fill.setPosition(x - this.width / 2 + 1, y + yOffset);
  }

  destroy(): void {
    this.bg.destroy();
    this.fill.destroy();
  }
}
