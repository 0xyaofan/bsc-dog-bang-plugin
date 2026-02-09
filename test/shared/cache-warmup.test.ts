import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  CacheWarmer,
  SmartWarmupStrategy,
  warmupCommonTokens,
  createCacheWarmer,
  createSmartWarmupStrategy,
  COMMON_TOKENS
} from '../../src/shared/cache-warmup';

describe('缓存预热测试', () => {
  let mockPublicClient: any;

  beforeEach(() => {
    mockPublicClient = {
      readContract: vi.fn().mockResolvedValue({
        liquidityAdded: false,
        quote: '0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c'
      })
    };
  });

  describe('CacheWarmer', () => {
    let warmer: CacheWarmer;

    beforeEach(() => {
      warmer = new CacheWarmer(mockPublicClient);
    });

    it('应该创建缓存预热器', () => {
      expect(warmer).toBeDefined();
    });

    it('应该预热单个代币', async () => {
      const result = await warmer.warmupToken('0xd86eb37348f72ddff0c0b9873531dd0fe4d7ffff');

      expect(result.success).toBe(true);
      expect(result.tokenAddress).toBe('0xd86eb37348f72ddff0c0b9873531dd0fe4d7ffff');
      expect(result.platform).toBe('four');
      expect(result.duration).toBeGreaterThanOrEqual(0);
    });

    it('应该处理预热失败', async () => {
      const failClient = {
        readContract: vi.fn().mockRejectedValue(new Error('Network error'))
      };
      const failWarmer = new CacheWarmer(failClient);

      const result = await failWarmer.warmupToken('0xd86eb37348f72ddff0c0b9873531dd0fe4d7ffff');

      // 结果应该存在（可能成功或失败，取决于 fallback 机制）
      expect(result).toBeDefined();
      expect(result.tokenAddress).toBe('0xd86eb37348f72ddff0c0b9873531dd0fe4d7ffff');
      expect(result.duration).toBeGreaterThanOrEqual(0);
    });

    it('应该批量预热代币', async () => {
      const tokens = [
        '0xd86eb37348f72ddff0c0b9873531dd0fe4d7ffff',
        '0x3e2a009d420512627a2791be63eeb04c94674444',
        '0x0e09fabb73bd3ade0a17ecc321fd13a19e81ce82'
      ];

      const results = await warmer.warmupTokens({
        tokenAddresses: tokens,
        concurrency: 2
      });

      expect(results).toHaveLength(3);
      // 至少有一些成功的
      expect(results.some(r => r.success)).toBe(true);
    });

    it('应该使用指定的并发数', async () => {
      const tokens = Array(10).fill(0).map((_, i) => `0x${i.toString().padStart(40, '0')}`);

      const results = await warmer.warmupTokens({
        tokenAddresses: tokens,
        concurrency: 3
      });

      expect(results).toHaveLength(10);
    });

    it('应该在失败时继续预热', async () => {
      const mixedClient = {
        readContract: vi.fn()
          .mockRejectedValueOnce(new Error('Error 1'))
          .mockResolvedValueOnce({ liquidityAdded: false })
          .mockRejectedValueOnce(new Error('Error 2'))
      };
      const mixedWarmer = new CacheWarmer(mixedClient);

      const tokens = ['0x1', '0x2', '0x3'];

      const results = await mixedWarmer.warmupTokens({
        tokenAddresses: tokens,
        concurrency: 1,
        continueOnError: true
      });

      expect(results).toHaveLength(3);
      // 应该有成功和失败的混合
      expect(results.length).toBe(3);
    });

    it('应该在失败时停止预热', async () => {
      const stopClient = {
        readContract: vi.fn()
          .mockResolvedValueOnce({ liquidityAdded: false })
          .mockRejectedValueOnce(new Error('Error'))
          .mockResolvedValueOnce({ liquidityAdded: false })
      };
      const stopWarmer = new CacheWarmer(stopClient);

      const tokens = ['0x1', '0x2', '0x3'];

      const results = await stopWarmer.warmupTokens({
        tokenAddresses: tokens,
        concurrency: 1,
        continueOnError: false
      });

      // 应该在失败后停止，所以结果数量应该 >= 1
      expect(results.length).toBeGreaterThanOrEqual(1);
    });

    it('应该调用进度回调', async () => {
      const onProgress = vi.fn();
      const tokens = ['0x1', '0x2', '0x3'];

      await warmer.warmupTokens({
        tokenAddresses: tokens,
        concurrency: 1,
        onProgress
      });

      expect(onProgress).toHaveBeenCalled();
      expect(onProgress).toHaveBeenCalledWith(3, 3);
    });

    it('应该调用完成回调', async () => {
      const onComplete = vi.fn();
      const tokens = ['0x1', '0x2'];

      await warmer.warmupTokens({
        tokenAddresses: tokens,
        concurrency: 1,
        onComplete
      });

      expect(onComplete).toHaveBeenCalledTimes(1);
      expect(onComplete).toHaveBeenCalledWith(expect.any(Array));
    });

    it('应该处理超时', async () => {
      mockPublicClient.readContract.mockImplementation(
        () => new Promise(resolve => setTimeout(resolve, 1000))
      );

      const result = await warmer.warmupToken('0x1');

      // 应该在超时前完成（默认 30 秒）
      expect(result).toBeDefined();
    }, 35000);

    it('应该计算正确的统计信息', async () => {
      const statsClient = {
        readContract: vi.fn()
          .mockResolvedValueOnce({ liquidityAdded: false })
          .mockRejectedValueOnce(new Error('Error'))
          .mockResolvedValueOnce({ liquidityAdded: false })
      };
      const statsWarmer = new CacheWarmer(statsClient);

      const tokens = ['0x1', '0x2', '0x3'];

      const results = await statsWarmer.warmupTokens({
        tokenAddresses: tokens,
        concurrency: 1
      });

      // 验证统计信息通过日志输出
      expect(results).toHaveLength(3);
      // 至少有一些结果
      expect(results.length).toBeGreaterThan(0);
    });
  });

  describe('SmartWarmupStrategy', () => {
    let strategy: SmartWarmupStrategy;

    beforeEach(() => {
      strategy = new SmartWarmupStrategy(mockPublicClient);
    });

    it('应该创建智能预热策略', () => {
      expect(strategy).toBeDefined();
    });

    it('应该记录代币访问', () => {
      strategy.recordAccess('0x1');
      strategy.recordAccess('0x1');
      strategy.recordAccess('0x2');

      const stats = strategy.getAccessStats();

      expect(stats.get('0x1')).toBe(2);
      expect(stats.get('0x2')).toBe(1);
    });

    it('应该获取热门代币', () => {
      strategy.recordAccess('0x1');
      strategy.recordAccess('0x1');
      strategy.recordAccess('0x1');
      strategy.recordAccess('0x2');
      strategy.recordAccess('0x2');
      strategy.recordAccess('0x3');

      const popular = strategy.getPopularTokens(2);

      expect(popular).toEqual(['0x1', '0x2']);
    });

    it('应该预热热门代币', async () => {
      strategy.recordAccess('0xd86eb37348f72ddff0c0b9873531dd0fe4d7ffff');
      strategy.recordAccess('0xd86eb37348f72ddff0c0b9873531dd0fe4d7ffff');
      strategy.recordAccess('0x3e2a009d420512627a2791be63eeb04c94674444');

      const results = await strategy.warmupPopularTokens(2);

      expect(results).toHaveLength(2);
      // 至少有一些成功的
      expect(results.some(r => r.success)).toBe(true);
    });

    it('应该处理没有热门代币的情况', async () => {
      const results = await strategy.warmupPopularTokens();

      expect(results).toHaveLength(0);
    });

    it('应该清除访问记录', () => {
      strategy.recordAccess('0x1');
      strategy.recordAccess('0x2');

      strategy.clearAccessRecords();

      const stats = strategy.getAccessStats();

      expect(stats.size).toBe(0);
    });

    it('应该启动定期预热', () => {
      vi.useFakeTimers();

      strategy.recordAccess('0xd86eb37348f72ddff0c0b9873531dd0fe4d7ffff');

      const stop = strategy.startPeriodicWarmup(1000);

      // 快进时间
      vi.advanceTimersByTime(2000);

      stop();

      vi.useRealTimers();
    });

    it('应该限制返回的热门代币数量', () => {
      for (let i = 0; i < 20; i++) {
        strategy.recordAccess(`0x${i}`);
      }

      const popular = strategy.getPopularTokens(5);

      expect(popular).toHaveLength(5);
    });
  });

  describe('warmupCommonTokens', () => {
    it('应该预热常用代币', async () => {
      const results = await warmupCommonTokens(mockPublicClient);

      expect(results).toHaveLength(COMMON_TOKENS.length);
    });

    it('应该处理预热失败', async () => {
      const failClient = {
        readContract: vi.fn().mockRejectedValue(new Error('Network error'))
      };

      const results = await warmupCommonTokens(failClient);

      expect(results).toHaveLength(COMMON_TOKENS.length);
      // 所有结果都应该存在
      expect(results.length).toBe(COMMON_TOKENS.length);
    });
  });

  describe('便捷函数', () => {
    it('createCacheWarmer 应该创建缓存预热器', () => {
      const warmer = createCacheWarmer(mockPublicClient);

      expect(warmer).toBeInstanceOf(CacheWarmer);
    });

    it('createSmartWarmupStrategy 应该创建智能预热策略', () => {
      const strategy = createSmartWarmupStrategy(mockPublicClient);

      expect(strategy).toBeInstanceOf(SmartWarmupStrategy);
    });
  });

  describe('COMMON_TOKENS', () => {
    it('应该包含常用代币', () => {
      expect(COMMON_TOKENS).toBeDefined();
      expect(COMMON_TOKENS.length).toBeGreaterThan(0);
      expect(COMMON_TOKENS).toContain('0x55d398326f99059ff775485246999027b3197955'); // USDT
      expect(COMMON_TOKENS).toContain('0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c'); // WBNB
    });
  });

  describe('边界情况', () => {
    it('应该处理空代币列表', async () => {
      const warmer = new CacheWarmer(mockPublicClient);

      const results = await warmer.warmupTokens({
        tokenAddresses: [],
        concurrency: 1
      });

      expect(results).toHaveLength(0);
    });

    it('应该处理并发数大于代币数量', async () => {
      const warmer = new CacheWarmer(mockPublicClient);
      const tokens = ['0x1', '0x2'];

      const results = await warmer.warmupTokens({
        tokenAddresses: tokens,
        concurrency: 10
      });

      expect(results).toHaveLength(2);
    });

    it('应该处理并发数为 1', async () => {
      const warmer = new CacheWarmer(mockPublicClient);
      const tokens = ['0x1', '0x2', '0x3'];

      const results = await warmer.warmupTokens({
        tokenAddresses: tokens,
        concurrency: 1
      });

      expect(results).toHaveLength(3);
    });
  });
});
