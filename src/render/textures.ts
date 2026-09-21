import Phaser from 'phaser';
import {
  ENEMY_TIERS,
  PLAYER_ATTACK_FX,
  PLAYER_VISUALS,
  WALL_THICKNESS,
  WORLD_VISUALS,
} from '../config/balance';
import { BODY, CELL, DROP, FLUID, GROWTH, HEART, PARASITE, VESSEL } from './palette';

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
 * Неровное пятно с разными полуосями: тело-палочка у бацилл и сплюснутая
 * капсула у прочих — так силуэты видов не повторяют друг друга.
 */
function blobPointsEllipse(
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  segments: number,
  wobble: number,
): Phaser.Math.Vector2[] {
  const points: Phaser.Math.Vector2[] = [];
  for (let i = 0; i < segments; i++) {
    const angle = (i / segments) * Math.PI * 2;
    const jitter = 1 + Phaser.Math.FloatBetween(-wobble, wobble);
    points.push(
      new Phaser.Math.Vector2(cx + Math.cos(angle) * rx * jitter, cy + Math.sin(angle) * ry * jitter),
    );
  }
  return points;
}

/** Точки-кортежи из пятна Vector2 — smoothClosedPath работает с кортежами */
function toPairs(points: readonly Phaser.Math.Vector2[]): Array<[number, number]> {
  return points.map((p) => [p.x, p.y] as [number, number]);
}

/**
 * Жгутик: волна из точек — бактерия гребёт хвостом. Начало в (x, y),
 * длина и направление задаются углом, число волн — как изгибается хвост.
 */
function flagellumPoints(
  x: number,
  y: number,
  length: number,
  angle: number,
  waves: number,
): Array<[number, number]> {
  const steps = 12;
  const points: Array<[number, number]> = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const bend = Math.sin(t * Math.PI * waves) * length * 0.22;
    points.push([
      x + Math.cos(angle) * length * t - Math.sin(angle) * bend,
      y + Math.sin(angle) * length * t + Math.cos(angle) * bend,
    ]);
  }
  return points;
}

/** Зуб пасти: треугольник от внешнего радиуса к внутреннему */
function toothPoints(
  cx: number,
  cy: number,
  angle: number,
  outer: number,
  inner: number,
  half: number,
): Phaser.Math.Vector2[] {
  return [
    new Phaser.Math.Vector2(cx + Math.cos(angle) * outer, cy + Math.sin(angle) * outer),
    new Phaser.Math.Vector2(cx + Math.cos(angle - half) * inner, cy + Math.sin(angle - half) * inner),
    new Phaser.Math.Vector2(cx + Math.cos(angle + half) * inner, cy + Math.sin(angle + half) * inner),
  ];
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
 * Лавка на карте — нора-нарост в теле бога. Материал тот же, что у мышц-стен
 * (палитра GROWTH), но силуэт выверен вручную и симметричен: ни одного
 * случайного бугра, поэтому нора выглядит построенной, а не налепленной.
 *
 * Что видно игроку: бугристая масса с горбом-насыпью сверху, под ней —
 * широкая арка входа с влажной мембраной по кромке. Внутри темно, из глубины
 * сочится тёплый жёлтый свет, стоит мясистый прилавок, а на нём ровным рядом
 * разложен товар теми же цветами, что лут с паразитов: золото-лимфа, склянка
 * с лимфой, клык-оружие, спора-навык и нервный узел. С потолка норы свисают
 * три полотнища-вывески со светлым крестом и две лампы-светлячка — по ним
 * нора читается как лавка, а не как пасть паразита.
 *
 * Ключ текстуры по-прежнему 'shop': на него завязаны сущность лавки, свечение
 * (SHOP.glowRadius) и подсказка про удар по ней. Печётся с масштабом 1.2
 * (≈139×115): нора крупнее прочих объектов, чтобы читалась с любого зума, а
 * вывеска «ЛАВКА» висит над её насыпью.
 */
export function buildShopTexture(g: Phaser.GameObjects.Graphics): void {
  /** Лавка крупнее остальных объектов: нора должна читаться с любого зума */
  const scale = 1.2;
  const width = 116;
  const height = 96;
  const cx = width / 2;
  /** Линия пола: на ней стоит нора, и к ней сходятся все дуги */
  const baseY = 88;

  const v = (px: number, py: number): Phaser.Math.Vector2 => new Phaser.Math.Vector2(px, py);
  /** Тот же силуэт, раздутый от центра подошвы: контур, тень кромки и мясо */
  const inflated = (points: readonly Phaser.Math.Vector2[], k: number): Phaser.Math.Vector2[] =>
    points.map((p) => v(cx + (p.x - cx) * k, baseY + (p.y - baseY) * k));

  // Подошва: нора проросла в ткань — тёмное пятно и два корня в пол
  g.fillStyle(GROWTH.rim, 0.55);
  g.fillEllipse(cx, 90, 108, 16);
  g.lineStyle(2, VESSEL.vein, 0.7);
  strokePath(g, [
    [cx - 32, 89],
    [cx - 45, 92],
  ]);
  strokePath(g, [
    [cx + 32, 89],
    [cx + 45, 92],
  ]);

  // Силуэт норы: масса с горбом-насыпью сверху. Один и тот же контур в трёх
  // проходах — тёмная граница с тканью, тень кромки и мясо — даёт цельный
  // силуэт без граней, а симметрия точек держит форму построенной
  const mound = smoothClosedPath([
    [cx - 51, 86],
    [cx - 53, 62],
    [cx - 47, 42],
    [cx - 35, 26],
    [cx - 20, 15],
    [cx - 7, 10],
    [cx + 7, 10],
    [cx + 20, 15],
    [cx + 35, 26],
    [cx + 47, 42],
    [cx + 53, 62],
    [cx + 51, 86],
    [cx + 30, 92],
    [cx, 93],
    [cx - 30, 92],
  ]);
  g.fillStyle(GROWTH.rim, 1);
  g.fillPoints(inflated(mound, 1.05), true);
  g.fillStyle(GROWTH.fleshDeep, 1);
  g.fillPoints(inflated(mound, 1.02), true);
  g.fillStyle(GROWTH.flesh, 1);
  g.fillPoints(mound, true);

  // Блик по верхушке насыпи: свет падает сверху — мясо там светлее.
  // Верхние дуги того же контура идут внутрь силуэта, поэтому блик не
  // вылезает на фон, как это делали отдельные эллипсы
  g.lineStyle(4, GROWTH.fleshHi, 0.2);
  g.strokePoints(
    inflated(mound, 0.9).filter((p) => p.y < 30),
    false,
  );
  // Складка под насыпью: горб отделён от мяса вокруг входа
  g.lineStyle(1.4, GROWTH.fleshDeep, 0.5);
  g.strokePoints(
    inflated(mound, 0.86).filter((p) => p.y < 33),
    false,
  );

  /** Бугор насыпи: тень-кольцо, мясо и блик — рельеф, а не заплатка */
  const bump = (x: number, y: number, r: number): void => {
    g.fillStyle(GROWTH.fleshDeep, 0.9);
    g.fillCircle(x, y, r);
    g.fillStyle(GROWTH.flesh, 1);
    g.fillCircle(x, y - 0.8, r * 0.78);
    g.fillStyle(GROWTH.fleshHi, 0.4);
    g.fillCircle(x - r * 0.25, y - r * 0.5, r * 0.3);
  };
  // Три бугра на насыпи: два по краям и один по центру
  bump(cx - 24, 31, 7);
  bump(cx + 22, 29, 7);
  bump(cx, 19, 6);

  // Вены: нора срослась с телом и питается его кровью
  g.lineStyle(2, VESSEL.vein, 0.55);
  strokePath(g, [
    [cx - 46, 84],
    [cx - 50, 66],
    [cx - 45, 48],
    [cx - 36, 36],
  ]);
  strokePath(g, [
    [cx + 46, 84],
    [cx + 50, 66],
    [cx + 45, 48],
    [cx + 36, 36],
  ]);

  // Арка входа: мясо разошлось широкой норой. Слои от кромки к глубине —
  // десна, провал и дальняя тьма: внутри норы темно, свет идёт от прилавка
  const arch: Array<[number, number]> = [
    [cx - 38, baseY],
    [cx - 38, 62],
    [cx - 34, 48],
    [cx - 24, 39],
    [cx - 10, 35],
    [cx + 10, 35],
    [cx + 24, 39],
    [cx + 34, 48],
    [cx + 38, 62],
    [cx + 38, baseY],
  ];
  const mawEdge = smoothClosedPath(arch);
  const mawMid = inflated(mawEdge, 0.93);
  const mawDeep = inflated(mawEdge, 0.85);
  const mawVoid = inflated(mawEdge, 0.74);
  g.fillStyle(GROWTH.gum, 1);
  g.fillPoints(mawEdge, true);
  g.fillStyle(GROWTH.maw, 1);
  g.fillPoints(mawMid, true);
  g.fillStyle(GROWTH.mawFar, 0.6);
  g.fillPoints(mawDeep, true);
  g.fillStyle(GROWTH.mawFar, 0.9);
  g.fillPoints(mawVoid, true);

  // Тёплый свет из глубины: у прилавка горит жёлтый — витрину видно издалека
  g.fillStyle(DROP.gold, 0.07);
  g.fillEllipse(cx, 84, 76, 22);
  g.fillStyle(DROP.gold, 0.11);
  g.fillEllipse(cx, 80, 60, 16);
  g.fillStyle(DROP.gold, 0.16);
  g.fillEllipse(cx, 77, 44, 11);

  // Кромка входа: светлая влажная мембрана по разошедшемуся мясу
  g.lineStyle(4.5, GROWTH.gum, 0.5);
  g.strokePoints(mawEdge, true);
  g.lineStyle(2, GROWTH.membrane, 0.6);
  g.strokePoints(mawEdge, true);
  g.lineStyle(1.2, GROWTH.membrane, 0.16);
  g.strokePoints(mawMid, true);

  // Прилавок: мясо выпятилось в полость — плита, на которой лежит товар
  g.fillStyle(GROWTH.mawFar, 0.5);
  g.fillEllipse(cx, 86, 68, 12);
  g.fillStyle(GROWTH.fleshDeep, 1);
  g.fillEllipse(cx, 84, 66, 12);
  g.fillStyle(GROWTH.shelf, 1);
  g.fillEllipse(cx, 80, 62, 8);
  g.lineStyle(1.6, GROWTH.shelfHi, 0.7);
  g.strokeEllipse(cx, 77, 56, 5);

  /** Монета-лимфа: тем же цветом, что падает с паразитов */
  const coin = (x: number, y: number, r: number): void => {
    g.fillStyle(DROP.goldDeep, 1);
    g.fillCircle(x, y + 0.7, r);
    g.fillStyle(DROP.gold, 1);
    g.fillCircle(x, y, r * 0.9);
    g.fillStyle(DROP.goldHi, 0.85);
    g.fillEllipse(x - r * 0.3, y - r * 0.35, r * 0.72, r * 0.42);
  };

  /** Клык паразита — оружие на прилавке. dir = 1 — остриё вверх, −1 — вниз */
  const fang = (x: number, y: number, size: number, lean: number, dir: number): void => {
    g.fillStyle(DROP.fangDeep, 1);
    g.fillPoints(
      [
        v(x - size * 0.42, y + size * 0.1 * dir),
        v(x + lean, y - size * dir),
        v(x + size * 0.42, y + size * 0.1 * dir),
      ],
      true,
    );
    g.fillStyle(DROP.fang, 1);
    g.fillPoints(
      [
        v(x - size * 0.26, y + size * 0.02 * dir),
        v(x + lean * 0.8, y - size * 0.78 * dir),
        v(x + size * 0.26, y + size * 0.02 * dir),
      ],
      true,
    );
    g.lineStyle(1.1, DROP.fangHi, 0.8);
    strokePath(g, [
      [x + lean * 0.55, y - size * 0.62 * dir],
      [x + lean * 0.9, y - size * 0.92 * dir],
    ]);
  };
  /** Склянка с лимфой: тело, горлышко и пробка — товар узнаётся как товар */
  const vial = (x: number, y: number, h: number, w: number): void => {
    g.fillStyle(GROWTH.bannerDeep, 1);
    g.fillEllipse(x, y - h * 0.34, w, h * 0.68);
    g.fillRect(x - w * 0.17, y - h, w * 0.34, h * 0.42);
    g.fillStyle(GROWTH.banner, 1);
    g.fillEllipse(x, y - h * 0.36, w * 0.78, h * 0.52);
    g.fillRect(x - w * 0.12, y - h, w * 0.24, h * 0.38);
    g.fillStyle(GROWTH.membrane, 0.75);
    g.fillEllipse(x - w * 0.16, y - h * 0.44, w * 0.2, h * 0.26);
    g.fillStyle(GROWTH.membrane, 0.9);
    g.fillEllipse(x, y - h - 1, w * 0.5, 2.6);
  };

  // Витрина: ровный ряд товара по прилавку — так нора читается как лавка
  coin(cx - 26, 75, 4.6);
  coin(cx - 21, 75.5, 3.8);
  coin(cx - 23.5, 71, 5);
  vial(cx - 9.5, 76, 13, 7);
  fang(cx, 76, 13, 3, 1);
  // Спора на черенке — навык
  g.fillStyle(DROP.sporeDeep, 1);
  g.fillEllipse(cx + 11, 69.5, 11, 13);
  g.fillStyle(DROP.spore, 1);
  g.fillEllipse(cx + 11, 69.5, 9, 10.5);
  g.fillStyle(DROP.sporeHi, 0.8);
  g.fillCircle(cx + 11, 68, 2.6);
  g.lineStyle(1.6, DROP.sporeDeep, 0.9);
  strokePath(g, [
    [cx + 11, 76],
    [cx + 11, 79],
  ]);
  // Нервный узел — очко характеристик
  g.lineStyle(1.6, DROP.nerveDeep, 0.85);
  for (let i = 0; i < 5; i++) {
    const angle = (i / 5) * Math.PI * 2 + 0.4;
    strokePath(g, [
      [cx + 22 + Math.cos(angle) * 3, 72 + Math.sin(angle) * 3],
      [cx + 22 + Math.cos(angle) * 5.4, 72 + Math.sin(angle) * 5.4],
    ]);
  }
  g.fillStyle(DROP.nerveDeep, 1);
  g.fillCircle(cx + 22, 72, 4.6);
  g.fillStyle(DROP.nerve, 1);
  g.fillCircle(cx + 22, 72, 3.4);


  /**
   * Вывеска: полотнище с крестом свисает с потолка норы на тяже — по нему
   * лавку видно издалека, и её не спутать с пастью паразита
   */
  const banner = (x: number, top: number, w: number, len: number): void => {
    g.lineStyle(1.2, GROWTH.membrane, 0.5);
    strokePath(g, [
      [x, top - 3],
      [x, top],
    ]);
    g.fillStyle(GROWTH.bannerDeep, 1);
    g.fillPoints(
      [
        v(x - w / 2 - 1, top - 1),
        v(x + w / 2 + 1, top - 1),
        v(x + w / 2 + 1, top + len + 1),
        v(x, top + len - 3.5),
        v(x - w / 2 - 1, top + len + 1),
      ],
      true,
    );
    g.fillStyle(GROWTH.banner, 1);
    g.fillPoints(
      [
        v(x - w / 2, top),
        v(x + w / 2, top),
        v(x + w / 2, top + len),
        v(x, top + len - 3.5),
        v(x - w / 2, top + len),
      ],
      true,
    );
    // Крест на полотнище — светлая мембрана, знак торговли
    g.fillStyle(GROWTH.membrane, 0.9);
    g.fillRect(x - 1, top + 3, 2, len - 8);
    g.fillRect(x - w / 2 + 2.5, top + len * 0.36, w - 5, 2);
  };
  // Три полотнища по потолку норы: центральное длиннее боковых
  banner(cx, 39, 15, 21);
  banner(cx - 23, 42, 12, 17);
  banner(cx + 23, 42, 12, 17);

  /** Лампа-светлячок на тяже: горит тем же золотом, что лимфа */
  const lamp = (x: number, top: number, y: number): void => {
    g.lineStyle(1.2, GROWTH.membrane, 0.5);
    strokePath(g, [
      [x, top],
      [x, y - 4],
    ]);
    g.fillStyle(DROP.gold, 0.12);
    g.fillCircle(x, y, 7);
    g.fillStyle(DROP.goldDeep, 1);
    g.fillCircle(x, y, 3.2);
    g.fillStyle(DROP.gold, 1);
    g.fillCircle(x, y, 2.4);
    g.fillStyle(DROP.goldHi, 0.9);
    g.fillCircle(x - 0.7, y - 0.7, 1);
  };
  // Лампы висят между полотнищами, у самого потолка норы
  lamp(cx - 12, 35.5, 53);
  lamp(cx + 12, 35.5, 53);

  // Рисунок тот же, но печётся крупнее. Масштаб сбрасываем сразу — тем же
  // Graphics дальше рисуются остальные текстуры
  g.setScale(scale);
  g.generateTexture('shop', Math.round(width * scale), Math.round(height * scale));
  g.setScale(1);
  g.clear();
}

/**
 * Враги — бактерии и паразиты, что ползут по телу бога и рвутся к сердцу.
 * Цвет тира остаётся основой (по нему виды различаются в бою), а форма и
 * детали рассказывают, кто перед тобой: кокк в капсуле, бацилла на жгутиках,
 * железа-плеватель, опухоль-осадник и червь-пожиратель с пастью.
 * Все виды нарисованы «носом вправо» (0 рад): Enemy доворачивает спрайт по
 * курсу движения, поэтому хвост-жгутик всегда тянется назад — против хода.
 */
export function buildParasiteTextures(g: Phaser.GameObjects.Graphics): void {
  for (const tier of ENEMY_TIERS) {
    const r = tier.radius;
    const base = tier.color;
    const deep = shade(base, -0.5);
    const dark = shade(base, -0.74);
    const lite = shade(base, 0.35);
    const pale = shade(base, 0.6);

    // Силуэт сглажен (smoothClosedPath): у живого тела нет граней
    // многоугольника — контур «дышит», и у каждого вида своя форма.
    // Тело занимает почти весь кадр (r - 0.5): враг должен быть заметным
    const shape =
      tier.id === 'runner'
        ? blobPointsEllipse(r + r * 0.1, r, r * 0.66, r * 0.5, 12, 0.06)
        : blobPoints(r, r, r - 0.5, 13, tier.id === 'tank' ? 0.11 : 0.08);
    const outline = smoothClosedPath(toPairs(shape));
    const body = smoothClosedPath(
      shape.map((p) => [r + (p.x - r) * 0.9, r + (p.y - r) * 0.9] as [number, number]),
    );
    g.fillStyle(dark, 1);
    g.fillPoints(outline, true);
    g.fillStyle(base, 1);
    g.fillPoints(body, true);

    switch (tier.id) {
      case 'slime': {
        // Кокк: зернистая цитоплазма, вакуоли и тёмный нуклеоид
        g.lineStyle(1.5, lite, 0.45);
        g.strokeCircle(r, r, r * 0.7);
        for (const [vx, vy, vr] of [
          [r - r * 0.4, r + r * 0.32, r * 0.2],
          [r + r * 0.42, r - r * 0.3, r * 0.15],
          [r + r * 0.1, r + r * 0.55, r * 0.12],
        ]) {
          g.fillStyle(lite, 0.26);
          g.fillCircle(vx, vy, vr);
          g.lineStyle(1, pale, 0.4);
          g.strokeCircle(vx, vy, vr);
        }
        g.fillStyle(dark, 0.9);
        g.fillPoints(smoothClosedPath(toPairs(blobPoints(r * 0.78, r * 1.1, r * 0.3, 9, 0.22))), true);
        // Гранулы рибосом
        g.fillStyle(pale, 0.5);
        for (let i = 0; i < 5; i++) {
          const angle = (i / 5) * Math.PI * 2 + 0.7;
          g.fillCircle(r + Math.cos(angle) * r * 0.55, r + Math.sin(angle) * r * 0.45, r * 0.07);
        }
        break;
      }
      case 'runner': {
        // Бацилла: палочка гребёт жгутиками и цепляется пилями. Палочка сдвинута
        // к «носу» (вправо), а жгутики уходят влево — назад по ходу движения
        const rodCenter = r + r * 0.1;
        for (const [dy, angle] of [
          [-r * 0.3, Math.PI + 0.34],
          [0, Math.PI],
          [r * 0.3, Math.PI - 0.34],
        ]) {
          // Жгутик растёт прямо из поверхности палочки: точка на эллипсе при этом dy
          const exit = Math.sqrt(Math.max(0, 1 - (dy / (r * 0.5)) ** 2));
          const tail = flagellumPoints(rodCenter - r * 0.66 * exit, r + dy, r * 0.4, angle, 2);
          g.lineStyle(2.6, PARASITE.flagellum, 0.85);
          strokePath(g, tail);
          g.lineStyle(1.3, lite, 0.7);
          strokePath(g, tail);
        }
        // Пили — короткие ворсинки на переднем конце
        g.lineStyle(1.4, dark, 0.7);
        for (let i = 0; i < 5; i++) {
          const spread = (i - 2) / 2;
          const dy = spread * r * 0.44;
          const exit = Math.sqrt(Math.max(0, 1 - (dy / (r * 0.5)) ** 2));
          const root = rodCenter + r * 0.66 * exit;
          strokePath(g, [
            [root - r * 0.06, r + dy],
            [root + r * 0.12, r + dy * 1.4],
          ]);
        }
        // Нуклеоид — комок наследственного вещества внутри палочки
        g.fillStyle(dark, 0.5);
        g.fillEllipse(rodCenter - r * 0.1, r, r * 0.54, r * 0.28);
        g.fillStyle(pale, 0.45);
        for (let i = 0; i < 4; i++) {
          const angle = (i / 4) * Math.PI * 2 + 0.3;
          g.fillCircle(
            rodCenter + Math.cos(angle) * r * 0.5,
            r + Math.sin(angle) * r * 0.3,
            r * 0.06,
          );
        }
        break;
      }
      case 'shooter': {
        // Железа-плеватель: кислотный мешок в теле, проток-хоботок и рот-кольцо,
        // с которого стекает кислота
        g.fillStyle(FLUID.bileDeep, 0.9);
        g.fillCircle(r - r * 0.14, r, r * 0.4);
        g.fillStyle(FLUID.bile, 0.85);
        g.fillCircle(r - r * 0.14, r, r * 0.3);
        g.fillStyle(FLUID.bileHi, 0.9);
        g.fillCircle(r - r * 0.22, r - r * 0.12, r * 0.12);
        g.fillStyle(deep, 1);
        g.fillEllipse(r + r * 0.32, r, r * 0.5, r * 0.28);
        g.lineStyle(1.5, lite, 0.45);
        g.strokeEllipse(r + r * 0.32, r, r * 0.52, r * 0.3);
        g.fillStyle(lite, 0.5);
        g.fillEllipse(r + r * 0.32, r - r * 0.06, r * 0.42, r * 0.12);
        g.fillStyle(deep, 1);
        g.fillCircle(r + r * 0.66, r, r * 0.3);
        g.fillStyle(FLUID.bile, 0.9);
        g.fillCircle(r + r * 0.66, r, r * 0.2);
        g.fillStyle(FLUID.bileHi, 1);
        g.fillCircle(r + r * 0.7, r - r * 0.05, r * 0.08);
        g.fillStyle(FLUID.bile, 0.85);
        g.fillCircle(r + r * 0.62, r + r * 0.34, r * 0.11);
        g.fillCircle(r + r * 0.56, r + r * 0.58, r * 0.07);
        break;
      }
      case 'tank': {
        // Опухоль-осадник: лопасти-наросты, фиброзные волокна, язвы-провалы
        // и известковая корка — плотная масса, которую бьют в упор
        for (let i = 0; i < 5; i++) {
          const angle = (i / 5) * Math.PI * 2 + 0.45;
          const nx = r + Math.cos(angle) * r * 0.42;
          const ny = r + Math.sin(angle) * r * 0.42;
          g.fillStyle(lite, 0.3);
          g.fillCircle(nx, ny, r * 0.24);
          g.lineStyle(2, deep, 0.45);
          g.strokeCircle(nx, ny, r * 0.24);
        }
        g.lineStyle(2.5, dark, 0.5);
        g.strokeCircle(r, r, r * 0.68);
        g.lineStyle(2, dark, 0.4);
        g.strokeCircle(r, r, r * 0.42);
        g.lineStyle(2, deep, 0.35);
        for (let i = 0; i < 8; i++) {
          const angle = (i / 8) * Math.PI * 2 + 0.3;
          strokePath(g, [
            [r + Math.cos(angle) * r * 0.45, r + Math.sin(angle) * r * 0.45],
            [r + Math.cos(angle) * r * 0.66, r + Math.sin(angle) * r * 0.66],
          ]);
        }
        g.fillStyle(dark, 0.7);
        g.fillEllipse(r - r * 0.34, r + r * 0.34, r * 0.34, r * 0.2);
        g.fillEllipse(r + r * 0.44, r - r * 0.2, r * 0.2, r * 0.3);
        for (let i = 0; i < 5; i++) {
          const angle = (i / 5) * Math.PI * 2 + 0.9;
          g.fillStyle(PARASITE.crust, 0.45);
          g.fillPoints(toothPoints(r, r, angle, r * 0.96, r * 0.7, 0.2), true);
        }
        break;
      }
      case 'boss': {
        // Червь-пожиратель: кольца сегментов, щупальца-усики, пасть с двумя
        // рядами зубов и ряд глазков над ней
        g.lineStyle(2.5, deep, 0.55);
        g.strokeCircle(r, r, r * 0.76);
        g.lineStyle(2, lite, 0.3);
        g.strokeCircle(r, r, r * 0.88);
        g.lineStyle(3, deep, 0.85);
        for (const dir of [-1, 1]) {
          strokePath(g, [
            [r + dir * r * 0.56, r - r * 0.46],
            [r + dir * r * 0.86, r - r * 0.72],
          ]);
        }
        g.fillStyle(dark, 1);
        g.fillCircle(r, r, r * 0.5);
        for (let i = 0; i < 12; i++) {
          const angle = (i / 12) * Math.PI * 2 + 0.12;
          g.fillStyle(PARASITE.tooth, 0.92);
          g.fillPoints(toothPoints(r, r, angle, r * 0.5, r * 0.34, 0.11), true);
        }
        for (let i = 0; i < 9; i++) {
          const angle = (i / 9) * Math.PI * 2 - 0.2;
          g.fillStyle(PARASITE.toothDeep, 0.9);
          g.fillPoints(toothPoints(r, r, angle, r * 0.3, r * 0.16, 0.16), true);
        }
        g.fillStyle(deep, 1);
        g.fillCircle(r, r, r * 0.16);
        for (const [angle, size] of [
          [-2.35, 0.09],
          [-1.95, 0.07],
          [-1.19, 0.07],
          [-0.79, 0.09],
        ]) {
          const ex = r + Math.cos(angle) * r * 0.66;
          const ey = r + Math.sin(angle) * r * 0.66;
          g.fillStyle(PARASITE.ocellus, 0.95);
          g.fillCircle(ex, ey, r * size);
          g.fillStyle(0x000000, 0.6);
          g.fillCircle(ex, ey, r * size * 0.45);
        }
        break;
      }
    }

    // Мембрана-капсула по кромке тела, блик и тёмный контур — паразит должен
    // читаться в бою так же чётко, как прежние враги
    g.lineStyle(2, PARASITE.capsule, tier.id === 'tank' || tier.id === 'boss' ? 0.18 : 0.3);
    g.strokePoints(body, true);
    g.fillStyle(0xffffff, 0.75);
    g.fillCircle(r + r * 0.3, r - r * 0.32, Math.max(2, r * 0.2));
    g.lineStyle(2, 0x000000, 0.25);
    g.strokePoints(outline, true);

    g.generateTexture(`enemy-${tier.id}`, r * 2, r * 2);
    g.clear();
  }
}
