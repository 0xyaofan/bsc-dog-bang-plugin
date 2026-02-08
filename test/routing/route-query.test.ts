import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fetchRouteWithFallback } from '../../src/shared/token-route';

describe('路由查询完整流程测试', () => {
  let mockPublicClient: any;

  beforeEach(() => {
    mockPublicClient = {
      readContract: vi.fn()
    };
  });

  describe('Four.meme 未迁移代币', () => {
    it('BNB 筹集的未迁移代币应该返回 Four.meme 路由', async () => {
      const tokenAddress = '0xd86eb37348f72ddff0c0b9873531dd0fe4d7ffff';

      // 模拟 Service Worker 错误
      mockPublicClient.readContract.mockRejectedValue(
        new Error('import() is disallowed on ServiceWorkerGlobalScope')
      );

      const route = await fetchRouteWithFallback(mockPublicClient, tokenAddress, 'four');

      expect(route.platform).toBe('four');
      expect(route.preferredChannel).toBe('four');
      expect(route.readyForPancake).toBe(false);
      expect(route.notes).toContain('Service Worker');
    });

    it('非 BNB 筹集的未迁移代币应该返回 Four.meme 路由', async () => {
      const tokenAddress = '0x3e2a009d420512627a2791be63eeb04c94674444';

      // 模拟 Service Worker 错误
      mockPublicClient.readContract.mockRejectedValue(
        new Error('import() is disallowed on ServiceWorkerGlobalScope')
      );

      const route = await fetchRouteWithFallback(mockPublicClient, tokenAddress, 'four');

      expect(route.platform).toBe('four');
      expect(route.preferredChannel).toBe('four');
      expect(route.readyForPancake).toBe(false);
    });

    it('正常查询未迁移代币应该返回 Four.meme 路由', async () => {
      const tokenAddress = '0x1234567890123456789012345678901234567fff';

      // 模拟正常的 Four.meme helper 响应
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
      expect(route.preferredChannel).toBe('four');
      expect(route.readyForPancake).toBe(false);
      expect(route.progress).toBeGreaterThan(0);
      expect(route.progress).toBeLessThanOrEqual(1);
    });
  });

  describe('Four.meme 已迁移代币', () => {
    it('已迁移代币应该返回 Pancake 路由', async () => {
      const tokenAddress = '0x1234567890123456789012345678901234567fff';

      // 第一次调用：getTokenInfo
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
        '0x1234567890123456789012345678901234567890' // pair address
      );

      const route = await fetchRouteWithFallback(mockPublicClient, tokenAddress, 'four');

      expect(route.platform).toBe('four');
      expect(route.preferredChannel).toBe('pancake');
      expect(route.readyForPancake).toBe(true);
      expect(route.progress).toBe(1);
    });

    it('已迁移但遇到 Service Worker 错误应该假设有流动性', async () => {
      const tokenAddress = '0x1234567890123456789012345678901234567fff';

      // 第一次调用：getTokenInfo
      mockPublicClient.readContract.mockResolvedValueOnce({
        liquidityAdded: true,
        quote: '0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c',
        launchTime: BigInt(Math.floor(Date.now() / 1000))
      });

      // 第二次调用：getPancakePair - Service Worker 错误
      mockPublicClient.readContract.mockRejectedValueOnce(
        new Error('import() is disallowed on ServiceWorkerGlobalScope')
      );

      const route = await fetchRouteWithFallback(mockPublicClient, tokenAddress, 'four');

      expect(route.platform).toBe('four');
      expect(route.preferredChannel).toBe('pancake');
      expect(route.readyForPancake).toBe(true);
    });
  });

  describe('Flap 代币', () => {
    it('Flap 代币遇到 Service Worker 错误应该返回 Flap 路由', async () => {
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

  describe('Unknown 平台代币', () => {
    it('Unknown 平台代币遇到 Service Worker 错误应该返回默认路由', async () => {
      const tokenAddress = '0x3753dd32cbc376ce6efd85f334b7289ae6d004af'; // KDOG

      mockPublicClient.readContract.mockRejectedValue(
        new Error('import() is disallowed on ServiceWorkerGlobalScope')
      );

      const route = await fetchRouteWithFallback(mockPublicClient, tokenAddress, 'unknown');

      expect(route.platform).toBe('unknown');
      expect(route.preferredChannel).toBe('pancake');
      // readyForPancake 可能是 true（使用 Service Worker 假设）
    });
  });

  describe('跨平台影响检测', () => {
    it('修改 Four.meme 路由不应该影响 Flap', async () => {
      // 测试 Four.meme
      const fourToken = '0xd86eb37348f72ddff0c0b9873531dd0fe4d7ffff';
      mockPublicClient.readContract.mockRejectedValue(
        new Error('import() is disallowed on ServiceWorkerGlobalScope')
      );

      const fourRoute = await fetchRouteWithFallback(mockPublicClient, fourToken, 'four');
      expect(fourRoute.platform).toBe('four');

      // 测试 Flap（不应该受影响）
      const flapToken = '0x1234567890123456789012345678901234567777';
      const flapRoute = await fetchRouteWithFallback(mockPublicClient, flapToken, 'flap');
      expect(flapRoute.platform).toBe('flap');
    });

    it('修改 Four.meme 路由不应该影响 Unknown', async () => {
      // 测试 Four.meme
      const fourToken = '0xd86eb37348f72ddff0c0b9873531dd0fe4d7ffff';
      mockPublicClient.readContract.mockRejectedValue(
        new Error('import() is disallowed on ServiceWorkerGlobalScope')
      );

      const fourRoute = await fetchRouteWithFallback(mockPublicClient, fourToken, 'four');
      expect(fourRoute.platform).toBe('four');

      // 测试 Unknown（不应该受影响）
      const unknownToken = '0x3753dd32cbc376ce6efd85f334b7289ae6d004af';
      const unknownRoute = await fetchRouteWithFallback(mockPublicClient, unknownToken, 'unknown');
      expect(unknownRoute.platform).toBe('unknown');
    });
  });
});
