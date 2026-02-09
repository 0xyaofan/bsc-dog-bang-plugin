import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  CacheMonitor,
  MonitoredCache,
  createMonitoredCache,
  CacheMonitorManager,
  cacheMonitorManager
} from '../../src/shared/cache-monitor';
import { LRUCache } from '../../src/shared/lru-cache';

describe('缓存监控测试', () => {
  describe('CacheMonitor', () => {
    let monitor: CacheMonitor;

    beforeEach(() => {
      monitor = new CacheMonitor(100);
    });

    it('应该创建缓存监控器', () => {
      expect(monitor).toBeDefined();
    });

    it('应该记录缓存命中', () => {
      monitor.recordHit();
      monitor.recordHit();

      const stats = monitor.getStats();

      expect(stats.hits).toBe(2);
      expect(stats.misses).toBe(0);
      expect(stats.totalRequests).toBe(2);
      expect(stats.hitRate).toBe(1);
    });

    it('应该记录缓存未命中', () => {
      monitor.recordMiss();
      monitor.recordMiss();

      const stats = monitor.getStats();

      expect(stats.hits).toBe(0);
      expect(stats.misses).toBe(2);
      expect(stats.totalRequests).toBe(2);
      expect(stats.hitRate).toBe(0);
    });

    it('应该计算命中率', () => {
      monitor.recordHit();
      monitor.recordHit();
      monitor.recordMiss();

      const stats = monitor.getStats();

      expect(stats.hitRate).toBeCloseTo(0.667, 2);
    });

    it('应该记录设置操作', () => {
      monitor.recordSet();
      monitor.recordSet();

      const stats = monitor.getStats();

      expect(stats.sets).toBe(2);
    });

    it('应该记录删除操作', () => {
      monitor.recordDelete();

      const stats = monitor.getStats();

      expect(stats.deletes).toBe(1);
    });

    it('应该记录清空操作', () => {
      monitor.recordClear();

      const stats = monitor.getStats();

      expect(stats.clears).toBe(1);
    });

    it('应该记录淘汰操作', () => {
      monitor.recordEviction();
      monitor.recordEviction();

      const stats = monitor.getStats();

      expect(stats.evictions).toBe(2);
    });

    it('应该记录获取操作时间', () => {
      monitor.recordGetTime(10);
      monitor.recordGetTime(20);
      monitor.recordGetTime(30);

      const perf = monitor.getPerformanceMetrics();

      expect(perf.avgGetTime).toBe(20);
      expect(perf.maxGetTime).toBe(30);
      expect(perf.minGetTime).toBe(10);
    });

    it('应该记录设置操作时间', () => {
      monitor.recordSetTime(5);
      monitor.recordSetTime(15);

      const perf = monitor.getPerformanceMetrics();

      expect(perf.avgSetTime).toBe(10);
      expect(perf.maxSetTime).toBe(15);
      expect(perf.minSetTime).toBe(5);
    });

    it('应该计算百分位数', () => {
      // 添加一些数据
      for (let i = 1; i <= 100; i++) {
        monitor.recordGetTime(i);
      }

      const perf = monitor.getPerformanceMetrics();

      expect(perf.p50GetTime).toBeGreaterThanOrEqual(49);
      expect(perf.p50GetTime).toBeLessThanOrEqual(51);
      expect(perf.p95GetTime).toBeGreaterThanOrEqual(94);
      expect(perf.p95GetTime).toBeLessThanOrEqual(96);
      expect(perf.p99GetTime).toBeGreaterThanOrEqual(98);
      expect(perf.p99GetTime).toBeLessThanOrEqual(100);
    });

    it('应该更新当前大小', () => {
      monitor.updateSize(50);

      const stats = monitor.getStats();

      expect(stats.currentSize).toBe(50);
      expect(stats.maxSize).toBe(100);
      expect(stats.utilizationRate).toBe(0.5);
    });

    it('应该重置统计信息', () => {
      monitor.recordHit();
      monitor.recordMiss();
      monitor.recordSet();

      monitor.reset();

      const stats = monitor.getStats();

      expect(stats.hits).toBe(0);
      expect(stats.misses).toBe(0);
      expect(stats.sets).toBe(0);
    });

    it('应该导出统计信息为 JSON', () => {
      monitor.recordHit();
      monitor.recordMiss();

      const json = monitor.exportStats();
      const data = JSON.parse(json);

      expect(data.stats).toBeDefined();
      expect(data.performance).toBeDefined();
      expect(data.stats.hits).toBe(1);
      expect(data.stats.misses).toBe(1);
    });

    it('应该限制时间数组大小', () => {
      // 添加超过 1000 个数据点
      for (let i = 0; i < 1500; i++) {
        monitor.recordGetTime(i);
      }

      const perf = monitor.getPerformanceMetrics();

      // 应该只保留最近的 1000 个
      expect(perf.avgGetTime).toBeGreaterThan(500);
    });
  });

  describe('MonitoredCache', () => {
    let cache: LRUCache<string, number>;
    let monitored: MonitoredCache<string, number>;

    beforeEach(() => {
      cache = new LRUCache<string, number>(3);
      monitored = new MonitoredCache(cache, 'test-cache');
    });

    it('应该创建带监控的缓存', () => {
      expect(monitored).toBeDefined();
      expect(monitored.size).toBe(0);
    });

    it('应该监控 get 操作', () => {
      monitored.set('a', 1);
      monitored.get('a'); // 命中
      monitored.get('b'); // 未命中

      const stats = monitored.getStats();

      expect(stats.hits).toBe(1);
      expect(stats.misses).toBe(1);
      expect(stats.hitRate).toBe(0.5);
    });

    it('应该监控 set 操作', () => {
      monitored.set('a', 1);
      monitored.set('b', 2);

      const stats = monitored.getStats();

      expect(stats.sets).toBe(2);
    });

    it('应该监控 delete 操作', () => {
      monitored.set('a', 1);
      monitored.delete('a');

      const stats = monitored.getStats();

      expect(stats.deletes).toBe(1);
    });

    it('应该监控 clear 操作', () => {
      monitored.set('a', 1);
      monitored.clear();

      const stats = monitored.getStats();

      expect(stats.clears).toBe(1);
    });

    it('应该监控淘汰操作', () => {
      monitored.set('a', 1);
      monitored.set('b', 2);
      monitored.set('c', 3);
      monitored.set('d', 4); // 应该淘汰 a

      const stats = monitored.getStats();

      expect(stats.evictions).toBe(1);
    });

    it('应该记录操作时间', () => {
      monitored.set('a', 1);
      monitored.get('a');

      const perf = monitored.getPerformanceMetrics();

      expect(perf.avgGetTime).toBeGreaterThanOrEqual(0);
      expect(perf.avgSetTime).toBeGreaterThanOrEqual(0);
    });

    it('应该更新缓存大小', () => {
      monitored.set('a', 1);
      monitored.set('b', 2);

      const stats = monitored.getStats();

      expect(stats.currentSize).toBe(2);
    });

    it('应该支持 has 方法', () => {
      monitored.set('a', 1);

      expect(monitored.has('a')).toBe(true);
      expect(monitored.has('b')).toBe(false);
    });

    it('应该重置统计信息', () => {
      monitored.set('a', 1);
      monitored.get('a');

      monitored.resetStats();

      const stats = monitored.getStats();

      expect(stats.hits).toBe(0);
      expect(stats.sets).toBe(0);
    });

    it('应该导出统计信息', () => {
      monitored.set('a', 1);
      monitored.get('a');

      const json = monitored.exportStats();
      const data = JSON.parse(json);

      expect(data.stats).toBeDefined();
      expect(data.performance).toBeDefined();
    });

    it('应该获取原始缓存对象', () => {
      const original = monitored.getCache();

      expect(original).toBe(cache);
    });
  });

  describe('CacheMonitorManager', () => {
    let manager: CacheMonitorManager;

    beforeEach(() => {
      manager = new CacheMonitorManager();
    });

    it('应该注册缓存监控', () => {
      const cache = new LRUCache<string, number>(5);
      const monitored = manager.register('test', cache);

      expect(monitored).toBeDefined();
      expect(manager.get('test')).toBe(monitored);
    });

    it('应该获取所有缓存统计', () => {
      const cache1 = new LRUCache<string, number>(5);
      const cache2 = new LRUCache<string, number>(10);

      const monitored1 = manager.register('cache1', cache1);
      const monitored2 = manager.register('cache2', cache2);

      monitored1.set('a', 1);
      monitored2.set('b', 2);

      const allStats = manager.getAllStats();

      expect(allStats.size).toBe(2);
      expect(allStats.get('cache1')).toBeDefined();
      expect(allStats.get('cache2')).toBeDefined();
    });

    it('应该重置所有统计信息', () => {
      const cache = new LRUCache<string, number>(5);
      const monitored = manager.register('test', cache);

      monitored.set('a', 1);
      monitored.get('a');

      manager.resetAll();

      const stats = monitored.getStats();

      expect(stats.hits).toBe(0);
      expect(stats.sets).toBe(0);
    });

    it('应该启动定期统计报告', () => {
      vi.useFakeTimers();

      const cache = new LRUCache<string, number>(5);
      manager.register('test', cache);

      const stop = manager.startPeriodicReporting(1000);

      // 快进时间
      vi.advanceTimersByTime(2000);

      stop();

      vi.useRealTimers();
    });
  });

  describe('便捷函数', () => {
    it('createMonitoredCache 应该创建带监控的缓存', () => {
      const cache = new LRUCache<string, number>(5);
      const monitored = createMonitoredCache(cache, 'test');

      expect(monitored).toBeInstanceOf(MonitoredCache);
    });
  });

  describe('全局缓存监控管理器', () => {
    it('应该提供全局实例', () => {
      expect(cacheMonitorManager).toBeDefined();
      expect(cacheMonitorManager).toBeInstanceOf(CacheMonitorManager);
    });
  });

  describe('边界情况', () => {
    it('应该处理空缓存的统计', () => {
      const monitor = new CacheMonitor(10);
      const stats = monitor.getStats();

      expect(stats.hitRate).toBe(0);
      expect(stats.utilizationRate).toBe(0);
    });

    it('应该处理没有时间数据的性能指标', () => {
      const monitor = new CacheMonitor(10);
      const perf = monitor.getPerformanceMetrics();

      expect(perf.avgGetTime).toBe(0);
      expect(perf.avgSetTime).toBe(0);
      expect(perf.minGetTime).toBe(0);
      expect(perf.minSetTime).toBe(0);
    });

    it('应该处理满容量的缓存', () => {
      const cache = new LRUCache<string, number>(2);
      const monitored = new MonitoredCache(cache, 'test');

      monitored.set('a', 1);
      monitored.set('b', 2);

      const stats = monitored.getStats();

      expect(stats.utilizationRate).toBe(1);
    });
  });
});
