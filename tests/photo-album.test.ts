import { describe, expect, it } from 'vitest';
import { ALBUM, type AlbumPhoto, fitSide, MemoryAlbumStore, PhotoAlbum, type Shot } from '../src/app/PhotoAlbum';

// #photo-2: what pictures are kept (the owner's rules, 28 Nov 2026): the player saves or dismisses each picture
// after seeing it; twelve are kept at good quality, and the player chooses which one a new picture replaces once
// they are full; every other kept picture is shrunk and compressed.

/** a picture whose "pixels" record the side and quality it was encoded at */
const shot = (w = 2560, h = 1440): Shot & { asked: [number, number][] } => {
  const asked: [number, number][] = [];
  return {
    asked,
    encode: async (side, quality) => {
      asked.push([side, quality]);
      return { blob: { size: side, quality } as unknown as Blob, ...fitSide(w, h, side) };
    },
  };
};
const shrink = async (blob: Blob, side: number, quality: number) => ({ blob: { size: side, quality, from: blob } as unknown as Blob, ...fitSide(1920, 1080, side) });

function setup() {
  const store = new MemoryAlbumStore();
  let t = 1000;
  const album = new PhotoAlbum(store, 1, shrink, () => t++);
  return { store, album };
}
const side = (p: AlbumPhoto) => (p.blob as unknown as { size: number }).size;

describe('#photo-2: the photo album', () => {
  it('the first twelve are kept at good quality, newest first', async () => {
    const { album } = setup();
    const s = shot();
    const p = await album.keep(s);
    expect(s.asked).toEqual([[ALBUM.bestSide, ALBUM.bestQuality]]);
    expect(p).toMatchObject({ best: true, w: 1920, h: 1080 });
    for (let i = 1; i < ALBUM.best; i++) await album.keep(shot());
    expect([album.best.length, album.others.length, album.full]).toEqual([12, 0, true]);
    expect(album.best.map((q) => q.at)).toEqual([...album.best.map((q) => q.at)].sort((a, b) => b - a));
    expect(album.best.at(-1)?.id).toBe(p?.id); // the first taken is the oldest
  });

  it('with the twelve full, a picture is kept shrunk and compressed, and the twelve are untouched', async () => {
    const { album } = setup();
    for (let i = 0; i < ALBUM.best; i++) await album.keep(shot());
    const twelve = album.best.map((p) => p.id);
    const s = shot();
    const p = await album.keep(s);
    expect(s.asked).toEqual([[ALBUM.smallSide, ALBUM.smallQuality]]);
    expect(p).toMatchObject({ best: false, w: 640, h: 360 });
    expect(album.best.map((q) => q.id)).toEqual(twelve);
    expect(album.others.map((q) => q.id)).toEqual([p?.id]);
  });

  it('the player picks which of the twelve a new picture replaces: it takes that place, and the old one stays as a small copy', async () => {
    const { album, store } = setup();
    for (let i = 0; i < ALBUM.best; i++) await album.keep(shot());
    const out = album.best[5];
    const s = shot();
    const p = await album.keep(s, out.id);
    expect(s.asked).toEqual([[ALBUM.bestSide, ALBUM.bestQuality]]);
    expect(p?.best).toBe(true);
    expect(album.best.length).toBe(12);
    expect(album.best.some((q) => q.id === out.id)).toBe(false);
    const kept = album.find(out.id)!;
    expect([kept.best, side(kept), kept.w, kept.h, kept.at]).toEqual([false, ALBUM.smallSide, 640, 360, out.at]); // shrunk, and still when it was taken
    // and the store holds the same thing the album shows
    const stored = await store.all(1);
    expect(stored.length).toBe(13);
    expect(stored.find((q) => q.id === out.id)).toMatchObject({ best: false, w: 640 });
  });

  it('a pick that is not one of the twelve replaces nothing: the picture is kept as a small copy', async () => {
    const { album } = setup();
    for (let i = 0; i < ALBUM.best; i++) await album.keep(shot());
    const small = await album.keep(shot());
    const p = await album.keep(shot(), small!.id);
    expect(p?.best).toBe(false);
    expect([album.best.length, album.others.length]).toEqual([12, 2]);
    expect((await album.keep(shot(), 'nothing'))?.best).toBe(false);
  });

  it('the small copies are capped: over the cap the oldest goes, and never one of the twelve', async () => {
    const { album, store } = setup();
    for (let i = 0; i < ALBUM.best; i++) await album.keep(shot());
    const twelve = album.best.map((p) => p.id);
    const first = await album.keep(shot());
    for (let i = 1; i < ALBUM.small + 3; i++) await album.keep(shot());
    expect([album.best.length, album.others.length]).toEqual([12, ALBUM.small]);
    expect(album.find(first!.id)).toBeUndefined();
    expect(album.best.map((p) => p.id)).toEqual(twelve);
    expect((await store.all(1)).length).toBe(12 + ALBUM.small);
  });

  it('deleting one of the twelve makes room for the next picture at good quality', async () => {
    const { album } = setup();
    for (let i = 0; i < ALBUM.best; i++) await album.keep(shot());
    expect(await album.remove(album.best[0].id)).toBe(true);
    expect(await album.remove('nothing')).toBe(false);
    expect(album.full).toBe(false);
    expect((await album.keep(shot()))?.best).toBe(true);
  });

  it('a picture that cannot be encoded or stored leaves the album as it was', async () => {
    const { album, store } = setup();
    await album.keep(shot());
    expect(await album.keep({ encode: () => Promise.reject(new Error('no')) })).toBeUndefined();
    store.put = () => Promise.reject(new Error('full'));
    expect(await album.keep(shot())).toBeUndefined();
    expect(album.count).toBe(1);
  });

  it('each save slot has its own album, read back from the store; a deleted slot is empty', async () => {
    const { album, store } = setup();
    await album.keep(shot());
    await album.keep(shot());
    const other = new PhotoAlbum(store, 2, shrink);
    await other.load();
    expect(other.count).toBe(0);
    const again = new PhotoAlbum(store, 1, shrink);
    let changed = 0;
    again.onChange = () => changed++;
    await again.load();
    expect([again.count, changed]).toEqual([2, 1]);
    expect(again.best.map((p) => p.id)).toEqual(album.best.map((p) => p.id));
    await store.clear(1);
    await again.load();
    expect(again.count).toBe(0);
    // a store that can't be read is an empty album, not a crash
    store.all = () => Promise.reject(new Error('blocked'));
    await again.load();
    expect(again.count).toBe(0);
  });

  it('pictures are never enlarged, and keep their shape', () => {
    expect(fitSide(2560, 1440, 1920)).toEqual({ w: 1920, h: 1080 });
    expect(fitSide(1080, 1920, 640)).toEqual({ w: 360, h: 640 });
    expect(fitSide(800, 600, 1920)).toEqual({ w: 800, h: 600 });
    expect(fitSide(4096, 1, 640)).toEqual({ w: 640, h: 1 });
  });
});
