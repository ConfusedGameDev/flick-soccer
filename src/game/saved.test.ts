import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { initialMatch } from '../engine/setup';
import { KITS } from '../render/kits';
import { SAVED_MATCH_KEY, clearSavedMatch, loadSavedMatch, saveMatch, savedMatchLabel, type SavedMatch } from './saved';

// The engine tests run in node: give the module a Map-backed localStorage.
function fakeStorage(): Storage {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, String(v)),
    removeItem: (k: string) => void map.delete(k),
    clear: () => map.clear(),
    key: (i: number) => [...map.keys()][i] ?? null,
    get length() {
      return map.size;
    },
  };
}

const snapshot = (): SavedMatch => ({
  v: 1,
  mode: 'cpu-normal',
  seed: 12345,
  state: { ...initialMatch('away'), turn: 4, score: { home: 1, away: 0 } },
  kits: { home: KITS[0], away: KITS[1] },
});

describe('saved match', () => {
  const g = globalThis as { localStorage?: Storage };
  let before: Storage | undefined;
  beforeEach(() => {
    before = g.localStorage;
    g.localStorage = fakeStorage();
  });
  afterEach(() => {
    if (before) g.localStorage = before;
    else delete g.localStorage;
  });

  it('round-trips a snapshot', () => {
    const s = snapshot();
    saveMatch(s);
    expect(loadSavedMatch()).toEqual(s);
  });

  it('keeps the attack plan and the run key', () => {
    const s: SavedMatch = {
      ...snapshot(),
      mode: 'run',
      attackPlan: { team: 'away', flicks: [{ playerId: 12, dir: { x: 0, y: -1 }, strength: 0.5 }] },
      run: { seed: 7, stage: 2 },
    };
    saveMatch(s);
    expect(loadSavedMatch()).toEqual(s);
  });

  it('is empty before any save and after clearing', () => {
    expect(loadSavedMatch()).toBeNull();
    saveMatch(snapshot());
    clearSavedMatch();
    expect(loadSavedMatch()).toBeNull();
  });

  it('rejects garbage, other versions, finished matches and run saves without a run', () => {
    localStorage.setItem(SAVED_MATCH_KEY, '{not json');
    expect(loadSavedMatch()).toBeNull();
    localStorage.setItem(SAVED_MATCH_KEY, JSON.stringify({ ...snapshot(), v: 2 }));
    expect(loadSavedMatch()).toBeNull();
    localStorage.setItem(SAVED_MATCH_KEY, JSON.stringify({ ...snapshot(), mode: 'online-create' }));
    expect(loadSavedMatch()).toBeNull();
    const done = snapshot();
    done.state.status = 'full-time';
    localStorage.setItem(SAVED_MATCH_KEY, JSON.stringify(done));
    expect(loadSavedMatch()).toBeNull();
    localStorage.setItem(SAVED_MATCH_KEY, JSON.stringify({ ...snapshot(), mode: 'run' }));
    expect(loadSavedMatch()).toBeNull();
  });

  it('survives a missing storage', () => {
    delete g.localStorage;
    expect(() => saveMatch(snapshot())).not.toThrow();
    expect(loadSavedMatch()).toBeNull();
    expect(() => clearSavedMatch()).not.toThrow();
  });

  it('labels the prompt with mode, clock and score', () => {
    expect(savedMatchLabel(snapshot())).toBe('vs CPU · normal: Half 1 · Turn 4, Home 1 – 0 Away.');
  });
});
