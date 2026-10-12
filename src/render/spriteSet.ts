// Which player art the pitch uses: the hand-drawn Aseprite sheet (art/sheet,
// the default on this branch), the typed 16x24 templates (`classic`, what
// shipped before) or the generated frames (art/frames, still being made).
// `?sprites=sheet|generated|classic` picks and remembers the choice under
// localStorage, so a browser that stored `classic` earlier keeps it until it
// visits `?sprites=sheet` once.

export type SpriteSet = 'sheet' | 'generated' | 'classic';

const KEY = 'flicksoccer.sprites';
let current: SpriteSet | null = null;

export function spriteSet(): SpriteSet {
  if (current) return current;
  let v: string | null = null;
  try {
    v = new URLSearchParams(location.search).get('sprites');
    if (v === 'classic' || v === 'generated' || v === 'sheet') localStorage.setItem(KEY, v);
    else v = localStorage.getItem(KEY);
  } catch {
    /* no storage */
  }
  current = v === 'generated' || v === 'classic' ? v : 'sheet';
  return current;
}
