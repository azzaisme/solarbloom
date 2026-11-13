export interface InputHandlers {
  hover(x: number, y: number): void;
  leave(): void;
  click(x: number, y: number, button: number): void;
  pan(dx: number, dy: number): void;
  zoom(factor: number): void;
}

/**
 * Pointer/touch input on the canvas only — HUD elements sit above it and never reach here,
 * so UI clicks can never spend resources in the world.
 */
export class InputController {
  private pointers = new Map<number, { x: number; y: number; sx: number; sy: number }>();
  private dragging = false;
  private pinchDist = 0;
  private suppressClick = false;
  static DRAG_PX = 7;

  constructor(
    private el: HTMLElement,
    private h: InputHandlers,
  ) {
    el.addEventListener('pointerdown', this.down);
    el.addEventListener('pointermove', this.move);
    el.addEventListener('pointerup', this.up);
    el.addEventListener('pointercancel', this.cancel);
    el.addEventListener('pointerleave', () => {
      if (!this.pointers.size) this.h.leave();
    });
    el.addEventListener('wheel', this.wheel, { passive: false });
    el.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  private local(e: PointerEvent | WheelEvent) {
    const r = this.el.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  private down = (e: PointerEvent) => {
    const p = this.local(e);
    this.el.setPointerCapture?.(e.pointerId);
    this.pointers.set(e.pointerId, { x: p.x, y: p.y, sx: p.x, sy: p.y });
    if (this.pointers.size === 1) {
      this.dragging = e.button === 1 || e.button === 2;
      this.suppressClick = this.dragging;
    } else {
      this.suppressClick = true;
      this.pinchDist = this.spread();
    }
  };

  private spread() {
    const ps = [...this.pointers.values()];
    if (ps.length < 2) return 0;
    return Math.hypot(ps[0].x - ps[1].x, ps[0].y - ps[1].y);
  }

  private move = (e: PointerEvent) => {
    const p = this.local(e);
    const ptr = this.pointers.get(e.pointerId);
    if (!ptr) {
      if (e.pointerType === 'mouse') this.h.hover(p.x, p.y);
      return;
    }
    const dx = p.x - ptr.x;
    const dy = p.y - ptr.y;
    ptr.x = p.x;
    ptr.y = p.y;
    if (this.pointers.size >= 2) {
      const d = this.spread();
      if (this.pinchDist > 0 && d > 0) this.h.zoom(d / this.pinchDist);
      this.pinchDist = d;
      this.h.pan(dx / 2, dy / 2);
      return;
    }
    if (!this.dragging && Math.hypot(p.x - ptr.sx, p.y - ptr.sy) > InputController.DRAG_PX) {
      this.dragging = true;
      this.suppressClick = true;
    }
    if (this.dragging) this.h.pan(dx, dy);
    else if (e.pointerType === 'mouse') this.h.hover(p.x, p.y);
  };

  private up = (e: PointerEvent) => {
    const p = this.local(e);
    const had = this.pointers.has(e.pointerId);
    this.pointers.delete(e.pointerId);
    if (!had) return;
    if (this.pointers.size === 0) {
      if (!this.suppressClick && !this.dragging) {
        if (e.pointerType !== 'mouse') this.h.hover(p.x, p.y);
        this.h.click(p.x, p.y, e.button);
      }
      this.dragging = false;
      this.suppressClick = false;
      if (e.pointerType !== 'mouse') this.h.leave();
    } else {
      this.pinchDist = this.spread();
    }
  };

  private cancel = (e: PointerEvent) => {
    this.pointers.delete(e.pointerId);
    if (!this.pointers.size) {
      this.dragging = false;
      this.suppressClick = false;
    }
  };

  private wheel = (e: WheelEvent) => {
    e.preventDefault();
    this.h.zoom(Math.exp(-e.deltaY * 0.0015));
  };
}
