import Phaser from 'phaser';
import {
  SHOP_LEVELS,
  SKILLS,
  type Rarity,
  type ServiceId,
  type SkillDef,
} from '../config/balance';
import type RunState from '../state/RunState';
import type { ShopStockSlot } from '../state/RunState';
import { describeSkillEffect, describeSkillUpgrade, skillAtLevel, skillUpgradeCost } from './Skills';

export type ShopOfferKind = 'points' | 'skill' | 'weapon' | 'service' | 'upgrade';
export type ShopTabId = 'goods' | 'services' | 'skills' | 'shop';

export interface ShopOffer {
  id: string;
  kind: ShopOfferKind;
  title: string;
  desc: string;
  /** Вкладка в окне лавки */
  tab: ShopTabId;
  /** Уровень товара (редкость) — для замены в стоке */
  tier?: Rarity;
  /** Индекс слота стока (товары) */
  slotIndex?: number;
  /** Слот распродан */
  soldOut?: boolean;
  cost: number;
  rarity?: Rarity;
  disabled?: boolean;
  /** Уровень прокачки навыка и максимум (для карточек улучшения) */
  level?: number;
  maxLevel?: number;
  payload?: {
    points?: number;
    crystalHp?: number;
    skillId?: string;
    weaponId?: string;
    serviceId?: ServiceId;
    skillTargetLevel?: number;
  };
}

/** Цена товара растёт с каждой покупкой того же товара */
export function scaledCost(baseCost: number, run: RunState, id: string): number {
  return Math.round(baseCost * (1 + 0.35 * run.purchasesOf(id)));
}

interface GoodsDef {
  id: string;
  kind: ShopOfferKind;
  title: string;
  desc: string;
  baseCost: number;
  rarity: Rarity;
  minShopLevel: number;
  payload?: ShopOffer['payload'];
}

/** Товары лавки (вкладка ТОВАРЫ). Оружие тоже часть стока */
const GOODS: GoodsDef[] = [
  {
    id: 'points-1', kind: 'points', title: 'ОЧКО ХАРАКТЕРИСТИК', desc: '+1 очко (тратьте в инвентаре)',
    baseCost: 12, rarity: 'common', minShopLevel: 1, payload: { points: 1 },
  },
  {
    id: 'weapon-rusty', kind: 'weapon', title: 'Ржавый клинок', desc: 'урон +2',
    baseCost: 10, rarity: 'common', minShopLevel: 1, payload: { weaponId: 'rusty' },
  },
  {
    id: 'weapon-twin', kind: 'weapon', title: 'Парные кинжалы', desc: 'скор. атаки +10%, крит +3%',
    baseCost: 14, rarity: 'common', minShopLevel: 1, payload: { weaponId: 'twin' },
  },
  {
    id: 'weapon-wand', kind: 'weapon', title: 'Жезл ученика', desc: 'мана +20, урон +1',
    baseCost: 12, rarity: 'common', minShopLevel: 1, payload: { weaponId: 'wand' },
  },
  {
    id: 'weapon-kite', kind: 'weapon', title: 'Клёпаный щит', desc: 'HP +18, реген +0.1 HP/с',
    baseCost: 12, rarity: 'common', minShopLevel: 1, payload: { weaponId: 'kite' },
  },
  {
    id: 'weapon-spear', kind: 'weapon', title: 'Длинное копьё', desc: 'радиус +35',
    baseCost: 12, rarity: 'common', minShopLevel: 1, payload: { weaponId: 'spear' },
  },
  {
    id: 'crystal-armor-small', kind: 'points', title: 'ЩИТ СЕРДЦА', desc: 'Макс. HP сердца +60',
    baseCost: 16, rarity: 'common', minShopLevel: 1, payload: { crystalHp: 60 },
  },
  {
    id: 'points-3', kind: 'points', title: '3 ОЧКА', desc: '+3 очка характеристик',
    baseCost: 32, rarity: 'rare', minShopLevel: 2, payload: { points: 3 },
  },
  {
    id: 'crystal-armor', kind: 'points', title: 'БРОНЯ СЕРДЦА', desc: 'Макс. HP сердца +150',
    baseCost: 26, rarity: 'rare', minShopLevel: 2, payload: { crystalHp: 150 },
  },
  {
    id: 'weapon-hammer', kind: 'weapon', title: 'Тяжёлый молот', desc: 'урон +8, скор. атаки -10%',
    baseCost: 28, rarity: 'rare', minShopLevel: 2, payload: { weaponId: 'hammer' },
  },
  {
    id: 'weapon-scimitar', kind: 'weapon', title: 'Ятаган разбойника', desc: 'урон +4, скор. атаки +18%, крит +4%',
    baseCost: 26, rarity: 'rare', minShopLevel: 2, payload: { weaponId: 'scimitar' },
  },
  {
    id: 'weapon-bow', kind: 'weapon', title: 'Лук охотника', desc: 'скор. атаки +12%, радиус +60',
    baseCost: 30, rarity: 'rare', minShopLevel: 2, payload: { weaponId: 'bow' },
  },
  {
    id: 'weapon-charm', kind: 'weapon', title: 'Клинок удачи', desc: 'крит +4%, удача +3',
    baseCost: 30, rarity: 'rare', minShopLevel: 3, payload: { weaponId: 'charm' },
  },
  {
    id: 'weapon-windfan', kind: 'weapon', title: 'Ветродуй', desc: 'скорость +12%, скор. атаки +6%, удача +1',
    baseCost: 32, rarity: 'rare', minShopLevel: 3, payload: { weaponId: 'windfan' },
  },
  {
    id: 'weapon-bloodthorn', kind: 'weapon', title: 'Кровоцвет', desc: 'урон +5, HP +40, реген +0.25 HP/с',
    baseCost: 34, rarity: 'rare', minShopLevel: 3, payload: { weaponId: 'bloodthorn' },
  },
  {
    id: 'crystal-armor-big', kind: 'points', title: 'БРОНЯ СЕРДЦА +', desc: 'Макс. HP сердца +280',
    baseCost: 44, rarity: 'rare', minShopLevel: 3, payload: { crystalHp: 280 },
  },
  {
    id: 'points-5', kind: 'points', title: '5 ОЧКОВ', desc: '+5 очков характеристик',
    baseCost: 50, rarity: 'epic', minShopLevel: 4, payload: { points: 5 },
  },
  {
    id: 'weapon-stormfang', kind: 'weapon', title: 'Клык бури', desc: 'урон +12, скор. атаки +15%, крит +5%, скорость +6%',
    baseCost: 62, rarity: 'epic', minShopLevel: 4, payload: { weaponId: 'stormfang' },
  },
  {
    id: 'weapon-axe', kind: 'weapon', title: 'Боевой топор', desc: 'урон +14, крит +5%, скор. атаки -5%',
    baseCost: 60, rarity: 'epic', minShopLevel: 4, payload: { weaponId: 'axe' },
  },
  {
    id: 'weapon-staff', kind: 'weapon', title: 'Посох силы', desc: 'урон +10, радиус +80, скор. атаки +8%, мана +30',
    baseCost: 65, rarity: 'epic', minShopLevel: 5, payload: { weaponId: 'staff' },
  },
  {
    id: 'weapon-rapier', kind: 'weapon', title: 'Сапфировая рапира', desc: 'урон +8, крит +6%, сила крита +0.75×, скорость +10%',
    baseCost: 68, rarity: 'epic', minShopLevel: 5, payload: { weaponId: 'rapier' },
  },
  {
    id: 'weapon-reaper', kind: 'weapon', title: 'Жнец', desc: 'урон +18, крит +8%, сила крита +0.5×, скор. атаки -15%',
    baseCost: 70, rarity: 'epic', minShopLevel: 5, payload: { weaponId: 'reaper' },
  },
];

interface ServiceDef {
  id: ServiceId;
  title: string;
  unit: string;
  minShopLevel: number;
}

/** Услуги лавки (вкладка УСЛУГИ). Не ограничены — покупаются многократно */
const SERVICES: ServiceDef[] = [
  { id: 'heal', title: 'ЛЕЧЕНИЕ', unit: 'HP', minShopLevel: 1 },
  { id: 'crystalRepair', title: 'РЕМОНТ СЕРДЦА', unit: 'HP', minShopLevel: 1 },
  { id: 'mana', title: 'ВОССТАНОВЛЕНИЕ МАНЫ', unit: 'MP', minShopLevel: 1 },
  { id: 'freeze', title: 'ЗАМОРОЗКА ВРАГОВ', unit: 'с', minShopLevel: 2 },
];

/** Диапазон эффекта услуги с учётом уровня лавки */
export function serviceRange(
  serviceId: ServiceId,
  shopLevel: number,
): { min: number; max: number } {
  const cfg = SHOP_LEVELS.services[serviceId];
  const shift = cfg.perLevel * (shopLevel - 1);
  return { min: cfg.baseMin + shift, max: cfg.baseMax + shift };
}

/** Вкладка УСЛУГИ: эффект случайный в диапазоне, качество растёт с уровнем лавки */
function pickServices(run: RunState): ShopOffer[] {
  return SERVICES.filter((d) => d.minShopLevel <= run.shopLevel).map((d) => {
    const range = serviceRange(d.id, run.shopLevel);
    const format = d.id === 'freeze' ? (v: number) => v.toFixed(1) : (v: number) => Math.round(v);
    return {
      id: `service-${d.id}`,
      kind: 'service' as const,
      title: d.title,
      desc: `Случайно: ${format(range.min)}–${format(range.max)} ${d.unit}`,
      tab: 'services' as const,
      cost: SHOP_LEVELS.services[d.id].cost,
      rarity: 'common' as const,
      payload: { serviceId: d.id },
    };
  });
}

function goodsDefById(id: string): GoodsDef | undefined {
  return GOODS.find((g) => g.id === id);
}

function soldOutOffer(slotIndex: number): ShopOffer {
  return {
    id: `stock-${slotIndex}`,
    kind: 'points',
    title: 'РАСПРОДАНО',
    desc: 'Новый товар появится после улучшения лавки',
    tab: 'goods',
    soldOut: true,
    cost: 0,
    disabled: true,
  };
}

/** Офер из слота стока (текущий товар слота) */
function stockSlotOffer(run: RunState, slot: ShopStockSlot): ShopOffer {
  if (!slot.defId) {
    return soldOutOffer(slot.slotIndex);
  }
  const def = goodsDefById(slot.defId);
  if (!def) {
    return soldOutOffer(slot.slotIndex);
  }

  return {
    id: `stock-${slot.slotIndex}`,
    kind: def.kind,
    title: def.title.toUpperCase(),
    desc: `${def.desc} · замен осталось: ${slot.replacementsLeft}`,
    tab: 'goods',
    tier: slot.tier,
    slotIndex: slot.slotIndex,
    cost: scaledCost(def.baseCost, run, def.id),
    rarity: def.rarity,
    payload: def.payload,
  };
}

/**
 * Генерирует сток товаров для текущего уровня лавки: слоты по редкостям
 * из конфига, товары случайно из пула доступных на этом уровне.
 */
export function rollShopStock(run: RunState): void {
  const slotsCfg =
    SHOP_LEVELS.stockSlots[Math.min(run.shopLevel, SHOP_LEVELS.stockSlots.length) - 1];
  const tiers: Array<{ tier: Rarity; count: number }> = [
    { tier: 'common', count: slotsCfg.common },
    { tier: 'rare', count: slotsCfg.rare },
    { tier: 'epic', count: slotsCfg.epic },
  ];

  const stock: ShopStockSlot[] = [];
  for (const { tier, count } of tiers) {
    const pool = Phaser.Utils.Array.Shuffle(
      GOODS.filter((g) => g.rarity === tier && g.minShopLevel <= run.shopLevel),
    );
    for (let i = 0; i < count; i++) {
      const def = pool.length > 0 ? pool[i % pool.length] : undefined;
      stock.push({
        slotIndex: stock.length,
        tier,
        defId: def ? def.id : null,
        replacementsLeft: SHOP_LEVELS.replacementsPerSlot,
      });
    }
  }

  run.shopStock = stock;
  run.stockShopLevel = run.shopLevel;
}

/**
 * Покупка товара из слота стока: товар заменяется следующим той же редкости,
 * а когда замены (SHOP_LEVELS.replacementsPerSlot) кончились — слот распродаётся.
 * Новый сток появляется после улучшения лавки.
 */
export function consumeStockSlot(run: RunState, slotIndex: number): void {
  const slot = run.shopStock[slotIndex];
  if (!slot || !slot.defId) {
    return;
  }

  const usedIds = new Set(
    run.shopStock
      .filter((s) => s.slotIndex !== slotIndex)
      .map((s) => s.defId)
      .filter((id): id is string => id !== null),
  );
  const def = goodsDefById(slot.defId);
  const currentIdx = def ? GOODS.findIndex((g) => g.id === def.id) : -1;

  const pickFrom = (excludeUsed: boolean): GoodsDef | undefined => {
    for (let step = 1; step <= GOODS.length; step++) {
      const candidate = GOODS[(currentIdx + step) % GOODS.length];
      if (
        candidate &&
        candidate.rarity === slot.tier &&
        candidate.minShopLevel <= run.shopLevel &&
        candidate.id !== slot.defId &&
        (!excludeUsed || !usedIds.has(candidate.id))
      ) {
        return candidate;
      }
    }
    return undefined;
  };

  // Сначала новый товар (разнообразие), при отсутствии — повтор того же уровня
  const next = pickFrom(true) ?? pickFrom(false);

  if (slot.replacementsLeft > 0 && next) {
    slot.replacementsLeft -= 1;
    slot.defId = next.id;
  } else {
    slot.defId = null;
    slot.replacementsLeft = 0;
  }
}

/** Вкладка НАВЫКИ: изучение новых навыков и улучшение изученных */
function pickSkillOffers(run: RunState): ShopOffer[] {
  const learnOffers: ShopOffer[] = SKILLS.filter(
    (s) => s.minShopLevel <= run.shopLevel && !run.learnedSkills.includes(s.id),
  ).map((s) => ({
    id: `skill-${s.id}`,
    kind: 'skill' as const,
    title: `ИЗУЧИТЬ: ${s.name.toUpperCase()}`,
    desc: `${s.desc} · ${describeSkillEffect(s)}`,
    tab: 'skills' as const,
    cost: s.shopCost,
    rarity: s.rarity,
    payload: { skillId: s.id },
  }));

  const upgradeOffers: ShopOffer[] = run.learnedSkills
    .map((id) => SKILLS.find((s) => s.id === id))
    .filter((s): s is SkillDef => Boolean(s))
    .map((s) => {
      const level = run.skillLevelOf(s.id);
      const maxed = level >= s.maxLevel;
      const target = level + 1;
      const current = skillAtLevel(s, level);
      return {
        id: `skill-up-${s.id}`,
        kind: 'skill' as const,
        title: maxed ? `${s.name.toUpperCase()} · МАКС.` : `УЛУЧШИТЬ: ${s.name.toUpperCase()}`,
        desc: maxed
          ? `Сейчас: ${describeSkillEffect(current)}`
          : `Следующий ур.: ${describeSkillUpgrade(s, target)} · сейчас: ${describeSkillEffect(current)}`,
        tab: 'skills' as const,
        level,
        maxLevel: s.maxLevel,
        cost: maxed ? 0 : skillUpgradeCost(s, target),
        rarity: s.rarity,
        disabled: maxed,
        payload: { skillId: s.id, skillTargetLevel: target },
      };
    });

  return [...learnOffers, ...upgradeOffers];
}

/**
 * Полный ассортимент за визит. Товары берутся из стока (замен ограниченное число),
 * услуги и навыки бесконечны, апгрейд лавки — отдельная вкладка.
 */
export function pickShopOffers(run: RunState): ShopOffer[] {
  // Сток создаётся на уровень лавки, на котором открыт; после апгрейда — новый
  if (run.stockShopLevel !== run.shopLevel || run.shopStock.length === 0) {
    rollShopStock(run);
  }

  const goods = run.shopStock.map((slot) => stockSlotOffer(run, slot));
  const offers: ShopOffer[] = [...goods, ...pickServices(run), ...pickSkillOffers(run)];

  if (run.shopLevel < SHOP_LEVELS.maxLevel) {
    offers.push({
      id: 'shop-upgrade',
      kind: 'upgrade',
      title: `УЛУЧШИТЬ ЛАВКУ → ${run.shopLevel + 1}`,
      desc: 'Новый сток товаров, навыки и сильнее услуги',
      tab: 'shop',
      cost: SHOP_LEVELS.upgradeCosts[run.shopLevel - 1],
      rarity: 'epic',
    });
  }

  for (const offer of offers) {
    if (!offer.soldOut) {
      offer.disabled = (offer.disabled ?? false) || run.gold < offer.cost;
    }
  }
  return offers;
}

export function describeWeapon(w: {
  damage?: number;
  attackSpeedPct?: number;
  range?: number;
  critChance?: number;
  critMultiplierAdd?: number;
  luck?: number;
  hp?: number;
  moveSpeedPct?: number;
  hpRegenAdd?: number;
  mana?: number;
}): string {
  const parts: string[] = [];
  if (w.damage) parts.push(`урон +${w.damage}`);
  if (w.attackSpeedPct) {
    parts.push(`скор. атаки ${w.attackSpeedPct > 0 ? '+' : ''}${Math.round(w.attackSpeedPct * 100)}%`);
  }
  if (w.range) parts.push(`радиус +${w.range}`);
  if (w.critChance) parts.push(`крит +${Math.round(w.critChance * 100)}%`);
  if (w.critMultiplierAdd) parts.push(`сила крита +${w.critMultiplierAdd.toFixed(2)}×`);
  if (w.luck) parts.push(`удача +${w.luck}`);
  if (w.hp) parts.push(`HP +${w.hp}`);
  if (w.hpRegenAdd) parts.push(`реген +${w.hpRegenAdd.toFixed(2)} HP/с`);
  if (w.moveSpeedPct) {
    parts.push(`скорость ${w.moveSpeedPct > 0 ? '+' : ''}${Math.round(w.moveSpeedPct * 100)}%`);
  }
  if (w.mana) parts.push(`мана +${w.mana}`);
  return parts.join(', ');
}