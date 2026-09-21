// Центральный файл баланса игры.
// Все числа (игрок, кристалл, враги, волны, опыт, золото) собраны здесь,
// чтобы после тестов на телефоне правки баланса делались в одном месте.

export const WORLD_SIZE = 1800;
export const WALL_THICKNESS = 48;
/** Высота нижней панели управления: джойстик, кнопки атаки/навыков, характеристики */
export const CONTROLS_HEIGHT = 200;

/**
 * Визуал мира «внутри бога»: пол — ткань с клетками, поверх — вены,
 * стены — мышечные волокна, ворота — раны. Тайлы рисуются простыми фигурами
 * (см. render/textures.ts), все числа подгоняются здесь.
 */
export const WORLD_VISUALS = {
  /** Сторона тайла пола (крупный — чтобы повтор клеток не бросался в глаза) */
  floorTile: 512,
  /** Клеток и точечных ядер на тайле пола */
  floorCells: 22,
  floorSpecks: 40,
  /** Размер клетки в долях тайла */
  floorCellMin: 0.08,
  floorCellMax: 0.15,
  /** Сторона тайла вен и сколько стволов на нём */
  veinTile: 512,
  veinTrunks: 5,
  /** Прозрачность и масштаб слоя вен поверх клеток */
  veinAlpha: 0.45,
  veinScale: 2,
  /** Тайл стены: длина вдоль стены (толщина — WALL_THICKNESS) и сколько волокон */
  wallTile: 128,
  wallFibers: 4,
  /** Крупные сосуды от сердца: сколько и какой толщины */
  vesselCount: 4,
  vesselWidth: 9,
  /** Стенки сосудов гаснут вместе с глубиной ветки */
  vesselBranchDepth: 1,
  /** Ворота-«раны»: радиус ямы, число колец, длина отходящих жил */
  poreRadius: 46,
  poreRings: 3,
  poreVeins: 5,
  /** Овальный «рот» в стене на месте ворот: длина вдоль стены и число слоёв */
  poreMouthLength: 190,
  poreMouthLayers: 4,
  /** Светлая мембрана по внутреннему краю стены */
  wallMembraneAlpha: 0.22,
  wallMembraneInset: 5,
} as const;

/**
 * Атрибуты персонажа. Стартовое значение каждого — ATTRS.startValue.
 * Влияние одного очка указано ниже; финальные статы считает systems/DerivedStats.
 */
export type AttrId = 'str' | 'agi' | 'end' | 'int' | 'luck';

export const ATTRS = {
  startValue: 5,
  /** Сила: урон атаки */
  str: { damagePerPoint: 2 },
  /** Ловкость: скорость атаки и бега */
  agi: { attackSpeedPctPerPoint: 0.02, moveSpeedPctPerPoint: 0.01 },
  /** Выносливость: объём здоровья и регенерация */
  end: { hpPerPoint: 12, hpRegenPerPoint: 0.15 },
  /** Интеллект: объём маны и регенерация */
  int: { manaPerPoint: 8, manaRegenPerPoint: 0.4 },
  /** Удача: крит, шанс лучшего лута */
  luck: {
    critChancePerPoint: 0.005,
    critMultiplier: 1.6,
    /** Множитель шансов выпадения лута */
    dropBonusPerPoint: 0.03,
  },
} satisfies Record<AttrId | 'startValue', unknown>;

export const ATTR_LABELS: Record<AttrId, string> = {
  str: 'СИЛА',
  agi: 'ЛОВКОСТЬ',
  end: 'ВЫНОСЛИВОСТЬ',
  int: 'ИНТЕЛЛЕКТ',
  luck: 'УДАЧА',
};

export const PLAYER_STATS = {
  /** База урона: итог = baseDamage + СИЛА * damagePerPoint (+ оружие) */
  baseDamage: 2,
  /** База здоровья: итог = baseHp + ВЫНОСЛ. * hpPerPoint (+ оружие) */
  baseHp: 40,
  /** База маны: итог = baseMana + ИНТЕЛЛЕКТ * manaPerPoint */
  baseMana: 20,
  attackInterval: 450,
  attackRange: 240,
  moveSpeed: 340,
  respawnDelay: 3000,
  invulnTime: 2000,
  radius: 28,
};

/**
 * Визуал игрока: персонаж собран из простых фигур — белый круг-тело,
 * чёрное лицо-овал (чуть сплюснуто сверху и снизу) и два белых овала-глаза.
 * Здесь же параметры анимаций: «взгляд» в сторону движения и «дыхание».
 */
export const PLAYER_VISUALS = {
  /** Радиус круга-тела (совпадает с радиусом физического тела) */
  bodyRadius: PLAYER_STATS.radius,
  /** Полуоси лица: по X больше, чем по Y — овал сплюснут сверху и снизу */
  faceRadiusX: 17,
  faceRadiusY: 14,
  /** Полуоси глаза (овал, вытянутый по вертикали) */
  eyeRadiusX: 4,
  eyeRadiusY: 6,
  /** Расстояние от центра лица до центра каждого глаза */
  eyeOffsetX: 6.5,
  /** Максимальное смещение лица в сторону движения (px) */
  faceShift: 5,
  /** Насколько дополнительно глаза смещаются внутри лица (доля от смещения лица) */
  eyeShiftRatio: 0.6,
  /** «Дыхание»: амплитуда подъёма/опускания (px) и период полного цикла (мс) */
  breathAmplitude: 3,
  breathPeriod: 1700,
  /** Сглаживание «взгляда»: за сколько мс он догоняет новое направление */
  aimSmoothMs: 130,
  /** Сколько мс взгляд держится на атаке/рывке (у них приоритет над движением) */
  lookHoldMs: 550,
  /** Отдача от выстрела: на сколько px персонаж подаётся назад и за сколько мс возвращается */
  recoilDistance: 4,
  recoilMs: 140,
} as const;

/**
 * Снаряд атаки игрока: белая сфера летит от героя в сторону цели и
 * разлетается брызгами, когда попадёт или долетит до радиуса атаки.
 */
export const PLAYER_ATTACK_FX = {
  /** Радиус сферы (размер её текстуры) */
  shotRadius: 15,
  /** За сколько мс сфера пролетает всю дистанцию атаки (скорость от радиуса) */
  flightMs: 220,
  /** Радиус попадания сферы по цели (плюс радиус самого врага) */
  hitRadius: 16,
  /** Скорость доворота сферы к цели (рад/с) — лёгкое самонаведение по бегущим */
  homingTurn: 5,
  /** Через сколько мс сфера оставляет отпечаток «хвоста» */
  trailEveryMs: 20,
  /** Сколько живёт один отпечаток «хвоста» (мс) */
  trailFadeMs: 220,
  /** Брызги при взрыве сферы: количество капель и разлёт (px) */
  splashCount: 12,
  splashSpread: 38,
} as const;

/** Базовые регенерации (в единицах в секунду), растут от атрибутов */
export const REGEN = { hpBase: 0.2, manaBase: 0.5 };


export const CRYSTAL_STATS = {
  maxHp: 500,
  /** Радиус цели: по нему враги бьют сердце и по нему же строится его тело */
  radius: 46,
  /** Смещение центра кристалла от нижней стены */
  offsetFromBottom: 110,
};

/** Опыт для следующего уровня: base + perLevel * level */
export const XP_CURVE = { base: 20, perLevel: 15 };

export const GOLD = {
  /** Радиус притяжения монет к игроку */
  magnetRadius: 130,
  /** Через сколько мс монета сама летит к игроку */
  pickupDelay: 600,
  coinRadius: 9,
  collectRadius: 26,
};

export type EnemyTierId = 'slime' | 'runner' | 'tank' | 'shooter' | 'boss';

export interface EnemyTier {
  id: EnemyTierId;
  name: string;
  hp: number;
  damage: number;
  speed: number;
  /** Интервал между ударами (мс) */
  attackInterval: number;
  /**
   * Радиус тела: он же половина размера текстуры врага, поэтому задаёт и
   * габарит вида на карте, и радиус хитбокса (увеличен, чтобы бактерии
   * читались в бою так же крупно, как прежние враги).
   */
  radius: number;
  color: number;
  xp: number;
  gold: number;
  /** С какой волны тир появляется */
  fromWave: number;
  /** Вес при выборе тира (0 = только вручную, напр. босс) */
  weight: number;
  /** Шанс, что враг пойдёт сразу к кристаллу (осадник) */
  siegeChance: number;
  /**
   * Стрелок: подходит к цели на дистанцию shootRange и стреляет зарядами
   * (скорость полёта — projectileSpeed). У обычных врагов поля нет.
   */
  shootRange?: number;
  projectileSpeed?: number;
}

export const ENEMY_TIERS: EnemyTier[] = [
  {
    id: 'slime', name: 'Слизень', hp: 30, damage: 6, speed: 75, attackInterval: 900,
    radius: 24, color: 0x66bb6a, xp: 5, gold: 4, fromWave: 1, weight: 60, siegeChance: 0.2,
  },
  {
    id: 'runner', name: 'Бегун', hp: 22, damage: 8, speed: 120, attackInterval: 700,
    radius: 19, color: 0xffb74d, xp: 7, gold: 5, fromWave: 2, weight: 45, siegeChance: 0.25,
  },
  {
    id: 'shooter', name: 'Плеватель', hp: 26, damage: 9, speed: 85, attackInterval: 1700,
    radius: 22, color: 0x26a69a, xp: 9, gold: 6, fromWave: 3, weight: 35, siegeChance: 0.15,
    shootRange: 280, projectileSpeed: 320,
  },
  {
    id: 'tank', name: 'Осадник', hp: 90, damage: 14, speed: 55, attackInterval: 1200,
    radius: 33, color: 0x8e24aa, xp: 18, gold: 12, fromWave: 4, weight: 25, siegeChance: 1,
  },
  {
    id: 'boss', name: 'Босс', hp: 400, damage: 25, speed: 60, attackInterval: 1000,
    radius: 46, color: 0xd81b60, xp: 70, gold: 45, fromWave: 5, weight: 0, siegeChance: 0.5,
  },
];

export const WAVES = {
  baseCount: 4,
  countPerWave: 2,
  /** Степень «аркадного» роста: count += wave^countPower (растёт быстрее линейного) */
  countPower: 1.35,
  /** Верхний предел одновременно заезжаемой волны */
  maxCount: 120,
  baseSpawnInterval: 800,
  minSpawnInterval: 140,
  spawnIntervalPerWave: 45,
  /** Пауза между волнами (мс) */
  intermission: 6000,
  /** Рост HP врагов: множитель (1 + scale)^(волна - 1) — бесконечное усиление */
  hpScalePerWave: 0.12,
  /** Рост урона врагов: множитель (1 + scale)^(волна - 1) */
  damageScalePerWave: 0.08,
  /** Рост скорости врагов: +scale за волну с потолком speedCap */
  speedScalePerWave: 0.015,
  speedCap: 1.5,
  bossEvery: 5,
};

/** Число врагов в волне: аркадный рост, бесконечный до потолка maxCount */
export function waveEnemyCount(wave: number): number {
  const linear = WAVES.baseCount + wave * WAVES.countPerWave;
  const growth = Math.pow(wave, WAVES.countPower);
  return Math.min(WAVES.maxCount, Math.round(linear + growth));
}

/** Лавка на карте: единственное место, где тратится золото */
export const SHOP = {
  /** Смещение лавки по X от центра карты (внизу, рядом с кристаллом) */
  offsetX: -430,
  /** Смещение от нижней стены */
  offsetFromBottom: 140,
  /** С какой дистанции удар по лавке открывает магазин */
  interactRange: 160,
  /** Радиус свечения-подсказки: подогнан под размер нароста-пещеры */
  glowRadius: 84,
};

/** Зазор между телами при атаке: дистанция удара = радиусы + этот зазор */
export const ENEMY_ATTACK_PAD = 10;

// ---------- Лут с монстров ----------

/** Шансы выпадения за убийство (до множителя удачи). Босс получает бонус ко всем */
export const DROPS = {
  statPoint: 0.04,
  weapon: 0.025,
  skill: 0.012,
  /** Прибавка к каждому шансу, если убит босс */
  bossBonus: 0.03,
  /** Цена продажи оружия из инвентаря (доля от цены в лавке) */
  sellRatio: 0.5,
};

// ---------- Оружие ----------

export type Rarity = 'common' | 'rare' | 'epic';

export interface WeaponDef {
  id: string;
  name: string;
  rarity: Rarity;
  /** Цена в лавке (0 — не продаётся) */
  shopCost: number;
  /** С какого уровня лавки продаётся */
  minShopLevel: number;
  /** Бонусы в экипировке */
  damage?: number;
  attackSpeedPct?: number;
  range?: number;
  critChance?: number;
  /** Прибавка к множителю крита (базовый задаётся удачей) */
  critMultiplierAdd?: number;
  /** Прибавка к удаче (итог считается отдельно от очков удачи) */
  luck?: number;
  hp?: number;
  /** Скорость движения: доля прибавки/убавки */
  moveSpeedPct?: number;
  /** Регенерация HP в секунду */
  hpRegenAdd?: number;
  /** Прибавка к максимальной мане */
  mana?: number;
}

export const WEAPONS: WeaponDef[] = [
  // ---------- common · лавка ур. 1 ----------
  { id: 'rusty', name: 'Ржавый клинок', rarity: 'common', shopCost: 10, minShopLevel: 1, damage: 2 },
  { id: 'twin', name: 'Парные кинжалы', rarity: 'common', shopCost: 14, minShopLevel: 1, attackSpeedPct: 0.1, critChance: 0.03 },
  { id: 'spear', name: 'Длинное копьё', rarity: 'common', shopCost: 12, minShopLevel: 1, range: 35 },
  { id: 'wand', name: 'Жезл ученика', rarity: 'common', shopCost: 12, minShopLevel: 1, damage: 1, mana: 20 },
  { id: 'kite', name: 'Клёпаный щит', rarity: 'common', shopCost: 12, minShopLevel: 1, hp: 18, hpRegenAdd: 0.1 },
  // ---------- rare · лавка ур. 2-3 ----------
  { id: 'hammer', name: 'Тяжёлый молот', rarity: 'rare', shopCost: 28, minShopLevel: 2, damage: 8, attackSpeedPct: -0.1 },
  { id: 'bow', name: 'Лук охотника', rarity: 'rare', shopCost: 30, minShopLevel: 2, attackSpeedPct: 0.12, range: 60 },
  { id: 'scimitar', name: 'Ятаган разбойника', rarity: 'rare', shopCost: 26, minShopLevel: 2, damage: 4, attackSpeedPct: 0.18, critChance: 0.04 },
  { id: 'charm', name: 'Клинок удачи', rarity: 'rare', shopCost: 30, minShopLevel: 3, critChance: 0.04, luck: 3 },
  { id: 'windfan', name: 'Ветродуй', rarity: 'rare', shopCost: 32, minShopLevel: 3, attackSpeedPct: 0.06, moveSpeedPct: 0.12, luck: 1 },
  { id: 'bloodthorn', name: 'Кровоцвет', rarity: 'rare', shopCost: 34, minShopLevel: 3, damage: 5, hp: 40, hpRegenAdd: 0.25 },
  // ---------- epic · лавка ур. 4-5 ----------
  { id: 'axe', name: 'Боевой топор', rarity: 'epic', shopCost: 60, minShopLevel: 4, damage: 14, critChance: 0.05, attackSpeedPct: -0.05 },
  { id: 'stormfang', name: 'Клык бури', rarity: 'epic', shopCost: 62, minShopLevel: 4, damage: 12, attackSpeedPct: 0.15, critChance: 0.05, moveSpeedPct: 0.06 },
  { id: 'staff', name: 'Посох силы', rarity: 'epic', shopCost: 65, minShopLevel: 5, damage: 10, range: 80, attackSpeedPct: 0.08, mana: 30 },
  { id: 'rapier', name: 'Сапфировая рапира', rarity: 'epic', shopCost: 68, minShopLevel: 5, damage: 8, critChance: 0.06, critMultiplierAdd: 0.75, moveSpeedPct: 0.1 },
  { id: 'reaper', name: 'Жнец', rarity: 'epic', shopCost: 70, minShopLevel: 5, damage: 18, critChance: 0.08, critMultiplierAdd: 0.5, attackSpeedPct: -0.15 },
];

// ---------- Навыки (активируются кнопками-крестом у кнопки атаки) ----------

export interface SkillDef {
  id: string;
  name: string;
  desc: string;
  rarity: Rarity;
  /** Цена изучения в лавке */
  shopCost: number;
  /** Требуемый уровень лавки */
  minShopLevel: number;
  /** Цена маны за применение */
  manaCost: number;
  /** Перезарядка (мс) */
  cooldown: number;
  /** Параметры эффекта (на 1-м уровне) */
  radius?: number;
  damageMult?: number;
  /** Доля макс. HP, поглощаемая щитом */
  shieldHpPct?: number;
  /** Длительность щита/берсерка (мс) */
  duration?: number;
  /** Множитель урона берсерка */
  berserkMult?: number;
  /** Дальность рывка (px) */
  dashDistance?: number;
  /** Сколько врагов задевает цепная молния */
  chainTargets?: number;
  // ---------- Прокачка за золото ----------
  /** Максимальный уровень навыка (Infinity — прокачка без предела) */
  maxLevel: number;
  /** Базовая цена улучшения (растёт с каждым уровнем: ×1.5 за уровень) */
  upgradeCost: number;
  /** Прибавка к параметру за каждый уровень навыка */
  perLevel?: {
    radius?: number;
    damageMult?: number;
    shieldHpPct?: number;
    duration?: number;
    berserkMult?: number;
    dashDistance?: number;
    chainTargets?: number;
    /** Снижение цены маны за уровень */
    manaCost?: number;
    /** Снижение перезарядки за уровень (мс), не ниже SKILL_UPGRADE.minCooldownFrac */
    cooldown?: number;
  };
}

/** Бесконечная прокачка навыков: цена и предел снижения КД */
export const SKILL_UPGRADE = {
  /** Перезарядка не опускается ниже этой доли базовой */
  minCooldownFrac: 0.4,
} as const;

export const SKILLS: SkillDef[] = [
  {
    id: 'nova', name: 'Нова', desc: 'Взрыв вокруг игрока: урон всем врагам рядом',
    rarity: 'common', shopCost: 35, minShopLevel: 2, manaCost: 20, cooldown: 6000,
    radius: 240, damageMult: 1.4,
    maxLevel: Infinity, upgradeCost: 35, perLevel: { radius: 30, damageMult: 0.3, cooldown: 250 },
  },
  {
    id: 'dash', name: 'Рывок', desc: 'Стремительный слайд в направлении движения: урон всем врагам на пути, на время рывка игрок неуязвим',
    rarity: 'common', shopCost: 30, minShopLevel: 1, manaCost: 12, cooldown: 5000,
    dashDistance: 260, damageMult: 0.8,
    maxLevel: Infinity, upgradeCost: 30, perLevel: { dashDistance: 40, damageMult: 0.2, cooldown: 200 },
  },
  {
    id: 'shield', name: 'Ледяной щит', desc: 'Поглощает урон, пока не разобьют или не истечёт',
    rarity: 'rare', shopCost: 45, minShopLevel: 3, manaCost: 30, cooldown: 15000,
    shieldHpPct: 0.4, duration: 8000,
    maxLevel: Infinity, upgradeCost: 40, perLevel: { shieldHpPct: 0.1, duration: 1500, cooldown: 600 },
  },
  {
    id: 'chain', name: 'Цепная молния', desc: 'Молния бьёт ближайшего врага и перескакивает на соседних',
    rarity: 'rare', shopCost: 50, minShopLevel: 3, manaCost: 25, cooldown: 9000,
    chainTargets: 3, damageMult: 1.1,
    maxLevel: Infinity, upgradeCost: 40, perLevel: { chainTargets: 1, damageMult: 0.25, cooldown: 350 },
  },
  {
    id: 'berserk', name: 'Берсерк', desc: 'На время сильно повышает урон',
    rarity: 'epic', shopCost: 60, minShopLevel: 4, manaCost: 25, cooldown: 18000,
    berserkMult: 1.5, duration: 8000,
    maxLevel: Infinity, upgradeCost: 50, perLevel: { berserkMult: 0.25, duration: 1000, cooldown: 700 },
  },
];

// ---------- Лавка: уровень лавки вместо привязки к уровню игрока ----------

export const SHOP_LEVELS = {
  maxLevel: 5,
  /** Стоимость апгрейда лавки с уровня i на i+1: upgradeCosts[i] */
  upgradeCosts: [70, 140, 260, 420],
  /**
   * Сток товаров по редкостям для каждого уровня лавки (индекс = уровень - 1).
   * Купленный товар заменяется товаром той же редкости; замен на слот — replacementsPerSlot.
   */
  stockSlots: [
    { common: 3, rare: 0, epic: 0 }, // ур. 1
    { common: 2, rare: 1, epic: 0 }, // ур. 2
    { common: 1, rare: 2, epic: 0 }, // ур. 3
    { common: 1, rare: 2, epic: 1 }, // ур. 4
    { common: 0, rare: 2, epic: 2 }, // ур. 5
  ],
  /** Сколько раз купленный товар заменяется следующим (того же уровня) */
  replacementsPerSlot: 3,
  /** Услуги: случайный эффект в диапазоне, растёт с уровнем лавки */
  services: {
    heal: { baseMin: 25, baseMax: 45, perLevel: 12, cost: 10 },
    crystalRepair: { baseMin: 70, baseMax: 130, perLevel: 35, cost: 14 },
    mana: { baseMin: 20, baseMax: 35, perLevel: 8, cost: 8 },
    freeze: { baseMin: 2.5, baseMax: 4, perLevel: 0.8, cost: 22 },
  },
};

export type ServiceId = keyof typeof SHOP_LEVELS.services;

