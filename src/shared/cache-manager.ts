/**
 * Cache Manager
 *
 * 提供统一的缓存接口，支持：
 * - TTL（过期时间）
 * - 缓存作用域（scope）
 * - 自动清理过期缓存
 * - 类型安全
 *
 * @example
 * ```typescript
 * // 创建缓存实例
 * const cache = new CacheManager<TokenInfo>({ ttl: 60000, scope: 'token-info' });
 *
 * // 设置缓存
 * cache.set('0x123...', tokenInfo);
 *
 * // 获取缓存
 * const info = cache.get('0x123...');
 *
 * // 检查是否存在
 * if (cache.has('0x123...')) {
 *   // ...
 * }
 *
 * // 删除缓存
 * cache.delete('0x123...');
 *
 * // 清空所有缓存
 * cache.clear();
 * ```
 */

import { logger } from './logger.js';

/**
 * 缓存项
 */
interface CacheEntry<T> {
  /** 缓存的数据 */
  data: T;
  /** 创建时间戳 */
  createdAt: number;
  /** 更新时间戳 */
  updatedAt: number;
  /** 过期时间戳（可选） */
  expiresAt?: number;
}

/**
 * 缓存管理器配置
 */
export interface CacheManagerOptions {
  /**
   * 默认 TTL（毫秒）
   * @default undefined（永不过期）
   */
  ttl?: number;

  /**
   * 缓存作用域（用于日志和调试）
   * @default 'default'
   */
  scope?: string;

  /**
   * 最大缓存条目数（LRU）
   * @default undefined（无限制）
   */
  maxSize?: number;

  /**
   * 自动清理过期缓存的间隔（毫秒）
   * @default undefined（不自动清理）
   */
  cleanupInterval?: number;
}

/**
 * 缓存统计信息
 */
export interface CacheStats {
  /** 总条目数 */
  size: number;
  /** 命中次数 */
  hits: number;
  /** 未命中次数 */
  misses: number;
  /** 命中率 */
  hitRate: number;
  /** 过期条目数 */
  expired: number;
}

/**
 * 缓存管理器
 */
export class CacheManager<T = any> {
  private cache: Map<string, CacheEntry<T>> = new Map();
  private options: Required<Omit<CacheManagerOptions, 'ttl' | 'maxSize' | 'cleanupInterval'>> & {
    ttl?: number;
    maxSize?: number;
    cleanupInterval?: number;
  };
  private stats = {
    hits: 0,
    misses: 0,
    expired: 0
  };
  private cleanupTimer?: number;

  constructor(options: CacheManagerOptions = {}) {
    this.options = {
      scope: options.scope || 'default',
      ttl: options.ttl,
      maxSize: options.maxSize,
      cleanupInterval: options.cleanupInterval
    };

    // 启动自动清理
    if (this.options.cleanupInterval) {
      this.startCleanup();
    }
  }

  /**
   * 生成缓存键（带作用域）
   */
  private makeKey(key: string): string {
    return `${this.options.scope}:${key}`;
  }

  /**
   * 检查缓存项是否过期
   */
  private isExpired(entry: CacheEntry<T>): boolean {
    if (!entry.expiresAt) {
      return false;
    }
    return Date.now() > entry.expiresAt;
  }

  /**
   * 设置缓存
   *
   * @param key 缓存键
   * @param data 缓存数据
   * @param ttl 过期时间（毫秒），覆盖默认 TTL
   */
  set(key: string, data: T, ttl?: number): void {
    const now = Date.now();
    const effectiveTtl = ttl ?? this.options.ttl;
    const expiresAt = effectiveTtl ? now + effectiveTtl : undefined;

    const entry: CacheEntry<T> = {
      data,
      createdAt: now,
      updatedAt: now,
      expiresAt
    };

    this.cache.set(key, entry);

    // LRU: 如果超过最大大小，删除最旧的条目
    if (this.options.maxSize && this.cache.size > this.options.maxSize) {
      const firstKey = this.cache.keys().next().value;
      if (firstKey) {
        this.cache.delete(firstKey);
        logger.debug(`[CacheManager:${this.options.scope}] LRU 删除: ${firstKey}`);
      }
    }
  }

  /**
   * 获取缓存
   *
   * @param key 缓存键
   * @returns 缓存数据，如果不存在或已过期则返回 undefined
   */
  get(key: string): T | undefined {
    const entry = this.cache.get(key);

    if (!entry) {
      this.stats.misses++;
      return undefined;
    }

    // 检查是否过期
    if (this.isExpired(entry)) {
      this.cache.delete(key);
      this.stats.expired++;
      this.stats.misses++;
      logger.debug(`[CacheManager:${this.options.scope}] 缓存过期: ${key}`);
      return undefined;
    }

    this.stats.hits++;
    return entry.data;
  }

  /**
   * 检查缓存是否存在且未过期
   *
   * @param key 缓存键
   * @returns true 表示存在且未过期
   */
  has(key: string): boolean {
    return this.get(key) !== undefined;
  }

  /**
   * 删除缓存
   *
   * @param key 缓存键
   * @returns true 表示删除成功
   */
  delete(key: string): boolean {
    return this.cache.delete(key);
  }

  /**
   * 清空所有缓存
   */
  clear(): void {
    this.cache.clear();
    logger.debug(`[CacheManager:${this.options.scope}] 清空缓存`);
  }

  /**
   * 获取缓存大小
   */
  get size(): number {
    return this.cache.size;
  }

  /**
   * 获取所有缓存键
   */
  keys(): string[] {
    return Array.from(this.cache.keys());
  }

  /**
   * 获取所有缓存值
   */
  values(): T[] {
    return Array.from(this.cache.values())
      .filter(entry => !this.isExpired(entry))
      .map(entry => entry.data);
  }

  /**
   * 获取所有缓存条目
   */
  entries(): Array<[string, T]> {
    return Array.from(this.cache.entries())
      .filter(([_, entry]) => !this.isExpired(entry))
      .map(([key, entry]) => [key, entry.data]);
  }

  /**
   * 获取缓存统计信息
   */
  getStats(): CacheStats {
    const total = this.stats.hits + this.stats.misses;
    return {
      size: this.cache.size,
      hits: this.stats.hits,
      misses: this.stats.misses,
      hitRate: total > 0 ? this.stats.hits / total : 0,
      expired: this.stats.expired
    };
  }

  /**
   * 重置统计信息
   */
  resetStats(): void {
    this.stats = {
      hits: 0,
      misses: 0,
      expired: 0
    };
  }

  /**
   * 清理过期缓存
   */
  cleanup(): number {
    let cleaned = 0;
    const now = Date.now();

    for (const [key, entry] of this.cache.entries()) {
      if (this.isExpired(entry)) {
        this.cache.delete(key);
        cleaned++;
      }
    }

    if (cleaned > 0) {
      logger.debug(`[CacheManager:${this.options.scope}] 清理了 ${cleaned} 个过期缓存`);
    }

    return cleaned;
  }

  /**
   * 启动自动清理
   */
  private startCleanup(): void {
    if (this.cleanupTimer) {
      return;
    }

    this.cleanupTimer = setInterval(() => {
      this.cleanup();
    }, this.options.cleanupInterval) as unknown as number;

    logger.debug(`[CacheManager:${this.options.scope}] 启动自动清理 (间隔: ${this.options.cleanupInterval}ms)`);
  }

  /**
   * 停止自动清理
   */
  stopCleanup(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = undefined;
      logger.debug(`[CacheManager:${this.options.scope}] 停止自动清理`);
    }
  }

  /**
   * 销毁缓存管理器
   */
  destroy(): void {
    this.stopCleanup();
    this.clear();
  }
}

/**
 * 创建带有默认配置的缓存管理器工厂
 *
 * @example
 * ```typescript
 * const createCache = createCacheFactory({ ttl: 60000 });
 * const tokenCache = createCache<TokenInfo>({ scope: 'token-info' });
 * const routeCache = createCache<RouteInfo>({ scope: 'route-info' });
 * ```
 */
export function createCacheFactory(defaultOptions: CacheManagerOptions) {
  return function<T = any>(overrideOptions?: CacheManagerOptions): CacheManager<T> {
    return new CacheManager<T>({ ...defaultOptions, ...overrideOptions });
  };
}
