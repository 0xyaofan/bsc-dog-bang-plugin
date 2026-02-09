/**
 * 流动性检查器测试
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  LiquidityChecker,
  createLiquidityChecker
} from '../../../src/shared/route-query/liquidity-checker';
import { InsufficientLiquidityError } from '../../../src/shared/route-query/errors';

describe('流动性检查器测试', () => {
  let checker: LiquidityChecker;
  let mockPublicClient: any;

  beforeEach(() => {
    checker = new LiquidityChecker();
    mockPublicClient = {
      readContract: vi.fn()
    };
  });

  describe('checkV2PairLiquidity', () => {
    it('应该检查 V2 pair 流动性充足', async () => {
      const pairAddress = '0x1234567890123456789012345678901234567890';
      const tokenAddress = '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd';
      const quoteToken = '0x55d398326f99059ff775485246999027b3197955'; // USDT

      // Mock getReserves
      mockPublicClient.readContract
        .mockResolvedValueOnce([BigInt(200 * 1e18), BigInt(100 * 1e18), 0]) // reserves
        .mockResolvedValueOnce(quoteToken) // token0
        .mockResolvedValueOnce(tokenAddress); // token1

      const result = await checker.checkV2PairLiquidity(
        mockPublicClient,
        pairAddress,
        tokenAddress,
        quoteToken
      );

      expect(result).toBe(true);
    });

    it('应该检查 V2 pair 流动性不足', async () => {
      const pairAddress = '0x1234567890123456789012345678901234567890';
      const tokenAddress = '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd';
      const quoteToken = '0x55d398326f99059ff775485246999027b3197955'; // USDT

      // Mock getReserves - 流动性不足
      mockPublicClient.readContract
        .mockResolvedValueOnce([BigInt(50 * 1e18), BigInt(100 * 1e18), 0]) // reserves
        .mockResolvedValueOnce(quoteToken) // token0
        .mockResolvedValueOnce(tokenAddress); // token1

      const result = await checker.checkV2PairLiquidity(
        mockPublicClient,
        pairAddress,
        tokenAddress,
        quoteToken
      );

      expect(result).toBe(false);
    });

    it('应该处理报价代币不匹配', async () => {
      const pairAddress = '0x1234567890123456789012345678901234567890';
      const tokenAddress = '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd';
      const quoteToken = '0x55d398326f99059ff775485246999027b3197955';

      // Mock - token0 和 token1 都不是 quoteToken
      mockPublicClient.readContract
        .mockResolvedValueOnce([BigInt(200 * 1e18), BigInt(100 * 1e18), 0])
        .mockResolvedValueOnce('0x1111111111111111111111111111111111111111')
        .mockResolvedValueOnce('0x2222222222222222222222222222222222222222');

      const result = await checker.checkV2PairLiquidity(
        mockPublicClient,
        pairAddress,
        tokenAddress,
        quoteToken
      );

      expect(result).toBe(false);
    });

    it('应该处理查询失败', async () => {
      mockPublicClient.readContract.mockRejectedValue(new Error('Network error'));

      const result = await checker.checkV2PairLiquidity(
        mockPublicClient,
        '0x1234567890123456789012345678901234567890',
        '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd',
        '0x55d398326f99059ff775485246999027b3197955'
      );

      expect(result).toBe(false);
    });
  });

  describe('checkV3PoolLiquidity', () => {
    it('应该检查 V3 pool 流动性充足', async () => {
      const poolAddress = '0x1234567890123456789012345678901234567890';

      mockPublicClient.readContract.mockResolvedValue(BigInt(1e12)); // 充足的流动性

      const result = await checker.checkV3PoolLiquidity(mockPublicClient, poolAddress);

      expect(result).toBe(true);
    });

    it('应该检查 V3 pool 流动性不足', async () => {
      const poolAddress = '0x1234567890123456789012345678901234567890';

      mockPublicClient.readContract.mockResolvedValue(BigInt(1e8)); // 不足的流动性

      const result = await checker.checkV3PoolLiquidity(mockPublicClient, poolAddress);

      expect(result).toBe(false);
    });

    it('应该处理查询失败', async () => {
      mockPublicClient.readContract.mockRejectedValue(new Error('Network error'));

      const result = await checker.checkV3PoolLiquidity(
        mockPublicClient,
        '0x1234567890123456789012345678901234567890'
      );

      expect(result).toBe(false);
    });
  });

  describe('getQuoteReserve', () => {
    it('应该获取报价代币储备量（token0）', async () => {
      const pairAddress = '0x1234567890123456789012345678901234567890';
      const quoteToken = '0x55d398326f99059ff775485246999027b3197955';

      mockPublicClient.readContract
        .mockResolvedValueOnce([BigInt(200 * 1e18), BigInt(100 * 1e18), 0])
        .mockResolvedValueOnce(quoteToken)
        .mockResolvedValueOnce('0xabcdefabcdefabcdefabcdefabcdefabcdefabcd');

      const reserve = await checker.getQuoteReserve(mockPublicClient, pairAddress, quoteToken);

      expect(reserve).toBe(BigInt(200 * 1e18));
    });

    it('应该获取报价代币储备量（token1）', async () => {
      const pairAddress = '0x1234567890123456789012345678901234567890';
      const quoteToken = '0x55d398326f99059ff775485246999027b3197955';

      mockPublicClient.readContract
        .mockResolvedValueOnce([BigInt(200 * 1e18), BigInt(100 * 1e18), 0])
        .mockResolvedValueOnce('0xabcdefabcdefabcdefabcdefabcdefabcdefabcd')
        .mockResolvedValueOnce(quoteToken);

      const reserve = await checker.getQuoteReserve(mockPublicClient, pairAddress, quoteToken);

      expect(reserve).toBe(BigInt(100 * 1e18));
    });

    it('应该处理报价代币不匹配', async () => {
      const pairAddress = '0x1234567890123456789012345678901234567890';
      const quoteToken = '0x55d398326f99059ff775485246999027b3197955';

      mockPublicClient.readContract
        .mockResolvedValueOnce([BigInt(200 * 1e18), BigInt(100 * 1e18), 0])
        .mockResolvedValueOnce('0x1111111111111111111111111111111111111111')
        .mockResolvedValueOnce('0x2222222222222222222222222222222222222222');

      const reserve = await checker.getQuoteReserve(mockPublicClient, pairAddress, quoteToken);

      expect(reserve).toBeNull();
    });

    it('应该处理查询失败', async () => {
      mockPublicClient.readContract.mockRejectedValue(new Error('Network error'));

      const reserve = await checker.getQuoteReserve(
        mockPublicClient,
        '0x1234567890123456789012345678901234567890',
        '0x55d398326f99059ff775485246999027b3197955'
      );

      expect(reserve).toBeNull();
    });
  });

  describe('getMinLiquidityThreshold', () => {
    it('应该获取 USDT 的阈值', () => {
      const threshold = checker.getMinLiquidityThreshold('0x55d398326f99059ff775485246999027b3197955');
      expect(threshold).toBe(BigInt(100 * 1e18));
    });

    it('应该获取 WBNB 的阈值', () => {
      const threshold = checker.getMinLiquidityThreshold('0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c');
      expect(threshold).toBe(BigInt(0.2 * 1e18));
    });

    it('应该获取默认阈值', () => {
      const threshold = checker.getMinLiquidityThreshold('0x1234567890123456789012345678901234567890');
      expect(threshold).toBe(BigInt(100 * 1e18));
    });

    it('应该处理大小写', () => {
      const threshold = checker.getMinLiquidityThreshold('0x55D398326F99059FF775485246999027B3197955');
      expect(threshold).toBe(BigInt(100 * 1e18));
    });
  });

  describe('validateLiquidity', () => {
    it('应该验证流动性充足', () => {
      expect(() => {
        checker.validateLiquidity(
          BigInt(200 * 1e18),
          BigInt(100 * 1e18),
          '0x1234567890123456789012345678901234567890',
          '0x55d398326f99059ff775485246999027b3197955'
        );
      }).not.toThrow();
    });

    it('应该验证流动性不足并抛出错误', () => {
      expect(() => {
        checker.validateLiquidity(
          BigInt(50 * 1e18),
          BigInt(100 * 1e18),
          '0x1234567890123456789012345678901234567890',
          '0x55d398326f99059ff775485246999027b3197955'
        );
      }).toThrow(InsufficientLiquidityError);
    });
  });

  describe('便捷函数', () => {
    it('createLiquidityChecker 应该创建检查器', () => {
      const checker = createLiquidityChecker();
      expect(checker).toBeInstanceOf(LiquidityChecker);
    });
  });
});
