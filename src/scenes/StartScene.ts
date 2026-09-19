import Phaser from 'phaser';

export default class StartScene extends Phaser.Scene {
  constructor() {
    super('Start');
  }

  create(): void {
    const { width, height } = this.scale;
    const centerX = width / 2;
    const centerY = height / 2;

    this.cameras.main.setBackgroundColor('#14141b');

    // Декоративные «пузыри» на фоне (геометрия, без графики)
    for (let i = 0; i < 8; i++) {
      const x = Phaser.Math.Between(30, Math.max(31, width - 30));
      const y = Phaser.Math.Between(30, Math.max(31, height - 30));
      const r = Phaser.Math.Between(8, 40);
      const bubble = this.add.circle(x, y, r, 0x4fc3f7, 0.08);
      this.tweens.add({
        targets: bubble,
        alpha: { from: 0.05, to: 0.2 },
        yoyo: true,
        repeat: -1,
        duration: Phaser.Math.Between(1200, 2600),
      });
    }

    this.add
      .text(centerX, centerY - height * 0.18, 'DEGAME', {
        fontFamily: 'Arial, sans-serif',
        fontSize: '56px',
        fontStyle: 'bold',
        color: '#e8e8f0',
      })
      .setOrigin(0.5);

    this.add
      .text(centerX, centerY - height * 0.18 + 48, 'защити кристалл от волн врагов', {
        fontFamily: 'Arial, sans-serif',
        fontSize: '20px',
        color: '#8a8a9a',
      })
      .setOrigin(0.5);

    this.createPlayButton(centerX, centerY + height * 0.12);

    this.scale.on('resize', this.handleResize, this);
    this.events.once('shutdown', () => {
      this.scale.off('resize', this.handleResize, this);
    });
  }

  private createPlayButton(centerX: number, centerY: number): void {
    const btnWidth = Math.min(300, this.scale.width - 40);
    const btnHeight = 72;
    const radius = 16;

    const bg = this.add.graphics();
    bg.fillStyle(0x4fc3f7, 1);
    bg.fillRoundedRect(centerX - btnWidth / 2, centerY - btnHeight / 2, btnWidth, btnHeight, radius);

    const label = this.add
      .text(centerX, centerY, 'ИГРАТЬ', {
        fontFamily: 'Arial, sans-serif',
        fontSize: '32px',
        fontStyle: 'bold',
        color: '#14141b',
      })
      .setOrigin(0.5);

    const zone = this.add
      .zone(centerX, centerY, btnWidth, btnHeight)
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true });

    zone.on('pointerdown', () => {
      this.tweens.add({
        targets: [bg, label],
        scale: 0.94,
        duration: 80,
        yoyo: true,
        onComplete: () => {
          this.scene.start('Game');
        },
      });
    });
  }

  private handleResize(): void {
    // При повороте экрана пересобираем сцену, чтобы UI выстроился заново
    this.scene.restart();
  }
}
