/**
 * 路由缓存管理器
 * 使用 LRU 缓存和监控系统
 */

import { createLRUCacheWithTTL } from '../lru-cache.js';
import { cacheMonitorManager } from '../cache-monitor.js';
import { structuredLogger } from '../structured-logger.js';
import { ROUTE_CACHE_CONFIG } from './constants.js';
import type { RouteCache, RouteFetchResult } from './types.js';

/**
 * 路由缓存管理器
 */
export class RouteCacheManager {
  private cache: ReturnType<typeof createLRUCacheWithTTL<string, RouteCache>>;

  constructor() {
    // 创建 LRU 缓存
    this.cache = createLRUCacheWithTTL<string, RouteCache>(
      ROUTE_CACHE_CONFIG.MAX_SIZE,
      ROUTE_CACHE_CONFIG.MIGRATED_TTL // 默认 TTL，会根据迁移状态动态调整
    );

    // 注册监控
    cacheMonitorManager.register('route-cache', this.cache);

    structuredLogger.info('[RouteCacheManager] 初始化完成', {
      maxSize: ROUTE_CACHE_CONFIG.MAX_SIZE,
      migratedTTL: ROUTE_CACHE_CONFIG.MIGRATED_TTL,
      notMigratedTTL: ROUTE_CACHE_CONFIG.NOT_MIGRATED_TTL
    });
  }

  /**
   * 获取路由缓存
   */
  getRoute(tokenAddress: string): RouteCache | undefined {
    const normalized = tokenAddress.toLowerCase();
    const cached = this.cache.get(normalized);

    if (cached) {
      structuredLogger.debug('[RouteCacheManager] 缓存命中', {
        tokenAddress: normalized,
        migrationStatus: cached.migrationStatus,
        age: Date.now() - cached.timestamp
      });
    }

    return cached;
  }

  /**
   * 设置路由缓存
   */
  setRoute(tokenAddress: string, route: RouteFetchResult): void {
    const normalized = tokenAddress.toLowerCase();
    const migrationStatus = route.readyForPancake ? 'migrated' : 'not_migrated';

    // 根据迁移状态设置 TTL
    const ttl = route.readyForPancake
      ? ROUTE_CACHE_CONFIG.MIGRATED_TTL
      : ROUTE_CACHE_CONFIG.NOT_MIGRATED_TTL;

    const cacheEntry: RouteCache = {
      route,
      timestamp: Date.now(),
      migrationStatus
    };

    this.cache.set(normalized, cacheEntry, ttl);

    structuredLogger.debug('[RouteCacheManager] 缓存已更新', {
      tokenAddress: normalized,
      platform: route.platform,
      migrationStatus,
      ttl: ttl === Infinity ? 'Infinity' : `${ttl}ms`
    });
  }

  /**
   * 判断是否应该使用缓存
   */
  shouldUseCache(cached: RouteCache): boolean {
    // 已迁移：永久缓存
    if (cached.migrationStatus === 'migrated') {
      structuredLogger.debug('[RouteCacheManager] 使用已迁移缓存（永久）');
      return true;
    }

    // 未迁移：检查是否过期
    const age = Date.now() - cached.timestamp;
    const expired = age >= ROUTE_CACHE_CONFIG.NOT_MIGRATED_TTL;

    if (expired) {
      structuredLogger.debug('[RouteCacheManager] 未迁移缓存已过期', {
        age,
        ttl: ROUTE_CACHE_CONFIG.NOT_MIGRATED_TTL
      });
      return false;
    }

    structuredLogger.debug('[RouteCacheManager] 使用未迁移缓存', { age });
    return true;
  }

  /**
   * 判断是否需要更新缓存
   */
  shouldUpdateCache(
    tokenAddress: string,
    currentRoute: RouteFetchResult
  ): boolean {
    const cached = this.getRoute(tokenAddress);

    // 1. 无缓存 → 更新
    if (!cached) {
      return true;
    }

    // 2. 迁移状态变化 → 更新
    const cachedMigrated = cached.migrationStatus === 'migrated';
    const currentMigrated = currentRoute.readyForPancake;

    if (cachedMigrated !== currentMigrated) {
      structuredLogger.info('[RouteCacheManager] 迁移状态变化，更新缓存', {
        tokenAddress,
        from: cached.migrationStatus,
        to: currentMigrated ? 'migrated' : 'not_migrated'
      });
      return true;
    }

    // 3. 迁移状态未变化
    // - 已迁移：不更新（永久缓存）
    // - 未迁移：不更新（由 TTL 控制）
    return false;
  }

  /**
   * 删除指定代币的缓存
   */
  deleteRoute(tokenAddress: string): boolean {
    const normalized = tokenAddress.toLowerCase();
    const deleted = this.cache.delete(normalized);

    if (deleted) {
      structuredLogger.info('[RouteCacheManager] 缓存已删除', {
        tokenAddress: normalized
      });
    }

    return deleted;
  }

  /**
   * 清空所有缓存
   */
  clearAll(): void {
    this.cache.clear();
    structuredLogger.info('[RouteCacheManager] 所有缓存已清空');
  }

  /**
   * 获取缓存统计信息
   */
  getStats() {
    return {
      size: this.cache.size,
      capacity: this.cache.capacity
    };
  }

  /**
   * 获取所有缓存的键
   */
  getAllKeys(): string[] {
    return this.cache.keys();
  }

  /**
   * 获取已迁移代币列表
   */
  getMigratedTokens(): string[] {
    return this.cache.keys().filter(key => {
      const cached = this.cache.get(key);
      return cached?.migrationStatus === 'migrated';
    });
  }

  /**
   * 获取未迁移代币列表
   */
  getNotMigratedTokens(): string[] {
    return this.cache.keys().filter(key => {
      const cached = this.cache.get(key);
      return cached?.migrationStatus === 'not_migrated';
    });
  }

  /**
   * 预热缓存
   */
  async warmup(
    publicClient: any,
    tokenAddresses: string[],
    queryFn: (publicClient: any, tokenAddress: string) => Promise<RouteFetchResult>
  ): Promise<void> {
    structuredLogger.info('[RouteCacheManager] 开始预热缓存', {
      count: tokenAddresses.length
    });

    const results = await Promise.allSettled(
      tokenAddresses.map(async address => {
        const route = await queryFn(publicClient, address);
        this.setRoute(address, route);
        return route;
      })
    );

    const succeeded = results.filter(r => r.status === 'fulfilled').length;
    const failed = results.filter(r => r.status === 'rejected').length;

    structuredLogger.info('[RouteCacheManager] 预热完成', {
      total: tokenAddresses.length,
      succeeded,
      failed
    });
  }
}

/**
 * 创建路由缓存管理器实例
 */
export function createRouteCacheManager(): RouteCacheManager {
  return new RouteCacheManager();
}

/**
 * 全局路由缓存管理器实例
 */
export const routeCacheManager = new RouteCacheManager();
