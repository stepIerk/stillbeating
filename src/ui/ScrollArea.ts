import Phaser from 'phaser';

/**
 * Вертикально прокручиваемая область (drag пальцем + колесо мыши).
 * Контент добавляется в content, маска обрезает его по прямоугольнику области.
 * movedAtLastPointerUp — насколько далеко протянули с последнего pointerdown:
 * так карточки отличают тап от скролла.
 *
 * Phaser 4 в WebGL не поддерживает геометрические маски (GeometryMask),
 * поэтому область обрезается фильтром-маской Phaser.Actions.AddMaskShape.
 */
export default class ScrollArea {
  /** Контейнер, который нужно добавить в родителя (не двигается, держит маску) */
  readonly content: Phaser.GameObjects.Container;
  /** Внутренний контейнер с элементами: смещается при прокрутке */
  readonly body: Phaser.GameObjects.Container;

  private scene: Phaser.Scene;
  private rect: Phaser.Geom.Rectangle;
  private maskFilter?: Phaser.Filters.Mask;
  private offset = 0;
  private totalHeight = 0;
  private dragging = false;
  private dragPointerId = -1;
  private lastY = 0;
  private moved = 0;
  private enabled = true;

  constructor(scene: Phaser.Scene, x: number, y: number, width: number, height: number) {
    this.scene = scene;
    this.rect = new Phaser.Geom.Rectangle(x, y, width, height);
    this.content = scene.add.container(0, 0);
    this.body = scene.add.container(0, 0);
    this.content.add(this.body);

    try {
      const masks = Phaser.Actions.AddMaskShape(this.content, {
        shape: 'rectangle',
        region: new Phaser.Geom.Rectangle(x, y, width, height),
        useInternal: true,
      });
      this.maskFilter = masks[0];
    } catch (error) {
      // Маска не критична: без неё контент просто может вылезать за границы
      console.warn('ScrollArea: не удалось создать маску прокрутки', error);
    }

    scene.input.on('pointerdown', this.handlePointerDown, this);
    scene.input.on('pointermove', this.handlePointerMove, this);
    scene.input.on('pointerup', this.handlePointerUp, this);
    scene.input.on('pointerupoutside', this.handlePointerUp, this);
    scene.input.on('wheel', this.handleWheel, this);
    scene.events.once('shutdown', this.destroy, this);
  }

  /** Общая высота контента (для клампа прокрутки) */
  setTotalHeight(total: number): void {
    this.totalHeight = total;
    this.clampOffset();
    this.applyOffset();
  }

  /** Прокручивали ли контент с последнего нажатия (порог для тапов по карточкам) */
  get movedAtLastPointerUp(): number {
    return this.moved;
  }

  /** Точка внутри видимой области (объекты за маской должны игнорировать тапы) */
  isInside(x: number, y: number): boolean {
    return this.inside(x, y);
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  private get maxOffset(): number {
    return Math.min(0, this.rect.height - this.totalHeight);
  }

  private clampOffset(): void {
    this.offset = Phaser.Math.Clamp(this.offset, this.maxOffset, 0);
  }

  private applyOffset(): void {
    // content и body стоят в (0,0): элементы позиционируются в абсолютных
    // координатах сцены, прокрутка сдвигает их контейнер по вертикали
    this.body.y = this.offset;
  }

  private inside(x: number, y: number): boolean {
    return Phaser.Geom.Rectangle.Contains(this.rect, x, y);
  }

  private handlePointerDown(pointer: Phaser.Input.Pointer): void {
    if (this.enabled && this.inside(pointer.x, pointer.y)) {
      this.beginDrag(pointer);
    }
  }

  private handlePointerMove(pointer: Phaser.Input.Pointer): void {
    if (!this.enabled || !this.dragging || pointer.id !== this.dragPointerId) {
      return;
    }
    const dy = pointer.y - this.lastY;
    this.lastY = pointer.y;
    this.moved += Math.abs(dy);
    this.offset += dy;
    this.clampOffset();
    this.applyOffset();
  }

  private handlePointerUp(pointer: Phaser.Input.Pointer): void {
    if (pointer.id === this.dragPointerId) {
      this.dragging = false;
      this.dragPointerId = -1;
    }
  }

  private handleWheel(
    pointer: Phaser.Input.Pointer,
    _over: unknown,
    _dx: number,
    dy: number,
  ): void {
    if (!this.enabled || !this.inside(pointer.x, pointer.y)) {
      return;
    }
    this.offset -= dy;
    this.clampOffset();
    this.applyOffset();
  }

  /** Вызывается карточками/вкладками при pointerdown: запоминаем старт скролла */
  beginDrag(pointer: Phaser.Input.Pointer): void {
    this.dragging = true;
    this.dragPointerId = pointer.id;
    this.lastY = pointer.y;
    this.moved = 0;
  }

  destroy(): void {
    this.scene.input.off('pointerdown', this.handlePointerDown, this);
    this.scene.input.off('pointermove', this.handlePointerMove, this);
    this.scene.input.off('pointerup', this.handlePointerUp, this);
    this.scene.input.off('pointerupoutside', this.handlePointerUp, this);
    this.scene.input.off('wheel', this.handleWheel, this);
    this.maskFilter?.destroy();
    this.maskFilter = undefined;
    this.content.destroy(true);
  }
}