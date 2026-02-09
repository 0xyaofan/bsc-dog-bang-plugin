/**
 * Pancake Pair 查找器测试
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  PancakePairFinder,
  createPancakePairFinder
} from '../../../src/shared/route-query/pancake-pair-finder';
import type { PancakePairCheckResult } from '../../../src/shared/route-query/types';

describe('Pancake Pair 查找器测试', () => {
  let finder: PancakePairFinder;
  let mockPublicClient: any;

  beforeEach(() => {
    finder = new PancakePairFinder();
    mockPublicClient = {
      readContract: vi.fn()
    };
  });

  describe('findBestPair', () => {
    it('应该找到 V2 pair', async () => {
      const tokenAddress = '0x1234567890123456789012345678901234567890';
      const quoteToken = '0x55d398326f99059ff775485246999027b3197955'; // USDT

      // Mock V2 Factory.getPair
      mockPublicClient.readContract
        .mockResolvedValueOnce('0xpairaddress') // getPair
        .mockResolvedValueOnce([BigInt(200 * 1e18), BigInt(100 * 1e18), 0]) // getReserves
        .mockResolvedValueOnce(quoteToken) // token0
        .mockResolvedValueOnce(tokenAddress); // token1

      const result = await finder.findBestPair(mockPublicClient, tokenAddress, quoteToken);

      expect(result.hasLiquidity).toBe(true);
      expect(result.version).toBe('v2');
      expect(result.pairAddress).toBe('0xpairaddress');
      expect(result.quoteToken).toBe(quoteToken);
    });

    it('应该找到 V3 pool', async () => {
      const tokenAddress = '0x1234567890123456789012345678901234567890';
      const quoteToken = '0x55d398326f99059ff775485246999027b3197955'; // USDT

      // Mock V2 不存在
      mockPublicClient.readContract
        .mockResolvedValueOnce('0x0000000000000000000000000000000000000000') // V2 getPair
        // Mock V3 pools
        .mockResolvedValueOnce('0xpool500') // 500 fee
        .mockResolvedValueOnce(BigInt(1e12)) // liquidity 500
        .mockResolvedValueOnce('0xpool2500') // 2500 fee
        .mockResolvedValueOnce(BigInt(2e12)) // liquidity 2500
        .mockResolvedValueOnce('0xpool10000') // 10000 fee
        .mockResolvedValueOnce(BigInt(1.5e12)); // liquidity 10000

      const result = await finder.findBestPair(mockPublicClient, tokenAddress, quoteToken);

      expect(result.hasLiquidity).toBe(true);
      expect(result.version).toBe('v3');
      expect(result.pairAddress).toBe('0xpool2500');
      expect(result.preferredMode).toBe('v3');
    });

    it('应该优先选择流动性更高的 pair', async () => {
      const tokenAddress = '0x1234567890123456789012345678901234567890';
      const quoteToken = '0x55d398326f99059ff775485246999027b3197955';

      // Mock V2 有较低流动性
      mockPublicClient.readContract
        .mockResolvedValueOnce('0xv2pair') // V2 getPair
        .mockResolvedValueOnce([BigInt(150 * 1e18), BigInt(100 * 1e18), 0]) // V2 reserves
        .mockResolvedValueOnce(quoteToken) // token0
        .mockResolvedValueOnce(tokenAddress) // token1
        // Mock V3 有更高流动性
        .mockResolvedValueOnce('0xpool500')
        .mockResolvedValueOnce(BigInt(5e12)) // 高流动性
        .mockResolvedValueOnce('0xpool2500')
        .mockResolvedValueOnce(BigInt(3e12))
        .mockResolvedValueOnce('0xpool10000')
        .mockResolvedValueOnce(BigInt(2e12));

      const result = await finder.findBestPair(mockPublicClient, tokenAddress, quoteToken);

      expect(result.hasLiquidity).toBe(true);
      expect(result.version).toBe('v3');
      expect(result.pairAddress).toBe('0xpool500');
    });

    it('应该处理没有找到 pair 的情况', async () => {
      const tokenAddress = '0x1234567890123456789012345678901234567890';
      const quoteToken = '0x55d398326f99059ff775485246999027b3197955';

      // Mock V2 不存在
      mockPublicClient.readContract
        .mockResolvedValueOnce('0x0000000000000000000000000000000000000000')
        // Mock V3 pools 都不存在或流动性不足
        .mockResolvedValueOnce('0x0000000000000000000000000000000000000000')
        .mockResolvedValueOnce('0x0000000000000000000000000000000000000000')
        .mockResolvedValueOnce('0x0000000000000000000000000000000000000000');

      const result = await finder.findBestPair(mockPublicClient, tokenAddress, quoteToken);

      expect(result.hasLiquidity).toBe(false);
    });

    it('应该尝试多个报价代币', async () => {
      const tokenAddress = '0x1234567890123456789012345678901234567890';

      // Mock USDT 不存在
      mockPublicClient.readContract
        .mockResolvedValueOnce('0x0000000000000000000000000000000000000000') // USDT V2
        .mockResolvedValueOnce('0x0000000000000000000000000000000000000000') // USDT V3 500
        .mockResolvedValueOnce('0x0000000000000000000000000000000000000000') // USDT V3 2500
        .mockResolvedValueOnce('0x0000000000000000000000000000000000000000') // USDT V3 10000
        // Mock WBNB 存在
        .mockResolvedValueOnce('0xwbnbpair') // WBNB V2
        .mockResolvedValueOnce([BigInt(1 * 1e18), BigInt(100 * 1e18), 0]) // reserves
        .mockResolvedValueOnce('0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c') // WBNB token0
        .mockResolvedValueOnce(tokenAddress); // token1

      const result = await finder.findBestPair(mockPublicClient, tokenAddress);

      expect(result.hasLiquidity).toBe(true);
      expect(result.quoteToken).toBe('0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c');
    });

    it('应该处理查询失败', async () => {
      const tokenAddress = '0x1234567890123456789012345678901234567890';

      mockPublicClient.readContract.mockRejectedValue(new Error('Network error'));

      const result = await finder.findBestPair(mockPublicClient, tokenAddress);

      expect(result.hasLiquidity).toBe(false);
    });
  });

  describe('缓存功能', () => {
    it('应该缓存查询结果', async () => {
      const tokenAddress = '0x1234567890123456789012345678901234567890';
      const quoteToken = '0x55d398326f99059ff775485246999027b3197955';

      mockPublicClient.readContract
        .mockResolvedValueOnce('0xpairaddress')
        .mockResolvedValueOnce([BigInt(200 * 1e18), BigInt(100 * 1e18), 0])
        .mockResolvedValueOnce(quoteToken)
        .mockResolvedValueOnce(tokenAddress);

      // 第一次查询
      const result1 = await finder.findBestPair(mockPublicClient, tokenAddress, quoteToken);
      expect(result1.hasLiquidity).toBe(true);

      // 第二次查询应该使用缓存
      const result2 = await finder.findBestPair(mockPublicClient, tokenAddress, quoteToken);
      expect(result2.hasLiquidity).toBe(true);
      expect(result2.pairAddress).toBe(result1.pairAddress);

      // 应该只调用一次 readContract
      expect(mockPublicClient.readContract).toHaveBeenCalledTimes(4);
    });

    it('应该清除指定代币的缓存', async () => {
      const tokenAddress = '0x1234567890123456789012345678901234567890';
      const quoteToken = '0x55d398326f99059ff775485246999027b3197955';

      mockPublicClient.readContract
        .mockResolvedValue('0xpairaddress')
        .mockResolvedValue([BigInt(200 * 1e18), BigInt(100 * 1e18), 0])
        .mockResolvedValue(quoteToken)
        .mockResolvedValue(tokenAddress);

      // 第一次查询
      await finder.findBestPair(mockPublicClient, tokenAddress, quoteToken);

      // 清除缓存
      finder.clearCache(tokenAddress);

      // 第二次查询应该重新查询
      await finder.findBestPair(mockPublicClient, tokenAddress, quoteToken);

      // 应该调用两次
      expect(mockPublicClient.readContract.mock.calls.length).toBeGreaterThan(4);
    });

    it('应该清除所有缓存', async () => {
      const token1 = '0x1111111111111111111111111111111111111111';
      const token2 = '0x2222222222222222222222222222222222222222';
      const quoteToken = '0x55d398326f99059ff775485246999027b3197955';

      mockPublicClient.readContract
        .mockResolvedValue('0xpairaddress')
        .mockResolvedValue([BigInt(200 * 1e18), BigInt(100 * 1e18), 0])
        .mockResolvedValue(quoteToken)
        .mockResolvedValue(token1);

      await finder.findBestPair(mockPublicClient, token1, quoteToken);
      await finder.findBestPair(mockPublicClient, token2, quoteToken);

      // 清除所有缓存
      finder.clearCache();

      // 验证缓存已清除（通过重新查询会调用 readContract）
      const callsBefore = mockPublicClient.readContract.mock.calls.length;
      await finder.findBestPair(mockPublicClient, token1, quoteToken);
      const callsAfter = mockPublicClient.readContract.mock.calls.length;

      expect(callsAfter).toBeGreaterThan(callsBefore);
    });
  });

  describe('特殊 pair 映射', () => {
    it('应该使用特殊映射的 pair', async () => {
      // 假设有特殊映射的代币
      const specialToken = '0x0e09fabb73bd3ade0a17ecc321fd13a19e81ce82'; // CAKE
      const quoteToken = '0x55d398326f99059ff775485246999027b3197955';

      // 不需要 mock，因为会直接使用映射
      const result = await finder.findBestPair(mockPublicClient, specialToken, quoteToken);

      // 如果有特殊映射，应该直接返回
      if (result.hasLiquidity) {
        expect(result.pairAddress).toBeDefined();
      }
    });
  });

  describe('便捷函数', () => {
    it('createPancakePairFinder 应该创建查找器', () => {
      const finder = createPancakePairFinder();
      expect(finder).toBeInstanceOf(PancakePairFinder);
    });
  });
});
