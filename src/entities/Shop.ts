import Phaser from 'phaser';
import { SHOP } from '../config/balance';

/**
 * Лавка на карте. Открывается ударом (атакой) рядом с ней:
 * внутри игра ставится на паузу и показывается окно покупок.
 */
export default class Shop extends Phaser.GameObjects.Image {
  private glow: Phaser.GameObjects.Arc;
  private highlighted = false;

  constructor(scene: Phaser.Scene, x: number, y: number) {
    super(scene, x, y, 'shop');
    scene.add.existing(this);
    this.setDepth(6);

    this.glow = scene.add
      .circle(x, y + 6, SHOP.glowRadius, 0xffd54f, 0.08)
      .setDepth(5);

    scene.tweens.add({
      targets: this.glow,
      alpha: { from: 0.06, to: 0.16 },
      scale: { from: 0.95, to: 1.1 },
      duration: 1300,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut',
    });

    // Вывеска смонтирована над лавкой — чтобы её было видно издалека
    scene.add
      .text(x, y - 62, 'ЛАВКА', {
        fontFamily: 'Arial, sans-serif',
        fontSize: '16px',
        fontStyle: 'bold',
        color: '#ffd54f',
      })
      .setOrigin(0.5)
      .setDepth(6);
  }

  /** Подсветка, когда игрок подошёл достаточно близко */
  setHighlight(value: boolean): void {
    if (this.highlighted === value) {
      return;
    }
    this.highlighted = value;
    this.glow.setFillStyle(0xffd54f, value ? 0.22 : 0.08);
    this.setScale(value ? 1.06 : 1);
  }

  destroy(fromScene?: boolean): void {
    this.glow.destroy();
    super.destroy(fromScene);
  }
}