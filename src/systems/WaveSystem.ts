import Phaser from 'phaser';
import { ENEMY_TIERS, WAVES, waveEnemyCount, type EnemyTierId } from '../config/balance';

export type WavePhase = 'intermission' | 'spawning' | 'clearing';

export interface WaveCallbacks {
  onWaveStart: (wave: number, count: number) => void;
  onSpawn: (tier: EnemyTierId) => void;
  onWaveClear: (wave: number) => void;
  onIntermissionTick: (secondsLeft: number) => void;
}

/**
 * Волны врагов. Внутри волны враги выходят по одному с интервалом
 * (то есть подходят постепенно, а не пачкой).
 */
export default class WaveSystem {
  wave = 0;

  private phase: WavePhase = 'intermission';
  private timer = WAVES.intermission;
  private spawnTimer = 0;
  private queue: EnemyTierId[] = [];
  private callbacks: WaveCallbacks;

  constructor(callbacks: WaveCallbacks) {
    this.callbacks = callbacks;
  }

  get phaseName(): WavePhase {
    return this.phase;
  }

  get intermissionSecondsLeft(): number {
    return Math.max(0, this.timer) / 1000;
  }

  update(delta: number, aliveEnemies: number): void {
    switch (this.phase) {
      case 'intermission': {
        this.timer -= delta;
        this.callbacks.onIntermissionTick(this.intermissionSecondsLeft);
        if (this.timer <= 0) {
          this.startWave();
        }
        break;
      }

      case 'spawning': {
        this.spawnTimer -= delta;
        while (this.spawnTimer <= 0 && this.queue.length > 0) {
          const tier = this.queue.shift();
          if (tier) {
            this.callbacks.onSpawn(tier);
          }
          this.spawnTimer += this.spawnInterval();
        }
        if (this.queue.length === 0) {
          // Зачистка проверяется со следующего кадра: сцена передаёт число врагов
          // до апдейта, поэтому только что вышедший враг ещё не посчитан —
          // без этого волна закрывалась бы в кадре его появления.
          this.phase = 'clearing';
          return;
        }
        break;
      }

      case 'clearing': {
        if (aliveEnemies === 0) {
          this.callbacks.onWaveClear(this.wave);
          this.phase = 'intermission';
          this.timer = WAVES.intermission;
        }
        break;
      }
    }
  }

  private startWave(): void {
    this.wave++;
    this.queue = this.buildQueue(this.wave);
    this.spawnTimer = 0;
    this.phase = 'spawning';
    this.callbacks.onWaveStart(this.wave, this.queue.length);
  }

  private spawnInterval(): number {
    return Math.max(
      WAVES.minSpawnInterval,
      WAVES.baseSpawnInterval - this.wave * WAVES.spawnIntervalPerWave,
    );
  }

  /** Очередь спавна волны: количество растёт (аркадно, бесконечно), тиры — по мере прогресса */
  private buildQueue(wave: number): EnemyTierId[] {
    const count = waveEnemyCount(wave);
    const queue: EnemyTierId[] = [];

    // Босс приходит каждые N волн и идёт к кристаллу
    if (wave % WAVES.bossEvery === 0) {
      queue.push('boss');
    }
    while (queue.length < count) {
      queue.push(this.pickTier(wave));
    }
    return queue;
  }

  private pickTier(wave: number): EnemyTierId {
    const pool = ENEMY_TIERS.filter((t) => t.fromWave <= wave && t.weight > 0);
    const total = pool.reduce((sum, t) => sum + t.weight, 0);
    let roll = Phaser.Math.FloatBetween(0, total);
    for (const tier of pool) {
      roll -= tier.weight;
      if (roll <= 0) {
        return tier.id;
      }
    }
    return pool[0]?.id ?? 'slime';
  }
}
