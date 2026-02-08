import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fetchRouteWithFallback } from '../../src/shared/token-route';

describe('流动性检查测试', () => {
  let mockPublicClient: any;

  beforeEach(() => {
    mockPublicClient = {
      readContract: vi.fn()
    };
  });

  describe('PancakeSwap V2 流动性检查', () => {
    it('应该检测到有效的 V2 流动性', async () => {
      const tokenAddress = '0x3753dd32cbc376ce6efd85f334b7289ae6d004af'; // KDOG

      // 模拟 getPancakePair 返回有效的 pair 地址
      mockPublicClient.readContract.mockResolvedValueOnce(
        '0x14C90904dD8868c8E748e42D092250Ec17f748d1' // pair address
      );

      // 模拟 getReserves 返回有效的储备量
      mockPublicClient.readContract.mockResolvedValueOnce({
        reserve0: 1000000000000000000000n, // 1000 tokens
        reserve1: 500000000000000000n,     // 0.5 BNB
        blockTimestampLast: Math.floor(Date.now() / 1000)
      });

      // 模拟 token0
      mockPublicClient.readContract.mockResolvedValueOnce(
        '0x3753dd32cbc376ce6efd85f334b7289ae6d004af'
      );

      const route = await fetchRouteWithFallback(mockPublicClient, tokenAddress, 'unknown');

      expect(route).toBeDefined();
      expect(route.platform).toBe('unknown');
      expect(route.preferredChannel).toBe('pancake');
      expect(route.readyForPancake).toBe(true);
    });

    it('应该处理零储备量的情况', async () => {
      const tokenAddress = '0x3753dd32cbc376ce6efd85f334b7289ae6d004af';

      // 模拟 getPancakePair 返回有效的 pair 地址
      mockPublicClient.readContract.mockResolvedValueOnce(
        '0x14C90904dD8868c8E748e42D092250Ec17f748d1'
      );

      // 模拟 getReserves 返回零储备量
      mockPublicClient.readContract.mockResolvedValueOnce({
        reserve0: 0n,
        reserve1: 0n,
        blockTimestampLast: Math.floor(Date.now() / 1000)
      });

      // 模拟 token0
      mockPublicClient.readContract.mockResolvedValueOnce(
        '0x3753dd32cbc376ce6efd85f334b7289ae6d004af'
      );

      const route = await fetchRouteWithFallback(mockPublicClient, tokenAddress, 'unknown');

      expect(route).toBeDefined();
      expect(route.platform).toBe('unknown');
    });

    it('应该处理 pair 不存在的情况', async () => {
      const tokenAddress = '0x3753dd32cbc376ce6efd85f334b7289ae6d004af';

      // 模拟 getPancakePair 返回零地址
      mockPublicClient.readContract.mockResolvedValueOnce(
        '0x0000000000000000000000000000000000000000'
      );

      const route = await fetchRouteWithFallback(mockPublicClient, tokenAddress, 'unknown');

      expect(route).toBeDefined();
      expect(route.platform).toBe('unknown');
    });
  });

  describe('多个 quote token 测试', () => {
    it('应该尝试多个 quote token', async () => {
      const tokenAddress = '0x3753dd32cbc376ce6efd85f334b7289ae6d004af';

      // 第一次尝试 WBNB - 失败
      mockPublicClient.readContract.mockResolvedValueOnce(
        '0x0000000000000000000000000000000000000000'
      );

      // 第二次尝试 USDT - 成功
      mockPublicClient.readContract.mockResolvedValueOnce(
        '0x14C90904dD8868c8E748e42D092250Ec17f748d1'
      );

      mockPublicClient.readContract.mockResolvedValueOnce({
        reserve0: 1000000000000000000000n,
        reserve1: 500000000000000000000n,
        blockTimestampLast: Math.floor(Date.now() / 1000)
      });

      mockPublicClient.readContract.mockResolvedValueOnce(
        '0x3753dd32cbc376ce6efd85f334b7289ae6d004af'
      );

      const route = await fetchRouteWithFallback(mockPublicClient, tokenAddress, 'unknown');

      expect(route).toBeDefined();
      expect(route.platform).toBe('unknown');
    });
  });

  describe('Service Worker 限制下的流动性检查', () => {
    it('应该在 Service Worker 错误时假设有流动性', async () => {
      const tokenAddress = '0x3753dd32cbc376ce6efd85f334b7289ae6d004af';

      mockPublicClient.readContract.mockRejectedValue(
        new Error('import() is disallowed on ServiceWorkerGlobalScope')
      );

      const route = await fetchRouteWithFallback(mockPublicClient, tokenAddress, 'unknown');

      expect(route).toBeDefined();
      expect(route.platform).toBe('unknown');
      expect(route.preferredChannel).toBe('pancake');
      expect(route.readyForPancake).toBe(true);
    });
  });

  describe('特殊配对映射测试', () => {
    it('应该使用特殊配对映射', async () => {
      // KDOG 有特殊配对映射到 KGST
      const tokenAddress = '0x3753dd32cbc376ce6efd85f334b7289ae6d004af';

      mockPublicClient.readContract.mockRejectedValue(
        new Error('import() is disallowed on ServiceWorkerGlobalScope')
      );

      const route = await fetchRouteWithFallback(mockPublicClient, tokenAddress, 'unknown');

      expect(route).toBeDefined();
      expect(route.platform).toBe('unknown');
      expect(route.readyForPancake).toBe(true);
    });
  });
});

describe('Four.meme 代币状态测试', () => {
  let mockPublicClient: any;

  beforeEach(() => {
    mockPublicClient = {
      readContract: vi.fn()
    };
  });

  describe('未迁移代币的不同阶段', () => {
    it('应该处理刚启动的代币（progress = 0）', async () => {
      const tokenAddress = '0xd86eb37348f72ddff0c0b9873531dd0fe4d7ffff';

      mockPublicClient.readContract.mockResolvedValue({
        liquidityAdded: false,
        quote: '0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c',
        launchTime: BigInt(Math.floor(Date.now() / 1000)),
        offers: 0n,
        maxOffers: 10000n,
        funds: 0n,
        maxFunds: 100000000000000000000n
      });

      const route = await fetchRouteWithFallback(mockPublicClient, tokenAddress, 'four');

      expect(route.platform).toBe('four');
      expect(route.progress).toBe(0);
      expect(route.readyForPancake).toBe(false);
    });

    it('应该处理进行中的代币（0 < progress < 1）', async () => {
      const tokenAddress = '0xd86eb37348f72ddff0c0b9873531dd0fe4d7ffff';

      mockPublicClient.readContract.mockResolvedValue({
        liquidityAdded: false,
        quote: '0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c',
        launchTime: BigInt(Math.floor(Date.now() / 1000)),
        offers: 5000n,
        maxOffers: 10000n,
        funds: 50000000000000000000n,
        maxFunds: 100000000000000000000n
      });

      const route = await fetchRouteWithFallback(mockPublicClient, tokenAddress, 'four');

      expect(route.platform).toBe('four');
      expect(route.progress).toBeGreaterThan(0);
      expect(route.progress).toBeLessThan(1);
      expect(route.readyForPancake).toBe(false);
    });

    it('应该处理即将完成的代币（progress 接近 1）', async () => {
      const tokenAddress = '0xd86eb37348f72ddff0c0b9873531dd0fe4d7ffff';

      mockPublicClient.readContract.mockResolvedValue({
        liquidityAdded: false,
        quote: '0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c',
        launchTime: BigInt(Math.floor(Date.now() / 1000)),
        offers: 9999n,
        maxOffers: 10000n,
        funds: 99999999999999999999n,
        maxFunds: 100000000000000000000n
      });

      const route = await fetchRouteWithFallback(mockPublicClient, tokenAddress, 'four');

      expect(route.platform).toBe('four');
      expect(route.progress).toBeGreaterThan(0.99);
      expect(route.progress).toBeLessThanOrEqual(1);
      expect(route.readyForPancake).toBe(false);
    });
  });

  describe('不同 quote token 的代币', () => {
    it('应该处理 WBNB 作为 quote token', async () => {
      const tokenAddress = '0xd86eb37348f72ddff0c0b9873531dd0fe4d7ffff';

      mockPublicClient.readContract.mockResolvedValue({
        liquidityAdded: false,
        quote: '0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c', // WBNB
        launchTime: BigInt(Math.floor(Date.now() / 1000)),
        offers: 5000n,
        maxOffers: 10000n,
        funds: 50000000000000000000n,
        maxFunds: 100000000000000000000n
      });

      const route = await fetchRouteWithFallback(mockPublicClient, tokenAddress, 'four');

      expect(route.platform).toBe('four');
      expect(route.quoteToken).toBe('0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c');
    });

    it('应该处理 USDT 作为 quote token', async () => {
      const tokenAddress = '0x3e2a009d420512627a2791be63eeb04c94674444';

      mockPublicClient.readContract.mockResolvedValue({
        liquidityAdded: false,
        quote: '0x55d398326f99059ff775485246999027b3197955', // USDT
        launchTime: BigInt(Math.floor(Date.now() / 1000)),
        offers: 5000n,
        maxOffers: 10000n,
        funds: 50000000000000000000n,
        maxFunds: 100000000000000000000n
      });

      const route = await fetchRouteWithFallback(mockPublicClient, tokenAddress, 'four');

      expect(route.platform).toBe('four');
      expect(route.quoteToken).toBe('0x55d398326f99059ff775485246999027b3197955');
    });

    it('应该处理 KGST 作为 quote token', async () => {
      const tokenAddress = '0x3e2a009d420512627a2791be63eeb04c94674444';

      mockPublicClient.readContract.mockResolvedValue({
        liquidityAdded: false,
        quote: '0x94be0bbA8E1E303fE998c9360B57b826F1A4f828', // KGST
        launchTime: BigInt(Math.floor(Date.now() / 1000)),
        offers: 5000n,
        maxOffers: 10000n,
        funds: 50000000000000000000n,
        maxFunds: 100000000000000000000n
      });

      const route = await fetchRouteWithFallback(mockPublicClient, tokenAddress, 'four');

      expect(route.platform).toBe('four');
      expect(route.quoteToken).toBe('0x94be0bbA8E1E303fE998c9360B57b826F1A4f828');
    });
  });

  describe('已迁移代币的 Pancake 查询', () => {
    it('应该查询 Pancake pair 并返回正确信息', async () => {
      const tokenAddress = '0xd86eb37348f72ddff0c0b9873531dd0fe4d7ffff';

      // 第一次调用：getTokenInfo - 已迁移
      mockPublicClient.readContract.mockResolvedValueOnce({
        liquidityAdded: true,
        quote: '0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c',
        launchTime: BigInt(Math.floor(Date.now() / 1000)),
        offers: 10000n,
        maxOffers: 10000n,
        funds: 100000000000000000000n,
        maxFunds: 100000000000000000000n
      });

      // 第二次调用：getPancakePair
      mockPublicClient.readContract.mockResolvedValueOnce(
        '0x1234567890123456789012345678901234567890'
      );

      const route = await fetchRouteWithFallback(mockPublicClient, tokenAddress, 'four');

      expect(route.platform).toBe('four');
      expect(route.preferredChannel).toBe('pancake');
      expect(route.readyForPancake).toBe(true);
      expect(route.progress).toBe(1);
    });
  });
});

describe('Flap 和 Luna 平台测试', () => {
  let mockPublicClient: any;

  beforeEach(() => {
    mockPublicClient = {
      readContract: vi.fn()
    };
  });

  describe('Flap 平台', () => {
    it('应该处理 Flap 代币的正常查询', async () => {
      const tokenAddress = '0x1234567890123456789012345678901234567777';

      mockPublicClient.readContract.mockResolvedValue({
        liquidityAdded: false,
        launchTime: BigInt(Math.floor(Date.now() / 1000))
      });

      const route = await fetchRouteWithFallback(mockPublicClient, tokenAddress, 'flap');

      expect(route.platform).toBe('flap');
      expect(route.preferredChannel).toBe('flap');
    });

    it('应该处理 Flap 代币的 Service Worker 错误', async () => {
      const tokenAddress = '0x1234567890123456789012345678901234567777';

      mockPublicClient.readContract.mockRejectedValue(
        new Error('import() is disallowed on ServiceWorkerGlobalScope')
      );

      const route = await fetchRouteWithFallback(mockPublicClient, tokenAddress, 'flap');

      expect(route.platform).toBe('flap');
      expect(route.preferredChannel).toBe('flap');
      expect(route.readyForPancake).toBe(false);
    });
  });

  describe('Luna 平台', () => {
    it('应该处理 Luna 代币的正常查询', async () => {
      const tokenAddress = '0x1234567890123456789012345678901234569999';

      mockPublicClient.readContract.mockResolvedValue({
        liquidityAdded: false,
        launchTime: BigInt(Math.floor(Date.now() / 1000))
      });

      const route = await fetchRouteWithFallback(mockPublicClient, tokenAddress, 'luna');

      expect(route).toBeDefined();
      expect(route.platform).toBeDefined();
    });

    it('应该处理 Luna 代币的 Service Worker 错误', async () => {
      const tokenAddress = '0x1234567890123456789012345678901234569999';

      mockPublicClient.readContract.mockRejectedValue(
        new Error('import() is disallowed on ServiceWorkerGlobalScope')
      );

      const route = await fetchRouteWithFallback(mockPublicClient, tokenAddress, 'luna');

      expect(route).toBeDefined();
      expect(route.platform).toBeDefined();
    });
  });
});
