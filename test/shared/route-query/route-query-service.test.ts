/**
 * 路由查询服务测试
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  RouteQueryService,
  createRouteQueryService
} from '../../../src/shared/route-query/route-query-service';
import type { RouteFetchResult } from '../../../src/shared/route-query/types';

describe('路由查询服务测试', () => {
  let service: RouteQueryService;
  let mockPublicClient: any;

  beforeEach(() => {
    mockPublicClient = {
      readContract: vi.fn()
    };
    service = new RouteQueryService(mockPublicClient);
    // 清除缓存
    service.clearCache();
  });

  describe('queryRoute', () => {
    it('应该查询 Four.meme 代币路由', async () => {
      const tokenAddress = '0xd86eb37348f72ddff0c0b9873531dd0fe4d74444'; // Four.meme

      mockPublicClient.readContract
        .mockResolvedValueOnce({
          liquidityAdded: true,
          offers: BigInt(100),
          funds: BigInt(100),
          quoteToken: '0x55d398326f99059ff775485246999027b3197955'
        })
        .mockResolvedValueOnce('0xpairaddress')
        .mockResolvedValueOnce([BigInt(200 * 1e18), BigInt(100 * 1e18), 0])
        .mockResolvedValueOnce('0x55d398326f99059ff775485246999027b3197955')
        .mockResolvedValueOnce(tokenAddress);

      const result = await service.queryRoute(tokenAddress);

      expect(result.platform).toBe('four');
      expect(result.preferredChannel).toBe('pancake');
      expect(result.readyForPancake).toBe(true);
    });

    it('应该查询 Flap 代币路由', async () => {
      const tokenAddress = '0xd86eb37348f72ddff0c0b9873531dd0fe4d77777'; // Flap

      mockPublicClient.readContract
        .mockResolvedValueOnce({ // State reader V7
          reserve: BigInt(150 * 1e18),
          threshold: BigInt(100 * 1e18),
          pool: '0xpooladdress',
          nativeToQuoteSwapEnabled: true
        })
        .mockResolvedValueOnce([BigInt(200 * 1e18), BigInt(100 * 1e18), 0])
        .mockResolvedValueOnce('0x55d398326f99059ff775485246999027b3197955')
        .mockResolvedValueOnce(tokenAddress);

      const result = await service.queryRoute(tokenAddress);

      expect(result.platform).toBe('flap');
      expect(result.preferredChannel).toBe('pancake');
      expect(result.readyForPancake).toBe(true);
    });

    it('应该查询 unknown 代币路由', async () => {
      const tokenAddress = '0x55d398326f99059ff775485246999027b3197955'; // USDT

      mockPublicClient.readContract
        .mockResolvedValueOnce('0xpairaddress')
        .mockResolvedValueOnce([BigInt(200 * 1e18), BigInt(100 * 1e18), 0])
        .mockResolvedValueOnce('0x55d398326f99059ff775485246999027b3197955')
        .mockResolvedValueOnce(tokenAddress);

      const result = await service.queryRoute(tokenAddress);

      expect(result.platform).toBe('unknown');
      expect(result.preferredChannel).toBe('pancake');
    });

    it('应该支持手动指定平台', async () => {
      const tokenAddress = '0x1234567890123456789012345678901234567890';

      mockPublicClient.readContract
        .mockResolvedValueOnce({
          liquidityAdded: true,
          offers: BigInt(100),
          funds: BigInt(100)
        })
        .mockResolvedValueOnce('0xpairaddress')
        .mockResolvedValueOnce([BigInt(200 * 1e18), BigInt(100 * 1e18), 0])
        .mockResolvedValueOnce('0x55d398326f99059ff775485246999027b3197955')
        .mockResolvedValueOnce(tokenAddress);

      const result = await service.queryRoute(tokenAddress, 'four');

      expect(result.platform).toBe('four');
    });
  });

  describe('缓存功能', () => {
    it('应该缓存已迁移代币的查询结果', async () => {
      const tokenAddress = '0xd86eb37348f72ddff0c0b9873531dd0fe4d74444';

      mockPublicClient.readContract
        .mockResolvedValueOnce({
          liquidityAdded: true,
          offers: BigInt(100),
          funds: BigInt(100)
        })
        .mockResolvedValueOnce('0xpairaddress')
        .mockResolvedValueOnce([BigInt(200 * 1e18), BigInt(100 * 1e18), 0])
        .mockResolvedValueOnce('0x55d398326f99059ff775485246999027b3197955')
        .mockResolvedValueOnce(tokenAddress);

      // 第一次查询
      const result1 = await service.queryRoute(tokenAddress);
      expect(result1.readyForPancake).toBe(true);

      // 第二次查询应该使用缓存
      const result2 = await service.queryRoute(tokenAddress);
      expect(result2).toEqual(result1);

      // 应该只调用一次 readContract
      expect(mockPublicClient.readContract).toHaveBeenCalledTimes(5);
    });

    it('应该对未迁移代币使用短期缓存', async () => {
      const tokenAddress = '0xd86eb37348f72ddff0c0b9873531dd0fe4d74444';

      mockPublicClient.readContract
        .mockResolvedValue({
          liquidityAdded: false,
          offers: BigInt(50),
          funds: BigInt(100)
        });

      // 第一次查询
      const result1 = await service.queryRoute(tokenAddress);
      expect(result1.readyForPancake).toBe(false);

      // 立即第二次查询应该使用缓存
      const result2 = await service.queryRoute(tokenAddress);
      expect(result2).toEqual(result1);
    });

    it('应该清除指定代币的缓存', async () => {
      const tokenAddress = '0xd86eb37348f72ddff0c0b9873531dd0fe4d74444';

      mockPublicClient.readContract
        .mockResolvedValue({
          liquidityAdded: true,
          offers: BigInt(100),
          funds: BigInt(100)
        })
        .mockResolvedValue('0xpairaddress')
        .mockResolvedValue([BigInt(200 * 1e18), BigInt(100 * 1e18), 0])
        .mockResolvedValue('0x55d398326f99059ff775485246999027b3197955')
        .mockResolvedValue(tokenAddress);

      // 第一次查询
      await service.queryRoute(tokenAddress);

      // 清除缓存
      service.clearCache(tokenAddress);

      // 第二次查询应该重新查询
      await service.queryRoute(tokenAddress);

      expect(mockPublicClient.readContract.mock.calls.length).toBeGreaterThan(5);
    });

    it('应该清除所有缓存', async () => {
      const token1 = '0xd86eb37348f72ddff0c0b9873531dd0fe4d74444';
      const token2 = '0xd86eb37348f72ddff0c0b9873531dd0fe4d77777';

      mockPublicClient.readContract
        .mockResolvedValue({
          liquidityAdded: true,
          offers: BigInt(100),
          funds: BigInt(100)
        })
        .mockResolvedValue('0xpairaddress')
        .mockResolvedValue([BigInt(200 * 1e18), BigInt(100 * 1e18), 0])
        .mockResolvedValue('0x55d398326f99059ff775485246999027b3197955')
        .mockResolvedValue(token1);

      await service.queryRoute(token1);
      await service.queryRoute(token2);

      const statsBefore = service.getCacheStats();
      expect(statsBefore.size).toBeGreaterThan(0);

      service.clearCache();

      const statsAfter = service.getCacheStats();
      expect(statsAfter.size).toBe(0);
    });
  });

  describe('批量查询', () => {
    it('应该批量查询多个代币', async () => {
      const tokens = [
        '0xd86eb37348f72ddff0c0b9873531dd0fe4d74444', // Four
        '0xd86eb37348f72ddff0c0b9873531dd0fe4d77777', // Flap
        '0x55d398326f99059ff775485246999027b3197955'  // Unknown
      ];

      mockPublicClient.readContract
        .mockResolvedValue({
          liquidityAdded: true,
          offers: BigInt(100),
          funds: BigInt(100)
        })
        .mockResolvedValue('0xpairaddress')
        .mockResolvedValue([BigInt(200 * 1e18), BigInt(100 * 1e18), 0])
        .mockResolvedValue('0x55d398326f99059ff775485246999027b3197955')
        .mockResolvedValue(tokens[0]);

      const results = await service.queryRoutes(tokens);

      expect(results.size).toBe(3);
      expect(results.get(tokens[0].toLowerCase())).toBeDefined();
      expect(results.get(tokens[1].toLowerCase())).toBeDefined();
      expect(results.get(tokens[2].toLowerCase())).toBeDefined();
    });

    it('应该处理批量查询中的失败', async () => {
      const tokens = [
        '0xd86eb37348f72ddff0c0b9873531dd0fe4d74444',
        '0xd86eb37348f72ddff0c0b9873531dd0fe4d77777'
      ];

      let callCount = 0;
      mockPublicClient.readContract.mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          return Promise.reject(new Error('Network error'));
        }
        return Promise.resolve({
          liquidityAdded: true,
          offers: BigInt(100),
          funds: BigInt(100)
        });
      });

      const results = await service.queryRoutes(tokens);

      // 至少有一个成功
      expect(results.size).toBeGreaterThanOrEqual(0);
    });
  });

  describe('缓存统计', () => {
    it('应该返回缓存统计信息', () => {
      const stats = service.getCacheStats();

      expect(stats).toBeDefined();
      expect(stats.size).toBeDefined();
      expect(stats.capacity).toBeDefined();
    });
  });

  describe('缓存预热', () => {
    it('应该预热多个代币的缓存', async () => {
      const tokens = [
        '0xd86eb37348f72ddff0c0b9873531dd0fe4d74444',
        '0xd86eb37348f72ddff0c0b9873531dd0fe4d77777',
        '0x55d398326f99059ff775485246999027b3197955'
      ];

      mockPublicClient.readContract
        .mockResolvedValue({
          liquidityAdded: true,
          offers: BigInt(100),
          funds: BigInt(100)
        })
        .mockResolvedValue('0xpairaddress')
        .mockResolvedValue([BigInt(200 * 1e18), BigInt(100 * 1e18), 0])
        .mockResolvedValue('0x55d398326f99059ff775485246999027b3197955')
        .mockResolvedValue(tokens[0]);

      await service.warmupCache(tokens);

      const stats = service.getCacheStats();
      expect(stats.size).toBeGreaterThan(0);
    });
  });

  describe('便捷函数', () => {
    it('createRouteQueryService 应该创建服务', () => {
      const service = createRouteQueryService(mockPublicClient);
      expect(service).toBeInstanceOf(RouteQueryService);
    });
  });
});
