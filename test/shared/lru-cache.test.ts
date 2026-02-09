import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  LRUCache,
  LRUCacheWithTTL,
  createLRUCache,
  createLRUCacheWithTTL
} from '../../src/shared/lru-cache';

describe('LRU 缓存测试', () => {
  describe('LRUCache', () => {
    let cache: LRUCache<string, number>;

    beforeEach(() => {
      cache = new LRUCache<string, number>(3);
    });

    it('应该创建指定容量的缓存', () => {
      expect(cache.capacity).toBe(3);
      expect(cache.size).toBe(0);
    });

    it('应该拒绝无效的容量', () => {
      expect(() => new LRUCache(0)).toThrow('maxSize must be greater than 0');
      expect(() => new LRUCache(-1)).toThrow('maxSize must be greater than 0');
    });

    it('应该设置和获取值', () => {
      cache.set('a', 1);
      expect(cache.get('a')).toBe(1);
      expect(cache.size).toBe(1);
    });

    it('应该在获取时更新访问顺序', () => {
      cache.set('a', 1);
      cache.set('b', 2);
      cache.set('c', 3);

      // 访问 a，使其成为最近使用
      cache.get('a');

      // 添加新项，应该淘汰 b（最久未使用）
      cache.set('d', 4);

      expect(cache.has('a')).toBe(true);
      expect(cache.has('b')).toBe(false);
      expect(cache.has('c')).toBe(true);
      expect(cache.has('d')).toBe(true);
    });

    it('应该在超过容量时淘汰最久未使用的项', () => {
      cache.set('a', 1);
      cache.set('b', 2);
      cache.set('c', 3);
      cache.set('d', 4); // 应该淘汰 a

      expect(cache.has('a')).toBe(false);
      expect(cache.has('b')).toBe(true);
      expect(cache.has('c')).toBe(true);
      expect(cache.has('d')).toBe(true);
      expect(cache.size).toBe(3);
    });

    it('应该更新现有键的值', () => {
      cache.set('a', 1);
      cache.set('a', 2);

      expect(cache.get('a')).toBe(2);
      expect(cache.size).toBe(1);
    });

    it('应该删除指定的键', () => {
      cache.set('a', 1);
      cache.set('b', 2);

      expect(cache.delete('a')).toBe(true);
      expect(cache.has('a')).toBe(false);
      expect(cache.size).toBe(1);

      expect(cache.delete('a')).toBe(false);
    });

    it('应该清空所有缓存', () => {
      cache.set('a', 1);
      cache.set('b', 2);
      cache.set('c', 3);

      cache.clear();

      expect(cache.size).toBe(0);
      expect(cache.has('a')).toBe(false);
      expect(cache.has('b')).toBe(false);
      expect(cache.has('c')).toBe(false);
    });

    it('应该返回所有键', () => {
      cache.set('a', 1);
      cache.set('b', 2);
      cache.set('c', 3);

      const keys = cache.keys();

      expect(keys).toEqual(['c', 'b', 'a']); // 最近使用的在前
    });

    it('应该返回所有值', () => {
      cache.set('a', 1);
      cache.set('b', 2);
      cache.set('c', 3);

      const values = cache.values();

      expect(values).toEqual([3, 2, 1]);
    });

    it('应该返回所有条目', () => {
      cache.set('a', 1);
      cache.set('b', 2);

      const entries = cache.entries();

      expect(entries).toEqual([['b', 2], ['a', 1]]);
    });

    it('应该遍历所有条目', () => {
      cache.set('a', 1);
      cache.set('b', 2);

      const result: Array<[string, number]> = [];
      cache.forEach((value, key) => {
        result.push([key, value]);
      });

      expect(result).toEqual([['b', 2], ['a', 1]]);
    });

    it('应该获取最近使用的 N 个键', () => {
      cache.set('a', 1);
      cache.set('b', 2);
      cache.set('c', 3);

      const recent = cache.getMostRecent(2);

      expect(recent).toEqual(['c', 'b']);
    });

    it('应该获取最久未使用的 N 个键', () => {
      cache.set('a', 1);
      cache.set('b', 2);
      cache.set('c', 3);

      const leastRecent = cache.getLeastRecent(2);

      expect(leastRecent).toEqual(['a', 'b']);
    });

    it('应该转换为 JSON', () => {
      cache.set('a', 1);
      cache.set('b', 2);

      const json = cache.toJSON();

      expect(json.size).toBe(2);
      expect(json.capacity).toBe(3);
      expect(json.entries).toEqual([['b', 2], ['a', 1]]);
    });

    it('应该从 JSON 恢复', () => {
      const json = {
        capacity: 3,
        entries: [['b', 2], ['a', 1]] as Array<[string, number]>
      };

      const restored = LRUCache.fromJSON(json);

      expect(restored.size).toBe(2);
      expect(restored.capacity).toBe(3);
      expect(restored.get('a')).toBe(1);
      expect(restored.get('b')).toBe(2);
    });

    it('应该处理容量为 1 的情况', () => {
      const smallCache = new LRUCache<string, number>(1);

      smallCache.set('a', 1);
      expect(smallCache.get('a')).toBe(1);

      smallCache.set('b', 2);
      expect(smallCache.has('a')).toBe(false);
      expect(smallCache.get('b')).toBe(2);
    });

    it('应该处理大量数据', () => {
      const largeCache = new LRUCache<number, number>(100);

      for (let i = 0; i < 150; i++) {
        largeCache.set(i, i * 2);
      }

      expect(largeCache.size).toBe(100);
      expect(largeCache.has(0)).toBe(false); // 前 50 个应该被淘汰
      expect(largeCache.has(50)).toBe(true);
      expect(largeCache.has(149)).toBe(true);
    });
  });

  describe('LRUCacheWithTTL', () => {
    let cache: LRUCacheWithTTL<string, number>;

    beforeEach(() => {
      cache = new LRUCacheWithTTL<string, number>(3, 1000); // 1 秒 TTL
    });

    it('应该创建带 TTL 的缓存', () => {
      expect(cache.capacity).toBe(3);
      expect(cache.size).toBe(0);
    });

    it('应该在 TTL 内返回值', () => {
      cache.set('a', 1);
      expect(cache.get('a')).toBe(1);
    });

    it('应该在 TTL 过期后返回 undefined', async () => {
      cache.set('a', 1, 100); // 100ms TTL

      expect(cache.get('a')).toBe(1);

      // 等待过期
      await new Promise(resolve => setTimeout(resolve, 150));

      expect(cache.get('a')).toBeUndefined();
      expect(cache.has('a')).toBe(false);
    });

    it('应该使用默认 TTL', async () => {
      cache.set('a', 1); // 使用默认 1000ms TTL

      expect(cache.get('a')).toBe(1);

      // 等待过期
      await new Promise(resolve => setTimeout(resolve, 1100));

      expect(cache.get('a')).toBeUndefined();
    });

    it('应该支持无限 TTL', () => {
      const infiniteCache = new LRUCacheWithTTL<string, number>(3, Infinity);

      infiniteCache.set('a', 1);
      expect(infiniteCache.get('a')).toBe(1);
    });

    it('应该获取剩余 TTL', () => {
      cache.set('a', 1, 1000);

      const ttl = cache.getTTL('a');

      expect(ttl).toBeDefined();
      expect(ttl!).toBeGreaterThan(0);
      expect(ttl!).toBeLessThanOrEqual(1000);
    });

    it('应该清理过期条目', async () => {
      cache.set('a', 1, 100);
      cache.set('b', 2, 200);
      cache.set('c', 3, 1000);

      // 等待 a 和 b 过期
      await new Promise(resolve => setTimeout(resolve, 250));

      const cleaned = cache.cleanup();

      expect(cleaned).toBe(2);
      expect(cache.has('a')).toBe(false);
      expect(cache.has('b')).toBe(false);
      expect(cache.has('c')).toBe(true);
    });

    it('应该启动自动清理', async () => {
      cache.set('a', 1, 100);

      const stop = cache.startAutoCleanup(150);

      // 等待自动清理
      await new Promise(resolve => setTimeout(resolve, 300));

      expect(cache.has('a')).toBe(false);

      stop();
    });

    it('应该在删除时清除 TTL', () => {
      cache.set('a', 1, 1000);

      expect(cache.getTTL('a')).toBeDefined();

      cache.delete('a');

      expect(cache.getTTL('a')).toBeUndefined();
    });

    it('应该在清空时清除所有 TTL', () => {
      cache.set('a', 1, 1000);
      cache.set('b', 2, 1000);

      cache.clear();

      expect(cache.getTTL('a')).toBeUndefined();
      expect(cache.getTTL('b')).toBeUndefined();
    });
  });

  describe('便捷函数', () => {
    it('createLRUCache 应该创建 LRU 缓存', () => {
      const cache = createLRUCache<string, number>(5);

      expect(cache).toBeInstanceOf(LRUCache);
      expect(cache.capacity).toBe(5);
    });

    it('createLRUCacheWithTTL 应该创建带 TTL 的 LRU 缓存', () => {
      const cache = createLRUCacheWithTTL<string, number>(5, 1000);

      expect(cache).toBeInstanceOf(LRUCacheWithTTL);
      expect(cache.capacity).toBe(5);
    });
  });
});
