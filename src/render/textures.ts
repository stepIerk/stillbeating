import Phaser from 'phaser';
import { WALL_THICKNESS, WORLD_VISUALS } from '../config/balance';
import { BODY, VESSEL } from './palette';

/**
 * Тайлы мира «внутри бога» — плоть, вены и мышечные стены.
 * Всё рисуется простыми фигурами (круги, линии) в Graphics и запекается
 * в текстуры, чтобы в кадре не было тяжёлой геометрии.
 *
 * Тайлы бесшовные: каждый элемент рисуется девять раз со смещениями
 * −размер, 0, +размер по обеим осям, поэтому на повторе нет стыков.
 */

/** Точка внутри тайла с отступом от края */
function pick(size: number, margin = 8): number {
  return Phaser.Math.Between(margin, size - margin);
}

/** Рисует элемент тайла в 9 копиях — так повтор тайла незаметен */
function drawWrapped(size: number, draw: (offsetX: number, offsetY: number) => void): void {
  for (let dx = -1; dx <= 1; dx++) {
    for (let dy = -1; dy <= 1; dy++) {
      draw(dx * size, dy * size);
    }
  }
}

/** Пол: тёмная плоть, круги-клетки с мембранами и ядрами */
function buildFloorTile(g: Phaser.GameObjects.Graphics, size: number): void {
  g.fillStyle(BODY.fleshDark, 1);
  g.fillRect(0, 0, size, size);

  const rMin = Math.round(size * WORLD_VISUALS.floorCellMin);
  const rMax = Math.round(size * WORLD_VISUALS.floorCellMax);

  for (let i = 0; i < WORLD_VISUALS.floorCells; i++) {
    const cx = pick(size);
    const cy = pick(size);
    const r = Phaser.Math.Between(rMin, rMax);

    g.fillStyle(BODY.cell, Phaser.Math.FloatBetween(0.35, 0.6));
    drawWrapped(size, (ox, oy) => g.fillCircle(cx + ox, cy + oy, r));

    g.lineStyle(2, BODY.membrane, 0.55);
    drawWrapped(size, (ox, oy) => g.strokeCircle(cx + ox, cy + oy, r));

    g.fillStyle(BODY.nucleus, 0.45);
    drawWrapped(size, (ox, oy) => g.fillCircle(cx + ox, cy + oy, Math.max(2, r * 0.16)));
  }

  // Мелкие ядра, разбросанные по ткани
  for (let i = 0; i < WORLD_VISUALS.floorSpecks; i++) {
    const cx = pick(size, 2);
    const cy = pick(size, 2);
    const r = Phaser.Math.Between(1, 3);
    g.fillStyle(BODY.nucleus, Phaser.Math.FloatBetween(0.25, 0.5));
    drawWrapped(size, (ox, oy) => g.fillCircle(cx + ox, cy + oy, r));
  }
}

/** Ветка вены: ломаная со случайными поворотами плюс светлый блик */
function strokeVein(
  g: Phaser.GameObjects.Graphics,
  size: number,
  startX: number,
  startY: number,
  angle: number,
  length: number,
  width: number,
  depth: number,
): void {
  const steps = 10;
  const stepLength = length / steps;
  const points: Array<{ x: number; y: number }> = [{ x: startX, y: startY }];
  let heading = angle;
  let x = startX;
  let y = startY;

  for (let i = 0; i < steps; i++) {
    heading += Phaser.Math.FloatBetween(-0.5, 0.5);
    x += Math.cos(heading) * stepLength;
    y += Math.sin(heading) * stepLength;
    points.push({ x, y });
  }

  const strokePath = (offsetX: number, offsetY: number, color: number, alpha: number, lineWidth: number) => {
    g.lineStyle(lineWidth, color, alpha);
    g.beginPath();
    g.moveTo(points[0].x + offsetX, points[0].y + offsetY);
    for (let i = 1; i < points.length; i++) {
      g.lineTo(points[i].x + offsetX, points[i].y + offsetY);
    }
    g.strokePath();
  };

  drawWrapped(size, (offsetX, offsetY) => {
    strokePath(offsetX, offsetY, VESSEL.vein, 1, width);
    strokePath(offsetX, offsetY, VESSEL.veinHi, 0.4, Math.max(1, width * 0.4));
  });

  // Ответвления одной-двух жил тоньше ствола
  if (depth > 0) {
    const branches = Phaser.Math.Between(1, 2);
    for (let b = 0; b < branches; b++) {
      const point = points[Phaser.Math.Between(2, points.length - 2)];
      strokeVein(
        g,
        size,
        point.x,
        point.y,
        heading + Phaser.Math.FloatBetween(-1.1, 1.1),
        length * 0.6,
        Math.max(1, width * 0.7),
        depth - 1,
      );
    }
  }
}

/** Слой вен: несколько ветвящихся стволов */
function buildVeinTile(g: Phaser.GameObjects.Graphics, size: number): void {
  for (let i = 0; i < WORLD_VISUALS.veinTrunks; i++) {
    strokeVein(
      g,
      size,
      pick(size, 40),
      pick(size, 40),
      Phaser.Math.FloatBetween(0, Math.PI * 2),
      size * 0.5,
      3,
      2,
    );
  }
}

/**
 * Стена: продольные мышечные волокна с тёмными швами.
 * Тайл используется целиком — длина вдоль стены × её толщина, поэтому для
 * горизонтальных и вертикальных стен тайлы отдельные (волокна вдоль стены).
 */
function buildWallTile(
  g: Phaser.GameObjects.Graphics,
  length: number,
  thickness: number,
  vertical: boolean,
): void {
  g.fillStyle(BODY.wallBase, 1);
  g.fillRect(0, 0, vertical ? thickness : length, vertical ? length : thickness);

  const rowStep = thickness / WORLD_VISUALS.wallFibers;

  for (let i = 0; i < WORLD_VISUALS.wallFibers; i++) {
    const base = rowStep * (i + 0.5);
    const amplitude = Phaser.Math.FloatBetween(0.5, rowStep * 0.28);
    const phase = Phaser.Math.FloatBetween(0, Math.PI * 2);
    const fiberWidth = Phaser.Math.FloatBetween(rowStep * 0.3, rowStep * 0.55);

    // Ровно один период синусоиды на тайл — повтор вдоль стены незаметен
    const point = (t: number) => {
      const wave = Math.sin(phase + t * Math.PI * 2) * amplitude;
      return vertical
        ? { x: base + wave, y: t * length }
        : { x: t * length, y: base + wave };
    };

    const fiber = (color: number, alpha: number, offset: number, width: number) => {
      g.lineStyle(width, color, alpha);
      g.beginPath();
      for (let s = 0; s <= 32; s++) {
        const t = s / 32;
        const p = point(t);
        const x = vertical ? p.x + offset : p.x;
        const y = vertical ? p.y : p.y + offset;
        if (s === 0) {
          g.moveTo(x, y);
        } else {
          g.lineTo(x, y);
        }
      }
      g.strokePath();
    };

    fiber(BODY.wallFiber, 0.9, 0, fiberWidth);
    fiber(BODY.wallSeam, 0.7, fiberWidth * 0.5, 1);
  }
}

/** Запекает тайлы мира «внутри бога» в текстуры сцены */
export function buildWorldTextures(g: Phaser.GameObjects.Graphics): void {
  buildFloorTile(g, WORLD_VISUALS.floorTile);
  g.generateTexture('floor-cells', WORLD_VISUALS.floorTile, WORLD_VISUALS.floorTile);
  g.clear();

  buildVeinTile(g, WORLD_VISUALS.veinTile);
  g.generateTexture('floor-veins', WORLD_VISUALS.veinTile, WORLD_VISUALS.veinTile);
  g.clear();

  // Стены: отдельные тайлы под горизонтальные и вертикальные участки
  const length = WORLD_VISUALS.wallTile;
  buildWallTile(g, length, WALL_THICKNESS, false);
  g.generateTexture('wall-flesh-h', length, WALL_THICKNESS);
  g.clear();

  buildWallTile(g, length, WALL_THICKNESS, true);
  g.generateTexture('wall-flesh-v', WALL_THICKNESS, length);
  g.clear();
}
