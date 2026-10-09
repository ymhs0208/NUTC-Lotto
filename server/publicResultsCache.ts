import type { DomainConfig, PublicDrawResult, PublicResultsResponse } from '../src/types';
import { sortDomainConfigs } from '../src/lib/domainCodes';
import { ShortCache } from './resourceLimits';
import { ApiError } from './errors';

export interface PublicMetadata { version: number; domain_configs: DomainConfig[] }
export interface PublicSnapshot extends PublicMetadata { results: PublicDrawResult[] | null }
const changed = Symbol('public version changed');

export class PublicResultsCache {
  // Metadata is shared only while a read is in flight; every later request checks
  // the committed DB version, including requests handled by other isolates.
  private metadata = new ShortCache<PublicMetadata>(0);
  private results: ShortCache<PublicResultsResponse>;
  private snapshots = new Map<string, { expires: number; response: PublicResultsResponse }>();
  private snapshotFlights = new ShortCache<PublicResultsResponse>(0);
  private epochs = new Map<string, number>();
  constructor(private ttlMs = 5000) { this.results = new ShortCache(ttlMs); }

  invalidate(database: string) {
    this.metadata.invalidate(database);
    this.results.invalidatePrefix(`${JSON.stringify(database)}:`);
    const prefix = `${JSON.stringify(database)}:`;
    for (const key of this.snapshots.keys()) if (key.startsWith(prefix)) this.snapshots.delete(key);
    this.snapshotFlights.invalidatePrefix(prefix);
    this.epochs.set(database, (this.epochs.get(database) || 0) + 1);
  }

  async getSnapshot(database: string, field: string, read: (knownVersion: number | null) => Promise<PublicSnapshot>): Promise<PublicResultsResponse> {
    const key = `${JSON.stringify(database)}:${JSON.stringify(field)}`;
    return this.snapshotFlights.get(key, async () => {
      const epoch = this.epochs.get(database) || 0;
      const entry = this.snapshots.get(key);
      const cached = entry && entry.expires > Date.now() ? entry.response : undefined;
      const snapshot = await read(cached?.version ?? null);
      if (snapshot.results === null && (!cached || cached.version !== snapshot.version)) throw new ApiError(503, '抽籤結果暫時無法讀取。');
      const response: PublicResultsResponse = {
        version: snapshot.version,
        domains: sortDomainConfigs(snapshot.domain_configs).map(config => config.field),
        results: snapshot.results === null ? cached!.results : snapshot.results.map(row => ({ ...row, leader_name: row.leader_name?.trim() || '' })),
      };
      if ((this.epochs.get(database) || 0) === epoch) {
        if (this.snapshots.size >= 32) this.snapshots.delete(this.snapshots.keys().next().value!);
        this.snapshots.set(key, { expires: Date.now() + this.ttlMs, response });
      }
      return response;
    });
  }

  async get(database: string, field: string, readMetadata: () => Promise<PublicMetadata>, readResults: () => Promise<PublicDrawResult[]>): Promise<PublicResultsResponse> {
    const metadata = () => this.metadata.get(database, readMetadata);
    for (let attempt = 0; attempt < 3; attempt++) {
      const before = await metadata();
      const key = `${JSON.stringify(database)}:${before.version}:${JSON.stringify(field)}`;
      try {
        return await this.results.get(key, async () => {
          const results = field ? await readResults() : [];
          const after = field ? await metadata() : before;
          if (after.version !== before.version) throw changed;
          return { version: before.version, domains: sortDomainConfigs(before.domain_configs).map(config => config.field), results };
        });
      } catch (error) { if (error !== changed) throw error; }
    }
    throw new ApiError(503, '抽籤結果正在更新，請稍後再試。');
  }
}

export const publicResultsCache = new PublicResultsCache();
