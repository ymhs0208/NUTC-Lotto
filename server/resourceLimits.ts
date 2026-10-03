import { ApiError } from './errors';

export class ResourceBusyError extends ApiError {
  readonly retryAfter = 2;
  constructor() { super(503, '服務忙碌，請稍後再試。'); }
}

/** Bound actual work and queued closures; expire waiters without running them. */
export class BoundedExecutor {
  private active = 0;
  private waiting: Array<{ start: () => void; timer: ReturnType<typeof setTimeout> }> = [];
  constructor(private concurrency: number, private maxWaiting: number, private waitMs: number) {}
  private acquire(): Promise<void> {
    if (this.active < this.concurrency) { this.active++; return Promise.resolve(); }
    if (this.waiting.length >= this.maxWaiting) return Promise.reject(new ResourceBusyError());
    return new Promise((resolve, reject) => {
      const entry = {
        start: () => { clearTimeout(entry.timer); this.active++; resolve(); },
        timer: setTimeout(() => {
          const index = this.waiting.indexOf(entry);
          if (index >= 0) { this.waiting.splice(index, 1); reject(new ResourceBusyError()); }
        }, this.waitMs),
      };
      this.waiting.push(entry);
    });
  }
  async run<T>(work: () => Promise<T>): Promise<T> {
    await this.acquire();
    try { return await work(); }
    finally { this.active--; this.waiting.shift()?.start(); }
  }
}

/** Per-process/isolate TTL cache, coalescing misses; invalidation cannot revive stale work. */
export class ShortCache<T> {
  private entries = new Map<string, { expires: number; promise: Promise<T> }>();
  constructor(private ttlMs: number) {}
  get(key: string, load: () => Promise<T>): Promise<T> {
    const cached = this.entries.get(key);
    if (cached && cached.expires > Date.now()) return cached.promise;
    if (this.entries.size >= 32) this.entries.delete(this.entries.keys().next().value!);
    const entry = { expires: Infinity, promise: Promise.resolve().then(load) };
    this.entries.set(key, entry);
    entry.promise = entry.promise.then(value => { entry.expires = Date.now() + this.ttlMs; return value; }, error => {
      if (this.entries.get(key) === entry) this.entries.delete(key);
      throw error;
    });
    return entry.promise;
  }
  invalidate(key: string): void { this.entries.delete(key); }
}
