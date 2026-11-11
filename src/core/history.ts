/**
 * Store con undo/redo. Lo stato è immutabile: ogni modifica è una funzione pura
 * `(stato) => nuovoStato`. Compatibile con il contratto degli store di Svelte
 * (`subscribe`), quindi in un componente si usa con `$history`.
 */

export interface HistoryView<T> {
  present: T;
  canUndo: boolean;
  canRedo: boolean;
}

export interface CommitOptions {
  /**
   * Commit consecutivi con la stessa chiave si fondono in un'unica voce di cronologia
   * (es. il trascinamento di una cella: un solo undo per tutto il gesto).
   */
  coalesceKey?: string;
}

export interface History<T> {
  subscribe(run: (view: HistoryView<T>) => void): () => void;
  get(): HistoryView<T>;
  commit(change: (state: T) => T, options?: CommitOptions): void;
  undo(): void;
  redo(): void;
  /** Sostituisce lo stato e azzera la cronologia (es. dopo aver caricato un file). */
  reset(state: T): void;
}

export function createHistory<T>(initial: T, limit = 200): History<T> {
  let past: T[] = [];
  let present = initial;
  let future: T[] = [];
  let lastKey: string | undefined;
  const subscribers = new Set<(view: HistoryView<T>) => void>();

  const view = (): HistoryView<T> => ({
    present,
    canUndo: past.length > 0,
    canRedo: future.length > 0,
  });

  const emit = () => {
    const v = view();
    for (const run of subscribers) run(v);
  };

  return {
    subscribe(run) {
      subscribers.add(run);
      run(view());
      return () => {
        subscribers.delete(run);
      };
    },
    get: view,
    commit(change, options) {
      const next = change(present);
      if (Object.is(next, present)) return; // nessun cambiamento, nessuna voce di cronologia
      const key = options?.coalesceKey;
      if (key !== undefined && key === lastKey && past.length > 0) {
        present = next; // fonde col commit precedente
      } else {
        past.push(present);
        if (past.length > limit) past = past.slice(past.length - limit);
        present = next;
      }
      future = [];
      lastKey = key;
      emit();
    },
    undo() {
      const previous = past.pop();
      if (previous === undefined) return;
      future.push(present);
      present = previous;
      lastKey = undefined;
      emit();
    },
    redo() {
      const next = future.pop();
      if (next === undefined) return;
      past.push(present);
      present = next;
      lastKey = undefined;
      emit();
    },
    reset(state) {
      past = [];
      future = [];
      present = state;
      lastKey = undefined;
      emit();
    },
  };
}
