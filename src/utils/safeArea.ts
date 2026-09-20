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
    return result;
  } catch {
    return ZERO;
  }
}
