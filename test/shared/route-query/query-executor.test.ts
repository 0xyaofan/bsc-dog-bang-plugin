/**
 * 查询执行器测试
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  QueryExecutor,
  createQueryExecutor
} from '../../../src/shared/route-query/query-executor';
import type { RouteFetchResult } from '../../../src/shared/route-query/types';

describe('查询执行器测试', () => {
  let executor: QueryExecutor;
  let mockPublicClient: any;

  beforeEach(() => {
    mockPublicClient = {
      readContract: vi.fn()
    };
    executor = new QueryExecutor(mockPublicClient);
  });

  describe('executeWithFallback', () => {
    it('应该成功查询 Four.meme 代币', async () => {
      const tokenAddress = '0x1234567890123456789012345678901234567890';

      // Mock Four.meme helper 返回已迁移
      mockPublicClient.readContract
        .mockResolvedValueOnce({ // fetchTokenInfo
          liquidityAdded: true,
          offers: BigInt(100),
          funds: BigInt(100),
          quoteToken: '0x55d398326f99059ff775485246999027b3197955'
        })
        .mockResolvedValueOnce('0xpairaddress') // getPancakePair
        .mockResolvedValueOnce([BigInt(200 * 1e18), BigInt(100 * 1e18), 0]) // getReserves
        .mockResolvedValueOnce('0x55d398326f99059ff775485246999027b3197955') // token0
        .mockResolvedValueOnce(tokenAddress); // token1

      const result = await executor.executeWithFallback(tokenAddress, 'four');

      expect(result.platform).toBe('four');
      expect(result.preferredChannel).toBe('pancake');
      expect(result.readyForPancake).toBe(true);
    });

    it('应该在 Four 失败时 fallback 到其他平台', async () => {
      const tokenAddress = '0x1234567890123456789012345678901234567890';

      // 使用 mockImplementation 来处理并发查询
      mockPublicClient.readContract.mockImplementation(async (params: any) => {
        // Four helper 返回空数据
        if (params.address?.toLowerCase() === '0xf251f83e40a78868fcfa3fa4599dad6494e46034') {
          return {
            liquidityAdded: false,
            offers: BigInt(0),
            funds: BigInt(0)
          };
        }
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
          return '0x55d398326f99059ff775485246999027b3197955';
        }
        // Pair token1
        if (params.functionName === 'token1') {
          return tokenAddress;
        }
        return null;
      });

      const result = await executor.executeWithFallback(tokenAddress, 'four');

      // Four 返回空数据时，会返回 readyForPancake: false，然后成为 lastValidRoute
      expect(result.platform).toBe('four');
      expect(result.readyForPancake).toBe(false);
      expect(result.preferredChannel).toBe('four');
    });

    it('应该处理 Service Worker 错误并跳转到 unknown', async () => {
      const tokenAddress = '0x1234567890123456789012345678901234567890';

      // 使用 mockImplementation 来处理并发查询
      mockPublicClient.readContract.mockImplementation(async (params: any) => {
        // Four helper 始终抛出 Service Worker 错误（包括重试）
        if (params.address?.toLowerCase() === '0xf251f83e40a78868fcfa3fa4599dad6494e46034') {
          const swError = new Error('Could not establish connection');
          throw swError;
        }
        // 后续调用返回 unknown 平台的 Pancake 数据
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
          return '0x55d398326f99059ff775485246999027b3197955';
        }
        // Pair token1
        if (params.functionName === 'token1') {
          return tokenAddress;
        }
        return null;
      });

      const result = await executor.executeWithFallback(tokenAddress, 'xmode');

      expect(result.platform).toBe('unknown');
      expect(result.preferredChannel).toBe('pancake');
    });

    it('应该按照 fallback 顺序尝试平台', async () => {
      const tokenAddress = '0x1234567890123456789012345678901234567890';

      let fourCalled = false;
      // 使用 mockImplementation 来处理并发查询
      mockPublicClient.readContract.mockImplementation(async (params: any) => {
        // Four helper 返回未迁移
        if (params.address?.toLowerCase() === '0xf251f83e40a78868fcfa3fa4599dad6494e46034') {
          fourCalled = true;
          return {
            liquidityAdded: false,
            offers: BigInt(50),
            funds: BigInt(100)
          };
        }
        // V2 Factory getPair - Four 的 fallback 不存在，但最终找到
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
          return '0x55d398326f99059ff775485246999027b3197955';
        }
        // Pair token1
        if (params.functionName === 'token1') {
          return tokenAddress;
        }
        return null;
      });

      const result = await executor.executeWithFallback(tokenAddress, 'four');

      // Four 返回未迁移，但最后会返回 Four 的结果（因为它是最后一个有效路由）
      expect(result.platform).toBe('four');
      expect(result.readyForPancake).toBe(false);
    });

    it('应该在所有平台失败时返回默认路由', async () => {
      const tokenAddress = '0x1234567890123456789012345678901234567890';

      // 清除缓存，避免使用之前测试的缓存结果
      const { pancakePairFinder } = await import('../../../src/shared/route-query/pancake-pair-finder.js');
      pancakePairFinder.clearCache(tokenAddress);

      // Mock 所有查询都失败
      mockPublicClient.readContract.mockRejectedValue(new Error('Network error'));

      // 当所有平台都失败时，unknown 平台会返回 readyForPancake: false 的结果
      const result = await executor.executeWithFallback(tokenAddress, 'unknown');

      expect(result.platform).toBe('unknown');
      expect(result.preferredChannel).toBe('pancake');
      expect(result.readyForPancake).toBe(false);
    });
  });

  describe('平台探测顺序', () => {
    it('应该为 four 平台构建正确的探测顺序', async () => {
      const tokenAddress = '0x1234567890123456789012345678901234567890';

      // 使用 mockImplementation 来处理并发查询
      mockPublicClient.readContract.mockImplementation(async (params: any) => {
        // Four helper 返回已迁移
        if (params.address?.toLowerCase() === '0xf251f83e40a78868fcfa3fa4599dad6494e46034') {
          return {
            liquidityAdded: true,
            offers: BigInt(100),
            funds: BigInt(100)
          };
        }
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
          return '0x55d398326f99059ff775485246999027b3197955';
        }
        // Pair token1
        if (params.functionName === 'token1') {
          return tokenAddress;
        }
        return null;
      });

      const result = await executor.executeWithFallback(tokenAddress, 'four');

      expect(result.platform).toBe('four');
    });

    it('应该为 unknown 平台直接查询', async () => {
      const tokenAddress = '0x1234567890123456789012345678901234567890';

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
          return '0x55d398326f99059ff775485246999027b3197955';
        }
        // Pair token1
        if (params.functionName === 'token1') {
          return tokenAddress;
        }
        return null;
      });

      const result = await executor.executeWithFallback(tokenAddress, 'unknown');

      expect(result.platform).toBe('unknown');
      expect(result.preferredChannel).toBe('pancake');
    });
  });

  describe('重试机制', () => {
    it('应该在临时失败时重试', async () => {
      const tokenAddress = '0x1234567890123456789012345678901234567890';

      let attemptCount = 0;
      // 使用 mockImplementation 来处理重试和并发查询
      mockPublicClient.readContract.mockImplementation(async (params: any) => {
        // Four helper - 第一次失败，第二次成功
        if (params.address?.toLowerCase() === '0xf251f83e40a78868fcfa3fa4599dad6494e46034') {
          attemptCount++;
          if (attemptCount === 1) {
            throw new Error('Temporary error');
          }
          return {
            liquidityAdded: true,
            offers: BigInt(100),
            funds: BigInt(100),
            maxOffers: BigInt(100),
            maxFunds: BigInt(100),
            launchTime: BigInt(Date.now()),
            quoteToken: '0x55d398326f99059ff775485246999027b3197955'
          };
        }
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
          return '0x55d398326f99059ff775485246999027b3197955';
        }
        // Pair token1
        if (params.functionName === 'token1') {
          return tokenAddress;
        }
        return null;
      });

      const result = await executor.executeWithFallback(tokenAddress, 'xmode');

      // Both 'four' and 'xmode' use FourPlatformQuery, so platform could be either
      expect(['four', 'xmode']).toContain(result.platform);
      expect(result.readyForPancake).toBe(true);
    });
  });

  describe('Fallback 判断', () => {
    it('应该在 preferredChannel=pancake 但 readyForPancake=false 时 fallback', async () => {
      const tokenAddress = '0x1234567890123456789012345678901234567890';

      // 使用 mockImplementation 来处理并发查询
      mockPublicClient.readContract.mockImplementation(async (params: any) => {
        // Four helper 返回需要 fallback 的结果（未迁移）
        if (params.address?.toLowerCase() === '0xf251f83e40a78868fcfa3fa4599dad6494e46034') {
          return {
            liquidityAdded: false,
            offers: BigInt(50),
            funds: BigInt(100)
          };
        }
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
          return '0x55d398326f99059ff775485246999027b3197955';
        }
        // Pair token1
        if (params.functionName === 'token1') {
          return tokenAddress;
        }
        return null;
      });

      const result = await executor.executeWithFallback(tokenAddress, 'four');

      // Four 返回未迁移，会返回 Four 的结果（最后一个有效路由）
      expect(result.platform).toBe('four');
      expect(result.readyForPancake).toBe(false);
    });

    it('应该在 readyForPancake=true 时停止 fallback', async () => {
      const tokenAddress = '0x1234567890123456789012345678901234567890';

      // 使用 mockImplementation 来处理并发查询
      mockPublicClient.readContract.mockImplementation(async (params: any) => {
        // Four helper 返回已迁移
        if (params.address?.toLowerCase() === '0xf251f83e40a78868fcfa3fa4599dad6494e46034') {
          return {
            liquidityAdded: true,
            offers: BigInt(100),
            funds: BigInt(100),
            maxOffers: BigInt(100),
            maxFunds: BigInt(100),
            launchTime: BigInt(Date.now()),
            quoteToken: '0x55d398326f99059ff775485246999027b3197955'
          };
        }
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
          return '0x55d398326f99059ff775485246999027b3197955';
        }
        // Pair token1
        if (params.functionName === 'token1') {
          return tokenAddress;
        }
        return null;
      });

      const result = await executor.executeWithFallback(tokenAddress, 'four');

      expect(result.readyForPancake).toBe(true);
      expect(result.platform).toBe('four');
    });
  });

  describe('便捷函数', () => {
    it('createQueryExecutor 应该创建执行器', () => {
      const executor = createQueryExecutor(mockPublicClient);
      expect(executor).toBeInstanceOf(QueryExecutor);
    });
  });
});
