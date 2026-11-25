export interface InputHandlers {
  hover(x: number, y: number): void;
  leave(): void;
  click(x: number, y: number, button: number): void;
  /** A world gesture that needs both ends of a mouse press. True consumes the normal click. */
  press?(button: number): boolean;
  release?(button: number): void;
  cancelPress?(): void;
  /** a drag moved by dx, dy; the pointer (or pinch centre) is now at x, y */
  pan(dx: number, dy: number, x: number, y: number): void;
  /** zoom by a factor toward a screen point (the wheel cursor or pinch centre) */
  zoom(factor: number, x?: number, y?: number): void;
  /** A two-finger pinch finished: its overall zoom factor (spread end / start) and how long it took. */
  pinchEnd?(factor: number, ms: number): void;
  /** A drag with `button` held moved by dx, dy pixels (it turns and tilts the view). Return true if it was used (else it pans). */
  orbit?(dx: number, dy: number, button: number): boolean;
  /**
   * Third person: the mouse is captured (pointer lock) and moved by dx, dy pixels. While captured there is no
   * cursor: moves only turn the view and a press is a click at once (no drags, no hover).
   */
  look?(dx: number, dy: number): void;
  /** A press on the canvas while the mouse is free. Return true to swallow it (it captured the mouse). */
  capture?(button: number): boolean;
  /**
   * Desktop "hold to look": a press with `button` on the free mouse. Return true to capture the mouse only while that
   * button is held (the view turns with it); the cursor comes back, where it was, the moment it is let go.
   */
  holdLook?(button: number): boolean;
  /** The held look button was let go (the mouse is free again). */
  holdLookEnd?(): void;
}

/**
 * Pointer/touch input on the canvas only — HUD elements sit above it and never reach here,
 * so UI clicks can never spend resources in the world.
 */
export class InputController {
  private pointers = new Map<number, { x: number; y: number; sx: number; sy: number }>();
  private dragging = false;
  /** the mouse button the current press began with */
  private downButton = 0;
  private pinchDist = 0;
  /** spread and time when the current pinch began */
  private pinchStart?: { d: number; at: number };
  private suppressClick = false;
  private claimedMouse = new Set<number>();
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
    // Captured, a mouse button acts the moment it goes down (every button, also pressed together with another).
    el.addEventListener('mousedown', (e) => {
      if (!this.locked || e.button === this.holdButton) return;
      if (this.h.press?.(e.button)) this.claimedMouse.add(e.button);
      else this.h.click(this.el.clientWidth / 2, this.el.clientHeight / 2, e.button);
    });
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    // Hold to look: letting go of the held button frees the mouse (mouseup reaches the locked canvas, and the window
    // in case the lock was already lost)
    const release = (e: MouseEvent) => {
      if (this.claimedMouse.delete(e.button)) this.h.release?.(e.button);
      if (this.holdButton === undefined || e.button !== this.holdButton) return;
      this.holdButton = undefined;
      if (this.locked) document.exitPointerLock?.();
      this.h.holdLookEnd?.();
    };
    window.addEventListener('mouseup', release);
    // the lock was lost some other way (Esc, the window lost focus): the hold is over
    document.addEventListener('pointerlockchange', () => {
      if (!this.locked && this.claimedMouse.size) this.cancelClaim();
      if (!this.locked && this.holdButton !== undefined) {
        this.holdButton = undefined;
        this.h.holdLookEnd?.();
      }
    });
    window.addEventListener('blur', this.cancelClaim);
  }

  private local(e: PointerEvent | WheelEvent) {
    const r = this.el.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  /** Is the mouse captured by the canvas (pointer lock)? */
  get locked(): boolean {
    return typeof document !== 'undefined' && document.pointerLockElement === this.el;
  }

  /** a press that captured the mouse: its release does nothing */
  private swallowUp = false;
  /** the button held to look (hold-to-look mode), while it is held */
  private holdButton?: number;

  private down = (e: PointerEvent) => {
    if (e.pointerType === 'mouse' && this.locked) return; // captured: the press acted already (mousedown)
    if (e.pointerType === 'mouse' && this.h.holdLook?.(e.button)) {
      this.holdButton = e.button;
      this.swallowUp = true;
      return;
    }
    if (e.pointerType === 'mouse' && this.h.capture?.(e.button)) {
      this.swallowUp = true;
      return;
    }
    if (e.pointerType === 'mouse' && this.h.press?.(e.button)) {
      this.claimedMouse.add(e.button);
      return;
    }
    const p = this.local(e);
    try {
      this.el.setPointerCapture?.(e.pointerId);
    } catch {
      // not an active pointer (e.g. synthetic events): input still works without capture
    }
    this.pointers.set(e.pointerId, { x: p.x, y: p.y, sx: p.x, sy: p.y });
    if (this.pointers.size === 1) {
      this.dragging = e.button === 1 || e.button === 2;
      this.downButton = e.button;
      this.suppressClick = this.dragging;
    } else {
      this.suppressClick = true;
      this.pinchDist = this.spread();
      if (this.pointers.size === 2) this.pinchStart = { d: this.pinchDist, at: performance.now() };
    }
  };

  private spread() {
    const ps = [...this.pointers.values()];
    if (ps.length < 2) return 0;
    return Math.hypot(ps[0].x - ps[1].x, ps[0].y - ps[1].y);
  }

  private move = (e: PointerEvent) => {
    if (e.pointerType === 'mouse' && this.locked) {
      if (e.movementX || e.movementY) this.h.look?.(e.movementX, e.movementY);
      return;
    }
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
      const ps = [...this.pointers.values()];
      const cx = (ps[0].x + ps[1].x) / 2;
      const cy = (ps[0].y + ps[1].y) / 2;
      const d = this.spread();
      if (this.pinchDist > 0 && d > 0) this.h.zoom(d / this.pinchDist, cx, cy);
      this.pinchDist = d;
      this.h.pan(dx / 2, dy / 2, cx, cy);
      return;
    }
    if (!this.dragging && Math.hypot(p.x - ptr.sx, p.y - ptr.sy) > InputController.DRAG_PX) {
      this.dragging = true;
      this.suppressClick = true;
    }
    if (this.dragging) {
      if (!(e.pointerType === 'mouse' && this.h.orbit?.(dx, dy, this.downButton))) this.h.pan(dx, dy, p.x, p.y);
    } else if (e.pointerType === 'mouse') this.h.hover(p.x, p.y);
  };

  private up = (e: PointerEvent) => {
    if (e.pointerType === 'mouse' && (this.locked || this.swallowUp)) {
      this.swallowUp = false;
      this.pointers.delete(e.pointerId);
      return;
    }
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
      // A pinch just ended (two fingers → one): report the whole gesture.
      if (this.pinchStart && this.pointers.size === 1) {
        const lastSpread = this.pinchDist;
        if (this.pinchStart.d > 0 && lastSpread > 0) this.h.pinchEnd?.(lastSpread / this.pinchStart.d, performance.now() - this.pinchStart.at);
        this.pinchStart = undefined;
      }
      this.pinchDist = this.spread();
    }
  };

  private cancel = (e: PointerEvent) => {
    if (e.pointerType === 'mouse' && this.claimedMouse.size) this.cancelClaim();
    this.pointers.delete(e.pointerId);
    if (!this.pointers.size) {
      this.dragging = false;
      this.suppressClick = false;
    }
  };

  private cancelClaim = () => {
    this.claimedMouse.clear();
    this.h.cancelPress?.();
  };

  private wheel = (e: WheelEvent) => {
    e.preventDefault();
    const p = this.local(e);
    this.h.zoom(Math.exp(-e.deltaY * 0.0015), p.x, p.y);
  };
}
