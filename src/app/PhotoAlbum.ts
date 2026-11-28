import type { Slot } from './SaveService';

/**
 * Photo mode's album (#photo-2, the owner's rules of 28 Nov 2026): a picture is kept only when the player says so
 * after seeing it. The album holds up to `best` pictures at good quality (the player's twelve: once they are full, a
 * new one takes the place of one the player picks); every other kept picture is shrunk and compressed (a small
 * copy), and so is a picture that gives up its place among the twelve. The small copies are capped too: the
 * oldest goes when a new one arrives over the cap.
 *
 * Pictures live in IndexedDB beside the save, one album per save slot (they are far too big for the save's own
 * storage, and the autosave never touches them). Nothing here reaches the game: the album is presentation only.
 */
export const ALBUM = {
  /** good-quality pictures (the player chooses which to replace once they are full) */
  best: 12,
  /** a good picture's longest side in pixels, and its JPEG quality */
  bestSide: 1920,
  bestQuality: 0.9,
  /** small copies: how many, their longest side, and their JPEG quality */
  small: 48,
  smallSide: 640,
  smallQuality: 0.72,
};

/** One kept picture. `best`: one of the good-quality twelve; otherwise a small copy. */
export interface AlbumPhoto {
  id: string;
  /** when it was taken (ms since 1970): the album's order, newest first */
  at: number;
  best: boolean;
  w: number;
  h: number;
  blob: Blob;
}

/** A picture as encoded for the album. */
export interface Encoded {
  blob: Blob;
  w: number;
  h: number;
}

/** A picture just taken, not yet kept: `encode` draws it no bigger than `side` along its longest side, as a JPEG. */
export interface Shot {
  encode(side: number, quality: number): Promise<Encoded>;
}

/** Where the album's pictures are stored (IndexedDB in the game, memory in tests). */
export interface AlbumStore {
  all(slot: Slot): Promise<AlbumPhoto[]>;
  put(slot: Slot, photo: AlbumPhoto): Promise<void>;
  remove(slot: Slot, id: string): Promise<void>;
  clear(slot: Slot): Promise<void>;
}

/** A size no longer than `side` along its longest side, in whole pixels, never enlarged. */
export function fitSide(w: number, h: number, side: number): { w: number; h: number } {
  const k = Math.min(1, side / Math.max(1, w, h));
  return { w: Math.max(1, Math.round(w * k)), h: Math.max(1, Math.round(h * k)) };
}

export class PhotoAlbum {
  private photos: AlbumPhoto[] = [];
  private urls = new Map<string, string>();
  private n = 0;
  /** called after every change (the Collection redraws) */
  onChange?: () => void;

  constructor(
    private store: AlbumStore,
    readonly slot: Slot,
    /** shrinks a kept picture to a small copy (a picture leaving the twelve) */
    private shrink: (blob: Blob, side: number, quality: number) => Promise<Encoded>,
    private now: () => number = Date.now,
  ) {}

  /** Reads the slot's pictures (once, as the game starts). A store that can't be read leaves the album empty. */
  async load(): Promise<void> {
    try {
      this.photos = (await this.store.all(this.slot)).filter((p) => p && typeof p.id === 'string' && p.blob).sort((a, b) => b.at - a.at);
    } catch {
      this.photos = [];
    }
    this.onChange?.();
  }

  /** The good-quality pictures, newest first (at most ALBUM.best). */
  get best(): readonly AlbumPhoto[] {
    return this.photos.filter((p) => p.best);
  }

  /** The small copies, newest first. */
  get others(): readonly AlbumPhoto[] {
    return this.photos.filter((p) => !p.best);
  }

  get count(): number {
    return this.photos.length;
  }

  /** The twelve are full: a new picture is kept as a small copy, or in place of one the player picks. */
  get full(): boolean {
    return this.best.length >= ALBUM.best;
  }

  find(id: string): AlbumPhoto | undefined {
    return this.photos.find((p) => p.id === id);
  }

  /** A URL an <img> can show (made once per picture, released when it leaves the album). */
  url(id: string): string {
    const p = this.find(id);
    if (!p || typeof URL === 'undefined' || !URL.createObjectURL) return '';
    let u = this.urls.get(id);
    if (!u) this.urls.set(id, (u = URL.createObjectURL(p.blob)));
    return u;
  }

  /**
   * Keeps a picture. With room among the twelve it is kept at good quality. With the twelve full it is kept as a
   * small copy, unless `replace` names one of the twelve: then it takes that place at good quality and the one it
   * replaces becomes a small copy. Over the cap, the oldest small copy goes. Undefined when it could not be stored
   * (the album is unchanged then).
   */
  async keep(shot: Shot, replace?: string): Promise<AlbumPhoto | undefined> {
    const out = replace !== undefined ? this.best.find((p) => p.id === replace) : undefined;
    const best = !this.full || !!out;
    try {
      const e = await shot.encode(best ? ALBUM.bestSide : ALBUM.smallSide, best ? ALBUM.bestQuality : ALBUM.smallQuality);
      const at = this.now();
      const photo: AlbumPhoto = { id: `${at.toString(36)}-${(this.n++).toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`, at, best, w: e.w, h: e.h, blob: e.blob };
      await this.store.put(this.slot, photo);
      this.photos = [photo, ...this.photos].sort((a, b) => b.at - a.at);
      if (out) await this.demote(out);
      await this.trim();
      this.onChange?.();
      return photo;
    } catch {
      return undefined;
    }
  }

  /** One of the twelve gives up its place: it stays in the album as a small copy (or as it is, if it can't be shrunk). */
  private async demote(p: AlbumPhoto) {
    let small: AlbumPhoto = { ...p, best: false };
    try {
      const e = await this.shrink(p.blob, ALBUM.smallSide, ALBUM.smallQuality);
      small = { ...small, w: e.w, h: e.h, blob: e.blob };
    } catch {
      /* kept at its own size: better than losing it */
    }
    await this.store.put(this.slot, small);
    this.release(p.id);
    this.photos = this.photos.map((q) => (q.id === p.id ? small : q));
  }

  /** Over the cap, the oldest small copies go. */
  private async trim() {
    const extra = this.others.slice(ALBUM.small);
    for (const p of extra) await this.drop(p.id);
  }

  private async drop(id: string) {
    await this.store.remove(this.slot, id);
    this.release(id);
    this.photos = this.photos.filter((p) => p.id !== id);
  }

  /** Takes a picture out of the album for good. False when it wasn't there or couldn't be removed. */
  async remove(id: string): Promise<boolean> {
    if (!this.find(id)) return false;
    try {
      await this.drop(id);
    } catch {
      return false;
    }
    this.onChange?.();
    return true;
  }

  private release(id: string) {
    const u = this.urls.get(id);
    if (u) URL.revokeObjectURL(u);
    this.urls.delete(id);
  }
}

/** An album store in memory (tests, and a browser without IndexedDB: pictures last for the session). */
export class MemoryAlbumStore implements AlbumStore {
  private slots = new Map<Slot, Map<string, AlbumPhoto>>();
  private of(slot: Slot) {
    let m = this.slots.get(slot);
    if (!m) this.slots.set(slot, (m = new Map()));
    return m;
  }
  async all(slot: Slot) {
    return [...this.of(slot).values()];
  }
  async put(slot: Slot, photo: AlbumPhoto) {
    this.of(slot).set(photo.id, photo);
  }
  async remove(slot: Slot, id: string) {
    this.of(slot).delete(id);
  }
  async clear(slot: Slot) {
    this.slots.delete(slot);
  }
}

const DB = 'solarbloom.photos';
const TABLE = 'photos';

/** The album in IndexedDB: one table, keyed by slot and picture id, indexed by slot. */
export class IdbAlbumStore implements AlbumStore {
  private db?: Promise<IDBDatabase>;

  private open(): Promise<IDBDatabase> {
    return (this.db ??= new Promise((resolve, reject) => {
      const r = indexedDB.open(DB, 1);
      r.onupgradeneeded = () => r.result.createObjectStore(TABLE, { keyPath: ['slot', 'id'] }).createIndex('slot', 'slot');
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
      r.onblocked = () => reject(new Error('The photo album is open elsewhere.'));
    }));
  }

  private async run<T>(mode: IDBTransactionMode, work: (t: IDBObjectStore) => IDBRequest<T> | void): Promise<T | undefined> {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(TABLE, mode);
      const req = work(tx.objectStore(TABLE));
      tx.oncomplete = () => resolve(req ? req.result : undefined);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  }

  async all(slot: Slot): Promise<AlbumPhoto[]> {
    const rows = (await this.run('readonly', (t) => t.index('slot').getAll(slot))) as (AlbumPhoto & { slot: Slot })[] | undefined;
    return (rows ?? []).map(({ id, at, best, w, h, blob }) => ({ id, at, best, w, h, blob }));
  }

  async put(slot: Slot, photo: AlbumPhoto) {
    await this.run('readwrite', (t) => t.put({ ...photo, slot }));
  }

  async remove(slot: Slot, id: string) {
    await this.run('readwrite', (t) => t.delete([slot, id]));
  }

  async clear(slot: Slot) {
    await this.run('readwrite', (t) => {
      const cursor = t.index('slot').openKeyCursor(IDBKeyRange.only(slot));
      cursor.onsuccess = () => {
        const c = cursor.result;
        if (!c) return;
        t.delete(c.primaryKey);
        c.continue();
      };
    });
  }
}

/** The album's store for this browser: IndexedDB, or memory where there is none. */
export function albumStore(): AlbumStore {
  return typeof indexedDB !== 'undefined' ? new IdbAlbumStore() : new MemoryAlbumStore();
}

/** Draws a picture no bigger than `side` along its longest side and encodes it as a JPEG. */
export function encodeJpeg(src: CanvasImageSource, sw: number, sh: number, side: number, quality: number): Promise<Encoded> {
  const { w, h } = fitSide(sw, sh, side);
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d');
  if (!g) return Promise.reject(new Error('The picture could not be drawn.'));
  g.imageSmoothingQuality = 'high';
  g.drawImage(src, 0, 0, w, h);
  return new Promise((resolve, reject) => c.toBlob((blob) => (blob ? resolve({ blob, w, h }) : reject(new Error('The picture could not be encoded.'))), 'image/jpeg', quality));
}

/** Shrinks a kept picture (the browser decodes it, then encodeJpeg draws it smaller). */
export async function shrinkBlob(blob: Blob, side: number, quality: number): Promise<Encoded> {
  const bmp = await createImageBitmap(blob);
  try {
    return await encodeJpeg(bmp, bmp.width, bmp.height, side, quality);
  } finally {
    bmp.close();
  }
}
