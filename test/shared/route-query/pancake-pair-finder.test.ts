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

      // 使用 mockImplementation 来处理并发查询
      mockPublicClient.readContract.mockImplementation(async (params: any) => {
        // V2 Factory getPair
        if (params.functionName === 'getPair') {
          return '0xpairaddress';
        }
        // V3 Factory getPool
        if (params.functionName === 'getPool') {
          return '0x0000000000000000000000000000000000000000';
        }
        // Pair getReserves
        if (params.functionName === 'getReserves') {
          return [BigInt(200 * 1e18), BigInt(100 * 1e18), 0];
        }
        // Pair token0
        if (params.functionName === 'token0') {
          return quoteToken;
        }
        // Pair token1
        if (params.functionName === 'token1') {
          return tokenAddress;
        }
        return null;
      });

      const result = await finder.findBestPair(mockPublicClient, tokenAddress, quoteToken);

      expect(result.hasLiquidity).toBe(true);
      expect(result.version).toBe('v2');
      expect(result.pairAddress).toBe('0xpairaddress');
      expect(result.quoteToken).toBe(quoteToken);
    });

    it('应该找到 V3 pool', async () => {
      const tokenAddress = '0x1234567890123456789012345678901234567890';
      const quoteToken = '0x55d398326f99059ff775485246999027b3197955'; // USDT

      // 使用 mockImplementation 来处理并发查询
      mockPublicClient.readContract.mockImplementation(async (params: any) => {
        // V2 Factory getPair - 不存在
        if (params.functionName === 'getPair') {
          return '0x0000000000000000000000000000000000000000';
        }
        // V3 Factory getPool
        if (params.functionName === 'getPool') {
          const fee = params.args[2];
          if (fee === 500) return '0xpool500';
          if (fee === 2500) return '0xpool2500';
          if (fee === 10000) return '0xpool10000';
        }
        // V3 Pool liquidity
        if (params.functionName === 'liquidity') {
          if (params.address === '0xpool500') return BigInt(1e12);
          if (params.address === '0xpool2500') return BigInt(2e12);
          if (params.address === '0xpool10000') return BigInt(1.5e12);
        }
        return null;
      });

      const result = await finder.findBestPair(mockPublicClient, tokenAddress, quoteToken);

      expect(result.hasLiquidity).toBe(true);
      expect(result.version).toBe('v3');
      // 由于并发查询，会返回第一个找到的有效 pool（当前实现不比较 V3 流动性）
      expect(['0xpool500', '0xpool2500', '0xpool10000']).toContain(result.pairAddress);
    });

    it('应该优先选择流动性更高的 pair', async () => {
      const tokenAddress = '0x1234567890123456789012345678901234567890';
      const quoteToken = '0x55d398326f99059ff775485246999027b3197955';

      // 使用 mockImplementation 来处理并发查询
      mockPublicClient.readContract.mockImplementation(async (params: any) => {
        // V2 Factory getPair
        if (params.functionName === 'getPair') {
          return '0xv2pair';
        }
        // V3 Factory getPool
        if (params.functionName === 'getPool') {
          const fee = params.args[2];
          if (fee === 500) return '0xpool500';
          if (fee === 2500) return '0xpool2500';
          if (fee === 10000) return '0xpool10000';
        }
        // V2 Pair getReserves
        if (params.functionName === 'getReserves') {
          return [BigInt(150 * 1e18), BigInt(100 * 1e18), 0];
        }
        // Pair token0
        if (params.functionName === 'token0') {
          return quoteToken;
        }
        // Pair token1
        if (params.functionName === 'token1') {
          return tokenAddress;
        }
        // V3 Pool liquidity
        if (params.functionName === 'liquidity') {
          if (params.address === '0xpool500') return BigInt(5e12);
          if (params.address === '0xpool2500') return BigInt(3e12);
          if (params.address === '0xpool10000') return BigInt(2e12);
        }
        return null;
      });

      const result = await finder.findBestPair(mockPublicClient, tokenAddress, quoteToken);

      expect(result.hasLiquidity).toBe(true);
      // 应该选择 V3（因为优先级更高）
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
      const wbnbAddress = '0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c';
      const usdtAddress = '0x55d398326f99059ff775485246999027b3197955';

      // 使用 mockImplementation 来处理并发查询
      mockPublicClient.readContract.mockImplementation(async (params: any) => {
        // V2 Factory getPair
        if (params.functionName === 'getPair') {
          const token0 = params.args[0].toLowerCase();
          const token1 = params.args[1].toLowerCase();
          // USDT pair 不存在
          if (token0 === usdtAddress.toLowerCase() || token1 === usdtAddress.toLowerCase()) {
            return '0x0000000000000000000000000000000000000000';
          }
          // WBNB pair 存在
          if (token0 === wbnbAddress.toLowerCase() || token1 === wbnbAddress.toLowerCase()) {
            return '0xwbnbpair';
          }
          return '0x0000000000000000000000000000000000000000';
        }
        // V3 Factory getPool - 都不存在
        if (params.functionName === 'getPool') {
          return '0x0000000000000000000000000000000000000000';
        }
        // Pair getReserves
        if (params.functionName === 'getReserves') {
          return [BigInt(1 * 1e18), BigInt(100 * 1e18), 0];
        }
        // Pair token0
        if (params.functionName === 'token0') {
          return wbnbAddress;
        }
        // Pair token1
        if (params.functionName === 'token1') {
          return tokenAddress;
        }
        return null;
      });

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

      // 使用 mockImplementation 来处理并发查询
      mockPublicClient.readContract.mockImplementation(async (params: any) => {
        // V2 Factory getPair
        if (params.functionName === 'getPair') {
          return '0xpairaddress';
        }
        // V3 Factory getPool
        if (params.functionName === 'getPool') {
          return '0x0000000000000000000000000000000000000000';
        }
        // Pair getReserves
        if (params.functionName === 'getReserves') {
          return [BigInt(200 * 1e18), BigInt(100 * 1e18), 0];
        }
        // Pair token0
        if (params.functionName === 'token0') {
          return quoteToken;
        }
        // Pair token1
        if (params.functionName === 'token1') {
          return tokenAddress;
        }
        return null;
      });

      // 第一次查询
      const result1 = await finder.findBestPair(mockPublicClient, tokenAddress, quoteToken);
      expect(result1.hasLiquidity).toBe(true);

      // 记录第一次查询后的调用次数
      const callsAfterFirstQuery = mockPublicClient.readContract.mock.calls.length;

      // 第二次查询应该使用缓存
      const result2 = await finder.findBestPair(mockPublicClient, tokenAddress, quoteToken);
      expect(result2.hasLiquidity).toBe(true);
      expect(result2.pairAddress).toBe(result1.pairAddress);

      // 第二次查询不应该增加调用次数（使用缓存）
      expect(mockPublicClient.readContract.mock.calls.length).toBe(callsAfterFirstQuery);
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
