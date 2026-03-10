import { describe, it, expect, vi, beforeEach } from 'vitest';
import { resolveV3FeeTier } from '../../src/background/custom-aggregator-agent';

/**
 * V3 Fee Tier 选择测试
 *
 * 测试目标：确保 resolveV3FeeTier 函数选择流动性最高的 fee tier
 *
 * Bug 背景：
 * - 问题代币：0x1d507b4a7e9301e41d86892c1ecd86cfc0694444（Four.meme, USD1 筹集）
 * - 问题：盲目选择第一个找到的 pool (0.01% fee)，流动性极低
 * - 结果：32 USD1 → ~0 WBNB（严重滑点）
 * - 修复：查询所有 fee tier 的流动性，选择最高的
 *
 * 测试范围：
 * - USD1/WBNB（问题代币）
 * - USDT/WBNB（其他稳定币）
 * - BUSD/WBNB（其他稳定币）
 * - 任何非 WBNB 筹集币种
 */

const MOCK_CONTRACTS = {
  PANCAKE_V3_FACTORY: '0x0BFbCF9fa4f9C56B0F40a671Ad40E0805A091865',
  WBNB: '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c',
  USD1: '0x3ba925fdeae6b46d0bb4d424d829982cb2f7309e',
  USDT: '0x55d398326f99059fF775485246999027B3197955',
  BUSD: '0xe9e7cea3dedca5984780bafc599bd69add087d56'
};

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

describe('V3 Fee Tier 选择测试', () => {
  let mockPublicClient: any;

  beforeEach(() => {
    mockPublicClient = {
      readContract: vi.fn()
    };
  });

  describe('流动性比较逻辑', () => {
    it('应该选择流动性最高的 fee tier（USD1 案例）', async () => {
      const tokenA = MOCK_CONTRACTS.USD1;
      const tokenB = MOCK_CONTRACTS.WBNB;

      // 模拟 V3 Factory 调用（查询每个 fee tier 的 pool）
      const mockPools = {
        100: '0x3d7C319090edf2293608a0f9a786317c66D320F8',  // 0.01% pool
        250: ZERO_ADDRESS,  // 不存在
        500: ZERO_ADDRESS,  // 不存在
        2500: '0x4a3218606AF9B4728a9F187E1c1a8c07fBC172a9', // 0.25% pool
        10000: ZERO_ADDRESS // 不存在
      };

      // 模拟流动性（通过 WBNB balanceOf pool）
      const mockLiquidities = {
        100: 10n * 10n ** 18n,    // 10 WBNB（流动性低）
        2500: 1000n * 10n ** 18n  // 1000 WBNB（流动性高）
      };

      // 设置 mock 返回值
      mockPublicClient.readContract
        // getPool(USD1, WBNB, 100)
        .mockResolvedValueOnce(mockPools[100])
        // balanceOf(0x3d7C...) - 获取 0.01% pool 的流动性
        .mockResolvedValueOnce(mockLiquidities[100])
        // getPool(USD1, WBNB, 250)
        .mockResolvedValueOnce(mockPools[250])
        // getPool(USD1, WBNB, 500)
        .mockResolvedValueOnce(mockPools[500])
        // getPool(USD1, WBNB, 2500)
        .mockResolvedValueOnce(mockPools[2500])
        // balanceOf(0x4a32...) - 获取 0.25% pool 的流动性
        .mockResolvedValueOnce(mockLiquidities[2500])
        // getPool(USD1, WBNB, 10000)
        .mockResolvedValueOnce(mockPools[10000]);

      const result = await resolveV3FeeTier(mockPublicClient, tokenA, tokenB);

      // 应该选择 2500 (0.25%)，因为流动性最高
      expect(result).toBe(2500);
    });

    it('应该选择流动性最高的 fee tier（USDT 案例）', async () => {
      const tokenA = MOCK_CONTRACTS.USDT;
      const tokenB = MOCK_CONTRACTS.WBNB;

      // 模拟 USDT/WBNB 有多个 pool
      const mockPools = {
        100: '0xPool100',  // 0.01% pool
        250: ZERO_ADDRESS,
        500: '0xPool500',  // 0.05% pool
        2500: ZERO_ADDRESS,
        10000: ZERO_ADDRESS
      };

      const mockLiquidities = {
        100: 500n * 10n ** 18n,   // 500 WBNB
        500: 2000n * 10n ** 18n   // 2000 WBNB（更高）
      };

      mockPublicClient.readContract
        .mockResolvedValueOnce(mockPools[100])
        .mockResolvedValueOnce(mockLiquidities[100])
        .mockResolvedValueOnce(mockPools[250])
        .mockResolvedValueOnce(mockPools[500])
        .mockResolvedValueOnce(mockLiquidities[500])
        .mockResolvedValueOnce(mockPools[2500])
        .mockResolvedValueOnce(mockPools[10000]);

      const result = await resolveV3FeeTier(mockPublicClient, tokenA, tokenB);

      // 应该选择 500 (0.05%)，因为流动性最高
      expect(result).toBe(500);
    });

    it('应该选择流动性最高的 fee tier（BUSD 案例）', async () => {
      const tokenA = MOCK_CONTRACTS.BUSD;
      const tokenB = MOCK_CONTRACTS.WBNB;

      // 模拟 BUSD/WBNB 只有一个 pool
      const mockPools = {
        100: ZERO_ADDRESS,
        250: ZERO_ADDRESS,
        500: '0xPoolBUSD',  // 0.05% pool
        2500: ZERO_ADDRESS,
        10000: ZERO_ADDRESS
      };

      const mockLiquidities = {
        500: 800n * 10n ** 18n   // 800 WBNB
      };

      mockPublicClient.readContract
        .mockResolvedValueOnce(mockPools[100])
        .mockResolvedValueOnce(mockPools[250])
        .mockResolvedValueOnce(mockPools[500])
        .mockResolvedValueOnce(mockLiquidities[500])
        .mockResolvedValueOnce(mockPools[2500])
        .mockResolvedValueOnce(mockPools[10000]);

      const result = await resolveV3FeeTier(mockPublicClient, tokenA, tokenB);

      // 应该选择 500 (0.05%)，因为只有这个 pool
      expect(result).toBe(500);
    });
  });

  describe('边界情况', () => {
    it('应该返回 null 如果所有 pool 都不存在', async () => {
      const tokenA = '0xNewToken';
      const tokenB = MOCK_CONTRACTS.WBNB;

      // 所有 fee tier 都返回零地址
      mockPublicClient.readContract
        .mockResolvedValue(ZERO_ADDRESS);

      const result = await resolveV3FeeTier(mockPublicClient, tokenA, tokenB);

      expect(result).toBe(null);
    });

    it('应该处理流动性为 0 的 pool', async () => {
      const tokenA = MOCK_CONTRACTS.USD1;
      const tokenB = MOCK_CONTRACTS.WBNB;

      const mockPools = {
        100: '0xPool100',
        250: ZERO_ADDRESS,
        500: '0xPool500',
        2500: ZERO_ADDRESS,
        10000: ZERO_ADDRESS
      };

      const mockLiquidities = {
        100: 0n,              // 流动性为 0
        500: 100n * 10n ** 18n // 100 WBNB
      };

      mockPublicClient.readContract
        .mockResolvedValueOnce(mockPools[100])
        .mockResolvedValueOnce(mockLiquidities[100])
        .mockResolvedValueOnce(mockPools[250])
        .mockResolvedValueOnce(mockPools[500])
        .mockResolvedValueOnce(mockLiquidities[500])
        .mockResolvedValueOnce(mockPools[2500])
        .mockResolvedValueOnce(mockPools[10000]);

      const result = await resolveV3FeeTier(mockPublicClient, tokenA, tokenB);

      // 应该选择 500，因为 100 流动性为 0
      expect(result).toBe(500);
    });

    it('应该处理 balanceOf 查询失败', async () => {
      const tokenA = MOCK_CONTRACTS.USD1;
      const tokenB = MOCK_CONTRACTS.WBNB;

      const mockPools = {
        100: '0xPool100',
        250: ZERO_ADDRESS,
        500: '0xPool500',
        2500: ZERO_ADDRESS,
        10000: ZERO_ADDRESS
      };

      mockPublicClient.readContract
        // getPool(100)
        .mockResolvedValueOnce(mockPools[100])
        // balanceOf - 失败
        .mockRejectedValueOnce(new Error('RPC error'))
        // getPool(250)
        .mockResolvedValueOnce(mockPools[250])
        // getPool(500)
        .mockResolvedValueOnce(mockPools[500])
        // balanceOf - 成功
        .mockResolvedValueOnce(100n * 10n ** 18n)
        // getPool(2500)
        .mockResolvedValueOnce(mockPools[2500])
        // getPool(10000)
        .mockResolvedValueOnce(mockPools[10000]);

      const result = await resolveV3FeeTier(mockPublicClient, tokenA, tokenB);

      // 应该选择 500，跳过失败的 100
      expect(result).toBe(500);
    });

    it('应该处理所有 pool 流动性都为 0 的情况', async () => {
      const tokenA = MOCK_CONTRACTS.USD1;
      const tokenB = MOCK_CONTRACTS.WBNB;

      const mockPools = {
        100: '0xPool100',
        250: '0xPool250',
        500: ZERO_ADDRESS,
        2500: ZERO_ADDRESS,
        10000: ZERO_ADDRESS
      };

      mockPublicClient.readContract
        .mockResolvedValueOnce(mockPools[100])
        .mockResolvedValueOnce(0n)  // 流动性为 0
        .mockResolvedValueOnce(mockPools[250])
        .mockResolvedValueOnce(0n)  // 流动性为 0
        .mockResolvedValueOnce(mockPools[500])
        .mockResolvedValueOnce(mockPools[2500])
        .mockResolvedValueOnce(mockPools[10000]);

      const result = await resolveV3FeeTier(mockPublicClient, tokenA, tokenB);

      // 应该返回 null，因为所有 pool 流动性都为 0
      expect(result).toBe(null);
    });
  });

  describe('回归测试 - 防止 Bug 复现', () => {
    it('[关键] 不应该盲目返回第一个找到的 pool', async () => {
      const tokenA = MOCK_CONTRACTS.USD1;
      const tokenB = MOCK_CONTRACTS.WBNB;

      // 模拟真实场景：0.01% pool 先被找到，但流动性极低
      const mockPools = {
        100: '0x3d7C319090edf2293608a0f9a786317c66D320F8',  // 先找到
        250: ZERO_ADDRESS,
        500: ZERO_ADDRESS,
        2500: '0x4a3218606AF9B4728a9F187E1c1a8c07fBC172a9', // 后找到
        10000: ZERO_ADDRESS
      };

      const mockLiquidities = {
        100: 10n * 10n ** 18n,    // 10 WBNB（极低）
        2500: 1000n * 10n ** 18n  // 1000 WBNB（高）
      };

      mockPublicClient.readContract
        .mockResolvedValueOnce(mockPools[100])
        .mockResolvedValueOnce(mockLiquidities[100])
        .mockResolvedValueOnce(mockPools[250])
        .mockResolvedValueOnce(mockPools[500])
        .mockResolvedValueOnce(mockPools[2500])
        .mockResolvedValueOnce(mockLiquidities[2500])
        .mockResolvedValueOnce(mockPools[10000]);

      const result = await resolveV3FeeTier(mockPublicClient, tokenA, tokenB);

      // 🚨 关键测试：必须选择 2500，而不是 100
      expect(result).toBe(2500);
      expect(result).not.toBe(100);
    });

    it('[关键] 应该对所有非 WBNB 筹集币种生效', async () => {
      const testTokens = [
        { name: 'USD1', address: MOCK_CONTRACTS.USD1 },
        { name: 'USDT', address: MOCK_CONTRACTS.USDT },
        { name: 'BUSD', address: MOCK_CONTRACTS.BUSD },
        { name: 'CustomToken', address: '0xCustomToken123' }
      ];

      for (const token of testTokens) {
        // 重置 mock
        mockPublicClient.readContract.mockClear();

        const mockPools = {
          100: '0xPoolLowLiquidity',
          250: ZERO_ADDRESS,
          500: ZERO_ADDRESS,
          2500: '0xPoolHighLiquidity',
          10000: ZERO_ADDRESS
        };

        const mockLiquidities = {
          100: 5n * 10n ** 18n,     // 5 WBNB
          2500: 500n * 10n ** 18n   // 500 WBNB
        };

        mockPublicClient.readContract
          .mockResolvedValueOnce(mockPools[100])
          .mockResolvedValueOnce(mockLiquidities[100])
          .mockResolvedValueOnce(mockPools[250])
          .mockResolvedValueOnce(mockPools[500])
          .mockResolvedValueOnce(mockPools[2500])
          .mockResolvedValueOnce(mockLiquidities[2500])
          .mockResolvedValueOnce(mockPools[10000]);

        const result = await resolveV3FeeTier(
          mockPublicClient,
          token.address,
          MOCK_CONTRACTS.WBNB
        );

        // 🚨 关键：对所有代币都应该选择流动性最高的
        expect(result).toBe(2500);
        expect(result).not.toBe(100);
      }
    });
  });

  describe('性能测试', () => {
    it('应该在合理时间内完成查询（< 5 次 RPC 调用查找 pool + N 次查询流动性）', async () => {
      const tokenA = MOCK_CONTRACTS.USD1;
      const tokenB = MOCK_CONTRACTS.WBNB;

      const mockPools = {
        100: '0xPool100',
        250: ZERO_ADDRESS,
        500: ZERO_ADDRESS,
        2500: '0xPool2500',
        10000: ZERO_ADDRESS
      };

      mockPublicClient.readContract
        .mockResolvedValueOnce(mockPools[100])
        .mockResolvedValueOnce(100n * 10n ** 18n)
        .mockResolvedValueOnce(mockPools[250])
        .mockResolvedValueOnce(mockPools[500])
        .mockResolvedValueOnce(mockPools[2500])
        .mockResolvedValueOnce(200n * 10n ** 18n)
        .mockResolvedValueOnce(mockPools[10000]);

      await resolveV3FeeTier(mockPublicClient, tokenA, tokenB);

      // 验证 RPC 调用次数：5 次 getPool + 2 次 balanceOf = 7 次
      expect(mockPublicClient.readContract).toHaveBeenCalledTimes(7);
    });
  });
});
