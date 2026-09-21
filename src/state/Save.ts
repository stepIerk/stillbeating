import RunState from './RunState';

/**
 * Сохранение забега в localStorage.
 * Забег живёт, пока игрок не проиграл: сейв удаляется в game-over.
 * Отдельно хранится лучший результат (рекорд) по волнам/уровню.
 *
 * Все обращения к localStorage обёрнуты в try/catch: приватный режим,
 * переполнение или отсутствие API не должны ломать игру. В окружениях без
 * localStorage (Node-тесты) используется in-memory фолбэк.
 */

const RUN_KEY = 'degame.save.v1';
const BEST_KEY = 'degame.best.v1';

/** Полный снимок сохраняемого забега */
export interface RunSaveData extends ReturnType<RunState['serialize']> {
  /** Номер волны, с которой продолжить (она начинается заново) */
  wave: number;
  /** Бонус к макс. HP сердца, купленный в лавке */
  crystalBonusHp: number;
}

/** Лучший результат за все забеги */
export interface BestRunData {
  wave: number;
  level: number;
  kills: number;
  /** Лучшее время выживания, секунды */
  time: number;
}

/** Доступ к хранилищу с in-memory фолбэком */
function getStorage(): Storage | null {
  try {
    if (typeof localStorage !== 'undefined') {
      return localStorage;
    }
  } catch {
    // доступ к localStorage может кинуть в приватном режиме
  }
  return null;
}

/** Фолбэк-хранилище для окружений без localStorage */
const memoryStore = new Map<string, string>();

function storageGet(key: string): string | null {
  const storage = getStorage();
  if (storage) {
    try {
      return storage.getItem(key);
    } catch {
      return null;
    }
  }
  return memoryStore.get(key) ?? null;
}

function storageSet(key: string, value: string): void {
  const storage = getStorage();
  if (storage) {
    try {
      storage.setItem(key, value);
      return;
    } catch {
      // переполнение квоты — падаем в память, игра продолжается
    }
  }
  memoryStore.set(key, value);
}

function storageRemove(key: string): void {
  const storage = getStorage();
  if (storage) {
    try {
      storage.removeItem(key);
    } catch {
      // игнорируем
    }
  }
  memoryStore.delete(key);
}

function readJson<T>(key: string): T | null {
  const raw = storageGet(key);
  if (!raw) {
    return null;
  }
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function writeJson(key: string, value: unknown): void {
  try {
    storageSet(key, JSON.stringify(value));
  } catch {
    // сериализация не удалась — сейв просто не обновится
  }
}

// ---------- Забег ----------

export function saveRun(run: RunState, wave: number, crystalBonusHp: number): void {
  const data: RunSaveData = {
    ...run.serialize(),
    wave,
    crystalBonusHp: Math.max(0, Math.floor(crystalBonusHp)),
  };
  writeJson(RUN_KEY, data);
}

export function loadRun(): RunSaveData | null {
  const data = readJson<RunSaveData>(RUN_KEY);
  if (!data || typeof data !== 'object') {
    return null;
  }
  // Минимальная проверка структуры
  if (typeof data.gold !== 'number' || !Array.isArray(data.learnedSkills)) {
    return null;
  }
  return data;
}

/** Сейв больше не нужен (проигрыш / начало нового забега) */
export function clearRun(): void {
  storageRemove(RUN_KEY);
}

/** Сброс рекорда (для тестов) */
export function clearBest(): void {
  storageRemove(BEST_KEY);
}

// ---------- Лучший результат ----------

export function loadBest(): BestRunData | null {
  const data = readJson<BestRunData>(BEST_KEY);
  if (!data || typeof data !== 'object' || typeof data.wave !== 'number') {
    return null;
  }
  return data;
}

/**
 * Обновляет рекорд, если новый забег лучше. Критерий: волна, при равенстве —
 * уровень. Возвращает true, если рекорд обновлён.
 */
export function maybeSaveBest(stats: BestRunData): boolean {
  const prev = loadBest();
  if (prev && (prev.wave > stats.wave || (prev.wave === stats.wave && prev.level >= stats.level))) {
    return false;
  }
  writeJson(BEST_KEY, stats);
  return true;
}
