/**
 * Смоук-тест игровой логики: запускается в Node без браузера
 * (phaser подменяется заглушкой tests/phaser-stub.ts).
 *
 * Проверяет чистые модули: характеристики (атрибуты -> производные статы),
 * лут с монстров, выбор цели врагом, лавку с уровнями и волны.
 *
 * Запуск: npm run test:logic
 */

import {
  BOSSES,
  CHAPTERS,
  DROPS,
  ENEMY_TIERS,
  isChapterBossWave,
  chapterOf,
  SHOP_LEVELS,
  SKILL_UPGRADE,
  WAVES,
  WEAPONS,
  waveEnemyCount,
  type EnemyTierId,
} from '../src/config/balance';
import { computeStats, equippedWeapon, totalAttr } from '../src/systems/DerivedStats';
import { rollDrops } from '../src/systems/Drops';
import { chooseTarget } from '../src/systems/Targeting';
import {
  pickShopOffers,
  consumeStockSlot,
  rollShopStock,
  scaledCost,
  serviceRange,
} from '../src/systems/Shop';
import RunState from '../src/state/RunState';
import {
  bossAttackDamage,
  bossNextPhase,
  bossPhaseDuration,
  bossStatsForChapter,
  pickBossAttack,
  selectBossTarget,
} from '../src/systems/BossAi';
import {
  clearBest,
  loadBest,
  maybeSaveBest,
} from '../src/state/Save';
import { describeSkillEffect, skillAtLevel, skillById, skillUpgradeCost } from '../src/systems/Skills';
import WaveSystem from '../src/systems/WaveSystem';

let passed = 0;
const failures: string[] = [];

function check(name: string, condition: boolean): void {
  if (condition) {
    passed++;
  } else {
    failures.push(name);
    console.log(`  ✗ ${name}`);
  }
}

function close(a: number, b: number, eps = 1e-6): boolean {
  return Math.abs(a - b) < eps;
}

function section(title: string): void {
  console.log(`\n${title}`);
}

// ---------------------------------------------------------------- XP / золото

section('RunState: опыт, уровни, золото, очки характеристик');
{
  const run = new RunState();
  check('стартовый уровень 1, опыт 0', run.level === 1 && run.xp === 0);
  check('кривая опыта: base + perLevel * level', run.xpToNext() === 20 + 15 * 1);

  check('нет левелапа при малом опыте', run.addXp(10) === 0 && run.level === 1);
  check('опыт накапливается', run.xp === 10);

  // 10 + 25 = 35 >= 35 (порог 2-го уровня) -> ровно 1 уровень, остаток 0
  check('один левелап по достижении порога', run.addXp(25) === 1 && run.level === 2);
  check('опыт обнулился в остаток', run.xp === 0);

  // порог 2 -> 3: 20 + 45 = 65; порог 3 -> 4: 20 + 60 = 80; 65 + 80 = 145
  check('несколько левелапов за раз', run.addXp(145) === 2 && run.level === 4);

  run.addGold(50);
  check('золото начисляется', run.gold === 50);
  check('трата больше баланса не проходит', run.spendGold(60) === false && run.gold === 50);
  check('трата в пределах баланса проходит', run.spendGold(20) === true && run.gold === 30);

  check('очков характеристик в начале нет', run.statPoints === 0);
  check('нельзя потратить очко, если их нет', run.spendStatPoint('str') === false);
  run.addStatPoints(2);
  check('очко тратится и повышает атрибут', run.spendStatPoint('str') === true);
  check('атрибут вырос, очков осталось 1', run.attrs.str === 6 && run.statPoints === 1);
}

// ------------------------------------------------------------ Прокачка лавки

section('RunState: уровни лавки');
{
  const run = new RunState();
  check('лавка стартует с 1 уровня', run.shopLevel === 1);
  check('без золота лавку не улучшить', run.upgradeShop(70) === false);

  run.addGold(1000);
  let upgrades = 0;
  for (let i = 0; i < 10; i++) {
    const idx = Math.min(run.shopLevel - 1, SHOP_LEVELS.upgradeCosts.length - 1);
    if (run.upgradeShop(SHOP_LEVELS.upgradeCosts[idx])) {
      upgrades++;
    }
  }
  check(
    'лавка доходит ровно до maxLevel',
    upgrades === SHOP_LEVELS.maxLevel - 1 && run.shopLevel === SHOP_LEVELS.maxLevel,
  );
  check('улучшение сверх максимума отклоняется', run.upgradeShop(10_000) === false);
}

// -------------------------------------------------------------- Инвентарь

section('RunState: инвентарь и экипировка');
{
  const run = new RunState();
  check('первое оружие добавлено', run.addWeapon('rusty') === 'added' && run.inventory.length === 1);
  check('первое оружие экипируется автоматически', equippedWeapon(run)?.id === 'rusty');

  for (let i = 1; i < run.inventoryCapacity; i++) {
    run.addWeapon('rusty');
  }
  check('инвентарь заполнен до ёмкости', run.inventory.length === run.inventoryCapacity);
  check('при полном инвентаре предмет не берётся', run.addWeapon('rusty') === 'full');

  // Освобождаем место продажей
  const uidToSell = run.inventory[1].uid;
  const beforeGold = run.gold;
  const earned = run.sellItem(uidToSell, 0.5);
  check('продажа возвращает золото', earned > 0 && run.gold === beforeGold + earned);
  check('проданный предмет исчез из инвентаря', run.getInventoryItem(uidToSell) === undefined);
  check('продажа несуществующего предмета даёт 0', run.sellItem('нет-такого', 0.5) === 0);

  check('топор добавлен после освобождения места', run.addWeapon('axe') === 'added');
  const axeItem = run.inventory[run.inventory.length - 1];
  check('экипировка топора меняет оружие', run.toggleEquip(axeItem.uid) === true);
  check('бонусы надетого топора видны в статах', equippedWeapon(run)?.id === 'axe');
  check('повторный toggle снимает оружие', run.toggleEquip(axeItem.uid) === true && equippedWeapon(run) === undefined);

  // Продажа экипированного предмета должна снять экипировку.
  // Слот пуст, поэтому новое оружие встаёт в руки автоматически.
  run.sellItem(run.inventory[0].uid, 0.5);
  check('после освобождения места оружие добавлено', run.addWeapon('twin') === 'added');
  const twinItem = run.inventory[run.inventory.length - 1];
  check('оружие автоматически экипировано в пустой слот', equippedWeapon(run)?.id === 'twin');
  check('toggle снимает авто-экипировку', run.toggleEquip(twinItem.uid) === true);
  run.toggleEquip(twinItem.uid);
  check('повторный toggle возвращает кинжалы в руки', equippedWeapon(run)?.id === 'twin');
  run.sellItem(twinItem.uid, 0.5);
  check('после продажи экипировки оружия нет', equippedWeapon(run) === undefined);
}

// -------------------------------------------------------------------- Навыки
section('RunState: навыки и слоты');
{
  const run = new RunState();
  check('навыки не изучены в начале', run.learnedSkills.length === 0);
  check('изучение навыка сажает его в первый слот', run.learnSkill('nova') === true && run.skillSlots[0] === 'nova');
  check('повторно навык не изучается', run.learnSkill('nova') === false);
  check('второй навык занимает второй слот', run.learnSkill('shield') === true && run.skillSlots[1] === 'shield');

  run.unassignSkill('nova');
  check('навык снимается со слота', run.skillSlots[0] === null);
  check(
    'снятый навык можно вернуть в свободный слот',
    run.assignSkillToFreeSlot('nova') === true && run.skillSlots[0] === 'nova',
  );
  check('неизученный навык в слот не садится', run.assignSkillToFreeSlot('berserk') === false);
  check('уже стоящий в слоте навык не дублируется', run.assignSkillToFreeSlot('shield') === false);
}

// ------------------------------------------------- Производные характеристики

section('DerivedStats: базовые значения без экипировки');
{
  const run = new RunState();
  const s = computeStats(run);
  check('HP = base 40 + выносливость 5 * 12', s.maxHp === 100);
  check('мана = base 20 + интеллект 5 * 8', s.maxMana === 60);
  check('урон = base 2 + сила 5 * 2', s.attackDamage === 12);
  check('скорость бега растёт от ловкости', close(s.moveSpeed, 340 * 1.05));
  check('интервал атаки падает от ловкости', close(s.attackInterval, 450 / 1.1));
  check('радиус атаки — базовый', s.attackRange === 240);
  check('крит = base 3% + удача 5 * 0.5%', close(s.critChance, 0.055));
  check('регенерация HP растёт от выносливости', close(s.hpRegen, 0.2 + 5 * 0.15));
  check('регенерация маны растёт от интеллекта', close(s.manaRegen, 0.5 + 5 * 0.4));
  check('множитель лута = 1 + удача * 3%', close(s.luckFactor, 1.15));
}

section('DerivedStats: влияние очков характеристик (главные статы)');
{
  const base = new RunState();
  const before = computeStats(base);

  // СИЛА -> урон
  base.attrs.str = 10;
  check('сила повышает урон на 2 за очко', computeStats(base).attackDamage === before.attackDamage + 10);
  base.attrs.str = 5;

  // ЛОВКОСТЬ -> скорость атаки и передвижения
  base.attrs.agi = 10;
  const agi = computeStats(base);
  check('ловкость ускоряет атаку', agi.attackInterval < before.attackInterval);
  check('ловкость ускоряет передвижение', agi.moveSpeed > before.moveSpeed);
  base.attrs.agi = 5;

  // ВЫНОСЛИВОСТЬ -> объём HP и регенерация
  base.attrs.end = 10;
  const end = computeStats(base);
  check('выносливость даёт +12 HP за очко', end.maxHp === before.maxHp + 5 * 12);
  check('выносливость ускоряет регенерацию HP', end.hpRegen > before.hpRegen);
  base.attrs.end = 5;

  // ИНТЕЛЛЕКТ -> объём маны и регенерация
  base.attrs.int = 10;
  const int = computeStats(base);
  check('интеллект даёт +8 маны за очко', int.maxMana === before.maxMana + 5 * 8);
  check('интеллект ускоряет регенерацию маны', int.manaRegen > before.manaRegen);
  base.attrs.int = 5;

  // УДАЧА -> крит и шанс лучшего лута
  base.attrs.luck = 10;
  const luck = computeStats(base);
  check('удача повышает крит', luck.critChance > before.critChance);
  check('удача повышает множитель лута', luck.luckFactor > before.luckFactor);
  check('итоговый атрибут удачи без оружия = очки', totalAttr(base, 'luck') === 10);
}

section('DerivedStats: бонусы от экипированного оружия');
{
  const run = new RunState();
  const plain = computeStats(run);

  run.addWeapon('axe'); // урон +14, крит +5%, скорость атаки -5%
  const axe = computeStats(run);
  check('оружие добавляет урон', axe.attackDamage === plain.attackDamage + 14);
  check('оружие добавляет крит', close(axe.critChance, plain.critChance + 0.05));
  check('отрицательная скорость атаки замедляет удары', axe.attackInterval > plain.attackInterval);

  const run2 = new RunState();
  run2.addWeapon('charm'); // крит +4%, удача +3
  const charm = computeStats(run2);
  check('оружие повышает удачу', charm.luckFactor > 1.15);
  check('удача с оружия видна в итоговом атрибуте', totalAttr(run2, 'luck') === 5 + 3);

  const run3 = new RunState();
  run3.addWeapon('staff'); // урон +10, радиус +80, скорость атаки +8%
  const staff = computeStats(run3);
  check('оружие увеличивает радиус атаки', staff.attackRange === plain.attackRange + 80);
  check('оружие ускоряет атаку при положительном бонусе', staff.attackInterval < plain.attackInterval);

  // Снятие оружия возвращает базовые значения
  const staffUid = run3.equippedWeaponUid as string;
  run3.toggleEquip(staffUid);
  const unequipped = computeStats(run3);
  check('без оружия статы возвращаются к базовым', close(unequipped.attackDamage, plain.attackDamage));
  check('без оружия радиус базовый', unequipped.attackRange === plain.attackRange);
}

// ------------------------------------------------------------------ Лут

section('Drops: выпадение очков характеристик, оружия и навыков');
{
  const realRandom = Math.random;
  const withRandom = (value: number, fn: () => void): void => {
    Math.random = () => value;
    try {
      fn();
    } finally {
      Math.random = realRandom;
    }
  };

  const run = new RunState();

  // Шансы независимы: при большом ролле не падает ничего
  withRandom(0.99, () => {
    check('высокий ролл — лута нет', rollDrops(run, false, ['nova']).length === 0);
  });

  // Низкий ролл пробивает все шансы сразу
  withRandom(0.001, () => {
    const drops = rollDrops(run, false, ['nova']);
    check('низкий ролл даёт очко характеристики', drops.some((d) => d.kind === 'statPoint'));
    check('низкий ролл даёт оружие', drops.some((d) => d.kind === 'weapon' && !!d.weaponId));
    check('низкий ролл даёт навык', drops.some((d) => d.kind === 'skill' && !!d.skillId));
  });

  // Навык не может выпасть, если не осталось неизученных
  withRandom(0.001, () => {
    check(
      'когда все навыки изучены, навык не падает',
      !rollDrops(run, false, []).some((d) => d.kind === 'skill'),
    );
    check(
      'выпавший навык берётся из списка неизученных',
      rollDrops(run, false, ['nova']).find((d) => d.kind === 'skill')?.skillId === 'nova',
    );
  });

  // Босс получает бонус к шансам: ролл, который не проходит у обычного врага
  const bossBonus = DROPS.bossBonus;
  const normalChance = DROPS.statPoint * computeStats(run).luckFactor;
  const roll = normalChance + bossBonus / 2;
  withRandom(roll, () => {
    check('обычный враг при таком ролле ничего не даёт', rollDrops(run, false, []).length === 0);
    check('босс при таком же ролле даёт лут', rollDrops(run, true, []).length > 0);
  });

  // Удача повышает шанс выпадения
  const lucky = new RunState();
  lucky.attrs.luck = 50;
  const luckyFactor = computeStats(lucky).luckFactor;
  const luckyChance = DROPS.statPoint * luckyFactor;
  const midRoll = (normalChance + luckyChance) / 2;
  withRandom(midRoll, () => {
    check('обычная удача не пробивает повышенный ролл', rollDrops(run, false, []).length === 0);
    check('высокая удача пробивает тот же ролл', rollDrops(lucky, false, []).length > 0);
  });
  check('множитель удачи растёт от атрибута', luckyFactor > computeStats(run).luckFactor);
}

// ------------------------------------------------------------- AI врагов

section('Targeting: за кем идёт враг');
{
  // Осадник всегда ломает кристалл
  check('осадник идёт к кристаллу', chooseTarget('sieger', true, 10, 5000) === 'crystal');
  check('осадник игнорирует убитого игрока', chooseTarget('sieger', false, 10, 5000) === 'crystal');

  // Охотник: игрок жив и ближе
  check('охотник преследует игрока', chooseTarget('hunter', true, 200, 900) === 'player');

  // Охотник: игрок мёртв -> идёт к кристаллу
  check('охотник идёт к кристаллу, пока игрок мёртв', chooseTarget('hunter', false, 200, 900) === 'crystal');

  // Охотник: кристалл ближе игрока -> ломает кристалл (иначе ковырял бы стену)
  check('охотник бьёт кристалл, если тот ближе игрока', chooseTarget('hunter', true, 900, 200) === 'crystal');
  check('охотник бьёт игрока, если игрок ближе кристалла', chooseTarget('hunter', true, 150, 260) === 'player');
  check('при равной дистанции выбирается игрок', chooseTarget('hunter', true, 300, 300) === 'player');
}

// --------------------------------------------------- Лавка: уровни и товары

section('Shop: вкладки, сток товаров и замены');
{
  const run = new RunState();
  const offersLvl1 = pickShopOffers(run);

  check('есть секция апгрейда лавки', offersLvl1.some((o) => o.kind === 'upgrade'));
  check(
    'сток 1 уровня по конфигу (common + rare + epic)',
    offersLvl1.filter((o) => o.tab === 'goods').length ===
      SHOP_LEVELS.stockSlots[0].common + SHOP_LEVELS.stockSlots[0].rare + SHOP_LEVELS.stockSlots[0].epic,
  );
  check(
    'товары приходят со слотом стока',
    offersLvl1.filter((o) => o.tab === 'goods').every((o) => o.slotIndex !== undefined),
  );
  check(
    'офферы разложены по вкладкам',
    offersLvl1.every(
      (o) => o.tab === 'goods' || o.tab === 'services' || o.tab === 'skills' || o.tab === 'shop',
    ),
  );
  check('товары недоступны без золота', offersLvl1.filter((o) => o.tab === 'goods').every((o) => o.disabled === true));
  check(
    'услуги не ограничены стоком',
    offersLvl1.filter((o) => o.tab === 'services').length > 0 &&
      offersLvl1.filter((o) => o.tab === 'services').every((o) => o.slotIndex === undefined),
  );
  check('на 1 уровне лавки доступен навык Рывок', offersLvl1.some((o) => o.payload?.skillId === 'dash'));

  run.addGold(10_000);
  check(
    'после начисления золота товары доступны',
    pickShopOffers(run).filter((o) => o.tab === 'goods').every((o) => !o.disabled),
  );

  // Услуги: диапазон растёт с уровнем лавки
  const heal1 = serviceRange('heal', 1);
  const heal5 = serviceRange('heal', SHOP_LEVELS.maxLevel);
  check('эффект лечения — диапазон из конфига', heal1.min === 25 && heal1.max === 45);
  check('на 5 уровне лавки лечение сильнее', heal5.min > heal1.min && heal5.max > heal1.max);
  const freeze1 = serviceRange('freeze', 1);
  check('заморозка измеряется в секундах', freeze1.min === 2.5 && freeze1.max === 4);

  // Цена товара растёт с каждой покупкой этого товара
  const base = 12;
  check('цена без покупок — базовая', scaledCost(base, run, 'stock-0') === base);
  run.registerPurchase('stock-0');
  check('первая покупка повышает цену на 35%', scaledCost(base, run, 'stock-0') === Math.round(base * 1.35));
  run.registerPurchase('stock-0');
  check('вторая покупка повышает цену ещё', scaledCost(base, run, 'stock-0') === Math.round(base * 1.7));
  check('чужая покупка цену не меняет', scaledCost(base, run, 'stock-1') === base);
}

section('Shop: покупка заменяет товар и слот распродаётся');
{
  const run = new RunState();
  run.addGold(10_000);
  pickShopOffers(run);

  const firstTier = run.shopStock[0].tier;
  const firstDef = run.shopStock[0].defId;
  consumeStockSlot(run, 0);
  check('после покупки слот получает следующий товар', run.shopStock[0].defId !== null);
  check('следующий товар того же уровня (редкости)', run.shopStock[0].tier === firstTier);
  check('товар действительно сменился', run.shopStock[0].defId !== firstDef);
  check(
    'замен осталось на одну меньше',
    run.shopStock[0].replacementsLeft === SHOP_LEVELS.replacementsPerSlot - 1,
  );

  // Исчерпываем замены: всего replacementsPerSlot покупок
  for (let i = 0; i < SHOP_LEVELS.replacementsPerSlot; i++) {
    consumeStockSlot(run, 0);
  }
  check('после всех замен слот распродан', run.shopStock[0].defId === null);
  check('у распроданного слота нет замен', run.shopStock[0].replacementsLeft === 0);
  const soldOutOffers = pickShopOffers(run);
  check('распроданный слот помечен в ассортименте', soldOutOffers[0].soldOut === true);
  check('распроданный слот нельзя купить', soldOutOffers[0].disabled === true);

  // Улучшение лавки выдаёт новый сток
  check('есть распроданные слоты до апгрейда', run.shopStock.some((s) => s.defId === null));
  run.upgradeShop(SHOP_LEVELS.upgradeCosts[run.shopLevel - 1]);
  pickShopOffers(run);
  check('после апгрейда сток полностью обновлён', run.shopStock.every((s) => s.defId !== null));
  check('новый сток соответствует уровню лавки', run.stockShopLevel === run.shopLevel);
}

section('Shop: навыки — изучение и улучшение за золото');
{
  const run = new RunState();
  run.addGold(10_000);
  check(
    'есть вкладка навыков',
    pickShopOffers(run).some((o) => o.tab === 'skills'),
  );

  run.learnSkill('dash');
  check('навык изучен', run.learnedSkills.includes('dash'));
  check('у изученного навыка 1 уровень', run.skillLevelOf('dash') === 1);

  const maxed = new RunState();
  maxed.addGold(10_000);
  for (let i = 0; i < SHOP_LEVELS.upgradeCosts.length; i++) {
    maxed.upgradeShop(SHOP_LEVELS.upgradeCosts[i]);
  }
  maxed.learnSkill('nova');
  const upOffer = pickShopOffers(maxed).find((o) => o.payload?.skillId === 'nova');
  check('изученный навык предлагается к улучшению', upOffer?.payload?.skillTargetLevel === 2);
  check('улучшение навыка стоит золото', Boolean(upOffer && upOffer.cost > 0));

  check('навык улучшается за золото', maxed.upgradeSkillLevel('nova', 100, Infinity) === true);
  check('текущий уровень навыка = 2', maxed.skillLevelOf('nova') === 2);
  for (let i = 0; i < 10; i++) {
    maxed.upgradeSkillLevel('nova', 100, Infinity);
  }
  check('уровень навыка = 12', maxed.skillLevelOf('nova') === 12);
  check('прокачка бесконечна: ещё одно улучшение проходит', maxed.upgradeSkillLevel('nova', 100, Infinity) === true);
  check('текущий уровень навыка = 13', maxed.skillLevelOf('nova') === 13);

  check('лавка прокачана до максимума', maxed.shopLevel === SHOP_LEVELS.maxLevel);
  check('апгрейд лавки пропадает из ассортимента на максимуме', !pickShopOffers(maxed).some((o) => o.kind === 'upgrade'));

  // Сток максимального уровня: больше слотов, появляются эпические товары
  const maxRun = new RunState();
  maxRun.addGold(10_000);
  for (let i = 0; i < SHOP_LEVELS.upgradeCosts.length; i++) {
    maxRun.upgradeShop(SHOP_LEVELS.upgradeCosts[i]);
  }
  rollShopStock(maxRun);
  const maxGoods = pickShopOffers(maxRun).filter((o) => o.tab === 'goods');
  check('на максимуме лавки есть эпические товары', maxGoods.some((o) => o.rarity === 'epic'));
  const maxSlots = SHOP_LEVELS.stockSlots[SHOP_LEVELS.maxLevel - 1];
  check(
    'на максимуме лавки сток по конфигу',
    maxGoods.length === maxSlots.common + maxSlots.rare + maxSlots.epic,
  );
  check(
    'на максимуме лавки есть заморозка',
    pickShopOffers(maxRun).some((o) => o.payload?.serviceId === 'freeze'),
  );
}

// ---------------------------------------------------- Навыки: описания и уровни

section('Skills: описания, эффект и прокачка уровней');
{
  const dash = skillById('dash');
  check('навык Рывок есть в конфиге', Boolean(dash));

  if (dash) {
    check('у навыка есть текстовое описание', dash.desc.length > 10);
    check('рывок даёт дальность и урон', Boolean(dash.dashDistance) && Boolean(dash.damageMult));
    check('рывок бьёт всех врагов на пути', dash.desc.toLowerCase().includes('на пути'));

    const lvl1 = skillAtLevel(dash, 1);
    const lvl2 = skillAtLevel(dash, 2);
    check('без прокачки параметры равны базовым', lvl1.dashDistance === dash.dashDistance);
    check(
      'уровень 2 увеличивает дальность рывка',
      (lvl2.dashDistance ?? 0) > (lvl1.dashDistance ?? 0),
    );
    check(
      'описание навыка содержит конкретные числа',
      describeSkillEffect(lvl1).includes('рывок на'),
    );
    check(
      'описание растёт вместе с уровнем',
      describeSkillEffect(lvl2) !== describeSkillEffect(lvl1),
    );
  }

  const nova = skillById('nova');
  if (nova) {
    const maxNova = skillAtLevel(nova, nova.maxLevel);
    const maxNovaOld = skillAtLevel(nova, 4); // прежний предел прокачки
    check('у навыка есть максимальный уровень > 1', nova.maxLevel > 1);
    check('на максимуме радиус больше базового', (maxNova.radius ?? 0) > (nova.radius ?? 0));
    check('на максимуме урон выше базового', (maxNova.damageMult ?? 0) > (nova.damageMult ?? 0));

    // Бесконечная прокачка: параметры продолжают расти за пределом
    const lv10 = skillAtLevel(nova, 10);
    check('параметры растут и после старого предела', (lv10.radius ?? 0) > (maxNovaOld.radius ?? 0));

    // КД снижается с уровнем, но не ниже доли базовой
    const cd10 = skillAtLevel(nova, 10).cooldown;
    check('кд снижается с уровнем', cd10 < nova.cooldown);
    check('кд не ниже нижней границы', cd10 >= Math.round(nova.cooldown * SKILL_UPGRADE.minCooldownFrac));
    const cdFloor = skillAtLevel(nova, 10_000).cooldown;
    check('кд упирается в нижнюю границу', cdFloor === Math.round(nova.cooldown * SKILL_UPGRADE.minCooldownFrac));
  }

  const chain = skillById('chain');
  if (chain) {
    check('цепная молния есть в конфиге', true);
    check(
      'уровень 2 добавляет цель молнии',
      (skillAtLevel(chain, 2).chainTargets ?? 0) > (chain.chainTargets ?? 0),
    );
  }

  // Карточка изучения в лавке несёт описание эффекта
  const run = new RunState();
  run.addGold(10_000);
  const learnOffer = pickShopOffers(run).find((o) => o.payload?.skillId === 'dash');
  check('изучение навыка сопровождается описанием', Boolean(learnOffer && learnOffer.desc.length > 20));
}

section('RunState: двойное списание золота (сцена списывает, апгрейды только применяются)');
{
  // Регрессия: сцена списывает золото через spendGold, а затем применяет апгрейд.
  // Если апгрейд снова списывает цену — при ровно достаточном балансе он не проходит.
  const shopRun = new RunState();
  shopRun.addGold(SHOP_LEVELS.upgradeCosts[0]); // ровно цена апгрейда ур. 1 -> 2
  check('сцена списывает золото за покупку', shopRun.spendGold(SHOP_LEVELS.upgradeCosts[0]) === true);
  check('золото нулевое после покупки', shopRun.gold === 0);
  check('апгрейд лавки применяется без повторного списания', shopRun.upgradeShop(0) === true);
  check('уровень лавки вырос', shopRun.shopLevel === 2);

  const skillRun = new RunState();
  skillRun.learnSkill('dash');
  const upgradeCost = skillUpgradeCost(skillById('dash')!, 2);
  skillRun.addGold(upgradeCost);
  check('сцена списывает золото за улучшение навыка', skillRun.spendGold(upgradeCost) === true);
  check('улучшение навыка применяется без повторного списания', skillRun.upgradeSkillLevel('dash', 0, Infinity) === true);
  check('уровень навыка вырос', skillRun.skillLevelOf('dash') === 2);
}

// ------------------------------------------------- Оружие и враги: новый баланс

section('Weapons: арсенал, уникальность и рост силы по уровням');
{
  const ids = new Set(WEAPONS.map((w) => w.id));
  check('id оружий уникальны', ids.size === WEAPONS.length);
  check('все оружия могут выпасть', WEAPONS.every((w) => w.shopCost > 0));
  check(
    'уровни лавки оружий в диапазоне 1..maxLevel',
    WEAPONS.every((w) => w.minShopLevel >= 1 && w.minShopLevel <= SHOP_LEVELS.maxLevel),
  );
  check('арсенал заметно расширен (не меньше 14 оружий)', WEAPONS.length >= 14);

  // Эпики сильнее коммонов по максимальному урону
  const maxCommonDmg = Math.max(...WEAPONS.filter((w) => w.rarity === 'common').map((w) => w.damage ?? 0));
  const maxEpicDmg = Math.max(...WEAPONS.filter((w) => w.rarity === 'epic').map((w) => w.damage ?? 0));
  check('эпические оружия бьют сильнее коммонов', maxEpicDmg > maxCommonDmg);

  check(
    'есть оружия с новыми эффектами (скорость/сила крита/мана/реген)',
    WEAPONS.some((w) => w.moveSpeedPct) &&
      WEAPONS.some((w) => w.critMultiplierAdd) &&
      WEAPONS.some((w) => w.mana) &&
      WEAPONS.some((w) => w.hpRegenAdd),
  );

  // Сила оружия растёт с уровнем лавки: минимальная цена эпиков выше коммонов
  const minCommonCost = Math.min(...WEAPONS.filter((w) => w.rarity === 'common').map((w) => w.shopCost));
  const minEpicCost = Math.min(...WEAPONS.filter((w) => w.rarity === 'epic').map((w) => w.shopCost));
  check('эпики дороже коммонов (уровень к уровню — сильнее)', minEpicCost > minCommonCost);
}

section('Enemies: стрелки и бесконечное усиление');
{
  const shooter = ENEMY_TIERS.find((t) => t.id === 'shooter');
  check(
    'есть тип-стрелок с дистанцией стрельбы и зарядами',
    Boolean(shooter?.shootRange && shooter?.projectileSpeed),
  );
  check('стрелки появляются с 3-й волны', shooter?.fromWave === 3);

  // Аркадный рост количества от волны к волне
  const c1 = waveEnemyCount(1);
  const c5 = waveEnemyCount(5);
  const c20 = waveEnemyCount(20);
  check('количество врагов растёт от волны к волне', c1 < c5 && c5 < c20);
  check('рост ограничен потолком maxCount', waveEnemyCount(1000) === WAVES.maxCount);
  check('рост быстрее линейного (аркадный)', waveEnemyCount(10) > WAVES.baseCount + 10 * WAVES.countPerWave);

  // Бесконечное усиление: экспоненциальный рост HP/урона
  const hpAt = (wave: number) => 30 * Math.pow(1 + WAVES.hpScalePerWave, wave - 1);
  const dmgAt = (wave: number) => 6 * Math.pow(1 + WAVES.damageScalePerWave, wave - 1);
  check('HP врагов усиливается с каждой волной', hpAt(10) > hpAt(5) && hpAt(20) > hpAt(10) && hpAt(20) > hpAt(5));
  check('урон врагов усиливается с каждой волной', dmgAt(10) > dmgAt(5) && dmgAt(20) > dmgAt(10));
}

// -------------------------------------------------------------------- Волны

section('WaveSystem: волны, постепенный выход, боссы');
{
  interface Log {
    starts: Array<{ wave: number; count: number }>;
    spawned: EnemyTierId[];
    cleared: number[];
    ticks: number;
  }

  function makeSystem(): { sys: WaveSystem; log: Log } {
    const log: Log = { starts: [], spawned: [], cleared: [], ticks: 0 };
    const sys = new WaveSystem({
      onWaveStart: (wave, count) => log.starts.push({ wave, count }),
      onSpawn: (tier) => log.spawned.push(tier),
      onWaveClear: (wave) => log.cleared.push(wave),
      onIntermissionTick: () => log.ticks++,
    });
    return { sys, log };
  }

  const { sys, log } = makeSystem();

  check('старт — интермиссия', sys.phaseName === 'intermission');
  check(
    'отсчёт интермиссии равен конфигу',
    close(sys.intermissionSecondsLeft, WAVES.intermission / 1000),
  );

  // Интермиссия: волна не начинается раньше времени
  sys.update(WAVES.intermission - 100, 0);
  check('волна не началась досрочно', sys.wave === 0 && log.starts.length === 0);

  // Пора начинать
  sys.update(100, 0);
  check('первая волна началась', sys.wave === 1 && log.starts.length === 1);
  check('фаза — спавн', sys.phaseName === 'spawning');

  const expectedCount = waveEnemyCount(1);
  check('количество врагов волны считается по аркадной формуле', log.starts[0].count === expectedCount);

  // Враги выходят постепенно: первый — сразу, остальные — по интервалу
  sys.update(0, 0);
  check('первый враг выходит сразу', log.spawned.length === 1);

  sys.update(10, 0);
  check('второй враг не выходит мгновенно', log.spawned.length === 1);

  const interval = Math.max(
    WAVES.minSpawnInterval,
    WAVES.baseSpawnInterval - 1 * WAVES.spawnIntervalPerWave,
  );
  // 10 мс уже «сгорели» в апдейте выше, поэтому вычитаем их из интервала
  sys.update(interval - 20, 0);
  check('до истечения интервала новых врагов нет', log.spawned.length === 1);
  sys.update(20, 0);
  check('по истечении интервала выходит следующий', log.spawned.length === 2);

  // Добираем остальных: суммарно ровно count (останавливаемся, как только очередь пуста)
  for (let i = 0; i < expectedCount && sys.phaseName === 'spawning'; i++) {
    sys.update(interval * 2, 0);
  }
  check('все враги волны выпущены', log.spawned.length === expectedCount);
  check('после выпуска очередь пуста — фаза очистки', sys.phaseName === 'clearing');

  // Волна не закрывается, пока есть живые враги
  sys.update(1000, 3);
  check('волна не закрыта, пока враги живы', log.cleared.length === 0);
  check('очистка не сбрасывает таймер интермиссии', sys.phaseName === 'clearing');

  sys.update(1000, 0);
  check('волна закрыта, когда врагов не осталось', log.cleared.length === 1 && log.cleared[0] === 1);
  check('после зачистки — снова интермиссия', sys.phaseName === 'intermission');
  check(
    'таймер интермиссии сброшен',
    close(sys.intermissionSecondsLeft, WAVES.intermission / 1000),
  );

  // Волна закрывается только один раз (не повторяется каждый кадр)
  sys.update(16, 0);
  check('закрытие волны срабатывает один раз', log.cleared.length === 1);

  /**
   * Прогоняет ровно одну волну: дожидается её старта, выпускает всю очередь
   * (считая, что врагов сразу убивают), дожидается зачистки. Возвращает номер волны.
   * Большая дельта за один апдейт перескакивает волны, поэтому шагаем пошагово.
   */
  function driveWave(system: WaveSystem): number {
    let guard = 0;
    const before = system.wave;
    while (system.wave === before && guard++ < 100) {
      system.update(WAVES.intermission, 0); // интермиссия → старт следующей волны
    }
    guard = 0;
    while (system.phaseName === 'spawning' && guard++ < 100) {
      system.update(WAVES.maxCount * WAVES.baseSpawnInterval, 0); // выпустить очередь
    }
    guard = 0;
    while (system.phaseName !== 'intermission' && guard++ < 100) {
      system.update(16, 0); // врагов нет → волна закрывается
    }
    return system.wave;
  }

  // Растём до боссовой волны (конец главы), запоминая тиры каждой волны
  const bossWave = CHAPTERS.wavesPerChapter;
  const { sys: prog, log: progLog } = makeSystem();
  const tiersByWave = new Map<number, EnemyTierId[]>();
  let guard = 0;
  while (prog.wave < bossWave && guard++ < bossWave + 2) {
    const from = progLog.spawned.length;
    const wave = driveWave(prog);
    tiersByWave.set(wave, progLog.spawned.slice(from));
  }
  check('дошли до конца главы (боссовой волны)', prog.wave === bossWave);
  check(
    'на боссовой волне появляется босс',
    (tiersByWave.get(bossWave) ?? []).includes('boss'),
  );
  check(
    'боссовая волна — ровно один босс без мобов',
    ((tiersByWave.get(bossWave) ?? []).length === 1) && (tiersByWave.get(bossWave) ?? [])[0] === 'boss',
  );
  check(
    'в ранних волнах босса нет',
    [...tiersByWave.entries()].every(
      ([wave, tiers]) => wave >= bossWave || !tiers.includes('boss'),
    ),
  );
  check(
    'каждая волна выпускает ровно столько врагов, сколько объявлено',
    [...tiersByWave.entries()].every(([wave, tiers]) => {
      const start = progLog.starts.find((s) => s.wave === wave);
      return start !== undefined && start.count === tiers.length;
    }),
  );

  // Тиры появляются по мере прогресса: бегун — со 2-й волны, осадник — с 4-й
  const { sys: early, log: earlyLog } = makeSystem();
  driveWave(early);
  const firstWaveTiers = [...earlyLog.spawned];
  check('на первой волне нет осадников', !firstWaveTiers.includes('tank'));
  check('на первой волне нет бегунов', !firstWaveTiers.includes('runner'));
  check('на первой волне есть слизни', firstWaveTiers.includes('slime'));
}

// ---------------------------------------------------- Сохранение забега

section('Save: сериализация забега, восстановление волны и рекорд');
{
  const run = new RunState();
  run.addGold(500);
  run.addXp(100);
  run.learnSkill('dash');
  run.upgradeSkillLevel('dash', 0, Infinity);
  run.upgradeSkillLevel('dash', 0, Infinity);
  run.addWeapon('bow');
  run.addWeapon('staff');
  run.toggleEquip('bow');
  run.upgradeShop(0);
  run.attrs.str = 9;
  run.addStatPoints(2);
  run.kills = 42;

  const snapshot = run.serialize();

  // Копия через JSON — имитация roundtrip через localStorage
  const restored = new RunState();
  restored.restore(JSON.parse(JSON.stringify(snapshot)));

  check('восстановлено золото', restored.gold === run.gold);
  check('восстановлены уровень и опыт', restored.level === run.level && restored.xp === run.xp);
  check('восстановлены атрибуты', restored.attrs.str === 9);
  check('восстановлены очки характеристик', restored.statPoints === 2);
  check('восстановлен уровень лавки', restored.shopLevel === run.shopLevel);
  check('восстановлен сток лавки', JSON.stringify(restored.shopStock) === JSON.stringify(run.shopStock));
  check('восстановлены покупки (цены растут)', restored.purchasesOf('skill-up-dash') === run.purchasesOf('skill-up-dash'));
  check('восстановлены навыки', restored.learnedSkills.includes('dash'));
  check('восстановлен уровень навыка', restored.skillLevelOf('dash') === 3);
  check('восстановлен слот навыка', restored.skillSlots.includes('dash'));
  check('восстановлен инвентарь (2 оружия)', restored.inventory.length === 2);
  check('восстановлен экипированный предмет', equippedWeapon(restored)?.id === 'bow');
  check('счётчик uid продолжается', (() => {
    restored.addWeapon('rusty');
    const last = restored.inventory[restored.inventory.length - 1];
    return last.weaponId === 'rusty' && Number(last.uid.slice(1)) > Number(run.inventory[1].uid.slice(1));
  })());
  check('убийства восстановлены', restored.kills === 42);

  // Битые данные не ломают игру
  const robust = new RunState();
  robust.restore({
    ...snapshot,
    gold: -50,
    level: 0,
    learnedSkills: ['hack-skill', 'dash'],
    inventory: [{ uid: 'x', kind: 'weapon', weaponId: 'not-a-weapon' }],
    equippedWeaponUid: 'missing',
  } as typeof snapshot);
  check('отрицательное золото отброшено', robust.gold === 0);
  check('уровень не ниже 1', robust.level === 1);
  check('неизвестный навык отброшен', robust.learnedSkills.join(',') === 'dash');
  check('неизвестное оружие отброшено', robust.inventory.length === 0);
  check('битая экипировка снята', robust.equippedWeaponUid === null);
}

section('Save: продолжение с сохранённой волны');
{
  // Проверяем restartAtWave напрямую: следующая волна должна быть ровно 7
  const started: number[] = [];
  const sys = new WaveSystem({ onWaveStart: (w) => started.push(w), onSpawn: () => {}, onWaveClear: () => {}, onIntermissionTick: () => {} });
  sys.restartAtWave(7);
  check('после восстановления фаза — межволновая пауза', sys.phaseName === 'intermission');
  // Прокручиваем паузу (6с по конфигу) маленькими шагами
  for (let i = 0; i < 700; i++) {
    sys.update(10, 0);
  }
  check('сохранённая волна начинается заново', started[0] === 7);
}

section('Save: рекорд обновляется только при улучшении');
{
  clearBest();
  check('первый результат записывается', maybeSaveBest({ wave: 5, level: 4, kills: 30, time: 200 }) === true);
  check('рекорд прочитан', loadBest()?.wave === 5);
  check('худший результат не затирает рекорд', maybeSaveBest({ wave: 3, level: 9, kills: 99, time: 500 }) === false);
  check('рекорд остался прежним', loadBest()?.level === 4);
  check('лучший результат обновляется', maybeSaveBest({ wave: 6, level: 2, kills: 1, time: 100 }) === true);
  check('при равной волне сравнивается уровень', maybeSaveBest({ wave: 6, level: 5, kills: 1, time: 100 }) === true);
  check('финальный рекорд — волна 6, уровень 5', loadBest()?.wave === 6 && loadBest()?.level === 5);
}

// ------------------------------------------------------ Главы и боссы глав

section('Chapters: счётчик глав и боссовые волны');
{
  check('волна 1 — глава 1', chapterOf(1) === 1);
  check('волна 19 — глава 1', chapterOf(19) === 1);
  check('волна 20 — глава 1', chapterOf(20) === 1);
  check('волна 21 — глава 2', chapterOf(21) === 2);
  check('волна 40 — глава 2', chapterOf(40) === 2);
  check('волна 41 — глава 3', chapterOf(41) === 3);
  check('волна 60 — глава 3', chapterOf(60) === 3);

  check('волна 20 — боссовая', isChapterBossWave(20));
  check('волна 40 — боссовая', isChapterBossWave(40));
  check('волна 60 — боссовая', isChapterBossWave(60));
  check('волна 19 — не боссовая', !isChapterBossWave(19));
  check('волна 1 — не боссовая', !isChapterBossWave(1));

  check('шаг глав из конфига равен 20', CHAPTERS.wavesPerChapter === 20);

  // RunState.chapter считается от волны
  const run = new RunState();
  run.wave = 45;
  check('RunState.chapter считает главу по волне', run.chapter === 3);
}

section('Bosses: конфиг, масштабирование по главам и выбор босса');
{
  check('в конфиге есть хотя бы один босс (расширяемый список)', BOSSES.length >= 1);
  const boss = BOSSES[0];
  check('у босса есть имя и HP', boss.name.length > 0 && boss.hp > 0);
  check('у босса есть набор атак', boss.attacks.length >= 3);

  // Набор атак покрывает все заявленные виды (рывок, шипы, сильный удар, зона)
  const ids = boss.attacks.map((a) => a.id);
  check('есть рывок', ids.includes('charge'));
  check('есть шипы', ids.includes('spikes'));
  check('есть сильный удар', ids.includes('slam'));
  check('есть удар по территории', ids.includes('groundAoe'));

  // У каждой атаки есть телеграф, активная фаза и откат
  check(
    'у каждой атаки есть телеграф, урон и откат',
    boss.attacks.every((a) => a.telegraphMs > 0 && a.activeMs > 0 && a.recoverMs > 0 && a.damageMult > 0),
  );

  // Босс 2-й главы крепче и бьёт сильнее, но награда растёт сильнее
  const c1 = bossStatsForChapter(boss, 1);
  const c3 = bossStatsForChapter(boss, 3);
  check('HP босса растёт с главой', c3.maxHp > c1.maxHp);
  check('урон босса растёт с главой', c3.damage > c1.damage);
  check('награда босса растёт с главой', c3.gold > c1.gold && c3.xp > c1.xp);
  check('босс 1-й главы не слабее базового HP', c1.maxHp >= boss.hp);
}

section('BossAi: фазы атаки, выбор цели и урон');
{
  const boss = BOSSES[0];
  const charge = boss.attacks.find((a) => a.id === 'charge')!;

  // Порядок фаз: телеграф → активная → откат → преследование
  check('после телеграфа идёт активная фаза', bossNextPhase('telegraph') === 'active');
  check('после активной фазы идёт откат', bossNextPhase('active') === 'recover');
  check('после отката — преследование', bossNextPhase('recover') === 'chase');
  check('в преследовании фаза не меняется', bossNextPhase('chase') === 'chase');

  // Длительности фаз берутся из описания атаки
  check('длительность телеграфа — из атаки', bossPhaseDuration('telegraph', charge) === charge.telegraphMs);
  check('длительность активной фазы — из атаки', bossPhaseDuration('active', charge) === charge.activeMs);
  check('длительность отката — из атаки', bossPhaseDuration('recover', charge) === charge.recoverMs);
  check('у преследования нет длительности', bossPhaseDuration('chase', charge) === 0);

  // Взвешенный выбор атаки: крайние значения ролла дают разные атаки
  const first = pickBossAttack(boss.attacks, 0);
  const last = pickBossAttack(boss.attacks, 0.999);
  check('выбор атаки возвращает атаку из набора', boss.attacks.includes(first));
  check('крайние роллы дают разные атаки', first.id !== last.id);
  check('выбор не падает на пустом весе', pickBossAttack([charge], 0.5).id === 'charge');

  // Урон атаки = базовый урон босса × множитель
  check('урон атаки учитывает множитель', bossAttackDamage(boss.damage, charge) === Math.round(boss.damage * charge.damageMult));

  // Выбор цели: игрок приоритетен; сердце — только когда игрок мёртв или сильно ближе
  check('живой игрок ближе — босс идёт за игроком', selectBossTarget(true, 200, 400) === 'player');
  check('игрок мёртв — босс идёт к сердцу', selectBossTarget(false, 200, 400) === 'crystal');
  check('сердце сильно ближе — босс идёт к сердцу', selectBossTarget(true, 400, 100) === 'crystal');
  check('сердце чуть ближе — босс всё равно идёт за игроком', selectBossTarget(true, 200, 150) === 'player');
}

// -------------------------------------------------------------------- Итог
console.log('');
if (failures.length === 0) {
  console.log(`✅ ВСЕ ПРОВЕРКИ ПРОЙДЕНЫ: ${passed}`);
} else {
  console.log(` ПРОВАЛЕНО ${failures.length} из ${passed + failures.length}:`);
  for (const name of failures) {
    console.log(`   - ${name}`);
  }
  process.exitCode = 1;
}
