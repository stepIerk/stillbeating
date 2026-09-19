import './style.css';
import Phaser from 'phaser';
import StartScene from './scenes/StartScene';
import GameScene from './scenes/GameScene';
import UIScene from './scenes/UIScene';

const config: Phaser.Types.Core.GameConfig = {
  type: Phaser.AUTO,
  parent: 'app',
  backgroundColor: '#14141b',
  // RESIZE: канвас занимает весь экран устройства (важно для мобильных),
  // а камера следит за игроком по карте, которая больше экрана
  scale: {
    mode: Phaser.Scale.RESIZE,
    autoCenter: Phaser.Scale.CENTER_BOTH,
    // Стартовый размер не важен: в RESIZE ScaleManager при boot и каждом
    // resize берёт размер родителя (#app) через getBoundingClientRect.
    width: '100%',
    height: '100%',
  },
  physics: {
    default: 'arcade',
    arcade: {
      debug: false,
    },
  },
  // Мультитач: джойстик + возможные будущие кнопки
  input: {
    activePointers: 3,
  },
  scene: [StartScene, GameScene, UIScene],
};

const game = new Phaser.Game(config);

// Отладочный доступ к игре (для консоли браузера и автоматических проверок)
declare global {
  interface Window {
    __game: Phaser.Game;
  }
}
window.__game = game;
