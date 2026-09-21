import Phaser from 'phaser';
import { DROP, MARKET } from '../render/palette';
import ScrollArea from './ScrollArea';

const FONT = 'Arial, sans-serif';
const RARITY_COLORS: Record<string, string> = {
  common: '#4fc3f7',
  rare: '#ffd54f',
  epic: '#ff7043',
};
const RARITY_ACCENTS: Record<string, number> = {
  common: 0x4fc3f7,
  rare: 0xffd54f,
  epic: 0xff7043,
};

/**
 * Стиль окна лавки: сама лавка — живая клетка, поэтому окно выглядит как её
 * нутро — тёмная плоть под светлой мембраной, карточки-вакуоли с товаром.
 * Яркость подобрана прежней: надписи, цены и цвета редкости читаются так же.
 */
const WINDOW = {
  /** Нутро лавки — основа панели */
  panel: 0x281019,
  /** Просвет цитоплазмы под мембраной */
  panelInner: 0x371721,
  /** Ярлык активной вкладки */
  tab: 0x45222e,
  /** Вакуоль — карточка товара */
  card: 0x341722,
  /** Вакуоль распроданного слота */
  cardSoldOut: 0x241117,
  /** Кнопка выхода */
  button: 0x45222e,
} as const;

export type ShopTabId = 'goods' | 'services' | 'skills' | 'shop';

export interface ShopTabOption {
  id: string;
  title: string;
  desc: string;
  cost: number;
  disabled?: boolean;
  soldOut?: boolean;
  rarity?: 'common' | 'rare' | 'epic';
  level?: number;
  maxLevel?: number;
}

export interface ShopTabPayload {
  id: ShopTabId;
  offers: ShopTabOption[];
}

export interface ShopPanelPayload {
  gold: number;
  shopLevel: number;
  nextUpgradeCost: number | null;
  tabs: ShopTabPayload[];
}

/** Метки вкладок в порядке показа */
const TAB_LABELS: Record<ShopTabId, string> = {
  goods: 'ТОВАРЫ',
  services: 'УСЛУГИ',
  skills: 'НАВЫКИ',
  shop: 'УЛУЧШЕНИЕ',
};

/**
 * Окно лавки: вкладки (товары/услуги/навыки/улучшение лавки) и прокручиваемый
 * список карточек. Покупка перерисовывает окно (GameScene переэмитит данные).
 */
export default class ShopPanel {
  private scene: Phaser.Scene;
  private onSelect: (id: string) => void;
  private onClose: () => void;
  private container?: Phaser.GameObjects.Container;
  private scroll?: ScrollArea;
  private open = false;
  private payload?: ShopPanelPayload;
  private activeTab: ShopTabId = 'goods';

  constructor(scene: Phaser.Scene, onSelect: (id: string) => void, onClose: () => void) {
    this.scene = scene;
    this.onSelect = onSelect;
    this.onClose = onClose;
  }

  get isOpen(): boolean {
    return this.open;
  }

  show(data: ShopPanelPayload): void {
    this.payload = data;
    const tabIds = data.tabs.map((t) => t.id);
    if (!this.open || !tabIds.includes(this.activeTab)) {
      // Вкладка по умолчанию: товары (или первая доступная)
      this.activeTab = tabIds.includes('goods') ? 'goods' : tabIds[0] ?? 'goods';
    }
    this.open = true;
    this.render();
  }

  hide(): void {
    this.destroyContent();
    this.open = false;
  }

  /** Полная перерисовка окна: контейнер и оверлей создаются заново */
  private render(): void {
    this.destroyContent();
    if (!this.payload) {
      return;
    }

    const { width, height } = this.scene.scale;
    this.container = this.scene.add.container(0, 0).setDepth(400);

    const overlay = this.scene.add
      .rectangle(width / 2, height / 2, width, height, 0x000000, 0.75)
      .setInteractive();
    this.container.add(overlay);
    overlay.on('pointerdown', () => this.close());

    this.buildBody(width, height);
  }

  private destroyContent(): void {
    this.scroll?.destroy();
    this.scroll = undefined;
    this.container?.destroy(true);
    this.container = undefined;
  }

  private close(): void {
    this.hide();
    this.onClose();
  }

  private buildBody(width: number, height: number): void {
    if (!this.container || !this.payload) {
      return;
    }
    const panelWidth = Math.min(width - 20, 400);
    const left = width / 2 - panelWidth / 2;
    const panelTop = height * 0.08;
    const panelHeight = height - panelTop * 2;

    const bg = this.scene.add.graphics();
    bg.fillStyle(WINDOW.panel, 1);
    bg.fillRoundedRect(left, panelTop, panelWidth, panelHeight, 16);
    bg.fillStyle(WINDOW.panelInner, 1);
    bg.fillRoundedRect(left + 6, panelTop + 6, panelWidth - 12, panelHeight - 12, 13);
    // Вакуоли в глубине окна — панель выглядит как нутро живой клетки
    bg.fillStyle(MARKET.vesicle, 0.08);
    bg.fillCircle(left + 40, panelTop + 130, 56);
    bg.fillCircle(left + panelWidth - 46, panelTop + panelHeight * 0.55, 68);
    bg.fillCircle(left + 26, panelTop + panelHeight - 96, 44);
    // Светлая мембрана по кромке и золотая жила внутри — золото лавки
    bg.lineStyle(2, MARKET.membrane, 0.4);
    bg.strokeRoundedRect(left, panelTop, panelWidth, panelHeight, 16);
    bg.lineStyle(1, DROP.gold, 0.3);
    bg.strokeRoundedRect(left + 6, panelTop + 6, panelWidth - 12, panelHeight - 12, 13);
    this.container.add(bg);

    // Заголовок: ЛАВКА · уровень, золото справа
    this.container.add(
      this.scene.add
        .text(left + 16, panelTop + 22, `ЛАВКА · УР. ${this.payload.shopLevel}`, {
          fontFamily: FONT,
          fontSize: '20px',
          fontStyle: 'bold',
          color: '#f4e4ec',
        })
        .setOrigin(0, 0.5),
    );
    this.container.add(
      this.scene.add
        .text(left + panelWidth - 16, panelTop + 22, `ЗОЛОТО: ${this.payload.gold}`, {
          fontFamily: FONT,
          fontSize: '15px',
          fontStyle: 'bold',
          color: '#ffca28',
        })
        .setOrigin(1, 0.5),
    );

    this.buildTabs(left, panelTop, panelWidth);

    // Список активной вкладки (прокрутка)
    const listTop = panelTop + 96;
    const footerHeight = 64;
    const listHeight = panelHeight - (listTop - panelTop) - footerHeight;
    const scrollArea = new ScrollArea(this.scene, left + 12, listTop, panelWidth - 24, listHeight);
    this.scroll = scrollArea;
    this.container.add(scrollArea.content);

    const tab = this.payload.tabs.find((t) => t.id === this.activeTab) ?? this.payload.tabs[0];
    const cardWidth = panelWidth - 56;
    const cardHeight = 84;
    const gap = 10;
    let cursor = listTop + 6;

    for (const option of tab?.offers ?? []) {
      this.buildCard(
        scrollArea.body,
        left + 16 + cardWidth / 2,
        cursor + cardHeight / 2,
        cardWidth,
        cardHeight,
        option,
      );
      cursor += cardHeight + gap;
    }

    scrollArea.setTotalHeight(cursor - listTop + 6);

    // Футер: кнопка выхода
    const closeY = height - panelTop - 24;
    this.buildCloseButton(width / 2, closeY, Math.min(panelWidth - 60, 260), 'ВЫЙТИ');
  }

  /** Вкладки: тап переключает и перерисовывает список */
  private buildTabs(left: number, panelTop: number, panelWidth: number): void {
    const tabs = this.payload?.tabs ?? [];
    if (tabs.length === 0) {
      return;
    }
    const tabY = panelTop + 62;
    const tabWidth = (panelWidth - 24) / tabs.length;

    tabs.forEach((tab, index) => {
      const x = left + 12 + tabWidth * (index + 0.5);
      const active = tab.id === this.activeTab;
      const gfx = this.scene.add.graphics();
      if (active) {
        gfx.fillStyle(WINDOW.tab, 1);
        gfx.fillRoundedRect(x - tabWidth / 2 + 3, tabY - 15, tabWidth - 6, 30, 8);
        gfx.lineStyle(1.5, MARKET.membrane, 0.5);
        gfx.strokeRoundedRect(x - tabWidth / 2 + 3, tabY - 15, tabWidth - 6, 30, 8);
        gfx.lineStyle(1, DROP.gold, 0.7);
        gfx.strokeRoundedRect(x - tabWidth / 2 + 5, tabY - 13, tabWidth - 10, 26, 7);
      }
      this.container?.add(gfx);
      // Подпись вкладки подгоняем по ширине, чтобы не вылезала на узких экранах
      const tabFont = Math.max(9, Math.min(13, Math.floor(tabWidth / 6.4)));
      this.container?.add(
        this.scene.add
          .text(x, tabY, TAB_LABELS[tab.id], {
            fontFamily: FONT,
            fontSize: `${tabFont}px`,
            fontStyle: 'bold',
            color: active ? '#ffd54f' : '#9d8791',
            align: 'center',
          })
          .setOrigin(0.5),
      );

      const zone = this.scene.add
        .zone(x, tabY, tabWidth, 36)
        .setOrigin(0.5)
        .setInteractive({ useHandCursor: true });
      zone.on('pointerdown', () => {
        this.activeTab = tab.id;
        this.render();
      });
      this.container?.add(zone);
    });
  }

  /** Карточка товара/услуги/навыка: тап (без скролла) покупает */
  private buildCard(
    content: Phaser.GameObjects.Container,
    x: number,
    y: number,
    w: number,
    h: number,
    option: ShopTabOption,
  ): void {
    const rarity = option.rarity ?? 'common';
    const accent = RARITY_ACCENTS[rarity];
    const disabled = option.disabled || option.soldOut;

    const card = this.scene.add.graphics();
    card.fillStyle(option.soldOut ? WINDOW.cardSoldOut : WINDOW.card, 1);
    card.fillRoundedRect(x - w / 2, y - h / 2, w, h, 12);
    card.lineStyle(2, option.soldOut ? 0x4a4a55 : accent, option.soldOut ? 0.4 : disabled ? 0.4 : 0.9);
    card.strokeRoundedRect(x - w / 2, y - h / 2, w, h, 12);
    // Тонкая мембрана внутри — карточка читается как вакуоль с товаром
    card.lineStyle(1, MARKET.vesicleHi, option.soldOut ? 0.08 : 0.16);
    card.strokeRoundedRect(x - w / 2 + 3, y - h / 2 + 3, w - 6, h - 6, 10);
    content.add(card);

    content.add(
      this.scene.add.text(x - w / 2 + 14, y - h / 2 + 10, option.title, {
        fontFamily: FONT,
        fontSize: '16px',
        fontStyle: 'bold',
        color: option.soldOut ? '#6b5762' : RARITY_COLORS[rarity],
        wordWrap: { width: w - 110 },
      }),
    );

    content.add(
      this.scene.add.text(x - w / 2 + 14, y - h / 2 + 34, option.desc, {
        fontFamily: FONT,
        fontSize: '12px',
        color: option.soldOut ? '#6b5762' : '#b9a6b0',
        wordWrap: { width: w - 100 },
        lineSpacing: 3,
      }),
    );

    // Стоимость справа (у распроданных слотов её нет)
    if (!option.soldOut) {
      content.add(
        this.scene.add
          .text(x + w / 2 - 12, y - h / 2 + 14, `G ${option.cost}`, {
            fontFamily: FONT,
            fontSize: '14px',
            fontStyle: 'bold',
            color: disabled ? '#9d8791' : '#ffd54f',
          })
          .setOrigin(1, 0),
      );
    }

    // Уровень прокачки навыка (для карточек улучшения)
    if (option.level !== undefined && option.maxLevel !== undefined) {
      content.add(
        this.scene.add
          .text(x + w / 2 - 12, y + h / 2 - 10, `УР. ${option.level}/${option.maxLevel}`, {
            fontFamily: FONT,
            fontSize: '11px',
            fontStyle: 'bold',
            color: '#9d8791',
          })
          .setOrigin(1, 1),
      );
    }

    if (disabled) {
      return;
    }

    const zone = this.scene.add
      .zone(x, y, w, h)
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true });
    zone.on('pointerup', (pointer: Phaser.Input.Pointer) => {
      // Скролл пальцем не должен считаться покупкой, тапы за маской игнорируем
      if (
        this.scroll &&
        this.scroll.isInside(pointer.x, pointer.y) &&
        this.scroll.movedAtLastPointerUp < 12
      ) {
        this.onSelect(option.id);
      }
    });
    content.add(zone);
  }

  private buildCloseButton(x: number, y: number, w: number, label: string): void {
    const container = this.container;
    if (!container) {
      return;
    }
    const h = 46;

    const bg = this.scene.add.graphics();
    bg.fillStyle(WINDOW.button, 1);
    bg.fillRoundedRect(x - w / 2, y - h / 2, w, h, 12);
    bg.lineStyle(1.5, MARKET.membrane, 0.35);
    bg.strokeRoundedRect(x - w / 2, y - h / 2, w, h, 12);
    container.add(bg);

    container.add(
      this.scene.add
        .text(x, y, label, {
          fontFamily: FONT,
          fontSize: '17px',
          fontStyle: 'bold',
          color: '#e8e8f0',
        })
        .setOrigin(0.5),
    );

    const zone = this.scene.add
      .zone(x, y, w, h)
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true });
    zone.on('pointerdown', () => this.close());
    container.add(zone);
  }
}
