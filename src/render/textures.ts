import Phaser from 'phaser';
import {
  ENEMY_TIERS,
  PLAYER_ATTACK_FX,
  PLAYER_VISUALS,
  WALL_THICKNESS,
  WORLD_VISUALS,
} from '../config/balance';
import { BODY, CELL, DROP, FLUID, HEART, MARKET, VESSEL } from './palette';

/**
 * Все текстуры игры рисуются простыми фигурами (круги, линии) в Graphics и
 * запекаются в текстуры сцены, чтобы в кадре не было тяжёлой геометрии.
 * Файл из двух частей: мир «внутри бога» (тайлы) и существа с лутом.
 *
 * Тайлы мира бесшовные: каждый элемент рисуется девять раз со смещениями
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

/** Сдвиг яркости цвета: amount > 0 — светлее, amount < 0 — темнее */
function shade(color: number, amount: number): number {
  const c = Phaser.Display.Color.IntegerToColor(color);
  const mix = (value: number): number =>
    Math.max(
      0,
      Math.min(255, Math.round(amount >= 0 ? value + (255 - value) * amount : value * (1 + amount))),
    );
  return Phaser.Display.Color.GetColor(mix(c.red), mix(c.green), mix(c.blue));
}

/** Неровное пятно: тело паразита — многоугольник с дрожью по радиусу */
function blobPoints(
  cx: number,
  cy: number,
  radius: number,
  segments: number,
  wobble: number,
): Phaser.Math.Vector2[] {
  const points: Phaser.Math.Vector2[] = [];
  for (let i = 0; i < segments; i++) {
    const angle = (i / segments) * Math.PI * 2;
    const r = radius * (1 + Phaser.Math.FloatBetween(-wobble, wobble));
    points.push(new Phaser.Math.Vector2(cx + Math.cos(angle) * r, cy + Math.sin(angle) * r));
  }
  return points;
}

/** Ломаная по точкам — короткий помощник для линий внутри фигур */
function strokePath(g: Phaser.GameObjects.Graphics, points: ReadonlyArray<readonly [number, number]>): void {
  g.beginPath();
  g.moveTo(points[0][0], points[0][1]);
  for (let i = 1; i < points.length; i++) {
    g.lineTo(points[i][0], points[i][1]);
  }
  g.strokePath();
}

/**
 * Игрок — лейкоцит: белая клетка с псевдоподиями по краю, мембраной и
 * гранулами в цитоплазме. Лицо и глаза остаются отдельными фигурами
 * (см. entities/Player) и рисуются поверх тела.
 */
export function buildPlayerTextures(g: Phaser.GameObjects.Graphics): void {
  const bodyR = PLAYER_VISUALS.bodyRadius;
  const size = (bodyR + 2) * 2;
  const c = size / 2;

  // Псевдоподии: бугры по краю, не выходящие за радиус физического тела
  const bumps = 9;
  for (let i = 0; i < bumps; i++) {
    const angle = (i / bumps) * Math.PI * 2 + 0.4;
    const bumpR = bodyR * Phaser.Math.FloatBetween(0.26, 0.4);
    const distance = bodyR - bumpR * 0.92;
    g.fillStyle(CELL.body, 1);
    g.fillCircle(c + Math.cos(angle) * distance, c + Math.sin(angle) * distance, bumpR);
  }

  g.fillStyle(CELL.body, 1);
  g.fillCircle(c, c, bodyR);

  // Гранулы в цитоплазме — кольцом вокруг лица
  g.fillStyle(CELL.granule, 0.9);
  for (let i = 0; i < 10; i++) {
    const angle = (i / 10) * Math.PI * 2 + 0.9;
    const distance = bodyR * Phaser.Math.FloatBetween(0.6, 0.78);
    g.fillCircle(
      c + Math.cos(angle) * distance,
      c + Math.sin(angle) * distance,
      Phaser.Math.FloatBetween(1.2, 2.2),
    );
  }

  g.lineStyle(2, CELL.membrane, 0.95);
  g.strokeCircle(c, c, bodyR - 1);
  g.generateTexture('player', size, size);
  g.clear();

  // Лицо игрока — чёрный овал, чуть сплюснутый сверху и снизу
  const faceW = PLAYER_VISUALS.faceRadiusX * 2;
  const faceH = PLAYER_VISUALS.faceRadiusY * 2;
  g.fillStyle(0x111111, 1);
  g.fillEllipse(faceW / 2, faceH / 2, faceW, faceH);
  g.generateTexture('player-face', faceW, faceH);
  g.clear();

  // Глаз игрока — белый овал, вытянутый по вертикали
  const eyeW = PLAYER_VISUALS.eyeRadiusX * 2;
  const eyeH = PLAYER_VISUALS.eyeRadiusY * 2;
  g.fillStyle(0xffffff, 1);
  g.fillEllipse(eyeW / 2, eyeH / 2, eyeW, eyeH);
  g.generateTexture('player-eye', eyeW, eyeH);
  g.clear();
}

/** Снаряды: сфера плазмы лейкоцита и комок кислоты паразита */
export function buildProjectileTextures(g: Phaser.GameObjects.Graphics): void {
  const shotR = PLAYER_ATTACK_FX.shotRadius;
  g.fillStyle(FLUID.plasmaGlow, 0.16);
  g.fillCircle(shotR, shotR, shotR);
  g.fillStyle(FLUID.plasmaGlow, 0.28);
  g.fillCircle(shotR, shotR, shotR * 0.74);
  g.fillStyle(FLUID.plasma, 0.6);
  g.fillCircle(shotR, shotR, shotR * 0.5);
  g.fillStyle(FLUID.plasma, 1);
  g.fillCircle(shotR, shotR, shotR * 0.28);
  g.generateTexture('player-shot', shotR * 2, shotR * 2);
  g.clear();

  // Плевок: комок кислоты с отлетающей каплей
  g.fillStyle(FLUID.bileDeep, 1);
  g.fillCircle(8, 8, 8);
  g.fillStyle(FLUID.bile, 1);
  g.fillCircle(8, 8.3, 6.3);
  g.fillStyle(FLUID.bileHi, 0.95);
  g.fillCircle(8.8, 7.4, 2.9);
  g.fillStyle(FLUID.bile, 0.9);
  g.fillCircle(2.8, 12.6, 2.2);
  g.generateTexture('enemy-shot', 16, 16);
  g.clear();
}

/**
 * Сглаживание замкнутого контура по опорным точкам (Catmull-Rom).
 * Силуэт сердца задаётся 16 точками, а не формулой «валентинки»: у настоящего
 * сердца верх широкий (предсердия и устья сосудов), правый край крутой,
 * а верхушка смещена вниз и вбок, к левому желудочку.
 */
function smoothClosedPath(points: ReadonlyArray<readonly [number, number]>): Phaser.Math.Vector2[] {
  const steps = 14;
  const count = points.length;
  const at = (i: number): readonly [number, number] => points[(i + count) % count];
  const spline = (p0: number, p1: number, p2: number, p3: number, t: number): number =>
    0.5 *
    (2 * p1 +
      (p2 - p0) * t +
      (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t +
      (3 * p1 - p0 - 3 * p2 + p3) * t * t * t);

  const out: Phaser.Math.Vector2[] = [];
  for (let i = 0; i < count; i++) {
    const [x0, y0] = at(i - 1);
    const [x1, y1] = at(i);
    const [x2, y2] = at(i + 1);
    const [x3, y3] = at(i + 2);
    for (let step = 0; step < steps; step++) {
      const t = step / steps;
      out.push(new Phaser.Math.Vector2(spline(x0, x1, x2, x3, t), spline(y0, y1, y2, y3, t)));
    }
  }
  return out;
}

/** Сосуд: капсула между двумя точками — тело и скруглённые устья на концах */
function capsule(
  g: Phaser.GameObjects.Graphics,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  width: number,
): void {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const length = Math.hypot(dx, dy) || 1;
  const half = width / 2;
  const nx = (-dy / length) * half;
  const ny = (dx / length) * half;

  g.fillCircle(x1, y1, half);
  g.fillCircle(x2, y2, half);
  g.fillPoints(
    [
      new Phaser.Math.Vector2(x1 + nx, y1 + ny),
      new Phaser.Math.Vector2(x2 + nx, y2 + ny),
      new Phaser.Math.Vector2(x2 - nx, y2 - ny),
      new Phaser.Math.Vector2(x1 - nx, y1 - ny),
    ],
    true,
  );
}

/**
 * Сердце бога — анатомический рисунок передней (грудино-рёберной) поверхности:
 * широкий верх с устьями полых вен, дугой аорты и лёгочным стволом, почти
 * отвесный правый край, пологий нижний край и верхушка, уходящая вниз и вправо
 * (к левому желудочку). Венечная борозда между предсердиями и желудочками
 * показана только тенью на мышце — жировой прослойки в стиле игры нет.
 * Все координаты заданы долями стороны текстуры, поэтому один и тот же
 * рисунок идёт и в игру, и в афишу меню.
 */
function drawHeartShape(g: Phaser.GameObjects.Graphics, size: number): void {
  const s = (value: number): number => value * size;
  const at = (x: number, y: number): [number, number] => [s(x), s(y)];

  // ---------- Сосуды: тело закроет их основания ----------
  g.fillStyle(HEART.vessel, 1);
  // Полые вены (справа от зрителя — слева на картинке)
  capsule(g, s(0.34), s(0.3), s(0.3), s(0.08), s(0.13));
  // Дуга аорты: восходит, изгибается и уходит вниз за лёгочный ствол
  g.lineStyle(s(0.12), HEART.vessel, 1);
  strokePath(g, [at(0.46, 0.3), at(0.45, 0.18), at(0.51, 0.12), at(0.6, 0.11), at(0.66, 0.17)]);
  // Три ветви от дуги: плечеголовной ствол, сонная и подключичная
  g.lineStyle(s(0.06), HEART.vessel, 1);
  strokePath(g, [at(0.49, 0.14), at(0.47, 0.03)]);
  strokePath(g, [at(0.56, 0.115), at(0.57, 0.02)]);
  strokePath(g, [at(0.63, 0.125), at(0.67, 0.04)]);
  // Лёгочный ствол: лежит впереди аорты
  g.fillStyle(HEART.vessel, 1);
  capsule(g, s(0.54), s(0.3), s(0.47), s(0.11), s(0.12));
  // Блики на сосудах — свет идёт сверху слева
  g.lineStyle(s(0.022), HEART.vesselHi, 0.5);
  strokePath(g, [at(0.31, 0.24), at(0.285, 0.1)]);
  strokePath(g, [at(0.44, 0.13), at(0.52, 0.07), at(0.61, 0.075)]);

  // ---------- Миокард ----------
  // Передняя поверхность сердца, как её видно спереди: сверху вниз по часовой
  // стрелке — правое предсердие с устьем полой вены, правый желудочек, верхушка,
  // левый желудочек и ушко левого предсердия. Слева на картинке — правая
  // половина сердца: правый край идёт почти отвесно, а длинная выпуклая дуга
  // левого желудочка сходится к верхушке ниже и правее центра.
  const body = smoothClosedPath([
    [0.245, 0.3], // ушко правого предсердия — лопасть слева под полой веной
    [0.215, 0.375], // правый край: выпуклость правого предсердия
    [0.2, 0.47], // самое широкое место правого края
    [0.215, 0.575], // острый край правого желудочка ниже венечной борозды
    [0.285, 0.7], // нижне-правый угол массы
    [0.39, 0.815], // нижний край правого желудочка
    [0.5, 0.89],
    [0.6, 0.93], // верхушка: низ и вправо, как у настоящего сердца
    [0.665, 0.885], // подъём к левому желудочку
    [0.75, 0.79],
    [0.825, 0.665],
    [0.862, 0.545], // левый желудочек — самый выпуклый край
    [0.845, 0.43],
    [0.79, 0.345], // стык левого желудочка с ушком предсердия
    [0.7, 0.285], // ушко левого предсердия
    [0.6, 0.27], // основание у устьев крупных сосудов
    [0.5, 0.255], // свод основания: выше всего посередине
    [0.4, 0.26],
    [0.32, 0.28], // основание справа, под полой веной
  ]).map((p) => new Phaser.Math.Vector2(s(p.x), s(p.y)));

  g.fillStyle(HEART.muscle, 1);
  g.fillPoints(body, true);

  // Объём: тень у правого края и на верхушке, блик на левом желудочке
  g.fillStyle(HEART.muscleDeep, 0.32);
  g.fillEllipse(s(0.315), s(0.52), s(0.19), s(0.4));
  g.fillStyle(HEART.muscleDeep, 0.36);
  g.fillEllipse(s(0.53), s(0.85), s(0.26), s(0.14));
  g.fillStyle(HEART.muscleHi, 0.28);
  g.fillEllipse(s(0.665), s(0.5), s(0.34), s(0.3));
  g.fillStyle(0xffffff, 0.16);
  g.fillEllipse(s(0.63), s(0.44), s(0.14), s(0.05));

  // ---------- Борозды и сосуды на поверхности ----------
  // Венечная борозда: только тень между предсердиями и желудочками —
  // жировой прослойки, как на препарированном сердце, в стиле игры нет
  g.lineStyle(s(0.03), HEART.muscleDeep, 0.5);
  strokePath(g, [at(0.215, 0.51), at(0.3, 0.45), at(0.42, 0.375), at(0.53, 0.32), at(0.65, 0.295), at(0.76, 0.335)]);

  // Коронарные сосуды: передняя межжелудочковая к верхушке по борозде,
  // правая по правому краю, огибающая — вдоль венечной борозды влево
  g.lineStyle(s(0.034), HEART.vessel, 0.95);
  strokePath(g, [at(0.53, 0.325), at(0.545, 0.47), at(0.56, 0.63), at(0.578, 0.79), at(0.592, 0.89)]);
  strokePath(g, [at(0.3, 0.45), at(0.24, 0.52), at(0.235, 0.6), at(0.285, 0.685)]);
  strokePath(g, [at(0.6, 0.295), at(0.7, 0.29), at(0.78, 0.33), at(0.83, 0.43)]);
  g.lineStyle(s(0.02), HEART.vessel, 0.8);
  strokePath(g, [at(0.545, 0.57), at(0.63, 0.61)]);
  strokePath(g, [at(0.588, 0.81), at(0.5, 0.86)]);

  // Тёмный контур
  g.lineStyle(s(0.022), HEART.rim, 0.9);
  g.strokePoints(body, true);
}

/** Сторона текстуры сердца в игре (тело врагов задаётся отдельно, см. Crystal) */
export const HEART_TEXTURE_SIZE = 132;

/** Сторона текстуры свечения: с запасом, чтобы гало не срезалось краем */
export const HEART_GLOW_SIZE = 300;

/**
 * Кристалл по коду — сердце бога. Гало рисуется отдельной текстурой
 * (crystal-glow), поэтому здесь важны только силуэт и детали.
 */
export function buildHeartTexture(g: Phaser.GameObjects.Graphics): void {
  drawHeartShape(g, HEART_TEXTURE_SIZE);
  g.generateTexture('crystal', HEART_TEXTURE_SIZE, HEART_TEXTURE_SIZE);
  g.clear();
}

/**
 * Свечение сердца: мягкое гало, которое в игре и в меню кладётся аддитивным
 * слоем под сердце — будто свет сочится из мышцы наружу.
 */
export function buildHeartGlowTexture(g: Phaser.GameObjects.Graphics): void {
  const c = HEART_GLOW_SIZE / 2;
  const rings = 18;
  for (let i = 0; i < rings; i++) {
    // Кольца от края к центру: перекрытие даёт плавный градиент
    g.fillStyle(HEART.glow, 0.03);
    g.fillCircle(c, c, c * (1 - (i / (rings - 1)) * 0.9));
  }
  g.fillStyle(HEART.glow, 0.12);
  g.fillCircle(c, c, c * 0.34);
  g.generateTexture('crystal-glow', HEART_GLOW_SIZE, HEART_GLOW_SIZE);
  g.clear();
}

/** Сторона афиши сердца в меню (масштаб задаёт сама сцена) */
export const MENU_HEART_SIZE = 320;

/**
 * Афиша главного меню: то же сердце, но крупное — бьётся за заголовком
 * на заставке. Гало к нему берётся из общей текстуры свечения.
 */
export function buildMenuTextures(g: Phaser.GameObjects.Graphics): void {
  drawHeartShape(g, MENU_HEART_SIZE);
  g.generateTexture('menu-heart', MENU_HEART_SIZE, MENU_HEART_SIZE);
  g.clear();
}

/**
 * Лут из паразитов: капля золота, нервный узел, клык и спора.
 * Размеры текстур не меняются — по ним построены радиусы подбора.
 */
export function buildDropTextures(g: Phaser.GameObjects.Graphics): void {
  // Монета — капля золотой лимфы
  g.fillStyle(DROP.goldDeep, 1);
  g.fillCircle(10, 10, 9);
  g.fillStyle(DROP.gold, 1);
  g.fillCircle(10, 9.6, 8.2);
  g.fillStyle(DROP.goldHi, 0.9);
  g.fillEllipse(7.2, 6.6, 4.4, 3);
  g.lineStyle(1.5, DROP.goldDeep, 0.75);
  g.strokeCircle(10, 10, 9);
  g.generateTexture('coin', 20, 20);
  g.clear();

  // Очко характеристик — нервный узел с отростками
  const node = 12;
  g.lineStyle(2, DROP.nerveDeep, 0.85);
  for (let i = 0; i < 6; i++) {
    const angle = (i / 6) * Math.PI * 2 + 0.3;
    strokePath(g, [
      [node + Math.cos(angle) * 4, node + Math.sin(angle) * 4],
      [node + Math.cos(angle) * 11, node + Math.sin(angle) * 11],
    ]);
  }
  g.fillStyle(DROP.nerveDeep, 1);
  g.fillCircle(node, node, 7);
  g.fillStyle(DROP.nerve, 1);
  g.fillCircle(node, node, 5.6);
  g.fillStyle(DROP.nerveHi, 0.9);
  g.fillCircle(node - 1.4, node - 1.6, 1.8);
  g.generateTexture('loot-point', 24, 24);
  g.clear();

  // Оружие — клык паразита
  const fang: Array<[number, number]> = [
    [6, 22],
    [3, 15],
    [8, 6],
    [16, 2],
    [19, 4],
    [12, 12],
    [11, 19],
  ];
  g.fillStyle(DROP.fangDeep, 1);
  g.fillPoints(fang.map(([x, y]) => new Phaser.Math.Vector2(x, y)), true);
  const fangCore: Array<[number, number]> = [
    [7.4, 19],
    [5.6, 14.4],
    [9.6, 7.6],
    [15.4, 4.4],
    [12, 11],
    [10.8, 17],
  ];
  g.fillStyle(DROP.fang, 1);
  g.fillPoints(fangCore.map(([x, y]) => new Phaser.Math.Vector2(x, y)), true);
  g.lineStyle(1.5, DROP.fangHi, 0.85);
  strokePath(g, [
    [9.6, 15],
    [14, 6.5],
  ]);
  g.generateTexture('loot-weapon', 24, 24);
  g.clear();

  // Навык — спора на черенке
  g.fillStyle(DROP.sporeDeep, 1);
  g.fillEllipse(12, 12, 19, 21);
  g.fillStyle(DROP.spore, 1);
  g.fillEllipse(12, 12, 16, 18);
  g.fillStyle(DROP.sporeHi, 0.85);
  g.fillCircle(12, 11.4, 4);
  g.lineStyle(2, DROP.sporeDeep, 0.9);
  strokePath(g, [
    [12, 20],
    [12, 23],
  ]);
  g.generateTexture('loot-skill', 24, 24);
  g.clear();
}

/**
 * Лавка-меняла на карте: лимфатический узел под мембранным навесом.
 * При мелком зуме силуэт должен читаться как лавка, поэтому в текстуре всего
 * три крупные формы — навес с бахромой, мешок-узел с торговцем и прилавок
 * с золотом (тем же, что выпадает из паразитов).
 *
 * Ключ и размер текстуры не меняются: по ним строится свечение-подсказка
 * (SHOP.glowRadius) и вывеска «ЛАВКА» над узлом.
 */
export function buildShopTexture(g: Phaser.GameObjects.Graphics): void {
  const width = 116;
  const height = 96;
  const cx = width / 2;

  // Мешок-узел: тёмная мембрана, ткань узла и светлая кромка —
  // чтобы лавка не сливалась с тканью пола
  g.fillStyle(MARKET.pouchDeep, 1);
  g.fillEllipse(cx, 64, 104, 54);
  g.fillStyle(MARKET.pouch, 1);
  g.fillEllipse(cx, 64, 94, 46);
  g.lineStyle(2, MARKET.awningHi, 0.35);
  g.strokeEllipse(cx, 64, 90, 42);

  // Тёплый свет внутри мешка — витрина
  g.fillStyle(DROP.gold, 0.16);
  g.fillEllipse(cx, 58, 74, 22);

  // Торговец: тёмный комок с бледными глазами, виден из-за прилавка
  g.fillStyle(MARKET.keeper, 1);
  g.fillEllipse(cx, 57, 22, 24);
  g.fillStyle(MARKET.keeperEye, 1);
  g.fillEllipse(cx - 5.4, 55.5, 4.6, 6.4);
  g.fillEllipse(cx + 5.4, 55.5, 4.6, 6.4);
  g.fillStyle(MARKET.keeper, 1);
  g.fillCircle(cx - 5.1, 56, 1.5);
  g.fillCircle(cx + 5.1, 56, 1.5);

  // Навес: полукруглая складка мембраны над узлом
  const awningBase = 34;
  const awningPeak = 6;
  const awningHalf = 54;
  const awningSteps = 24;
  const awning: Array<[number, number]> = [];
  for (let i = 0; i <= awningSteps; i++) {
    const t = (i / awningSteps) * Math.PI;
    awning.push([
      cx - awningHalf * Math.cos(t),
      awningBase - (awningBase - awningPeak) * Math.sin(t),
    ]);
  }
  g.fillStyle(MARKET.awning, 1);
  g.fillPoints(
    awning.map(([x, y]) => new Phaser.Math.Vector2(x, y)),
    true,
  );

  // Бахрома навеса: круглые фестоны по нижнему краю
  const bump = 9.75;
  const bumpStep = (awningHalf * 2 - bump * 2) / 5;
  for (let i = 0; i < 6; i++) {
    g.fillCircle(cx - awningHalf + bump + i * bumpStep, awningBase, bump);
  }

  // Светлая мембрана по верхней кромке навеса
  g.lineStyle(2.5, MARKET.awningHi, 0.5);
  strokePath(g, awning);

  // Прилавок: плотная кромка ткани перед торговцем
  g.fillStyle(MARKET.counterDeep, 1);
  g.fillEllipse(cx, 74, 92, 18);
  g.fillStyle(MARKET.counter, 1);
  g.fillEllipse(cx, 72, 90, 15);
  g.lineStyle(1.5, MARKET.counterHi, 0.45);
  g.strokeEllipse(cx, 69.5, 82, 8);

  // Золото-лимфа на прилавке: горка слева и монета справа
  const coin = (x: number, y: number, r: number): void => {
    g.fillStyle(DROP.goldDeep, 1);
    g.fillCircle(x, y + 1, r);
    g.fillStyle(DROP.gold, 1);
    g.fillCircle(x, y, r * 0.9);
    g.fillStyle(DROP.goldHi, 0.85);
    g.fillEllipse(x - r * 0.3, y - r * 0.35, r * 0.72, r * 0.42);
  };
  coin(cx - 30, 71, 8.5);
  coin(cx - 23, 74, 6.5);
  coin(cx + 27, 72, 7.5);

  // Ножки прилавка: две короткие стойки, чтобы силуэт читался как лавка,
  // а не как гриб, плюс тяжи-корни, которыми узел держится в ткани
  g.fillStyle(MARKET.counterDeep, 1);
  g.fillRoundedRect(cx - 40, 76, 9, 19, 4);
  g.fillRoundedRect(cx + 31, 76, 9, 19, 4);
  g.lineStyle(2.5, VESSEL.vein, 0.85);
  strokePath(g, [
    [cx - 36, 92],
    [cx - 44, 94],
  ]);
  strokePath(g, [
    [cx + 36, 92],
    [cx + 44, 94],
  ]);

  g.generateTexture('shop', width, height);
  g.clear();
}

/**
 * Враги — паразиты, ползущие по телу бога. Цвет тира остаётся основой
 * (по нему виды различаются в бою), а форма и детали отличают их друг от друга:
 * амёба, личинка, железа-плеватель, опухоль и червь-босс.
 */
export function buildParasiteTextures(g: Phaser.GameObjects.Graphics): void {
  for (const tier of ENEMY_TIERS) {
    const r = tier.radius;
    const base = tier.color;
    const deep = shade(base, -0.5);
    const lite = shade(base, 0.35);

    // Контур и тело: неровное пятно вместо ровного круга
    const outline = blobPoints(r, r, r - 0.5, 11, 0.07);
    const body = blobPoints(r, r, r - 2.5, 11, 0.12);
    g.fillStyle(deep, 1);
    g.fillPoints(outline, true);
    g.fillStyle(base, 1);
    g.fillPoints(body, true);

    switch (tier.id) {
      case 'slime': {
        // Амёба: ядро, вакуоли и тонкая внутренняя мембрана
        g.lineStyle(1.5, lite, 0.5);
        g.strokeCircle(r, r, r * 0.72);
        g.fillStyle(lite, 0.4);
        for (let i = 0; i < 3; i++) {
          const angle = Phaser.Math.FloatBetween(0, Math.PI * 2);
          const distance = r * Phaser.Math.FloatBetween(0.3, 0.6);
          g.fillCircle(r + Math.cos(angle) * distance, r + Math.sin(angle) * distance, r * 0.16);
        }
        g.fillStyle(deep, 1);
        g.fillCircle(r * 0.85, r * 1.3, r * 0.32);
        break;
      }
      case 'runner': {
        // Личинка: ножки по краю и тёмный глазок на голове
        g.lineStyle(2, deep, 1);
        for (let i = 0; i < 8; i++) {
          const angle = (i / 8) * Math.PI * 2 + 0.2;
          strokePath(g, [
            [r + Math.cos(angle) * r * 0.62, r + Math.sin(angle) * r * 0.62],
            [r + Math.cos(angle) * r * 0.94, r + Math.sin(angle) * r * 0.94],
          ]);
        }
        g.fillStyle(lite, 0.9);
        g.fillCircle(r * 1.35, r * 0.8, r * 0.22);
        g.fillStyle(0x000000, 0.55);
        g.fillCircle(r * 1.4, r * 0.75, Math.max(1.2, r * 0.1));
        break;
      }
      case 'shooter': {
        // Железа-плеватель: тёмный рот с кислотным ядром и капли снизу
        g.fillStyle(deep, 1);
        g.fillCircle(r, r, r * 0.52);
        g.lineStyle(2.5, FLUID.bile, 0.9);
        g.strokeCircle(r, r, r * 0.5);
        g.fillStyle(FLUID.bile, 0.85);
        g.fillCircle(r, r, r * 0.36);
        g.fillStyle(FLUID.bileHi, 1);
        g.fillCircle(r, r, r * 0.2);
        g.fillStyle(base, 1);
        for (let i = 0; i < 3; i++) {
          g.fillCircle(r * (0.5 + i * 0.5), r * 1.55, r * 0.14);
        }
        break;
      }
      case 'tank': {
        // Опухоль: наросты по краю и кольца плотной ткани
        g.fillStyle(lite, 0.35);
        for (let i = 0; i < 6; i++) {
          const angle = (i / 6) * Math.PI * 2 + 0.5;
          g.fillCircle(r + Math.cos(angle) * r * 0.7, r + Math.sin(angle) * r * 0.7, r * 0.18);
        }
        g.lineStyle(2.5, deep, 0.55);
        g.strokeCircle(r, r, r * 0.66);
        g.lineStyle(2, deep, 0.45);
        g.strokeCircle(r, r, r * 0.42);
        break;
      }
      case 'boss': {
        // Червь-пожиратель: пасть с зубами и кольца сегментов
        g.fillStyle(deep, 1);
        g.fillCircle(r, r, r * 0.45);
        g.fillStyle(0xfff3e0, 0.9);
        for (let i = 0; i < 9; i++) {
          const angle = (i / 9) * Math.PI * 2;
          const inner = r * 0.3;
          const outer = r * 0.47;
          const half = 0.16;
          g.fillPoints(
            [
              new Phaser.Math.Vector2(
                r + Math.cos(angle) * outer,
                r + Math.sin(angle) * outer,
              ),
              new Phaser.Math.Vector2(
                r + Math.cos(angle - half) * inner,
                r + Math.sin(angle - half) * inner,
              ),
              new Phaser.Math.Vector2(
                r + Math.cos(angle + half) * inner,
                r + Math.sin(angle + half) * inner,
              ),
            ],
            true,
          );
        }
        g.fillStyle(0x000000, 0.5);
        g.fillCircle(r, r, r * 0.22);
        g.lineStyle(2.5, deep, 0.6);
        g.strokeCircle(r, r, r * 0.7);
        g.lineStyle(2, lite, 0.35);
        g.strokeCircle(r, r, r * 0.86);
        break;
      }
    }

    // Блик и тёмный контур — чтобы паразит читался в бою, как прежние враги
    g.fillStyle(0xffffff, 0.8);
    g.fillCircle(r + r * 0.3, r - r * 0.32, Math.max(2, r * 0.2));
    g.lineStyle(2, 0x000000, 0.25);
    g.strokePoints(outline, true);

    g.generateTexture(`enemy-${tier.id}`, r * 2, r * 2);
    g.clear();
  }
}
