import type { BossAttackDef, BossDef } from '../config/balance';
import { BOSS_SCALING, BOSS_TARGETING } from '../config/balance';

/**
 * Мозг босса: чистые функции без Phaser, поэтому проверяются в Node-смоук-тесте.
 * Атака идёт по фазам: chase → telegraph (характерное движение) → active (урон)
 * → recover (пауза), затем снова chase.
 */

export type BossPhase = 'chase' | 'telegraph' | 'active' | 'recover';
export type BossTarget = 'player' | 'crystal';

/**
 * Кого бьёт босс. Босс всегда преследует игрока и переключается на сердце
 * только если игрок мёртв (идёт возрождение) или сердце «сильно ближе».
 */
export function selectBossTarget(
  playerAlive: boolean,
  distToPlayer: number,
  distToCrystal: number,
): BossTarget {
  if (!playerAlive) {
    return 'crystal';
  }
  return distToCrystal < distToPlayer * BOSS_TARGETING.crystalBias ? 'crystal' : 'player';
}

/** Взвешенный выбор следующей атаки; random — число [0, 1) */
export function pickBossAttack(attacks: BossAttackDef[], random: number): BossAttackDef {
  if (attacks.length === 0) {
    throw new Error('boss has no attacks');
  }
  const total = attacks.reduce((sum, a) => sum + a.weight, 0);
  let roll = Math.max(0, Math.min(0.999999, random)) * total;
  for (const attack of attacks) {
    roll -= attack.weight;
    if (roll < 0) {
      return attack;
    }
  }
  return attacks[attacks.length - 1];
}

/** Сколько держится фаза атаки (мс) */
export function bossPhaseDuration(phase: BossPhase, attack: BossAttackDef | null): number {
  if (!attack) {
    return 0;
  }
  switch (phase) {
    case 'telegraph':
      return attack.telegraphMs;
    case 'active':
      return attack.activeMs;
    case 'recover':
      return attack.recoverMs;
    default:
      return 0;
  }
}

/** Фаза, следующая за текущей после её завершения */
export function bossNextPhase(phase: BossPhase): BossPhase {
  switch (phase) {
    case 'telegraph':
      return 'active';
    case 'active':
      return 'recover';
    case 'recover':
      return 'chase';
    default:
      return 'chase';
  }
}

/** Урон атаки: базовый урон босса, умноженный на множитель атаки */
export function bossAttackDamage(bossDamage: number, attack: BossAttackDef): number {
  return Math.max(1, Math.round(bossDamage * attack.damageMult));
}

/** Скалярное усиление босса по главе: HP, урон и награда растут с номером главы */
export function bossScaling(chapter: number): { hp: number; damage: number; reward: number } {
  const steps = Math.max(0, chapter - 1);
  return {
    hp: Math.pow(1 + BOSS_SCALING.hpPerChapter, steps),
    damage: Math.pow(1 + BOSS_SCALING.damagePerChapter, steps),
    reward: 1 + BOSS_SCALING.rewardPerChapter * steps,
  };
}

/** Итоговые характеристики босса для главы */
export function bossStatsForChapter(
  def: BossDef,
  chapter: number,
): { maxHp: number; damage: number; speed: number; xp: number; gold: number } {
  const scale = bossScaling(chapter);
  return {
    maxHp: Math.round(def.hp * scale.hp),
    damage: Math.round(def.damage * scale.damage),
    speed: def.speed,
    xp: Math.round(def.xp * scale.reward),
    gold: Math.round(def.gold * scale.reward),
  };
}
