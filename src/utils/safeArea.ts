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
