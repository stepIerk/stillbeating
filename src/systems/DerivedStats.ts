import {
  ATTRS,
  PLAYER_STATS,
  REGEN,
  WEAPONS,
  type AttrId,
  type WeaponDef,
} from '../config/balance';
import type RunState from '../state/RunState';

export interface DerivedStats {
  maxHp: number;
  maxMana: number;
  hpRegen: number;
  manaRegen: number;
  attackDamage: number;
  attackInterval: number;
  attackRange: number;
  moveSpeed: number;
  critChance: number;
  critMultiplier: number;
  /** Итоговая удача: очки удачи + удача с оружия */
  luck: number;
  /** Множитель шансов лута (1 + удача * dropBonusPerPoint) */
  luckFactor: number;
}

export function equippedWeapon(run: RunState): WeaponDef | undefined {
  const item = run.equippedWeaponUid
    ? run.getInventoryItem(run.equippedWeaponUid)
    : undefined;
  return item ? WEAPONS.find((w) => w.id === item.weaponId) : undefined;
}

/** Финальные характеристики: база + атрибуты + бонусы экипированного оружия */
export function computeStats(run: RunState): DerivedStats {
  const w = equippedWeapon(run);
  const luck = run.attrs.luck + (w?.luck ?? 0);

  const maxHp =
    PLAYER_STATS.baseHp +
    run.attrs.end * ATTRS.end.hpPerPoint +
    (w?.hp ?? 0);
  const maxMana = PLAYER_STATS.baseMana + run.attrs.int * ATTRS.int.manaPerPoint + (w?.mana ?? 0);

  return {
    maxHp,
    maxMana,
    hpRegen:
      REGEN.hpBase + run.attrs.end * ATTRS.end.hpRegenPerPoint + (w?.hpRegenAdd ?? 0),
    manaRegen: REGEN.manaBase + run.attrs.int * ATTRS.int.manaRegenPerPoint,
    attackDamage:
      PLAYER_STATS.baseDamage +
      run.attrs.str * ATTRS.str.damagePerPoint +
      (w?.damage ?? 0),
    attackInterval:
      PLAYER_STATS.attackInterval /
      (1 + run.attrs.agi * ATTRS.agi.attackSpeedPctPerPoint + (w?.attackSpeedPct ?? 0)),
    attackRange: PLAYER_STATS.attackRange + (w?.range ?? 0),
    moveSpeed:
      PLAYER_STATS.moveSpeed *
      (1 + run.attrs.agi * ATTRS.agi.moveSpeedPctPerPoint + (w?.moveSpeedPct ?? 0)),
    critChance:
      0.03 + run.attrs.luck * ATTRS.luck.critChancePerPoint + (w?.critChance ?? 0),
    critMultiplier: ATTRS.luck.critMultiplier + (w?.critMultiplierAdd ?? 0),
    luck,
    luckFactor: 1 + luck * ATTRS.luck.dropBonusPerPoint,
  };
}

/** Итоговый атрибут (очки + экипировка), для отображения в инвентаре */
export function totalAttr(run: RunState, attr: AttrId): number {
  const w = equippedWeapon(run);
  return run.attrs[attr] + (attr === 'luck' ? w?.luck ?? 0 : 0);
}
