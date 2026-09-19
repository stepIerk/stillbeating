import Phaser from 'phaser';
import { DROPS, WEAPONS, type WeaponDef } from '../config/balance';
import type RunState from '../state/RunState';
import { computeStats } from './DerivedStats';

export type DropKind = 'statPoint' | 'weapon' | 'skill';

export interface DropRoll {
  kind: DropKind;
  weaponId?: string;
  skillId?: string;
}

/**
 * Ролл лута с монстра. Каждый вид лута проверяется независимо по своему шансу
 * из конфига (DROPS), поэтому за одно убийство может выпасть 0, 1 или сразу
 * несколько предметов. Удача умножает все шансы, босс получает бонус к каждому.
 */
export function rollDrops(
  run: RunState,
  isBoss: boolean,
  notLearnedSkills: string[],
): DropRoll[] {
  const luckFactor = computeStats(run).luckFactor;
  const bonus = isBoss ? DROPS.bossBonus : 0;
  const chance = (base: number): number => Math.min(0.95, base * luckFactor + bonus);
  const drops: DropRoll[] = [];

  if (Math.random() < chance(DROPS.statPoint)) {
    drops.push({ kind: 'statPoint' });
  }

  if (Math.random() < chance(DROPS.weapon)) {
    const weapon = pickWeapon();
    if (weapon) {
      drops.push({ kind: 'weapon', weaponId: weapon.id });
    }
  }

  if (notLearnedSkills.length > 0 && Math.random() < chance(DROPS.skill)) {
    drops.push({ kind: 'skill', skillId: Phaser.Utils.Array.GetRandom(notLearnedSkills) });
  }

  return drops;
}

/** Случайное оружие для выпадения */
function pickWeapon(): WeaponDef | undefined {
  const pool = WEAPONS.filter((w) => w.shopCost > 0);
  // Чем дороже оружие — тем реже выпадает
  const weighted: WeaponDef[] = [];
  for (const weapon of pool) {
    const weight = weapon.rarity === 'common' ? 5 : weapon.rarity === 'rare' ? 3 : 1;
    for (let i = 0; i < weight; i++) {
      weighted.push(weapon);
    }
  }
  return Phaser.Utils.Array.GetRandom(weighted);
}
