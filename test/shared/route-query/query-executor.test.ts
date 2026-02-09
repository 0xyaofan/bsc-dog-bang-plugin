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

      // Mock Four 返回空数据
      mockPublicClient.readContract
        .mockResolvedValueOnce({ // Four helper 返回空
          liquidityAdded: false,
          offers: BigInt(0),
          funds: BigInt(0)
        })
        // Mock Pancake fallback
        .mockResolvedValueOnce('0xpairaddress') // V2 getPair
        .mockResolvedValueOnce([BigInt(200 * 1e18), BigInt(100 * 1e18), 0]) // reserves
        .mockResolvedValueOnce('0x55d398326f99059ff775485246999027b3197955') // token0
        .mockResolvedValueOnce(tokenAddress); // token1

      const result = await executor.executeWithFallback(tokenAddress, 'four');

      expect(result.found).toBe(true);
      expect(result.preferredChannel).toBe('pancake');
    });

    it('应该处理 Service Worker 错误并跳转到 unknown', async () => {
      const tokenAddress = '0x1234567890123456789012345678901234567890';

      // Mock Service Worker 错误
      const swError = new Error('Service Worker error');
      (swError as any).message = 'Could not establish connection';
      mockPublicClient.readContract
        .mockRejectedValueOnce(swError) // Four 查询失败
        // Mock unknown 平台查询
        .mockResolvedValueOnce('0xpairaddress') // Pancake V2
        .mockResolvedValueOnce([BigInt(200 * 1e18), BigInt(100 * 1e18), 0])
        .mockResolvedValueOnce('0x55d398326f99059ff775485246999027b3197955')
        .mockResolvedValueOnce(tokenAddress);

      const result = await executor.executeWithFallback(tokenAddress, 'four');

      expect(result.platform).toBe('unknown');
      expect(result.preferredChannel).toBe('pancake');
    });

    it('应该按照 fallback 顺序尝试平台', async () => {
      const tokenAddress = '0x1234567890123456789012345678901234567890';

      // Mock 所有平台都返回需要 fallback 的结果
      mockPublicClient.readContract
        // Four 返回未迁移
        .mockResolvedValueOnce({
          liquidityAdded: false,
          offers: BigInt(50),
          funds: BigInt(100)
        })
        // Pancake fallback 未找到
        .mockResolvedValueOnce('0x0000000000000000000000000000000000000000')
        .mockResolvedValueOnce('0x0000000000000000000000000000000000000000')
        .mockResolvedValueOnce('0x0000000000000000000000000000000000000000')
        .mockResolvedValueOnce('0x0000000000000000000000000000000000000000')
        // 最终 unknown 平台找到
        .mockResolvedValueOnce('0xpairaddress')
        .mockResolvedValueOnce([BigInt(200 * 1e18), BigInt(100 * 1e18), 0])
        .mockResolvedValueOnce('0x55d398326f99059ff775485246999027b3197955')
        .mockResolvedValueOnce(tokenAddress);

      const result = await executor.executeWithFallback(tokenAddress, 'four');

      expect(result.found).toBe(true);
    });

    it('应该在所有平台失败时返回默认路由', async () => {
      const tokenAddress = '0x1234567890123456789012345678901234567890';

      // Mock 所有查询都失败
      mockPublicClient.readContract.mockRejectedValue(new Error('Network error'));

      const result = await executor.executeWithFallback(tokenAddress, 'unknown');

      expect(result.platform).toBe('unknown');
      expect(result.preferredChannel).toBe('pancake');
      expect(result.readyForPancake).toBe(true);
    });
  });

  describe('平台探测顺序', () => {
    it('应该为 four 平台构建正确的探测顺序', async () => {
      const tokenAddress = '0x1234567890123456789012345678901234567890';

      // Mock 返回成功结果以快速完成
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

      const result = await executor.executeWithFallback(tokenAddress, 'four');

      expect(result.platform).toBe('four');
    });

    it('应该为 unknown 平台直接查询', async () => {
      const tokenAddress = '0x1234567890123456789012345678901234567890';

      mockPublicClient.readContract
        .mockResolvedValueOnce('0xpairaddress')
        .mockResolvedValueOnce([BigInt(200 * 1e18), BigInt(100 * 1e18), 0])
        .mockResolvedValueOnce('0x55d398326f99059ff775485246999027b3197955')
        .mockResolvedValueOnce(tokenAddress);

      const result = await executor.executeWithFallback(tokenAddress, 'unknown');

      expect(result.platform).toBe('unknown');
      expect(result.preferredChannel).toBe('pancake');
    });
  });

  describe('重试机制', () => {
    it('应该在临时失败时重试', async () => {
      const tokenAddress = '0x1234567890123456789012345678901234567890';

      // 第一次失败，第二次成功
      mockPublicClient.readContract
        .mockRejectedValueOnce(new Error('Temporary error'))
        .mockResolvedValueOnce({
          liquidityAdded: true,
          offers: BigInt(100),
          funds: BigInt(100)
        })
        .mockResolvedValueOnce('0xpairaddress')
        .mockResolvedValueOnce([BigInt(200 * 1e18), BigInt(100 * 1e18), 0])
        .mockResolvedValueOnce('0x55d398326f99059ff775485246999027b3197955')
        .mockResolvedValueOnce(tokenAddress);

      const result = await executor.executeWithFallback(tokenAddress, 'four');

      expect(result.platform).toBe('four');
      expect(result.readyForPancake).toBe(true);
    });
  });

  describe('Fallback 判断', () => {
    it('应该在 preferredChannel=pancake 但 readyForPancake=false 时 fallback', async () => {
      const tokenAddress = '0x1234567890123456789012345678901234567890';

      // Mock Four 返回需要 fallback 的结果
      mockPublicClient.readContract
        .mockResolvedValueOnce({
          liquidityAdded: false,
          offers: BigInt(50),
          funds: BigInt(100)
        })
        // Pancake fallback
        .mockResolvedValueOnce('0xpairaddress')
        .mockResolvedValueOnce([BigInt(200 * 1e18), BigInt(100 * 1e18), 0])
        .mockResolvedValueOnce('0x55d398326f99059ff775485246999027b3197955')
        .mockResolvedValueOnce(tokenAddress);

      const result = await executor.executeWithFallback(tokenAddress, 'four');

      expect(result.found).toBe(true);
    });

    it('应该在 readyForPancake=true 时停止 fallback', async () => {
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
