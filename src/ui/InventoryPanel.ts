import Phaser from 'phaser';
import { ATTR_LABELS, type AttrId, type Rarity } from '../config/balance';
import type { DerivedStats } from '../systems/DerivedStats';
import ScrollArea from './ScrollArea';

const FONT = 'Arial, sans-serif';
const RARITY_COLORS: Record<Rarity, string> = {
  common: '#4fc3f7',
  rare: '#ffd54f',
  epic: '#ff7043',
};
const RARITY_ACCENTS: Record<Rarity, number> = {
  common: 0x4fc3f7,
  rare: 0xffd54f,
  epic: 0xff7043,
};

export interface InventoryItemView {
  uid: string;
  name: string;
  rarity: Rarity;
  desc: string;
}

export interface LearnedSkillView {
  id: string;
  name: string;
  /** Уровень прокачки (1 — уже изучен, выше — улучшен в лавке) */
  level: number;
  maxLevel: number;
  /** Человекочитаемое описание эффекта с текущими числами */
  desc: string;
  manaCost: number;
  cooldown: number;
}

export interface InventoryPayload {
  level: number;
  gold: number;
  statPoints: number;
  attrs: Record<AttrId, number>;
  skillSlots: Array<string | null>;
  learnedSkills: LearnedSkillView[];
  equippedUid: string | null;
  items: InventoryItemView[];
  stats: DerivedStats;
}

export interface InventoryCallbacks {
  onClose: () => void;
  onSpendPoint: (attr: AttrId) => void;
  onEquip: (uid: string) => void;
  onSell: (uid: string) => void;
  onAssignSkill: (skillId: string, slot: number) => void;
}

type TabId = 'stats' | 'bag' | 'skills';

/**
 * Окно инвентаря: вкладки СТАТЫ (атрибуты + производные), СУМКА (экипировка),
 * НАВЫКИ (слоты креста). Открывается на паузе.
 */
export default class InventoryPanel {
  private scene: Phaser.Scene;
  private callbacks: InventoryCallbacks;
  private container?: Phaser.GameObjects.Container;
  private content?: Phaser.GameObjects.Container;
  private open = false;
  private payload?: InventoryPayload;
  private tab: TabId = 'stats';
  private selectedUid?: string;
  /** Прокрутка сетки сумки и списка навыков (пересоздаётся при rebuild) */
  private bagScroll?: ScrollArea;
  private skillsScroll?: ScrollArea;

  constructor(scene: Phaser.Scene, callbacks: InventoryCallbacks) {
    this.scene = scene;
    this.callbacks = callbacks;
  }

  get isOpen(): boolean {
    return this.open;
  }

  show(payload: InventoryPayload): void {
    this.payload = payload;
    if (this.open) {
      this.rebuild();
      return;
    }

    const { width, height } = this.scene.scale;
    this.container = this.scene.add.container(0, 0).setDepth(420);
    this.open = true;

    const overlay = this.scene.add
      .rectangle(width / 2, height / 2, width, height, 0x000000, 0.75)
      .setInteractive();
    this.container.add(overlay);

    this.rebuild();
  }

  hide(): void {
    this.destroyScrolls();
    this.container?.destroy(true);
    this.container = undefined;
    this.content = undefined;
    this.open = false;
    this.selectedUid = undefined;
  }

  private destroyScrolls(): void {
    this.bagScroll?.destroy();
    this.bagScroll = undefined;
    this.skillsScroll?.destroy();
    this.skillsScroll = undefined;
  }

  /** Перестроить содержимое (после траты очка/экипировки) */
  private rebuild(): void {
    this.destroyScrolls();
    this.content?.destroy(true);
    this.content = undefined;

    const payload = this.payload;
    if (!this.container || !payload) {
      return;
    }
    const { width, height } = this.scene.scale;
    const content = this.scene.add.container(0, 0);
    this.content = content;
    this.container.add(content);

    const panelWidth = Math.min(width - 20, 380);
    const left = width / 2 - panelWidth / 2;
    const panelTop = height * 0.1;

    const bg = this.scene.add.graphics();
    bg.fillStyle(0x14141f, 1);
    bg.fillRoundedRect(left, panelTop, panelWidth, height - panelTop * 2, 16);
    bg.lineStyle(2, 0x4fc3f7, 0.5);
    bg.strokeRoundedRect(left, panelTop, panelWidth, height - panelTop * 2, 16);
    content.add(bg);

    content.add(
      this.scene.add
        .text(width / 2, panelTop + 24, 'ИНВЕНТАРЬ', {
          fontFamily: FONT,
          fontSize: '22px',
          fontStyle: 'bold',
          color: '#e8e8f0',
        })
        .setOrigin(0.5),
    );

    content.add(
      this.scene.add
        .text(
          width / 2,
          panelTop + 50,
          `УР. ${payload.level}  ·  G ${payload.gold}  ·  ОЧКИ: ${payload.statPoints}`,
          { fontFamily: FONT, fontSize: '15px', fontStyle: 'bold', color: '#ffd54f' },
        )
        .setOrigin(0.5),
    );

    this.addZone(content, left + panelWidth - 24, panelTop + 24, 36, 36, 'X', () =>
      this.callbacks.onClose(),
    );

    const tabs: Array<[TabId, string]> = [
      ['stats', 'СТАТЫ'],
      ['bag', 'СУМКА'],
      ['skills', 'НАВЫКИ'],
    ];
    const tabWidth = (panelWidth - 32) / 3;
    tabs.forEach(([tabId, label], index) => {
      const x = left + 16 + tabWidth * (index + 0.5);
      const active = this.tab === tabId;
      content.add(
        this.scene.add
          .text(x, panelTop + 82, label, {
            fontFamily: FONT,
            fontSize: '15px',
            fontStyle: 'bold',
            color: active ? '#4fc3f7' : '#8a8a9a',
          })
          .setOrigin(0.5),
      );
      this.addZone(content, x, panelTop + 82, tabWidth, 30, undefined, () => {
        this.tab = tabId;
        this.selectedUid = undefined;
        this.rebuild();
      });
    });

    const bodyTop = panelTop + 104;
    const bodyHeight = height - panelTop * 2 - (bodyTop - panelTop) - 16;
    const bodyBg = this.scene.add.graphics();
    bodyBg.fillStyle(0x1c1c26, 1);
    bodyBg.fillRoundedRect(left + 12, bodyTop, panelWidth - 24, bodyHeight, 10);
    content.add(bodyBg);

    if (this.tab === 'stats') {
      this.buildStatsTab(content, left + 16, bodyTop + 10, panelWidth - 32, payload);
    } else if (this.tab === 'bag') {
      this.buildBagTab(content, left + 16, bodyTop + 10, panelWidth - 32, payload, bodyTop + bodyHeight);
    } else {
      this.buildSkillsTab(content, left + 16, bodyTop + 10, panelWidth - 32, payload, bodyTop + bodyHeight);
    }
  }

  // ---------- Вкладка СТАТЫ ----------

  private buildStatsTab(
    content: Phaser.GameObjects.Container,
    x: number,
    y: number,
    w: number,
    payload: InventoryPayload,
  ): void {
    const attrs: AttrId[] = ['str', 'agi', 'end', 'int', 'luck'];
    const rowHeight = 30;

    attrs.forEach((attr, index) => {
      const rowY = y + 18 + index * rowHeight;
      content.add(
        this.scene.add
          .text(x + 8, rowY, ATTR_LABELS[attr], {
            fontFamily: FONT,
            fontSize: '14px',
            color: '#a0a0b0',
          })
          .setOrigin(0, 0.5),
      );

      content.add(
        this.scene.add
          .text(x + w * 0.58, rowY, `${payload.attrs[attr]}`, {
            fontFamily: FONT,
            fontSize: '16px',
            fontStyle: 'bold',
            color: '#e8e8f0',
          })
          .setOrigin(0.5),
      );

      const canSpend = payload.statPoints > 0;
      content.add(
        this.scene.add
          .text(x + w - 16, rowY, '+', {
            fontFamily: FONT,
            fontSize: '20px',
            fontStyle: 'bold',
            color: canSpend ? '#8bc34a' : '#4a4a55',
          })
          .setOrigin(0.5),
      );
      if (canSpend) {
        this.addZone(content, x + w - 16, rowY, 40, 28, undefined, () =>
          this.callbacks.onSpendPoint(attr),
        );
      }
    });

    const s = payload.stats;
    const lines = [
      `ЗДОРОВЬЕ ${s.maxHp}   МАНА ${s.maxMana}`,
      `УРОН ${s.attackDamage}   КРИТ ${Math.round(s.critChance * 100)}%`,
      `СКОР. АТАКИ ${(1000 / s.attackInterval).toFixed(1)}/с   БЕГ ${Math.round(s.moveSpeed)}`,
      `РЕГЕН: ${s.hpRegen.toFixed(2)} HP/с, ${s.manaRegen.toFixed(1)} MP/с`,
      `УДАЧА ${s.luck}  (лут ×${s.luckFactor.toFixed(2)})`,
    ];
    content.add(
      this.scene.add.text(x + 8, y + 18 + attrs.length * rowHeight + 14, lines.join('\n'), {
        fontFamily: FONT,
        fontSize: '13px',
        color: '#8a8a9a',
        lineSpacing: 6,
      }),
    );
  }

  // ---------- Вкладка СУМКА ----------

  private buildBagTab(
    content: Phaser.GameObjects.Container,
    x: number,
    y: number,
    w: number,
    payload: InventoryPayload,
    bottomY: number,
  ): void {
    const equipped = payload.items.find((i) => i.uid === payload.equippedUid);
    content.add(
      this.scene.add
        .text(x + 6, y + 8, `ЭКИПИРОВАНО: ${equipped ? equipped.name : '— пусто —'}`, {
          fontFamily: FONT,
          fontSize: '13px',
          fontStyle: 'bold',
          color: equipped ? RARITY_COLORS[equipped.rarity] : '#5a5a66',
          wordWrap: { width: w - 12 },
        })
        .setOrigin(0, 0),
    );
    content.add(
      this.scene.add
        .text(
          x + 6,
          y + 28,
          equipped ? equipped.desc : 'Выберите оружие тапом, затем НАДЕТЬ или ПРОДАТЬ',
          {
            fontFamily: FONT,
            fontSize: '11px',
            color: '#8a8a9a',
            wordWrap: { width: w - 12 },
            lineSpacing: 2,
          },
        )
        .setOrigin(0, 0),
    );

    // Панель действий закреплена внизу вкладки, сетка плиток — над ней (со скроллом)
    const actionBarH = 52;
    const gridTop = y + 58;
    const gridBottom = bottomY - actionBarH - 6;
    const gridHeight = Math.max(90, gridBottom - gridTop);

    const cols = 3;
    const cellGap = 12;
    const cellSize = Math.min(112, Math.floor((w - 12 - cellGap * (cols - 1)) / cols));
    const gridWidth = cellSize * cols + cellGap * (cols - 1);
    const gridLeft = x + 6 + (w - 12 - gridWidth) / 2;
    const bagItems = payload.items;

    const scroll = new ScrollArea(this.scene, gridLeft - 4, gridTop, gridWidth + 8, gridHeight);
    this.bagScroll = scroll;
    content.add(scroll.content);

    bagItems.forEach((item, index) => {
      const col = index % cols;
      const row = Math.floor(index / cols);
      const cellX = gridLeft + col * (cellSize + cellGap) + cellSize / 2;
      const cellY = gridTop + row * (cellSize + cellGap) + cellSize / 2;
      const isEquipped = item.uid === payload.equippedUid;
      const isSelected = item.uid === this.selectedUid;

      const cell = this.scene.add.graphics();
      cell.fillStyle(isSelected ? 0x2a3a4a : 0x23232f, 1);
      cell.fillRoundedRect(cellX - cellSize / 2, cellY - cellSize / 2, cellSize, cellSize, 10);
      cell.lineStyle(
        3,
        isSelected ? 0x4fc3f7 : isEquipped ? 0x8bc34a : RARITY_ACCENTS[item.rarity],
        isEquipped || isSelected ? 1 : 0.7,
      );
      cell.strokeRoundedRect(cellX - cellSize / 2, cellY - cellSize / 2, cellSize, cellSize, 10);
      scroll.body.add(cell);

      scroll.body.add(
        this.scene.add
          .text(cellX, cellY - 10, this.wrapName(item.name, 12), {
            fontFamily: FONT,
            fontSize: '12px',
            fontStyle: 'bold',
            color: RARITY_COLORS[item.rarity],
            align: 'center',
            lineSpacing: 2,
          })
          .setOrigin(0.5),
      );
      if (isEquipped) {
        scroll.body.add(
          this.scene.add
            .text(cellX, cellY + cellSize / 2 - 14, 'НАДЕТО', {
              fontFamily: FONT,
              fontSize: '10px',
              fontStyle: 'bold',
              color: '#8bc34a',
            })
            .setOrigin(0.5),
        );
      }

      // Тап по плитке выбирает предмет; протяжка пальцем не считается выбором
      const cellZone = this.scene.add
        .zone(cellX, cellY, cellSize, cellSize)
        .setOrigin(0.5)
        .setInteractive({ useHandCursor: true });
      cellZone.on('pointerup', (pointer: Phaser.Input.Pointer) => {
        if (scroll.isInside(pointer.x, pointer.y) && scroll.movedAtLastPointerUp < 12) {
          this.selectedUid = isSelected ? undefined : item.uid;
          this.rebuild();
        }
      });
      scroll.body.add(cellZone);
    });

    const rows = Math.ceil(bagItems.length / cols);
    scroll.setTotalHeight(rows * (cellSize + cellGap) + 4);

    if (bagItems.length === 0) {
      content.add(
        this.scene.add
          .text(x + w / 2, gridTop + gridHeight / 2, 'Сумка пуста.\nЛут с монстров попадает сюда.', {
            fontFamily: FONT,
            fontSize: '13px',
            color: '#5a5a66',
            align: 'center',
          })
          .setOrigin(0.5),
      );
    }

    this.buildBagActions(content, x + 6, w - 12, bottomY - actionBarH);
  }

  /** Фиксированная панель действий: НАДЕТЬ/СНЯТЬ и ПРОДАТЬ для выбранного предмета */
  private buildBagActions(
    content: Phaser.GameObjects.Container,
    x: number,
    w: number,
    top: number,
  ): void {
    const selected = this.payload?.items.find((i) => i.uid === this.selectedUid);
    const h = 44;
    const centerY = top + h / 2;

    if (!selected) {
      content.add(
        this.scene.add
          .text(x + w / 2, centerY, 'ВЫБЕРИТЕ ОРУЖИЕ', {
            fontFamily: FONT,
            fontSize: '14px',
            fontStyle: 'bold',
            color: '#5a5a66',
          })
          .setOrigin(0.5),
      );
      return;
    }

    const isEquipped = selected.uid === this.payload?.equippedUid;
    const gap = 10;
    const halfW = (w - gap) / 2;

    this.buildButton(
      content,
      x + halfW / 2,
      centerY,
      halfW,
      h,
      isEquipped ? 'СНЯТЬ' : 'НАДЕТЬ',
      0x4fc3f7,
      () => {
        this.callbacks.onEquip(selected.uid);
        this.selectedUid = undefined;
        this.rebuild();
      },
    );

    this.buildButton(
      content,
      x + halfW + gap + halfW / 2,
      centerY,
      halfW,
      h,
      'ПРОДАТЬ',
      0xff8a65,
      () => {
        this.callbacks.onSell(selected.uid);
        this.selectedUid = undefined;
        this.rebuild();
      },
    );
  }

  /** Крупная кнопка действия (фон + подпись + кликабельная зона) */
  private buildButton(
    content: Phaser.GameObjects.Container,
    x: number,
    y: number,
    w: number,
    h: number,
    label: string,
    color: number,
    onClick: () => void,
  ): void {
    const bg = this.scene.add.graphics();
    bg.fillStyle(color, 0.16);
    bg.fillRoundedRect(x - w / 2, y - h / 2, w, h, 10);
    bg.lineStyle(2, color, 0.85);
    bg.strokeRoundedRect(x - w / 2, y - h / 2, w, h, 10);
    content.add(bg);

    content.add(
      this.scene.add
        .text(x, y, label, {
          fontFamily: FONT,
          fontSize: '15px',
          fontStyle: 'bold',
          color: '#e8e8f0',
        })
        .setOrigin(0.5),
    );

    this.addZone(content, x, y, w, h, undefined, onClick);
  }

  // ---------- Вкладка НАВЫКИ ----------

  private buildSkillsTab(
    content: Phaser.GameObjects.Container,
    x: number,
    y: number,
    w: number,
    payload: InventoryPayload,
    bottomY: number,
  ): void {
    const pad = 8;
    const scroll = new ScrollArea(this.scene, x, y, w, Math.max(120, bottomY - y - 8));
    this.skillsScroll = scroll;
    content.add(scroll.content);

    const body = scroll.body;
    let cursor = y + 8;

    body.add(
      this.scene.add
        .text(x + pad, cursor, 'СЛОТЫ КНОПОК У АТАКИ', {
          fontFamily: FONT,
          fontSize: '12px',
          color: '#8a8a9a',
        })
        .setOrigin(0, 0),
    );
    cursor += 22;

    payload.skillSlots.forEach((skillId, slot) => {
      const skill = payload.learnedSkills.find((s) => s.id === skillId);
      const rowY = cursor + 12;
      body.add(
        this.scene.add
          .text(x + pad, rowY, `${slot + 1}.`, {
            fontFamily: FONT,
            fontSize: '15px',
            fontStyle: 'bold',
            color: '#4fc3f7',
          })
          .setOrigin(0, 0.5),
      );
      body.add(
        this.scene.add
          .text(
            x + pad + 24,
            rowY,
            skill ? `${skill.name}  ·  УР. ${skill.level}/${skill.maxLevel}` : '— пусто —',
            {
              fontFamily: FONT,
              fontSize: '14px',
              color: skill ? '#e8e8f0' : '#5a5a66',
            },
          )
          .setOrigin(0, 0.5),
      );
      if (skill) {
        this.addZone(
          body,
          x + w - pad - 28,
          rowY,
          56,
          26,
          'СНЯТЬ',
          () => {
            this.callbacks.onAssignSkill('', slot);
          },
          scroll,
        );
      }
      cursor += 34;
    });

    cursor += 10;
    body.add(
      this.scene.add
        .text(x + pad, cursor, 'ИЗУЧЕННЫЕ НАВЫКИ И ИХ ЭФФЕКТ', {
          fontFamily: FONT,
          fontSize: '12px',
          color: '#8a8a9a',
        })
        .setOrigin(0, 0),
    );
    cursor += 22;

    if (payload.learnedSkills.length === 0) {
      body.add(
        this.scene.add
          .text(x + w / 2, cursor + 24, 'Навыков пока нет.\nИзучайте в лавке во вкладке НАВЫКИ.', {
            fontFamily: FONT,
            fontSize: '13px',
            color: '#5a5a66',
            align: 'center',
          })
          .setOrigin(0.5),
      );
      cursor += 80;
    }

    payload.learnedSkills.forEach((skill) => {
      const cardH = 96;
      const card = this.scene.add.graphics();
      card.fillStyle(0x23232f, 1);
      card.fillRoundedRect(x + pad, cursor, w - pad * 2, cardH, 10);
      card.lineStyle(2, 0xb39ddb, 0.6);
      card.strokeRoundedRect(x + pad, cursor, w - pad * 2, cardH, 10);
      body.add(card);

      body.add(
        this.scene.add
          .text(x + pad + 12, cursor + 12, skill.name, {
            fontFamily: FONT,
            fontSize: '15px',
            fontStyle: 'bold',
            color: '#e8e8f0',
          })
          .setOrigin(0, 0),
      );
      body.add(
        this.scene.add
          .text(x + w - pad - 12, cursor + 14, `УР. ${skill.level}/${skill.maxLevel}`, {
            fontFamily: FONT,
            fontSize: '12px',
            fontStyle: 'bold',
            color: '#ffd54f',
          })
          .setOrigin(1, 0),
      );

      body.add(
        this.scene.add
          .text(x + pad + 12, cursor + 34, skill.desc, {
            fontFamily: FONT,
            fontSize: '12px',
            color: '#a0a0b0',
            wordWrap: { width: w - pad * 2 - 24 },
            lineSpacing: 3,
          })
          .setOrigin(0, 0),
      );

      body.add(
        this.scene.add
          .text(
            x + pad + 12,
            cursor + cardH - 18,
            `МАНА ${Math.round(skill.manaCost)}  ·  КД ${(skill.cooldown / 1000).toFixed(1)} с  ·  СЛОТ:`,
            {
              fontFamily: FONT,
              fontSize: '11px',
              color: '#8a8a9a',
            },
          )
          .setOrigin(0, 0.5),
      );

      for (let slot = 0; slot < 3; slot++) {
        const btnX = x + w - pad - 22 - (2 - slot) * 34;
        const alreadyHere = payload.skillSlots[slot] === skill.id;
        this.addZone(
          body,
          btnX,
          cursor + cardH - 18,
          30,
          26,
          `${slot + 1}`,
          () => {
            this.callbacks.onAssignSkill(skill.id, slot);
          },
          scroll,
        );
        if (alreadyHere) {
          body.add(
            this.scene.add
              .text(btnX, cursor + cardH - 18, `${slot + 1}`, {
                fontFamily: FONT,
                fontSize: '14px',
                fontStyle: 'bold',
                color: '#8bc34a',
              })
              .setOrigin(0.5)
              .setDepth(1),
          );
        }
      }

      cursor += cardH + 10;
    });

    scroll.setTotalHeight(cursor - y + 8);
  }

  // ---------- Хелперы ----------

  /** Невидимая кликабельная зона (опционально с подписью) */
  private addZone(
    content: Phaser.GameObjects.Container,
    x: number,
    y: number,
    w: number,
    h: number,
    label: string | undefined,
    onClick: () => void,
    scroll?: ScrollArea,
  ): void {
    const zone = this.scene.add
      .zone(x, y, w, h)
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true });
    zone.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      if (scroll && !scroll.isInside(pointer.x, pointer.y)) {
        return;
      }
      onClick();
    });
    content.add(zone);

    if (label) {
      content.add(
        this.scene.add
          .text(x, y, label, {
            fontFamily: FONT,
            fontSize: '12px',
            fontStyle: 'bold',
            color: '#e8e8f0',
          })
          .setOrigin(0.5),
      );
    }
  }

  /** Разбивает название предмета на строки по ~13 символов */
  private wrapName(name: string, maxChars: number): string {
    const words = name.split(' ');
    const lines: string[] = [];
    let current = '';
    for (const word of words) {
      if ((current + ' ' + word).trim().length > maxChars && current) {
        lines.push(current);
        current = word;
      } else {
        current = (current + ' ' + word).trim();
      }
    }
    if (current) {
      lines.push(current);
    }
    return lines.join('\n');
  }
}
