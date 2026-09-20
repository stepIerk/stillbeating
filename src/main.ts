import './style.css';
import Phaser from 'phaser';
import StartScene from './scenes/StartScene';
import GameScene from './scenes/GameScene';
import UIScene from './scenes/UIScene';
import { installViewportDiagnostics } from './utils/safeArea';

installViewportDiagnostics();

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

// iOS standalone: WebKit отдаёт заниженный innerHeight первые ~0.5-1с после
// запуска из иконки и с задержкой после orientationchange. Scale Manager не
// должен полагаться на первое значение — принудительно пересчитываем размер
// после того, как viewport устаканится. game.scale.refresh() в RESIZE-режиме
// перечитывает размер родителя (#app), и при реальном изменении поднимает
// 'resize', на который уже подписаны UIScene.layoutHud() и GameScene.
function refreshScaleWithDelay(delayMs: number): void {
  window.setTimeout(() => game.scale.refresh(), delayMs);
}

// Старт из иконки: значения занижены в первые кадры — серия отложенных refresh.
refreshScaleWithDelay(150);
refreshScaleWithDelay(600);
refreshScaleWithDelay(1200);

// Поворот: iOS отдаёт финальные размеры не сразу — refresh с задержкой
// (частый класс ошибок — полагаться только на значение при событии).
window.addEventListener('orientationchange', () => {
  refreshScaleWithDelay(350);
  refreshScaleWithDelay(800);
});

// Возврат из фона/переключение вкладок: страница может быть восстановлена
// (bfcache) со старыми размерами.
window.addEventListener('pageshow', (event) => {
  if (event.persisted) {
    refreshScaleWithDelay(100);
    refreshScaleWithDelay(600);
  }
});

// visualViewport.resize ловит все изменения viewport (скрытие/показ системных
// панелей в standalone в т.ч.), но срабатывает часто — дебаунсим.
let vvRefreshTimer = 0;
window.visualViewport?.addEventListener('resize', () => {
  window.clearTimeout(vvRefreshTimer);
  vvRefreshTimer = window.setTimeout(() => game.scale.refresh(), 150);
});


// Отладочный доступ к игре (для консоли браузера и автоматических проверок)
declare global {
  interface Window {
    __game: Phaser.Game;
  }
}
window.__game = game;
