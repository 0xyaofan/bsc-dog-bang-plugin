/**
 * 缓存性能监控
 *
 * 提供缓存命中率、性能指标等监控功能
 */

import { structuredLogger } from './structured-logger.js';

/**
 * 缓存操作类型
 */
export type CacheOperation = 'get' | 'set' | 'delete' | 'clear';

/**
 * 缓存统计信息
 */
export interface CacheStats {
  /** 总请求次数 */
  totalRequests: number;
  /** 命中次数 */
  hits: number;
  /** 未命中次数 */
  misses: number;
  /** 命中率 */
  hitRate: number;
  /** 设置次数 */
  sets: number;
  /** 删除次数 */
  deletes: number;
  /** 清空次数 */
  clears: number;
  /** 淘汰次数 */
  evictions: number;
  /** 当前大小 */
  currentSize: number;
  /** 最大容量 */
  maxSize: number;
  /** 使用率 */
  utilizationRate: number;
}

/**
 * 缓存性能指标
 */
export interface CachePerformanceMetrics {
  /** 平均获取时间（毫秒） */
  avgGetTime: number;
  /** 平均设置时间（毫秒） */
  avgSetTime: number;
  /** 最大获取时间（毫秒） */
  maxGetTime: number;
  /** 最大设置时间（毫秒） */
  maxSetTime: number;
  /** 最小获取时间（毫秒） */
  minGetTime: number;
  /** 最小设置时间（毫秒） */
  minSetTime: number;
  /** P50 获取时间（毫秒） */
  p50GetTime: number;
  /** P95 获取时间（毫秒） */
  p95GetTime: number;
  /** P99 获取时间（毫秒） */
  p99GetTime: number;
}

/**
 * 缓存监控器
 */
export class CacheMonitor {
  private hits: number = 0;
  private misses: number = 0;
  private sets: number = 0;
  private deletes: number = 0;
  private clears: number = 0;
  private evictions: number = 0;
  private getTimes: number[] = [];
  private setTimes: number[] = [];
  private maxGetTime: number = 0;
  private maxSetTime: number = 0;
  private minGetTime: number = Infinity;
  private minSetTime: number = Infinity;
  private currentSize: number = 0;
  private maxSize: number = 0;

  constructor(maxSize: number) {
    this.maxSize = maxSize;
  }

  /**
   * 记录缓存命中
   */
  recordHit(): void {
    this.hits++;
  }

  /**
   * 记录缓存未命中
   */
  recordMiss(): void {
    this.misses++;
  }

  /**
   * 记录设置操作
   */
  recordSet(): void {
    this.sets++;
  }

  /**
   * 记录删除操作
   */
  recordDelete(): void {
    this.deletes++;
  }

  /**
   * 记录清空操作
   */
  recordClear(): void {
    this.clears++;
  }

  /**
   * 记录淘汰操作
   */
  recordEviction(): void {
    this.evictions++;
  }

  /**
   * 记录获取操作时间
   */
  recordGetTime(timeMs: number): void {
    this.getTimes.push(timeMs);
    this.maxGetTime = Math.max(this.maxGetTime, timeMs);
    this.minGetTime = Math.min(this.minGetTime, timeMs);

    // 限制数组大小
    if (this.getTimes.length > 1000) {
      this.getTimes.shift();
    }
  }

  /**
   * 记录设置操作时间
   */
  recordSetTime(timeMs: number): void {
    this.setTimes.push(timeMs);
    this.maxSetTime = Math.max(this.maxSetTime, timeMs);
    this.minSetTime = Math.min(this.minSetTime, timeMs);

    // 限制数组大小
    if (this.setTimes.length > 1000) {
      this.setTimes.shift();
    }
  }

  /**
   * 更新当前大小
   */
  updateSize(size: number): void {
    this.currentSize = size;
  }

  /**
   * 获取统计信息
   */
  getStats(): CacheStats {
    const totalRequests = this.hits + this.misses;
    const hitRate = totalRequests > 0 ? this.hits / totalRequests : 0;
    const utilizationRate = this.maxSize > 0 ? this.currentSize / this.maxSize : 0;

    return {
      totalRequests,
      hits: this.hits,
      misses: this.misses,
      hitRate,
      sets: this.sets,
      deletes: this.deletes,
      clears: this.clears,
      evictions: this.evictions,
      currentSize: this.currentSize,
      maxSize: this.maxSize,
      utilizationRate
    };
  }

  /**
   * 获取性能指标
   */
  getPerformanceMetrics(): CachePerformanceMetrics {
    const avgGetTime = this.getTimes.length > 0
      ? this.getTimes.reduce((a, b) => a + b, 0) / this.getTimes.length
      : 0;

    const avgSetTime = this.setTimes.length > 0
      ? this.setTimes.reduce((a, b) => a + b, 0) / this.setTimes.length
      : 0;

    const sortedGetTimes = [...this.getTimes].sort((a, b) => a - b);
    const p50GetTime = this.getPercentile(sortedGetTimes, 0.5);
    const p95GetTime = this.getPercentile(sortedGetTimes, 0.95);
    const p99GetTime = this.getPercentile(sortedGetTimes, 0.99);

    return {
      avgGetTime,
      avgSetTime,
      maxGetTime: this.maxGetTime,
      maxSetTime: this.maxSetTime,
      minGetTime: this.minGetTime === Infinity ? 0 : this.minGetTime,
      minSetTime: this.minSetTime === Infinity ? 0 : this.minSetTime,
      p50GetTime,
      p95GetTime,
      p99GetTime
    };
  }

  /**
   * 计算百分位数
   */
  private getPercentile(sortedArray: number[], percentile: number): number {
    if (sortedArray.length === 0) {
      return 0;
    }

    const index = Math.floor(sortedArray.length * percentile);
    return sortedArray[index] || 0;
  }

  /**
   * 重置统计信息
   */
  reset(): void {
    this.hits = 0;
    this.misses = 0;
    this.sets = 0;
    this.deletes = 0;
    this.clears = 0;
    this.evictions = 0;
    this.getTimes = [];
    this.setTimes = [];
    this.maxGetTime = 0;
    this.maxSetTime = 0;
    this.minGetTime = Infinity;
    this.minSetTime = Infinity;
  }

  /**
   * 导出统计信息为 JSON
   */
  exportStats(): string {
    return JSON.stringify({
      stats: this.getStats(),
      performance: this.getPerformanceMetrics()
    }, null, 2);
  }

  /**
   * 记录到日志
   */
  logStats(): void {
    const stats = this.getStats();
    const perf = this.getPerformanceMetrics();

    structuredLogger.info('[Cache] 缓存统计', {
      hitRate: `${(stats.hitRate * 100).toFixed(2)}%`,
      hits: stats.hits,
      misses: stats.misses,
      evictions: stats.evictions,
      utilizationRate: `${(stats.utilizationRate * 100).toFixed(2)}%`,
      avgGetTime: `${perf.avgGetTime.toFixed(2)}ms`,
      p95GetTime: `${perf.p95GetTime.toFixed(2)}ms`
    });
  }
}

/**
 * 带监控的缓存包装器
 */
export class MonitoredCache<K, V> {
  private cache: Map<K, V> | any;
  private monitor: CacheMonitor;
  private name: string;

  constructor(cache: Map<K, V> | any, name: string = 'cache') {
    this.cache = cache;
    this.name = name;

    // 获取最大容量
    const maxSize = cache.capacity || cache.maxSize || 100;
    this.monitor = new CacheMonitor(maxSize);
  }

  /**
   * 获取缓存值（带监控）
   */
  get(key: K): V | undefined {
    const start = performance.now();
    const value = this.cache.get(key);
    const duration = performance.now() - start;

    this.monitor.recordGetTime(duration);

    if (value !== undefined) {
      this.monitor.recordHit();
      structuredLogger.cache(`[${this.name}] 缓存命中`, {
        key: String(key),
        hit: true
      });
    } else {
      this.monitor.recordMiss();
      structuredLogger.cache(`[${this.name}] 缓存未命中`, {
        key: String(key),
        hit: false
      });
    }

    this.monitor.updateSize(this.cache.size);

    return value;
  }

  /**
   * 设置缓存值（带监控）
   */
  set(key: K, value: V, ...args: any[]): void {
    const start = performance.now();
    const oldSize = this.cache.size;

    this.cache.set(key, value, ...args);

    const duration = performance.now() - start;
    this.monitor.recordSetTime(duration);
    this.monitor.recordSet();

    // 检查是否发生淘汰
    if (this.cache.size < oldSize + 1) {
      this.monitor.recordEviction();
      structuredLogger.cache(`[${this.name}] 缓存淘汰`, {
        key: String(key)
      });
    }

    this.monitor.updateSize(this.cache.size);
  }

  /**
   * 删除缓存项（带监控）
   */
  delete(key: K): boolean {
    const result = this.cache.delete(key);

    if (result) {
      this.monitor.recordDelete();
      structuredLogger.cache(`[${this.name}] 缓存删除`, {
        key: String(key)
      });
    }

    this.monitor.updateSize(this.cache.size);

    return result;
  }

  /**
   * 清空缓存（带监控）
   */
  clear(): void {
    this.cache.clear();
    this.monitor.recordClear();
    this.monitor.updateSize(0);

    structuredLogger.cache(`[${this.name}] 缓存清空`, {});
  }

  /**
   * 检查键是否存在
   */
  has(key: K): boolean {
    return this.cache.has(key);
  }

  /**
   * 获取缓存大小
   */
  get size(): number {
    return this.cache.size;
  }

  /**
   * 获取统计信息
   */
  getStats(): CacheStats {
    return this.monitor.getStats();
  }

  /**
   * 获取性能指标
   */
  getPerformanceMetrics(): CachePerformanceMetrics {
    return this.monitor.getPerformanceMetrics();
  }

  /**
   * 重置统计信息
   */
  resetStats(): void {
    this.monitor.reset();
  }

  /**
   * 记录统计信息到日志
   */
  logStats(): void {
    this.monitor.logStats();
  }

  /**
   * 导出统计信息
   */
  exportStats(): string {
    return this.monitor.exportStats();
  }

  /**
   * 获取原始缓存对象
   */
  getCache(): Map<K, V> | any {
    return this.cache;
  }
}

/**
 * 创建带监控的缓存
 */
export function createMonitoredCache<K, V>(
  cache: Map<K, V> | any,
  name: string = 'cache'
): MonitoredCache<K, V> {
  return new MonitoredCache<K, V>(cache, name);
}

/**
 * 全局缓存监控管理器
 */
export class CacheMonitorManager {
  private monitors: Map<string, MonitoredCache<any, any>>;

  constructor() {
    this.monitors = new Map();
  }

  /**
   * 注册缓存监控
   */
  register<K, V>(name: string, cache: Map<K, V> | any): MonitoredCache<K, V> {
    const monitored = new MonitoredCache<K, V>(cache, name);
    this.monitors.set(name, monitored);
    return monitored;
  }

  /**
   * 获取缓存监控
   */
  get(name: string): MonitoredCache<any, any> | undefined {
    return this.monitors.get(name);
  }

  /**
   * 获取所有缓存统计
   */
  getAllStats(): Map<string, CacheStats> {
    const stats = new Map<string, CacheStats>();

    for (const [name, monitor] of this.monitors) {
      stats.set(name, monitor.getStats());
    }

    return stats;
  }

  /**
   * 记录所有缓存统计到日志
   */
  logAllStats(): void {
    for (const [name, monitor] of this.monitors) {
      structuredLogger.info(`[CacheMonitor] ${name} 统计`, monitor.getStats());
    }
  }

  /**
   * 重置所有统计信息
   */
  resetAll(): void {
    for (const monitor of this.monitors.values()) {
      monitor.resetStats();
    }
  }

  /**
   * 启动定期统计报告
   */
  startPeriodicReporting(intervalMs: number = 60000): () => void {
    const timer = setInterval(() => {
      this.logAllStats();
    }, intervalMs);

    return () => clearInterval(timer);
  }
}

/**
 * 全局缓存监控管理器实例
 */
export const cacheMonitorManager = new CacheMonitorManager();
