// Which player art the pitch uses: the imported frames (art/frames) or the
// typed 16x24 templates. `?sprites=classic|generated` picks and remembers.

export type SpriteSet = 'generated' | 'classic';

const KEY = 'flicksoccer.sprites';
let current: SpriteSet | null = null;

export function spriteSet(): SpriteSet {
  if (current) return current;
  let v: string | null = null;
  try {
    v = new URLSearchParams(location.search).get('sprites');
    if (v === 'classic' || v === 'generated') localStorage.setItem(KEY, v);
    else v = localStorage.getItem(KEY);
  } catch {
    /* no storage */
  }
  current = v === 'classic' ? 'classic' : 'generated';
  return current;
}
