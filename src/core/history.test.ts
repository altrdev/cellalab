import { describe, expect, it } from 'vitest';
import { createHistory } from './history';

describe('createHistory', () => {
  it('undo and redo restore the states', () => {
    const h = createHistory(0);
    h.commit((n) => n + 1);
    h.commit((n) => n + 1);
    expect(h.get().present).toBe(2);
    h.undo();
    expect(h.get().present).toBe(1);
    expect(h.get().canRedo).toBe(true);
    h.redo();
    expect(h.get().present).toBe(2);
    expect(h.get().canRedo).toBe(false);
  });

  it('a commit after an undo clears the redo', () => {
    const h = createHistory(0);
    h.commit((n) => n + 1);
    h.undo();
    h.commit((n) => n + 10);
    expect(h.get().canRedo).toBe(false);
    expect(h.get().present).toBe(10);
  });

  it('ignores commits that do not change the state', () => {
    const h = createHistory({ a: 1 });
    h.commit((s) => s);
    expect(h.get().canUndo).toBe(false);
  });

  it('merges commits with the same coalesceKey into a single undo', () => {
    const h = createHistory(0);
    h.commit((n) => n + 1, { coalesceKey: 'drag' });
    h.commit((n) => n + 1, { coalesceKey: 'drag' });
    h.commit((n) => n + 1, { coalesceKey: 'drag' });
    expect(h.get().present).toBe(3);
    h.undo();
    expect(h.get().present).toBe(0);
    expect(h.get().canUndo).toBe(false);
  });

  it('different keys do not merge', () => {
    const h = createHistory(0);
    h.commit((n) => n + 1, { coalesceKey: 'a' });
    h.commit((n) => n + 1, { coalesceKey: 'b' });
    h.undo();
    expect(h.get().present).toBe(1);
  });

  it('respects the history limit', () => {
    const h = createHistory(0, 3);
    for (let i = 0; i < 10; i++) h.commit((n) => n + 1);
    for (let i = 0; i < 10; i++) h.undo();
    expect(h.get().present).toBe(7);
  });

  it('subscribe notifies immediately and at every change, unsubscribe stops', () => {
    const h = createHistory(0);
    const seen: number[] = [];
    const off = h.subscribe((v) => seen.push(v.present));
    h.commit((n) => n + 1);
    off();
    h.commit((n) => n + 1);
    expect(seen).toEqual([0, 1]);
  });

  it('reset clears the history', () => {
    const h = createHistory(0);
    h.commit((n) => n + 1);
    h.reset(42);
    expect(h.get()).toEqual({ present: 42, canUndo: false, canRedo: false });
  });
});
