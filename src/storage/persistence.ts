export interface PersistenceAdapter {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

class InMemoryAdapter implements PersistenceAdapter {
  private readonly data = new Map<string, string>();

  getItem(key: string): string | null {
    return this.data.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.data.set(key, value);
  }

  removeItem(key: string): void {
    this.data.delete(key);
  }
}

class BrowserLocalStorageAdapter implements PersistenceAdapter {
  getItem(key: string): string | null {
    return window.localStorage.getItem(key);
  }

  setItem(key: string, value: string): void {
    window.localStorage.setItem(key, value);
  }

  removeItem(key: string): void {
    window.localStorage.removeItem(key);
  }
}

function resolveDefaultAdapter(): PersistenceAdapter {
  try {
    if (typeof window === "undefined" || !window.localStorage) {
      return new InMemoryAdapter();
    }
    const probeKey = "__bm_persist_probe__";
    window.localStorage.setItem(probeKey, "1");
    window.localStorage.removeItem(probeKey);
    return new BrowserLocalStorageAdapter();
  } catch {
    return new InMemoryAdapter();
  }
}

let activeAdapter: PersistenceAdapter = resolveDefaultAdapter();

export function setPersistenceAdapter(adapter: PersistenceAdapter): void {
  activeAdapter = adapter;
}

export function persistenceGetItem(key: string): string | null {
  try {
    return activeAdapter.getItem(key);
  } catch {
    return null;
  }
}

export function persistenceSetItem(key: string, value: string): void {
  try {
    activeAdapter.setItem(key, value);
  } catch {
    // best-effort persistence only
  }
}

export function persistenceRemoveItem(key: string): void {
  try {
    activeAdapter.removeItem(key);
  } catch {
    // best-effort persistence only
  }
}

export function persistenceGetJson<T>(key: string, fallback: T): T {
  try {
    const raw = persistenceGetItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function persistenceSetJson<T>(key: string, value: T): void {
  try {
    persistenceSetItem(key, JSON.stringify(value));
  } catch {
    // best-effort persistence only
  }
}
