import { Logger } from '@nestjs/common';
import type { OnModuleDestroy } from '@nestjs/common';
import { ThrottlerStorageService } from '@nestjs/throttler';
import type { ThrottlerStorage } from '@nestjs/throttler';
import type { ThrottlerStorageRecord } from '@nestjs/throttler/dist/throttler-storage-record.interface';
import { ThrottlerStorageRedisService } from '@nest-lab/throttler-storage-redis';
import Redis from 'ioredis';

/**
 * Where the rate limiter keeps its counts.
 *
 * The default storage counts in the process, which means N replicas allow N
 * times the limit: the login endpoint's whole purpose is to make a fixed number
 * of guesses expensive, and a limit that multiplies by the deployment size is
 * not that. Redis makes one budget shared by every replica.
 *
 * **What happens when Redis is not there is the design decision here**, and it
 * has three possible answers, two of which are wrong.
 *
 * Failing open — allowing everything when the store is unreachable — deletes
 * brute-force protection at exactly the moment the system is already unwell,
 * and does it silently. Failing closed — refusing everything — turns a Redis
 * blip into a total outage of a health record people may be trying to read in
 * an appointment.
 *
 * So neither. When Redis cannot answer, the count falls back to this process's
 * own memory: the limit stops being shared and goes on being enforced. That is
 * the same protection the platform had before Redis existed, which is a known
 * and survivable state rather than a new one. The degradation is logged once
 * per outage rather than per request, because a line per rejected attempt
 * during an incident is how the useful lines get lost.
 */
export class ResilientThrottlerStorage implements ThrottlerStorage, OnModuleDestroy {
  private readonly logger = new Logger('ThrottlerStorage');
  private readonly local = new ThrottlerStorageService();
  private degraded = false;

  constructor(private readonly shared: ThrottlerStorageRedisService | null) {}

  async increment(
    key: string,
    ttl: number,
    limit: number,
    blockDuration: number,
    throttlerName: string,
  ): Promise<ThrottlerStorageRecord> {
    if (!this.shared) {
      return this.local.increment(key, ttl, limit, blockDuration, throttlerName);
    }

    try {
      const record = await this.shared.increment(
        key,
        ttl,
        limit,
        blockDuration,
        throttlerName,
      );
      if (this.degraded) {
        this.degraded = false;
        this.logger.log('Rate limit counts are shared across replicas again.');
      }
      return record;
    } catch (err) {
      if (!this.degraded) {
        this.degraded = true;
        this.logger.error(
          'Redis is not answering, so rate limits are being counted per process ' +
            `until it returns. Every replica now has its own budget. ${(err as Error).message}`,
        );
      }
      return this.local.increment(key, ttl, limit, blockDuration, throttlerName);
    }
  }

  /** Whether counts are currently shared. Reported by the readiness probe. */
  get sharedAcrossReplicas(): boolean {
    return this.shared !== null && !this.degraded;
  }

  get configured(): boolean {
    return this.shared !== null;
  }

  onModuleDestroy(): void {
    this.shared?.onModuleDestroy();
    this.local.onApplicationShutdown();
  }
}

/**
 * Builds the storage for a given `REDIS_URL`, or the in-process one when there
 * is none.
 *
 * `maxRetriesPerRequest: 1` and a short connect timeout on purpose. ioredis
 * defaults to queueing commands while it reconnects, which turns a Redis
 * outage into requests that hang rather than requests that are rate-limited by
 * a local count — and a hung request is indistinguishable to a reader from a
 * broken product. Failing the command quickly is what lets the fallback above
 * do its job.
 */
export function createThrottlerStorage(redisUrl: string | undefined): ResilientThrottlerStorage {
  if (!redisUrl) return new ResilientThrottlerStorage(null);

  const client = new Redis(redisUrl, {
    maxRetriesPerRequest: 1,
    connectTimeout: 2000,
    enableOfflineQueue: false,
    lazyConnect: false,
    retryStrategy: (times) => Math.min(times * 200, 5000),
  });

  // ioredis emits `error` on every failed reconnection attempt, and an
  // unhandled 'error' on an EventEmitter takes the process down. The storage
  // wrapper already reports the degradation once per outage, so this listener
  // exists to stop Node exiting, not to log.
  client.on('error', () => {});

  return new ResilientThrottlerStorage(new ThrottlerStorageRedisService(client));
}
