import Phaser from 'phaser';

const FONT = 'Arial, sans-serif';

/** Всплывающий текст (урон, опыт, золото) — как в рогаликах */
export function showFloatingText(
  scene: Phaser.Scene,
  x: number,
  y: number,
  text: string,
  color: string,
  fontSize = 18,
): void {
  const label = scene.add
    .text(x, y, text, { fontFamily: FONT, fontSize: `${fontSize}px`, fontStyle: 'bold', color })
    .setOrigin(0.5)
    .setDepth(120);

  scene.tweens.add({
    targets: label,
    y: y - 46,
    alpha: 0,
    duration: 720,
    ease: 'Quad.easeOut',
    onComplete: () => label.destroy(),
  });
}

/** Разлетающиеся кружки — простая замена спрайтовым частицам */
export function burst(
  scene: Phaser.Scene,
  x: number,
  y: number,
  color: number,
  count = 6,
  spread = 46,
  sizeMax = 6,
): void {
  for (let i = 0; i < count; i++) {
    const angle = Phaser.Math.FloatBetween(0, Math.PI * 2);
    const dist = Phaser.Math.Between(Math.round(spread * 0.4), spread);
    const dot = scene.add
      .circle(x, y, Phaser.Math.Between(3, sizeMax), color, 0.9)
      .setDepth(111);
    scene.tweens.add({
      targets: dot,
      x: x + Math.cos(angle) * dist,
      y: y + Math.sin(angle) * dist,
      alpha: 0,
      scale: 0.2,
      duration: Phaser.Math.Between(260, 420),
      onComplete: () => dot.destroy(),
    });
  }
}
