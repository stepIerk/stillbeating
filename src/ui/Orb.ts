import Phaser from 'phaser';

/**
 * Круглая «колба» с жидкостью: уровень заполнения — точный сегмент круга
 * (жидкость сверху ограничена горизонтальной линией с бликом).
 * Перерисовка только по setRatio/layout — дёшево вызывать из onStats.
 */
export default class Orb {
  private gfx: Phaser.GameObjects.Graphics;
  private x = 0;
  private y = 0;
  private ratio = 1;
  private size: number;
  private radius: number;
  private liquidColor: number;

  constructor(scene: Phaser.Scene, radius = 32, liquidColor = 0x4fc3f7) {
    this.radius = radius;
    this.size = radius;
    this.liquidColor = liquidColor;
    this.gfx = scene.add.graphics().setDepth(100);
  }

  layout(x: number, y: number, type: 'hp' | 'mana'): this {
    this.x = x;
    this.y = y;
    this.size = type === 'hp' ? this.radius : this.radius * 0.9;
    this.draw();
    return this;
  }

  setRatio(ratio: number): void {
    const clamped = Phaser.Math.Clamp(ratio, 0, 1);
    if (clamped === this.ratio) {
      return;
    }
    this.ratio = clamped;
    this.draw();
  }

  private draw(): void {
    const g = this.gfx;
    const { x, y } = this;
    const r = this.size;
    const rl = r - 2; // жидкость внутри ободка
    g.clear();

    // Стекло: тёмный фон
    g.fillStyle(0x000000, 0.9);
    g.fillCircle(x, y, r);

    if (this.ratio > 0.001) {
      // Уровень жидкости: хорда на высоте yl, сегмент через нижнюю точку
      const yl = y + rl - 2 * rl * this.ratio;
      const s = Phaser.Math.Clamp((yl - y) / rl, -1, 1);
      const a1 = Math.asin(s);
      const a2 = Math.PI - a1;
      const pts: Phaser.Math.Vector2[] = [];
      const N = 20;
      for (let i = 0; i <= N; i++) {
        const a = a1 + ((a2 - a1) * i) / N;
        pts.push(new Phaser.Math.Vector2(x + rl * Math.cos(a), y + rl * Math.sin(a)));
      }
      g.fillStyle(this.liquidColor, 0.9);
      g.fillPoints(pts, true);
      // Блик на поверхности
      g.lineStyle(2, 0xffffff, 0.5);
      g.lineBetween(x + rl * Math.cos(a1), yl, x + rl * Math.cos(a2), yl);
    }

    // Ободок и блик стекла
    g.lineStyle(3, 0xffffff, 0.28);
    g.strokeCircle(x, y, r);
    g.fillStyle(0xffffff, 0.3);
    g.fillCircle(x - r * 0.35, y - r * 0.42, Math.max(2, r * 0.11));
  }
}
