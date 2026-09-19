/**
 * Выбор цели врага — чистая логика без Phaser,
 * поэтому её можно проверять в Node-смоук-тесте (npm run test:logic).
 */

export type EnemyRole = 'hunter' | 'sieger';
export type EnemyTarget = 'player' | 'crystal';

/**
 * Правила выбора цели:
 *  1. sieger (осадник) всегда идёт ломать кристалл;
 *  2. hunter идёт к кристаллу, если игрок мёртв (идёт возрождение);
 *  3. hunter идёт к кристаллу, если кристалл ближе игрока — иначе он будет
 *     ковырять стену рядом с кристаллом, вместо того чтобы его бить;
 *  4. иначе hunter преследует игрока.
 */
export function chooseTarget(
  role: EnemyRole,
  playerAlive: boolean,
  distToPlayer: number,
  distToCrystal: number,
): EnemyTarget {
  if (role === 'sieger' || !playerAlive) {
    return 'crystal';
  }
  return distToCrystal < distToPlayer ? 'crystal' : 'player';
}