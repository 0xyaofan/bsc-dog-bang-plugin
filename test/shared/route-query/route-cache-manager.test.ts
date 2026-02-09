/**
 * 路由缓存管理器测试
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  RouteCacheManager,
  createRouteCacheManager
} from '../../../src/shared/route-query/route-cache-manager';
import type { RouteFetchResult } from '../../../src/shared/route-query/types';

describe('路由缓存管理器测试', () => {
  let manager: RouteCacheManager;

  beforeEach(() => {
    manager = new RouteCacheManager();
  });

  describe('基础缓存操作', () => {
    it('应该设置和获取路由缓存', () => {
      const tokenAddress = '0x1234567890123456789012345678901234567890';
      const route: RouteFetchResult = {
        platform: 'four',
        preferredChannel: 'pancake',
        readyForPancake: true,
        progress: 1,
        migrating: false
      };

      manager.setRoute(tokenAddress, route);
      const cached = manager.getRoute(tokenAddress);

      expect(cached).toBeDefined();
      expect(cached?.route).toEqual(route);
      expect(cached?.migrationStatus).toBe('migrated');
    });

    it('应该处理大小写不敏感的地址', () => {
      const route: RouteFetchResult = {
        platform: 'four',
        preferredChannel: 'pancake',
        readyForPancake: true,
        progress: 1,
        migrating: false
      };

      manager.setRoute('0xABCD1234', route);
      const cached = manager.getRoute('0xabcd1234');

      expect(cached).toBeDefined();
      expect(cached?.route).toEqual(route);
    });

    it('应该删除指定代币的缓存', () => {
      const tokenAddress = '0x1234567890123456789012345678901234567890';
      const route: RouteFetchResult = {
        platform: 'four',
        preferredChannel: 'pancake',
        readyForPancake: true,
        progress: 1,
        migrating: false
      };

      manager.setRoute(tokenAddress, route);
      expect(manager.getRoute(tokenAddress)).toBeDefined();

      manager.deleteRoute(tokenAddress);
      expect(manager.getRoute(tokenAddress)).toBeUndefined();
    });

    it('应该清除所有缓存', () => {
      const route: RouteFetchResult = {
        platform: 'four',
        preferredChannel: 'pancake',
        readyForPancake: true,
        progress: 1,
        migrating: false
      };

      manager.setRoute('0x1111', route);
      manager.setRoute('0x2222', route);
      manager.setRoute('0x3333', route);

      const statsBefore = manager.getStats();
      expect(statsBefore.size).toBe(3);

      manager.clearAll();

      const statsAfter = manager.getStats();
      expect(statsAfter.size).toBe(0);
    });
  });

  describe('迁移状态判断', () => {
    it('应该正确识别已迁移代币', () => {
      const route: RouteFetchResult = {
        platform: 'four',
        preferredChannel: 'pancake',
        readyForPancake: true,
        progress: 1,
        migrating: false
      };

      manager.setRoute('0x1234', route);
      const cached = manager.getRoute('0x1234');

      expect(cached?.migrationStatus).toBe('migrated');
    });

    it('应该正确识别未迁移代币', () => {
      const route: RouteFetchResult = {
        platform: 'four',
        preferredChannel: 'four',
        readyForPancake: false,
        progress: 0.5,
        migrating: true
      };

      manager.setRoute('0x1234', route);
      const cached = manager.getRoute('0x1234');

      expect(cached?.migrationStatus).toBe('not_migrated');
    });

    it('应该正确识别迁移中代币（未完成迁移）', () => {
      const route: RouteFetchResult = {
        platform: 'four',
        preferredChannel: 'pancake',
        readyForPancake: false,
        progress: 0.8,
        migrating: true
      };

      manager.setRoute('0x1234', route);
      const cached = manager.getRoute('0x1234');

      // 迁移中但未完成，状态为 not_migrated
      expect(cached?.migrationStatus).toBe('not_migrated');
    });
  });

  describe('缓存使用判断', () => {
    it('应该对已迁移代币永久使用缓存', () => {
      const route: RouteFetchResult = {
        platform: 'four',
        preferredChannel: 'pancake',
        readyForPancake: true,
        progress: 1,
        migrating: false
      };

      manager.setRoute('0x1234', route);
      const cached = manager.getRoute('0x1234');

      expect(manager.shouldUseCache(cached!)).toBe(true);
    });

    it('应该对未迁移代币在 TTL 内使用缓存', () => {
      const route: RouteFetchResult = {
        platform: 'four',
        preferredChannel: 'four',
        readyForPancake: false,
        progress: 0.5,
        migrating: true
      };

      manager.setRoute('0x1234', route);
      const cached = manager.getRoute('0x1234');

      expect(manager.shouldUseCache(cached!)).toBe(true);
    });

    it('应该对过期的未迁移代币不使用缓存', () => {
      const route: RouteFetchResult = {
        platform: 'four',
        preferredChannel: 'four',
        readyForPancake: false,
        progress: 0.5,
        migrating: true
      };

      manager.setRoute('0x1234', route);
      const cached = manager.getRoute('0x1234');

      // 修改时间戳为 2 分钟前
      if (cached) {
        cached.timestamp = Date.now() - 120000;
      }

      expect(manager.shouldUseCache(cached!)).toBe(false);
    });
  });

  describe('缓存更新判断', () => {
    it('应该更新已迁移代币的缓存', () => {
      const tokenAddress = '0x1234';
      const route: RouteFetchResult = {
        platform: 'four',
        preferredChannel: 'pancake',
        readyForPancake: true,
        progress: 1,
        migrating: false
      };

      expect(manager.shouldUpdateCache(tokenAddress, route)).toBe(true);
    });

    it('应该更新未迁移代币的缓存', () => {
      const tokenAddress = '0x1234';
      const route: RouteFetchResult = {
        platform: 'four',
        preferredChannel: 'four',
        readyForPancake: false,
        progress: 0.5,
        migrating: true
      };

      expect(manager.shouldUpdateCache(tokenAddress, route)).toBe(true);
    });

    it('应该在状态变化时更新缓存', () => {
      const tokenAddress = '0x1234';

      // 先缓存未迁移状态
      const route1: RouteFetchResult = {
        platform: 'four',
        preferredChannel: 'four',
        readyForPancake: false,
        progress: 0.5,
        migrating: true
      };
      manager.setRoute(tokenAddress, route1);

      // 状态变为已迁移
      const route2: RouteFetchResult = {
        platform: 'four',
        preferredChannel: 'pancake',
        readyForPancake: true,
        progress: 1,
        migrating: false
      };

      expect(manager.shouldUpdateCache(tokenAddress, route2)).toBe(true);
    });
  });

  describe('缓存统计', () => {
    it('应该返回正确的缓存统计', () => {
      const route: RouteFetchResult = {
        platform: 'four',
        preferredChannel: 'pancake',
        readyForPancake: true,
        progress: 1,
        migrating: false
      };

      manager.setRoute('0x1111', route);
      manager.setRoute('0x2222', route);
      manager.setRoute('0x3333', route);

      const stats = manager.getStats();

      expect(stats.size).toBe(3);
      expect(stats.capacity).toBeGreaterThan(0);
    });
  });

  describe('缓存预热', () => {
    it('应该预热多个代币的缓存', async () => {
      const tokens = ['0x1111', '0x2222', '0x3333'];
      const mockPublicClient = {};

      const mockFetcher = vi.fn().mockResolvedValue({
        platform: 'four',
        preferredChannel: 'pancake',
        readyForPancake: true,
        progress: 1,
        migrating: false
      });

      await manager.warmup(mockPublicClient, tokens, mockFetcher);

      expect(mockFetcher).toHaveBeenCalledTimes(3);
      expect(manager.getRoute('0x1111')).toBeDefined();
      expect(manager.getRoute('0x2222')).toBeDefined();
      expect(manager.getRoute('0x3333')).toBeDefined();
    });

    it('应该处理预热失败的情况', async () => {
      const tokens = ['0x1111', '0x2222'];
      const mockPublicClient = {};

      const mockFetcher = vi.fn()
        .mockResolvedValueOnce({
          platform: 'four',
          preferredChannel: 'pancake',
          readyForPancake: true,
          progress: 1,
          migrating: false
        })
        .mockRejectedValueOnce(new Error('Network error'));

      await manager.warmup(mockPublicClient, tokens, mockFetcher);

      expect(mockFetcher).toHaveBeenCalledTimes(2);
      expect(manager.getRoute('0x1111')).toBeDefined();
      expect(manager.getRoute('0x2222')).toBeUndefined();
    });
  });

  describe('便捷函数', () => {
    it('createRouteCacheManager 应该创建管理器', () => {
      const manager = createRouteCacheManager();
      expect(manager).toBeInstanceOf(RouteCacheManager);
    });
  });
});
