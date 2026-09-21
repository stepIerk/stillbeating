import {
  ATTRS,
  chapterOf,
  SHOP_LEVELS,
  type AttrId,
  type Rarity,
  SKILLS,
  WEAPONS,
  XP_CURVE,
} from '../config/balance';

export interface InventoryItem {
  /** Уникальный идентификатор экземпляра предмета */
  uid: string;
  kind: 'weapon';
  weaponId: string;
}

/** Слот стока товаров лавки: товар одной редкости с ограниченным числом замен */
export interface ShopStockSlot {
  slotIndex: number;
  /** Уровень товара (редкость) */
  tier: Rarity;
  /** id определения товара (товар/оружие), null — слот распродан */
  defId: string | null;
  /** Сколько замен осталось до распродажи слота */
  replacementsLeft: number;
}


/**
 * Состояние одного забега (рогалик-прогон):
 * опыт, уровень, атрибуты, очки, инвентарь, навыки, лавка.
 */
export default class RunState {
  wave = 0;
  gold = 0;
  xp = 0;
  level = 1;
  kills = 0;
  startedAt = 0;

  /** Номер главы забега (каждые CHAPTERS.wavesPerChapter волн — новая глава) */
  get chapter(): number {
    return chapterOf(this.wave);
  }

  /** Атрибуты и очки характеристик */
  attrs: Record<AttrId, number> = {
    str: ATTRS.startValue,
    agi: ATTRS.startValue,
    end: ATTRS.startValue,
    int: ATTRS.startValue,
    luck: ATTRS.startValue,
  };
  statPoints = 0;

  /** Лавка: прокачивается за монеты, открывает новые товары и услуги */
  shopLevel = 1;

  /**
   * Сток товаров лавки текущего уровня: купленный товар заменяется товаром
   * той же редкости (ограниченное число замен), распроданный слот пуст до
   * улучшения лавки. stockShopLevel — уровень лавки, для которого сток создан.
   */
  shopStock: ShopStockSlot[] = [];
  stockShopLevel = 0;

  /** Изученные навыки (id) и слоты кнопок-креста (до 3 навыков) */
  learnedSkills: string[] = [];
  /** Уровни прокачки навыков: id -> уровень (изученный навык = 1) */
  skillLevels: Record<string, number> = {};
  skillSlots: Array<string | null> = [null, null, null];

  /** Инвентарь оружия и экипированный предмет */
  inventory: InventoryItem[] = [];
  readonly inventoryCapacity = 12;
  equippedWeaponUid: string | null = null;

  private purchases: Record<string, number> = {};
  private nextUid = 1;

  // ---------- Опыт и уровни ----------

  xpToNext(): number {
    return XP_CURVE.base + XP_CURVE.perLevel * this.level;
  }

  /** Добавляет опыт. Возвращает количество полученных уровней (может быть > 1) */
  addXp(amount: number): number {
    this.xp += amount;
    let levels = 0;
    while (this.xp >= this.xpToNext()) {
      this.xp -= this.xpToNext();
      this.level++;
      levels++;
    }
    return levels;
  }

  addGold(amount: number): void {
    this.gold += amount;
  }

  spendGold(amount: number): boolean {
    if (this.gold < amount) {
      return false;
    }
    this.gold -= amount;
    return true;
  }

  // ---------- Атрибуты ----------

  addStatPoints(count: number): void {
    this.statPoints += count;
  }

  /** Тратит очко на атрибут. Возвращает true, если хватило очков */
  spendStatPoint(attr: AttrId): boolean {
    if (this.statPoints <= 0) {
      return false;
    }
    this.statPoints--;
    this.attrs[attr]++;
    return true;
  }

  // ---------- Лавка ----------

  purchasesOf(id: string): number {
    return this.purchases[id] ?? 0;
  }

  registerPurchase(id: string): void {
    this.purchases[id] = this.purchasesOf(id) + 1;
  }

  /** Повышает уровень лавки. Возвращает false, если максимум */
  upgradeShop(cost: number): boolean {
    if (this.shopLevel >= SHOP_LEVELS.maxLevel || !this.spendGold(cost)) {
      return false;
    }
    this.shopLevel++;
    // Сток старого уровня больше не актуален — при открытии сгенерируется новый
    this.stockShopLevel = 0;
    return true;
  }

  // ---------- Уровни навыков ----------

  skillLevelOf(skillId: string): number {
    return this.skillLevels[skillId] ?? 0;
  }

  /** Повышает уровень навыка за золото. Возвращает false, если не вышло */
  upgradeSkillLevel(skillId: string, cost: number, maxLevel: number): boolean {
    const level = this.skillLevelOf(skillId);
    if (!this.learnedSkills.includes(skillId) || level >= maxLevel || !this.spendGold(cost)) {
      return false;
    }
    this.skillLevels[skillId] = level + 1;
    return true;
  }

  // ---------- Оружие и инвентарь ----------

  /** Добавляет оружие. Возвращает 'added' | 'full' (полон — продать) | 'equipped' */
  addWeapon(weaponId: string): 'added' | 'full' {
    if (this.inventory.length >= this.inventoryCapacity) {
      return 'full';
    }
    const item: InventoryItem = { uid: `w${this.nextUid++}`, kind: 'weapon', weaponId };
    this.inventory.push(item);
    // Первое оружие автоматически экипируется
    if (!this.equippedWeaponUid) {
      this.equippedWeaponUid = item.uid;
    }
    return 'added';
  }

  getInventoryItem(uid: string): InventoryItem | undefined {
    return this.inventory.find((i) => i.uid === uid);
  }

  /** Экипирует/снимает оружие. Возвращает true, если состояние изменилось */
  toggleEquip(uid: string): boolean {
    if (this.equippedWeaponUid === uid) {
      this.equippedWeaponUid = null;
      return true;
    }
    if (!this.getInventoryItem(uid)) {
      return false;
    }
    this.equippedWeaponUid = uid;
    return true;
  }

  /** Продажа предмета. Возвращает полученное золото (0 — не продано) */
  sellItem(uid: string, ratio: number): number {
    const index = this.inventory.findIndex((i) => i.uid === uid);
    if (index < 0) {
      return 0;
    }
    const item = this.inventory[index];
    this.inventory.splice(index, 1);
    if (this.equippedWeaponUid === uid) {
      this.equippedWeaponUid = null;
    }
    const def = WEAPONS.find((w) => w.id === item.weaponId);
    const value = Math.max(1, Math.round((def?.shopCost ?? 5) * ratio));
    this.addGold(value);
    return value;
  }

  // ---------- Навыки ----------

  /** Изучает навык (уровень 1). Возвращает false, если уже изучен */
  learnSkill(skillId: string): boolean {
    if (this.learnedSkills.includes(skillId)) {
      return false;
    }
    this.learnedSkills.push(skillId);
    this.skillLevels[skillId] = Math.max(1, this.skillLevels[skillId] ?? 1);
    const slot = this.skillSlots.findIndex((s) => s === null);
    if (slot >= 0) {
      this.skillSlots[slot] = skillId;
    }
    return true;
  }

  /** Сажает изученный навык в первый свободный слот */
  assignSkillToFreeSlot(skillId: string): boolean {
    if (!this.learnedSkills.includes(skillId) || this.skillSlots.includes(skillId)) {
      return false;
    }
    const slot = this.skillSlots.findIndex((s) => s === null);
    if (slot < 0) {
      return false;
    }
    this.skillSlots[slot] = skillId;
    return true;
  }

  /** Снимает навык со слота */
  unassignSkill(skillId: string): void {
    const slot = this.skillSlots.indexOf(skillId);
    if (slot >= 0) {
      this.skillSlots[slot] = null;
    }
  }

  getElapsedSeconds(now: number): number {
    return (now - this.startedAt) / 1000;
  }

  // ---------- Сериализация (сохранение забега) ----------

  /** Снимок состояния забега для localStorage */
  serialize() {
    return {
      version: 1,
      wave: this.wave,
      gold: this.gold,
      xp: this.xp,
      level: this.level,
      kills: this.kills,
      attrs: { ...this.attrs },
      statPoints: this.statPoints,
      shopLevel: this.shopLevel,
      shopStock: this.shopStock.map((s) => ({ ...s })),
      stockShopLevel: this.stockShopLevel,
      purchases: { ...this.purchases },
      nextUid: this.nextUid,
      learnedSkills: [...this.learnedSkills],
      skillLevels: { ...this.skillLevels },
      skillSlots: [...this.skillSlots],
      inventory: this.inventory.map((i) => ({ ...i })),
      equippedWeaponUid: this.equippedWeaponUid,
    };
  }

  /**
   * Восстановление состояния из снимка. Некорректные данные отбрасываются
   * по частям (неизвестные навыки/оружие, отрицательные числа) — сломать
   * игру битым сейвом нельзя.
   */
  restore(data: ReturnType<RunState['serialize']>): void {
    const num = (v: unknown, fallback: number): number =>
      typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : fallback;

    this.wave = Math.max(0, Math.floor(num(data.wave, 0)));
    this.gold = Math.floor(num(data.gold, 0));
    this.xp = Math.floor(num(data.xp, 0));
    this.level = Math.max(1, Math.floor(num(data.level, 1)));
    this.kills = Math.floor(num(data.kills, 0));
    this.statPoints = Math.floor(num(data.statPoints, 0));
    this.shopLevel = Math.min(
      SHOP_LEVELS.maxLevel,
      Math.max(1, Math.floor(num(data.shopLevel, 1))),
    );

    for (const attr of Object.keys(this.attrs) as AttrId[]) {
      const v = (data.attrs as Record<string, unknown> | undefined)?.[attr];
      this.attrs[attr] = Math.max(0, Math.floor(num(v, ATTRS.startValue)));
    }

    this.shopStock = Array.isArray(data.shopStock)
      ? data.shopStock
          .filter((s): s is ShopStockSlot => Boolean(s))
          .map((s) => ({
            slotIndex: Math.max(0, Math.floor(num(s.slotIndex, 0))),
            tier: s.tier,
            defId: s.defId,
            replacementsLeft: Math.max(0, Math.floor(num(s.replacementsLeft, 0))),
          }))
      : [];
    this.stockShopLevel = Math.max(0, Math.floor(num(data.stockShopLevel, 0)));

    this.purchases = {};
    if (data.purchases && typeof data.purchases === 'object') {
      for (const [id, count] of Object.entries(data.purchases)) {
        this.purchases[id] = Math.max(0, Math.floor(num(count, 0)));
      }
    }
    this.nextUid = Math.max(1, Math.floor(num(data.nextUid, 1)));

    this.learnedSkills = Array.isArray(data.learnedSkills)
      ? data.learnedSkills.filter((id) => SKILLS.some((s) => s.id === id))
      : [];
    this.skillLevels = {};
    if (data.skillLevels && typeof data.skillLevels === 'object') {
      for (const [id, level] of Object.entries(data.skillLevels)) {
        if (this.learnedSkills.includes(id)) {
          this.skillLevels[id] = Math.max(1, Math.floor(num(level, 1)));
        }
      }
    }
    this.skillSlots = Array.isArray(data.skillSlots) && data.skillSlots.length === 3
      ? data.skillSlots.map((id) => (typeof id === 'string' && this.learnedSkills.includes(id) ? id : null))
      : [null, null, null];

    this.inventory = Array.isArray(data.inventory)
      ? data.inventory
          .filter((i): i is InventoryItem => Boolean(i) && typeof i.weaponId === 'string')
          .filter((i) => WEAPONS.some((w) => w.id === i.weaponId))
          .map((i) => ({ uid: String(i.uid), kind: 'weapon' as const, weaponId: i.weaponId }))
      : [];
    this.equippedWeaponUid =
      typeof data.equippedWeaponUid === 'string' && this.getInventoryItem(data.equippedWeaponUid)
        ? data.equippedWeaponUid
        : null;
  }
}

