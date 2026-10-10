// Which player art the pitch uses: the typed 16x24 templates (the default,
// what ships) or the imported frames (art/frames), which are still being
// generated and are only for testing. `?sprites=generated|classic` picks and
// remembers; a stored choice is cleared again by `?sprites=classic`.

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
  current = v === 'generated' ? 'generated' : 'classic';
  return current;
}
