import Phaser from 'phaser';
import { BODY, HEART, VOID_CSS } from '../render/palette';
import { clearRun, loadRun } from '../state/Save';
import { loadBest } from '../state/Save';
import {
  HEART_GLOW_SIZE,
  MENU_HEART_SIZE,
  buildHeartGlowTexture,
  buildMenuTextures,
  buildWorldTextures,
} from '../render/textures';

/**
 * Заставка: экран внутри тела бога — ткань с клетками и венами, бьющееся
 * сердце за заголовком и кнопка «ИГРАТЬ». Позиция кнопки зафиксирована
 * (centerY + height * 0.12) — по ней бьёт e2e-тест возврата в меню.
 */
export default class StartScene extends Phaser.Scene {
  constructor() {
    super('Start');
  }

  create(): void {
    const { width, height } = this.scale;
    const centerX = width / 2;
    const centerY = height / 2;

    this.cameras.main.setBackgroundColor(VOID_CSS);
    this.createMenuTextures();
    this.createBackdrop(width, height);
    this.createHeart(centerX, centerY - height * 0.14, width);

    this.add
      .text(centerX, centerY - height * 0.18, 'DEGAME', {
        fontFamily: 'Arial, sans-serif',
        fontSize: '56px',
        fontStyle: 'bold',
        color: '#ffe9e6',
      })
      .setOrigin(0.5)
      .setShadow(0, 3, '#3a0308', 8, false, true);

    this.add
      .text(centerX, centerY - height * 0.18 + 48, 'защити сердце бога от паразитов', {
        fontFamily: 'Arial, sans-serif',
        fontSize: '20px',
        color: '#e2b6b6',
      })
      .setOrigin(0.5)
      .setShadow(0, 2, '#3a0308', 6, false, true);

    this.createPlayButton(centerX, centerY + height * 0.12);
    this.createBestRunLabel(centerX, centerY + height * 0.12 + 70);
    this.createContinueHint(centerX, centerY + height * 0.12 + 106);
    // Кнопка сброса не должна уехать за нижний край на низких экранах
    this.createNewRunButton(centerX, Math.min(centerY + height * 0.12 + 168, height - 40));

    this.scale.on('resize', this.handleResize, this);
    this.events.once('shutdown', () => {
      this.scale.off('resize', this.handleResize, this);
    });
  }

  /** Текстуры заставки: тайлы плоти, крупное сердце и его свечение */
  private createMenuTextures(): void {
    const g = this.make.graphics({ x: 0, y: 0 }, false);
    if (!this.textures.exists('floor-cells')) {
      buildWorldTextures(g);
    }
    if (!this.textures.exists('menu-heart')) {
      buildMenuTextures(g);
    }
    if (!this.textures.exists('crystal-glow')) {
      buildHeartGlowTexture(g);
    }
    g.destroy();
  }

  /** Фон: та же ткань с клетками и венами, что и в игре, но притемнённая */
  private createBackdrop(width: number, height: number): void {
    this.add.tileSprite(0, 0, width, height, 'floor-cells').setOrigin(0).setTileScale(0.55);
    this.add
      .tileSprite(0, 0, width, height, 'floor-veins')
      .setOrigin(0)
      .setTileScale(0.6)
      .setAlpha(0.5);
    // Затемнение — чтобы заголовок и кнопка читались поверх вен
    this.add.rectangle(0, 0, width, height, BODY.void, 0.45).setOrigin(0);
  }

  /** Сердце за заголовком: бьётся «сильный удар — слабый — пауза» */
  private createHeart(centerX: number, centerY: number, width: number): void {
    const heart = this.add.container(centerX, centerY);
    const heartScale = Math.min(width * 0.95, 400) / MENU_HEART_SIZE;

    // Гало света из мышцы: аддитивный слой под сердцем
    heart.add(
      this.add
        .image(0, 0, 'crystal-glow')
        .setBlendMode(Phaser.BlendModes.ADD)
        .setScale((MENU_HEART_SIZE * 1.4) / HEART_GLOW_SIZE)
        .setAlpha(0.5),
    );
    heart.add(this.add.image(0, 0, 'menu-heart').setScale(heartScale));

    this.tweens.add({
      targets: heart.list[0],
      alpha: { from: 0.34, to: 0.74 },
      duration: 500,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut',
    });

    this.tweens.chain({
      targets: heart,
      loop: -1,
      tweens: [
        { scale: 1.07, duration: 120, ease: 'Sine.easeOut' },
        { scale: 1, duration: 130, ease: 'Sine.easeIn' },
        { scale: 1.04, duration: 100, ease: 'Sine.easeOut' },
        { scale: 1, duration: 650, ease: 'Sine.easeInOut' },
      ],
    });
  }

  private createPlayButton(centerX: number, centerY: number): void {
    const btnWidth = Math.min(300, this.scale.width - 40);
    const btnHeight = 72;
    const radius = 16;

    const bg = this.add.graphics();
    bg.fillStyle(HEART.muscle, 1);
    bg.fillRoundedRect(centerX - btnWidth / 2, centerY - btnHeight / 2, btnWidth, btnHeight, radius);
    bg.lineStyle(2, HEART.muscleHi, 0.8);
    bg.strokeRoundedRect(centerX - btnWidth / 2, centerY - btnHeight / 2, btnWidth, btnHeight, radius);

    const label = this.add
      .text(centerX, centerY, 'ИГРАТЬ', {
        fontFamily: 'Arial, sans-serif',
        fontSize: '32px',
        fontStyle: 'bold',
        color: '#ffffff',
      })
      .setOrigin(0.5)
      .setShadow(0, 2, '#5c0a12', 6, false, true);

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

  /** Рекорд: лучший забег по волнам/уровню */
  private createBestRunLabel(centerX: number, y: number): void {
    const best = loadBest();
    if (!best) {
      return;
    }
    const text =
      `ЛУЧШИЙ ЗАБЕГ: ВОЛНА ${best.wave} · УРОВЕНЬ ${best.level} · УБИЙСТВ ${best.kills} · ` +
      `${Math.floor(best.time / 60)}:${String(Math.floor(best.time % 60)).padStart(2, '0')}`;
    this.add
      .text(centerX, y, text, {
        fontFamily: 'Arial, sans-serif',
        fontSize: '16px',
        color: '#ffd54f',
      })
      .setOrigin(0.5)
      .setShadow(0, 2, '#3a0308', 6, false, true);
  }

  /** Подсказка о продолжении сохранённого забега */
  private createContinueHint(centerX: number, y: number): void {
    if (!loadRun()) {
      return;
    }
    this.add
      .text(centerX, y, 'нажмите ИГРАТЬ, чтобы продолжить сохранённый забег', {
        fontFamily: 'Arial, sans-serif',
        fontSize: '15px',
        color: '#9fe8bf',
      })
      .setOrigin(0.5)
      .setShadow(0, 2, '#3a0308', 6, false, true);
  }

  /** Вторая кнопка: сбросить сохранённый забег и начать новый */
  private createNewRunButton(centerX: number, y: number): void {
    if (!loadRun()) {
      return;
    }

    const btnWidth = Math.min(300, this.scale.width - 40);
    const btnHeight = 56;
    const radius = 14;

    const bg = this.add.graphics();
    bg.fillStyle(0x3a1218, 1);
    bg.fillRoundedRect(centerX - btnWidth / 2, y - btnHeight / 2, btnWidth, btnHeight, radius);
    bg.lineStyle(1, 0x8a4a52, 0.7);
    bg.strokeRoundedRect(centerX - btnWidth / 2, y - btnHeight / 2, btnWidth, btnHeight, radius);

    const label = this.add
      .text(centerX, y, 'НАЧАТЬ ЗАНОВО', {
        fontFamily: 'Arial, sans-serif',
        fontSize: '22px',
        fontStyle: 'bold',
        color: '#e8a0a8',
      })
      .setOrigin(0.5)
      .setShadow(0, 2, '#2a0206', 4, false, true);

    const zone = this.add
      .zone(centerX, y, btnWidth, btnHeight)
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true });

    zone.on('pointerdown', () => {
      this.tweens.add({
        targets: [bg, label],
        scale: 0.94,
        duration: 80,
        yoyo: true,
        onComplete: () => {
          clearRun();
          this.scene.start('Game');
        },
      });
    });
  }
}
