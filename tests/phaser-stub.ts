// Временная заглушка Phaser для смоук-теста логики в Node (без DOM).
// В проекте не используется — нужна только для тестового SSR-сборки.
const FloatBetween = (min: number, max: number): number => min + Math.random() * (max - min);
const Between = (min: number, max: number): number => Math.floor(min + Math.random() * (max - min + 1));
const Clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

const Shuffle = (arr: unknown[]): unknown[] => {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = arr[i];
    arr[i] = arr[j];
    arr[j] = tmp;
  }
  return arr;
};

const Phaser = {
  Math: { FloatBetween, Between, Clamp },
  Utils: { Array: { Shuffle, GetRandom: (arr: unknown[]) => arr[Math.floor(Math.random() * arr.length)] } },
  TintModes: { MULTIPLY: 0, FILL: 1 },
};

export default Phaser;
