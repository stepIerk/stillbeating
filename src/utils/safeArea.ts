// Диагностика viewport для iOS standalone PWA.
//
// Симптом: в standalone (viewport-fit=cover + black-translucent) WebKit вычитает
// верхний safe-area-inset из height:100%, 100vh, 100svh и 100dvh — контейнер
// получается короче реального экрана на высоту статус-бара. Только 100lvh даёт
// полную высоту. Логи ниже позволяют сравнить значения в standalone
// (navigator.standalone === true) и в обычном Safari и подтвердить причину.
export function installViewportDiagnostics(): void {
  const log = (label: string, extra = ''): void => {
    const vv = window.visualViewport;
    const standalone = (navigator as Navigator & { standalone?: boolean }).standalone;
    console.log(
      `[VP][${label}]` +
        ` innerHeight=${window.innerHeight}` +
        ` docClientHeight=${document.documentElement.clientHeight}` +
        ` visualViewport.height=${vv ? Math.round(vv.height * 10) / 10 : 'n/a'}` +
        ` screen.height=${window.screen.height}` +
        ` navigator.standalone=${standalone}` +
        ` dpr=${window.devicePixelRatio}` +
        (extra ? ` ${extra}` : ''),
    );
  };

  log('init');
  window.addEventListener('load', () => log('load'));
  window.addEventListener('resize', () => log('resize'));
  window.addEventListener('orientationchange', () => log('orientationchange'));
  window.addEventListener('pageshow', (event) => {
    log('pageshow', `persisted=${event.persisted}`);
  });
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', () => log('visualViewport.resize'));
  }
}

// Чтение CSS safe-area-insets (вырез Dynamic Island, чёлка, home-индикатор).
// Phaser-канвас занимает весь экран (viewport-fit=cover), поэтому отступы
// нужно учитывать вручную при раскладке HUD в UIScene.layoutHud().
//
// env() нельзя прочитать из JS напрямую — измеряем через временный div,
// у которого padding задан через env(). Вызывать только на resize/re-layout,
// а не каждый кадр.

export interface SafeAreaInsets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

const ZERO: SafeAreaInsets = { top: 0, right: 0, bottom: 0, left: 0 };

function parsePx(value: string): number {
  const n = Number.parseFloat(value);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Fallback для iOS standalone, где env(safe-area-inset-bottom) врёт и
 * возвращает 0 (WebKit bug 254868; также подтверждено в next.js discussion
 * #81264 и piclaw docs/PWA.md). «Лежачий» viewport (svh/dvh/visualViewport)
 * отчитывает высоту МИНУС safe-area — измеряем дефицит между полной высотой
 * экрана (screen) и высотой визуального viewport и считаем его нижним инсетом.
 * Возвращаем только разумные значения (высота home-индикатора ~34px).
 */
function measureStandaloneBottomInset(): number {
  try {
    const standalone = (navigator as Navigator & { standalone?: boolean }).standalone;
    if (!standalone) return 0;
    const vv = window.visualViewport;
    if (!vv) return 0;
    // screen.width/height на iOS не вращаются — ориентируемся по innerWidth/Height
    const portrait = window.innerWidth < window.innerHeight;
    const fullHeight = portrait ? window.screen.height : window.screen.width;
    const reportedHeight = portrait ? vv.height : vv.width;
    const deficit = Math.round(fullHeight - reportedHeight);
    if (deficit <= 0 || deficit > 150) return 0;
    return deficit;
  } catch {
    return 0;
  }
}

export function getSafeAreaInsets(): SafeAreaInsets {
  try {
    if (typeof document === 'undefined' || !document.body) {
      return ZERO;
    }
    const probe = document.createElement('div');
    probe.style.cssText =
      'position:fixed;inset:0;' +
      'padding:env(safe-area-inset-top,0px) env(safe-area-inset-right,0px) ' +
      'env(safe-area-inset-bottom,0px) env(safe-area-inset-left,0px);' +
      'visibility:hidden;pointer-events:none;';
    document.body.appendChild(probe);
    const cs = getComputedStyle(probe);
    const result: SafeAreaInsets = {
      top: parsePx(cs.paddingTop),
      right: parsePx(cs.paddingRight),
      bottom: parsePx(cs.paddingBottom),
      left: parsePx(cs.paddingLeft),
    };
    probe.remove();
    // iOS standalone: env(safe-area-inset-bottom) врёт (0px) — берём измеренный
    // дефицит viewport. Без этого управление уезжает под home-индикатор.
    if (result.bottom === 0) {
      result.bottom = measureStandaloneBottomInset();
    }
    return result;
  } catch {
    return ZERO;
  }
}
