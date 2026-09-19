import { SKILLS, type SkillDef } from '../config/balance';

/**
 * Эффективные параметры навыка с учётом уровня прокачки:
 * каждая прибавка из perLevel умножается на (уровень - 1).
 */
export function skillAtLevel(def: SkillDef, level: number): SkillDef {
  const lv = Math.max(1, Math.min(level, def.maxLevel));
  const per = def.perLevel ?? {};
  const steps = lv - 1;

  return {
    ...def,
    manaCost: per.manaCost ? Math.max(1, def.manaCost - per.manaCost * steps) : def.manaCost,
    radius: def.radius !== undefined && per.radius ? def.radius + per.radius * steps : def.radius,
    damageMult:
      def.damageMult !== undefined && per.damageMult
        ? def.damageMult + per.damageMult * steps
        : def.damageMult,
    shieldHpPct:
      def.shieldHpPct !== undefined && per.shieldHpPct
        ? def.shieldHpPct + per.shieldHpPct * steps
        : def.shieldHpPct,
    duration:
      def.duration !== undefined && per.duration ? def.duration + per.duration * steps : def.duration,
    berserkMult:
      def.berserkMult !== undefined && per.berserkMult
        ? def.berserkMult + per.berserkMult * steps
        : def.berserkMult,
    dashDistance:
      def.dashDistance !== undefined && per.dashDistance
        ? def.dashDistance + per.dashDistance * steps
        : def.dashDistance,
    chainTargets:
      def.chainTargets !== undefined && per.chainTargets
        ? def.chainTargets + per.chainTargets * steps
        : def.chainTargets,
  };
}

/** Навык по id */
export function skillById(id: string): SkillDef | undefined {
  return SKILLS.find((s) => s.id === id);
}

/** Цена улучшения навыка до уровня targetLevel (уровень 1 — изучение, не улучшение) */
export function skillUpgradeCost(def: SkillDef, targetLevel: number): number {
  // Уровень 2 — базовая цена, дальше ×1.5 за уровень
  return Math.round(def.upgradeCost * Math.pow(1.5, Math.max(1, targetLevel - 2)));
}

/** Числовые параметры эффекта навыка (без маны и КД) */
export function describeSkillNumbers(eff: SkillDef): string {
  const parts: string[] = [];

  if (eff.damageMult !== undefined && eff.radius !== undefined) {
    parts.push(`урон ×${eff.damageMult.toFixed(1)} по врагам в радиусе ${Math.round(eff.radius)}`);
  } else if (eff.damageMult !== undefined && eff.dashDistance !== undefined) {
    parts.push(
      `рывок на ${Math.round(eff.dashDistance)} с уроном ×${eff.damageMult.toFixed(1)} врагам на пути`,
    );
  } else if (eff.damageMult !== undefined && eff.chainTargets !== undefined) {
    parts.push(
      `урон ×${eff.damageMult.toFixed(1)} до ${Math.round(eff.chainTargets)} врагам по цепочке`,
    );
  } else if (eff.shieldHpPct !== undefined && eff.duration !== undefined) {
    parts.push(
      `щит на ${Math.round(eff.shieldHpPct * 100)}% макс. HP на ${(eff.duration / 1000).toFixed(1)} с`,
    );
  } else if (eff.berserkMult !== undefined && eff.duration !== undefined) {
    parts.push(`урон ×${eff.berserkMult.toFixed(2)} на ${(eff.duration / 1000).toFixed(1)} с`);
  }

  return parts.join(' · ');
}

/** Человекочитаемое описание эффекта навыка с текущими числами */
export function describeSkillEffect(eff: SkillDef): string {
  const numbers = describeSkillNumbers(eff);
  const costs = `мана ${Math.round(eff.manaCost)}, кд ${(eff.cooldown / 1000).toFixed(1)} с`;
  return numbers ? `${numbers} · ${costs}` : costs;
}

/** Что даст следующий уровень навыка (для карточки улучшения в лавке) */
export function describeSkillUpgrade(def: SkillDef, targetLevel: number): string {
  const per = def.perLevel;
  if (!per) {
    return '';
  }
  const parts: string[] = [];
  if (per.damageMult) parts.push(`урон +${per.damageMult.toFixed(2)}×`);
  if (per.radius) parts.push(`радиус +${per.radius}`);
  if (per.shieldHpPct) parts.push(`щит +${Math.round(per.shieldHpPct * 100)}% HP`);
  if (per.duration) parts.push(`длительность +${(per.duration / 1000).toFixed(1)} с`);
  if (per.berserkMult) parts.push(`урон +${per.berserkMult.toFixed(2)}×`);
  if (per.dashDistance) parts.push(`дальность +${per.dashDistance}`);
  if (per.chainTargets) parts.push(`целей +${per.chainTargets}`);
  if (per.manaCost) parts.push(`мана -${per.manaCost}`);
  return parts.length > 0 ? `${def.name} → УР. ${targetLevel}: ${parts.join(', ')}` : '';
}