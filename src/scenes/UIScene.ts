import Phaser from 'phaser';
import { CONTROLS_HEIGHT, SKILLS } from '../config/balance';
import ShopPanel, { type ShopPanelPayload } from '../ui/ShopPanel';
import InventoryPanel, { type InventoryPayload } from '../ui/InventoryPanel';
import type GameScene from './GameScene';

const FONT = 'Arial, sans-serif';

// Джойстик (слева)
const JOY_BASE_RADIUS = 58;
const JOY_KNOB_RADIUS = 26;
const JOY_MARGIN_X = 24;
const JOY_BOTTOM_MARGIN = 22;

// Кнопка атаки (справа)
const ATTACK_RADIUS = 42;
const ATTACK_MARGIN_X = 24;
const ATTACK_BOTTOM_MARGIN = 26;
// Кнопки навыков — крест вокруг кнопки атаки
const SKILL_RADIUS = 27;
const SKILL_OFFSET = ATTACK_RADIUS + SKILL_RADIUS + 8;

export interface StatsPayload {
  hp: number;
  maxHp: number;
  mana: number;
  maxMana: number;
  statPoints: number;
  damage: number;
  attacksPerSec: number;
  range: number;
  critChance: number;
  level: number;
  xp: number;
  xpToNext: number;
  gold: number;
  wave: number;
  enemiesLeft: number;
  kills: number;
  crystalHp: number;
  crystalMaxHp: number;
  time: number;
  respawnIn: number;
  phase: string;
  nearShop: boolean;
}

interface WaveStartPayload {
  wave: number;
  count: number;
}

interface IntermissionPayload {
  secondsLeft: number;
  wave: number;
}

interface LevelUpPayload {
  level: number;
  statPoints: number;
}

interface GameOverPayload {
  wave: number;
  kills: number;
  level: number;
  gold: number;
  time: number;
}

/** Полоска (фон + заполнение), растягивается слева направо */
class Bar {
  readonly bg: Phaser.GameObjects.Rectangle;
  readonly fill: Phaser.GameObjects.Rectangle;

  constructor(scene: Phaser.Scene, color: number, height: number) {
    this.bg = scene.add.rectangle(0, 0, 10, height, 0x000000, 0.55).setOrigin(0, 0.5).setDepth(100);
    this.fill = scene.add.rectangle(0, 0, 8, height - 2, color, 1).setOrigin(0, 0.5).setDepth(101);
  }

  layout(x: number, y: number, width: number): void {
    const height = this.bg.height;
    this.bg.setPosition(x, y).setSize(width, height);
    this.fill.setPosition(x + 1, y).setSize(width - 2, height - 2);
  }

  setRatio(ratio: number): void {
    const width = this.bg.width - 2;
    this.fill.setSize(Math.max(0.5, width * Phaser.Math.Clamp(ratio, 0, 1)), this.fill.height);
  }
}

/**
 * UI-сцена: джойстик, кнопка атаки, характеристики внизу,
 * баннеры волн, оверлеи смерти и конец забега.
 */
export default class UIScene extends Phaser.Scene {
  // Ввод
  private joyActive = false;
  private joyPointerId = -1;
  private joyVector = new Phaser.Math.Vector2(0, 0);
  private attackHeldFlag = false;
  private attackPointerId = -1;

  // HUD
  private panelGfx!: Phaser.GameObjects.Graphics;
  private hpBar!: Bar;
  private manaBar!: Bar;
  private crystalBar!: Bar;
  private xpBar!: Bar;
  private hpText!: Phaser.GameObjects.Text;
  private manaText!: Phaser.GameObjects.Text;
  private crystalText!: Phaser.GameObjects.Text;
  private attackStatsText!: Phaser.GameObjects.Text;
  private timerText!: Phaser.GameObjects.Text;
  private levelText!: Phaser.GameObjects.Text;
  private xpText!: Phaser.GameObjects.Text;
  private waveText!: Phaser.GameObjects.Text;
  private enemiesText!: Phaser.GameObjects.Text;
  private killsText!: Phaser.GameObjects.Text;
  private goldText!: Phaser.GameObjects.Text;

  // Управление
  private joyBase!: Phaser.GameObjects.Arc;
  private joyKnob!: Phaser.GameObjects.Arc;
  private attackButton!: Phaser.GameObjects.Arc;
  private attackZone!: Phaser.GameObjects.Zone;
  private attackCooldown!: Phaser.GameObjects.Graphics;
  private attackLabel!: Phaser.GameObjects.Text;
  private attackX = 0;
  private attackY = 0;

  // Кнопки навыков (крест вокруг кнопки атаки): 0 — сверху, 1 — слева, 2 — снизу
  private skillButtons: Array<{
    button: Phaser.GameObjects.Arc;
    cooldown: Phaser.GameObjects.Graphics;
    label: Phaser.GameObjects.Text;
    levelText: Phaser.GameObjects.Text;
    zone: Phaser.GameObjects.Zone;
    x: number;
    y: number;
  }> = [];

  // Кнопка инвентаря (правый верхний угол)
  private invButton!: Phaser.GameObjects.Arc;
  private invZone!: Phaser.GameObjects.Zone;
  private invLabel!: Phaser.GameObjects.Text;
  private invBadge!: Phaser.GameObjects.Text;

  // Оверлеи
  private banner?: Phaser.GameObjects.Text;
  private intermissionText!: Phaser.GameObjects.Text;
  private respawnOverlay!: Phaser.GameObjects.Rectangle;
  private respawnText!: Phaser.GameObjects.Text;
  private shopHint!: Phaser.GameObjects.Text;
  private gameOverBg!: Phaser.GameObjects.Rectangle;
  private gameOverTitle!: Phaser.GameObjects.Text;
  private gameOverStats!: Phaser.GameObjects.Text;

  // Панель лавки (окно покупок) и окно инвентаря
  private shopPanel!: ShopPanel;
  private inventoryPanel!: InventoryPanel;

  constructor() {
    super({ key: 'UI', active: false });
  }

  create(): void {
    this.input.enabled = true;
    this.joyActive = false;
    this.joyPointerId = -1;
    this.attackHeldFlag = false;
    this.attackPointerId = -1;
    this.joyVector = new Phaser.Math.Vector2(0, 0);
    this.banner = undefined;

    this.panelGfx = this.add.graphics().setDepth(90);
    this.buildHud();
    this.buildJoystick();
    this.buildAttackButton();
    this.buildSkillButtons();
    this.buildInventoryButton();
    this.buildOverlays();
    this.buildPanels();

    this.setupJoystickInput();
    this.layoutHud();

    this.registerGameEvents();

    this.scale.on('resize', this.layoutHud, this);
    this.events.once('shutdown', () => {
      this.scale.off('resize', this.layoutHud, this);
    });
  }

  /** Джойстик живёт в UI-сцене, вектор движения читает GameScene */
  get moveVector(): Phaser.Math.Vector2 {
    return this.joyVector;
  }

  get attackHeld(): boolean {
    return this.attackHeldFlag;
  }

  private get gameScene(): GameScene {
    return this.scene.get('Game') as GameScene;
  }

  // ---------- HUD: полоски, текст, раскладка ----------

  private buildHud(): void {
    this.hpBar = new Bar(this, 0x4fc3f7, 16);
    this.manaBar = new Bar(this, 0xb39ddb, 9);
    this.crystalBar = new Bar(this, 0x4dd0e1, 11);
    this.xpBar = new Bar(this, 0xb39ddb, 7);

    this.hpText = this.makeText(13, '#e8e8f0', true);
    this.manaText = this.makeText(11, '#e8e8f0');
    this.crystalText = this.makeText(11, '#e8e8f0');
    this.attackStatsText = this.makeText(13, '#a0a0b0');
    this.timerText = this.makeText(22, '#8a8a9a');
    this.levelText = this.makeText(13, '#e8e8f0', true);
    this.xpText = this.makeText(10, '#8a8a9a');
    this.waveText = this.makeText(12, '#a0a0b0');
    this.enemiesText = this.makeText(12, '#a0a0b0');
    this.killsText = this.makeText(12, '#a0a0b0');
    this.goldText = this.makeText(13, '#ffd54f', true);

    this.intermissionText = this.makeText(14, '#c5e1a5');
    this.intermissionText.setVisible(false);

    this.shopHint = this.makeText(14, '#ffd54f', true);
    this.shopHint.setText('АТАКУЙ ЛАВКУ — ОТКРОЕТСЯ МАГАЗИН');
    this.shopHint.setVisible(false);

    this.hpBar.setRatio(1);
    this.crystalBar.setRatio(1);
    this.xpBar.setRatio(0);
  }

  private makeText(size: number, color: string, bold = false): Phaser.GameObjects.Text {
    return this.add
      .text(0, 0, '', {
        fontFamily: FONT,
        fontSize: `${size}px`,
        fontStyle: bold ? 'bold' : 'normal',
        color,
      })
      .setOrigin(0.5)
      .setDepth(102);
  }

  /** Раскладка нижней панели под текущий размер экрана */
  private layoutHud(): void {
    const width = this.scale.width;
    const height = this.scale.height;
    const panelTop = height - CONTROLS_HEIGHT;

    this.panelGfx.clear();
    this.panelGfx.fillStyle(0x0a0a10, 0.92);
    this.panelGfx.fillRect(0, panelTop, width, CONTROLS_HEIGHT);
    this.panelGfx.lineStyle(2, 0xffffff, 0.12);
    this.panelGfx.lineBetween(0, panelTop, width, panelTop);

    const margin = 12;
    const barWidth = width - margin * 2;

    const hpY = panelTop + 20;
    this.hpBar.layout(margin, hpY, barWidth);
    this.hpText.setPosition(width / 2, hpY);

    const manaY = panelTop + 42;
    this.manaBar.layout(margin, manaY, barWidth);
    this.manaText.setPosition(width / 2, manaY);

    const crystalY = panelTop + 60;
    this.crystalBar.layout(margin, crystalY, barWidth);
    this.crystalText.setPosition(width / 2, crystalY);

    this.attackStatsText.setPosition(width / 2, panelTop + 78);
    this.timerText.setPosition(width / 2, 26);

    // Центральная колонка — характеристики забега
    const centerX = width / 2;
    const middleTop = panelTop + 106;
    this.levelText.setPosition(centerX, middleTop);
    this.xpBar.layout(centerX - 45, middleTop + 18, 90);
    this.xpText.setPosition(centerX, middleTop + 30);
    this.waveText.setPosition(centerX, middleTop + 50);
    this.enemiesText.setPosition(centerX, middleTop + 70);
    this.killsText.setPosition(centerX, middleTop + 90);
    this.goldText.setPosition(centerX, middleTop + 110);

    // Управление
    this.joyBase.setPosition(
      JOY_MARGIN_X + JOY_BASE_RADIUS,
      height - JOY_BOTTOM_MARGIN - JOY_BASE_RADIUS,
    );
    this.joyKnob.setPosition(this.joyBase.x, this.joyBase.y);

    // Кнопка атаки приподнята, чтобы крест навыков поместился над и под ней
    this.attackX = width - ATTACK_MARGIN_X - ATTACK_RADIUS;
    this.attackY = height - ATTACK_BOTTOM_MARGIN - ATTACK_RADIUS - SKILL_OFFSET;
    this.attackButton.setPosition(this.attackX, this.attackY);
    this.attackZone.setPosition(this.attackX, this.attackY);
    this.attackLabel.setPosition(this.attackX, this.attackY);

    this.intermissionText.setPosition(width / 2, 58);
    this.shopHint.setPosition(width / 2, 84);

    // Кнопки навыков — крест: сверху, слева, снизу от кнопки атаки
    const skillPositions: Array<[number, number]> = [
      [this.attackX, this.attackY - SKILL_OFFSET],
      [this.attackX - SKILL_OFFSET, this.attackY],
      [this.attackX, this.attackY + SKILL_OFFSET],
    ];
    this.skillButtons.forEach((btn, index) => {
      const [x, y] = skillPositions[index];
      btn.x = x;
      btn.y = y;
      btn.button.setPosition(x, y);
      btn.zone.setPosition(x, y);
      btn.label.setPosition(x, y);
      btn.levelText.setPosition(x + SKILL_RADIUS * 0.62, y + SKILL_RADIUS * 0.66);
    });

    // Кнопка инвентаря в правом верхнем углу
    this.invButton.setPosition(width - 34, 30);
    this.invZone.setPosition(width - 34, 30);
    this.invLabel.setPosition(width - 34, 30);
    this.invBadge.setPosition(width - 34, 58);

    // Оверлеи
    this.respawnOverlay.setPosition(width / 2, panelTop / 2).setSize(width, panelTop);
    this.respawnText.setPosition(width / 2, panelTop / 2);
    this.gameOverBg.setPosition(width / 2, panelTop / 2).setSize(width, panelTop);
    this.gameOverTitle.setPosition(width / 2, panelTop / 2 - 44);
    this.gameOverStats.setPosition(width / 2, panelTop / 2 + 16);
  }

  // ---------- Джойстик ----------

  private buildJoystick(): void {
    this.joyBase = this.add
      .circle(0, 0, JOY_BASE_RADIUS, 0xffffff, 0.08)
      .setStrokeStyle(2, 0xffffff, 0.3)
      .setDepth(100);

    this.joyKnob = this.add.circle(0, 0, JOY_KNOB_RADIUS, 0xffffff, 0.55).setDepth(101);
  }

  /** Кнопки навыков — крест вокруг кнопки атаки: тап = каст навыка */
  private buildSkillButtons(): void {
    // Сцена может создаваться повторно (возврат в меню и снова в игру):
    // старые кнопки уничтожены рестартом сцены, а массив нужно очистить,
    // иначе кнопки копятся и layoutHud падает на лишних элементах.
    this.skillButtons.length = 0;
    const SKILL_LABELS = ['Н', 'Щ', 'Б'];

    for (let slot = 0; slot < 3; slot++) {
      const button = this.add
        .circle(0, 0, SKILL_RADIUS, 0xb39ddb, 0.12)
        .setStrokeStyle(2, 0xb39ddb, 0.6)
        .setDepth(100);

      const cooldown = this.add.graphics().setDepth(104);

      const label = this.makeText(11, '#e8e8f0', true);
      label.setDepth(105).setText(SKILL_LABELS[slot]);

      // Бейдж уровня прокачки навыка (скрыт на 1-м уровне)
      const levelText = this.makeText(10, '#ffd54f', true);
      levelText.setDepth(106).setText('');

      const zone = this.add
        .zone(0, 0, SKILL_RADIUS * 2 + 12, SKILL_RADIUS * 2 + 12)
        .setOrigin(0.5)
        .setInteractive({ useHandCursor: true });
      zone.on('pointerdown', () => {
        this.gameScene.castSkill(slot);
        button.setScale(0.9);
        this.time.delayedCall(90, () => {
          if (button.active) {
            button.setScale(1);
          }
        });
      });

      this.skillButtons.push({ button, cooldown, label, levelText, zone, x: 0, y: 0 });
    }

    this.updateSkillButtonLabels();
  }

  /** Подписи кнопок навыков из назначенных слотов */
  private updateSkillButtonLabels(): void {
    const gs = this.gameScene;
    for (let slot = 0; slot < 3; slot++) {
      const skillId = gs.skillSlots[slot];
      const def = skillId ? SKILLS.find((s) => s.id === skillId) : undefined;
      const btn = this.skillButtons[slot];
      if (!btn) {
        continue;
      }
      btn.label.setText(def ? def.name.slice(0, 6).toUpperCase() : '—');
      const level = skillId ? gs.skillLevel(skillId) : 0;
      btn.levelText.setText(def && level > 1 ? `${level}` : '');
      // Пустой слот — тусклая кнопка
      btn.button.setFillStyle(def ? 0xb39ddb : 0xffffff, def ? 0.14 : 0.06);
      btn.button.setStrokeStyle(2, def ? 0xb39ddb : 0xffffff, def ? 0.6 : 0.2);
    }
  }

  /** Кнопка инвентаря (правый верхний угол) */
  private buildInventoryButton(): void {
    this.invButton = this.add
      .circle(0, 0, 24, 0xffd54f, 0.12)
      .setStrokeStyle(2, 0xffd54f, 0.6)
      .setDepth(100);

    this.invZone = this.add
      .zone(0, 0, 56, 56)
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true });
    this.invZone.on('pointerdown', () => {
      if (!this.panelsOpen && !this.gameScene.isRunFinished) {
        this.gameScene.openInventory();
      }
    });

    this.invLabel = this.makeText(10, '#ffd54f', true);
    this.invLabel.setDepth(105).setText('СУМКА');

    // Бейдж со свободными очками характеристик
    this.invBadge = this.makeText(11, '#8bc34a', true);
    this.invBadge.setDepth(105).setVisible(false);
  }

  private setupJoystickInput(): void {
    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => this.onPointerDown(p));
    this.input.on('pointermove', (p: Phaser.Input.Pointer) => this.onPointerMove(p));
    this.input.on('pointerup', (p: Phaser.Input.Pointer) => this.onPointerUp(p));
    this.input.on('pointerupoutside', (p: Phaser.Input.Pointer) => this.onPointerUp(p));
  }

  private onPointerDown(pointer: Phaser.Input.Pointer): void {
    if (this.joyActive || this.panelsOpen) {
      return;
    }
    const dist = Phaser.Math.Distance.Between(pointer.x, pointer.y, this.joyBase.x, this.joyBase.y);
    // Захват чуть больше зоны базы — удобнее попадать пальцем
    if (dist <= JOY_BASE_RADIUS * 2) {
      this.joyActive = true;
      this.joyPointerId = pointer.id;
      this.updateJoystick(pointer);
    }
  }

  private onPointerMove(pointer: Phaser.Input.Pointer): void {
    if (this.joyActive && pointer.id === this.joyPointerId) {
      this.updateJoystick(pointer);
    }
  }

  private onPointerUp(pointer: Phaser.Input.Pointer): void {
    if (this.joyActive && pointer.id === this.joyPointerId) {
      this.resetJoystick();
    }
    if (this.attackHeldFlag && pointer.id === this.attackPointerId) {
      this.setAttackHeld(false);
    }
  }

  private updateJoystick(pointer: Phaser.Input.Pointer): void {
    const dx = pointer.x - this.joyBase.x;
    const dy = pointer.y - this.joyBase.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const maxLen = JOY_BASE_RADIUS - 4;
    const clamped = Math.min(dist, maxLen);
    const nx = dist > 0 ? (dx / dist) * clamped : 0;
    const ny = dist > 0 ? (dy / dist) * clamped : 0;

    this.joyKnob.setPosition(this.joyBase.x + nx, this.joyBase.y + ny);
    this.joyVector.set(nx / maxLen, ny / maxLen);
  }

  private resetJoystick(): void {
    this.joyActive = false;
    this.joyPointerId = -1;
    this.joyVector.set(0, 0);
    this.joyKnob.setPosition(this.joyBase.x, this.joyBase.y);
  }

  // ---------- Кнопка атаки ----------

  private buildAttackButton(): void {
    this.attackButton = this.add
      .circle(0, 0, ATTACK_RADIUS, 0xffffff, 0.1)
      .setStrokeStyle(2, 0x4fc3f7, 0.6)
      .setDepth(100);

    // Сектор перезарядки: рисуется, пока удар не готов
    this.attackCooldown = this.add.graphics().setDepth(104);

    this.attackLabel = this.makeText(13, '#e8e8f0', true);
    this.attackLabel.setText('АТАКА');

    // Отдельная зона захвата — надёжнее, чем хит-область круга
    this.attackZone = this.add
      .zone(0, 0, ATTACK_RADIUS * 2, ATTACK_RADIUS * 2)
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true });

    this.attackZone.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      this.attackPointerId = pointer.id;
      this.setAttackHeld(true);
    });
  }

  private setAttackHeld(value: boolean): void {
    this.attackHeldFlag = value;
    this.attackButton.setFillStyle(value ? 0x4fc3f7 : 0xffffff, value ? 0.35 : 0.1);
  }

  private get panelsOpen(): boolean {
    return this.shopPanel.isOpen || this.inventoryPanel.isOpen;
  }

  private drawAttackCooldown(): void {
    this.attackCooldown.clear();
    if (this.panelsOpen || this.gameScene.isRunFinished) {
      return;
    }

    const ratio = this.gameScene.getAttackCooldownRatio();
    if (ratio >= 1) {
      return;
    }

    const start = -Math.PI / 2;
    const end = start + Math.PI * 2 * (1 - ratio);
    this.attackCooldown.fillStyle(0x4fc3f7, 0.35);
    this.attackCooldown.slice(this.attackX, this.attackY, ATTACK_RADIUS - 3, start, end, false);
    this.attackCooldown.fillPath();
  }

  private drawSkillCooldowns(): void {
    const now = this.time.now;
    for (let slot = 0; slot < 3; slot++) {
      const btn = this.skillButtons[slot];
      if (!btn) {
        continue;
      }
      btn.cooldown.clear();
      if (this.panelsOpen || this.gameScene.isRunFinished) {
        continue;
      }
      const ratio = this.gameScene.getSkillCooldownRatio(slot, now);
      if (ratio < 0 || ratio >= 1) {
        continue;
      }
      const start = -Math.PI / 2;
      const end = start + Math.PI * 2 * (1 - ratio);
      btn.cooldown.fillStyle(0xb39ddb, 0.4);
      btn.cooldown.slice(btn.x, btn.y, SKILL_RADIUS - 3, start, end, false);
      btn.cooldown.fillPath();
    }
  }

  update(): void {
    this.drawAttackCooldown();
    this.drawSkillCooldowns();
  }

  // ---------- Оверлеи и панели выбора ----------

  private buildOverlays(): void {
    this.respawnOverlay = this.add
      .rectangle(0, 0, 10, 10, 0x000000, 0.45)
      .setDepth(110)
      .setVisible(false);

    this.respawnText = this.makeText(20, '#ff5252', true);
    this.respawnText.setDepth(111).setVisible(false);

    this.gameOverBg = this.add
      .rectangle(0, 0, 10, 10, 0x000000, 0.7)
      .setDepth(110)
      .setVisible(false);

    this.gameOverTitle = this.makeText(30, '#ff5252', true);
    this.gameOverTitle.setDepth(111).setVisible(false);

    this.gameOverStats = this.makeText(14, '#e8e8f0');
    this.gameOverStats.setDepth(111).setVisible(false);
  }

  private buildPanels(): void {
    // Лавка: окно покупок с вкладками, открывается ударом по лавке на карте
    this.shopPanel = new ShopPanel(
      this,
      (id) => this.gameScene.buyShopItem(id),
      () => this.gameScene.closeShop(),
    );

    // Инвентарь: окно с характеристиками, экипировкой и навыками (пауза)
    this.inventoryPanel = new InventoryPanel(this, {
      onClose: () => {
        this.inventoryPanel.hide();
        this.gameScene.closeInventory();
      },
      onSpendPoint: (attr) => this.gameScene.spendStatPoint(attr),
      onEquip: (uid) => this.gameScene.toggleEquipItem(uid),
      onSell: (uid) => this.gameScene.sellInventoryItem(uid),
      onAssignSkill: (skillId, slot) => this.gameScene.assignSkill(skillId, slot),
    });
  }

  // ---------- События от GameScene ----------

  private registerGameEvents(): void {
    const gameEvents = this.scene.get('Game').events;

    gameEvents.on('stats', this.onStats, this);
    gameEvents.on('wave-start', this.onWaveStart, this);
    gameEvents.on('intermission', this.onIntermission, this);
    gameEvents.on('player-died', this.onPlayerDied, this);
    gameEvents.on('player-respawned', this.onPlayerRespawned, this);
    gameEvents.on('level-up', this.onLevelUp, this);
    gameEvents.on('shop-offer', this.onShopOffer, this);
    gameEvents.on('skills-changed', this.onSkillsChanged, this);
    gameEvents.on('inventory-open', this.onInventoryOpen, this);
    gameEvents.on('game-over', this.onGameOver, this);

    // Снимаем слушатели, чтобы они не накапливались между забегами
    this.events.once('shutdown', () => {
      gameEvents.off('stats', this.onStats, this);
      gameEvents.off('wave-start', this.onWaveStart, this);
      gameEvents.off('intermission', this.onIntermission, this);
      gameEvents.off('player-died', this.onPlayerDied, this);
      gameEvents.off('player-respawned', this.onPlayerRespawned, this);
      gameEvents.off('level-up', this.onLevelUp, this);
      gameEvents.off('shop-offer', this.onShopOffer, this);
      gameEvents.off('skills-changed', this.onSkillsChanged, this);
      gameEvents.off('inventory-open', this.onInventoryOpen, this);
      gameEvents.off('game-over', this.onGameOver, this);
    });
  }

  // ---------- Обработчики событий ----------

  private onStats(data: StatsPayload): void {
    this.hpBar.setRatio(data.hp / data.maxHp);
    this.hpText.setText(`ЗДОРОВЬЕ ${data.hp}/${data.maxHp}`);
    this.manaBar.setRatio(data.maxMana > 0 ? data.mana / data.maxMana : 0);
    this.manaText.setText(`МАНА ${data.mana}/${data.maxMana}`);
    this.crystalBar.setRatio(data.crystalHp / data.crystalMaxHp);
    this.crystalText.setText(`КРИСТАЛЛ ${data.crystalHp}/${data.crystalMaxHp}`);

    this.attackStatsText.setText(
      `УРОН ${data.damage}  ·  ${data.attacksPerSec.toFixed(1)}/С  ·  КРИТ ${Math.round(
        data.critChance * 100,
      )}%  ·  РАДИУС ${Math.round(data.range)}`,
    );
    this.timerText.setText(this.formatTime(data.time));

    this.levelText.setText(`УРОВЕНЬ ${data.level}`);
    this.xpBar.setRatio(data.xpToNext > 0 ? data.xp / data.xpToNext : 0);
    this.xpText.setText(`XP ${Math.floor(data.xp)}/${data.xpToNext}`);
    this.waveText.setText(`ВОЛНА ${data.wave}`);
    this.enemiesText.setText(`ВРАГИ ${data.enemiesLeft}`);
    this.killsText.setText(`УБИЙСТВ ${data.kills}`);
    this.goldText.setText(`G ${data.gold}`);

    // Бейдж очков на кнопке инвентаря
    this.invBadge.setVisible(data.statPoints > 0);
    this.invBadge.setText(`+${data.statPoints}`);
    this.shopHint.setVisible(data.nearShop && !this.panelsOpen);

    this.updateRespawnOverlay(data.respawnIn);
  }

  private formatTime(seconds: number): string {
    const minutes = Math.floor(seconds / 60);
    const rest = Math.floor(seconds % 60);
    return `${minutes}:${rest.toString().padStart(2, '0')}`;
  }

  private updateRespawnOverlay(respawnIn: number): void {
    const visible = respawnIn > 0.05;
    this.respawnOverlay.setVisible(visible);
    this.respawnText.setVisible(visible);
    if (visible) {
      this.respawnText.setText(`ВОЗРОЖДЕНИЕ ЧЕРЕЗ ${respawnIn.toFixed(1)} С`);
    }
  }

  private onWaveStart(data: WaveStartPayload): void {
    this.intermissionText.setVisible(false);
    this.showBanner(`ВОЛНА ${data.wave}`, `врагов: ${data.count}`);
  }

  private showBanner(title: string, subtitle: string): void {
    this.banner?.destroy();

    const banner = this.add
      .text(this.scale.width / 2, 120, `${title}\n${subtitle}`, {
        fontFamily: FONT,
        fontSize: '30px',
        fontStyle: 'bold',
        color: '#e8e8f0',
        align: 'center',
      })
      .setOrigin(0.5)
      .setDepth(150)
      .setAlpha(0);
    this.banner = banner;

    this.tweens.add({
      targets: banner,
      alpha: 1,
      duration: 240,
      yoyo: true,
      hold: 1300,
      onComplete: () => {
        if (this.banner === banner) {
          this.banner = undefined;
          banner.destroy();
        }
      },
    });
  }

  private onIntermission(data: IntermissionPayload): void {
    if (this.panelsOpen) {
      return;
    }
    this.intermissionText.setVisible(true);
    this.intermissionText.setText(`ВОЛНА ${data.wave} ЧЕРЕЗ ${Math.ceil(data.secondsLeft)} С`);
  }

  private onPlayerDied(data: { respawnIn: number }): void {
    this.resetJoystick();
    this.setAttackHeld(false);
    this.updateRespawnOverlay(data.respawnIn);
    this.showBanner('ВЫ ПОГИБЛИ', 'враги идут к кристаллу');
  }

  private onPlayerRespawned(): void {
    this.resetJoystick();
    this.updateRespawnOverlay(0);
  }

  /** Левелап: +1 очко характеристик (тратится в инвентаре) */
  private onLevelUp(data: LevelUpPayload): void {
    this.showBanner(
      `УРОВЕНЬ ${data.level}`,
      `+1 очко характеристик (всего: ${data.statPoints})`,
    );
  }

  private onShopOffer(data: ShopPanelPayload): void {
    this.setAttackHeld(false);
    this.resetJoystick();
    this.intermissionText.setVisible(false);
    this.shopHint.setVisible(false);
    this.shopPanel.show(data);
  }

  /** Список навыков изменился: обновляем подписи кнопок креста */
  private onSkillsChanged(): void {
    this.updateSkillButtonLabels();
  }

  /** Открытие инвентаря: пауза уже включена сценой игры */
  private onInventoryOpen(payload: InventoryPayload): void {
    this.resetJoystick();
    this.setAttackHeld(false);
    this.intermissionText.setVisible(false);
    this.inventoryPanel.show(payload);
  }

  private onGameOver(data: GameOverPayload): void {
    this.shopPanel.hide();
    this.resetJoystick();
    this.setAttackHeld(false);
    this.updateRespawnOverlay(0);
    this.intermissionText.setVisible(false);

    this.gameOverBg.setVisible(true);
    this.gameOverTitle.setVisible(true).setText('КРИСТАЛЛ РАЗРУШЕН');
    this.gameOverStats
      .setVisible(true)
      .setText(
        `ВОЛНА ${data.wave}  ·  УБИЙСТВ ${data.kills}  ·  УРОВЕНЬ ${data.level}\n` +
          `ЗОЛОТО ${data.gold}  ·  ВРЕМЯ ${this.formatTime(data.time)}\n\nВозврат в меню…`,
      );
  }
}