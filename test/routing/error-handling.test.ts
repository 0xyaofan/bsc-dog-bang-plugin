import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createRouteQueryService } from '../../src/shared/route-query/route-query-service';
import { routeCacheManager } from '../../src/shared/route-query/route-cache-manager';
import { detectTokenPlatform } from '../../src/shared/token-route';

describe('错误处理和回退机制测试', () => {
  let mockPublicClient: any;
  let service: ReturnType<typeof createRouteQueryService>;

  beforeEach(() => {
    mockPublicClient = {
      readContract: vi.fn()
    };
    service = createRouteQueryService(mockPublicClient);
    // 清除缓存，避免测试间干扰
    routeCacheManager.clearAll();
  });

  describe('网络错误处理', () => {
    it('应该处理网络超时错误', async () => {
      const tokenAddress = '0xd86eb37348f72ddff0c0b9873531dd0fe4d7ffff';

      mockPublicClient.readContract.mockRejectedValue(
        new Error('Network timeout')
      );

      const route = await service.queryRoute(tokenAddress, 'four');

      // 网络错误时，应该返回有效的路由信息
      expect(route).toBeDefined();
      expect(route.platform).toBeDefined();
      expect(route.preferredChannel).toBeDefined();
    });

    it('应该处理 RPC 错误', async () => {
      const tokenAddress = '0xd86eb37348f72ddff0c0b9873531dd0fe4d7ffff';

      mockPublicClient.readContract.mockRejectedValue(
        new Error('RPC error: execution reverted')
      );

      const route = await service.queryRoute(tokenAddress, 'four');

      expect(route).toBeDefined();
      expect(route.platform).toBeDefined();
    });

    it('应该处理合约不存在错误', async () => {
      const tokenAddress = '0xd86eb37348f72ddff0c0b9873531dd0fe4d7ffff';

      mockPublicClient.readContract.mockRejectedValue(
        new Error('Contract not found')
      );

      const route = await service.queryRoute(tokenAddress, 'four');

      expect(route).toBeDefined();
      expect(route.platform).toBeDefined();
    });

    it('应该处理 Gas 估算失败', async () => {
      const tokenAddress = '0xd86eb37348f72ddff0c0b9873531dd0fe4d7ffff';

      mockPublicClient.readContract.mockRejectedValue(
        new Error('Gas estimation failed')
      );

      const route = await service.queryRoute(tokenAddress, 'four');

      expect(route).toBeDefined();
      expect(route.platform).toBeDefined();
    });
  });

  describe('Service Worker 错误处理', () => {
    it('Four.meme 代币遇到 Service Worker 错误应该返回正确路由', async () => {
      const tokenAddress = '0xd86eb37348f72ddff0c0b9873531dd0fe4d7ffff';

      mockPublicClient.readContract.mockRejectedValue(
        new Error('import() is disallowed on ServiceWorkerGlobalScope')
      );

      const route = await service.queryRoute(tokenAddress, 'four');

      expect(route.platform).toBe('four');
      expect(route.preferredChannel).toBe('four');
      expect(route.readyForPancake).toBe(false);
      expect(route.notes).toContain('Service Worker');
    });

    it('Flap 代币遇到 Service Worker 错误应该返回正确路由', async () => {
      const tokenAddress = '0x1234567890123456789012345678901234567777';

      mockPublicClient.readContract.mockRejectedValue(
        new Error('import() is disallowed on ServiceWorkerGlobalScope')
      );

      const route = await service.queryRoute(tokenAddress, 'flap');

      expect(route.platform).toBe('flap');
      expect(route.preferredChannel).toBe('flap');
      expect(route.readyForPancake).toBe(false);
    });

    it('Luna 代币遇到 Service Worker 错误应该返回正确路由', async () => {
      const tokenAddress = '0x1234567890123456789012345678901234569999';

      mockPublicClient.readContract.mockRejectedValue(
        new Error('import() is disallowed on ServiceWorkerGlobalScope')
      );

      // Luna 没有特定地址模式，但我们显式传入 luna 平台
      const route = await service.queryRoute(tokenAddress, 'luna');

      // 由于回退机制，可能会尝试其他平台
      expect(route).toBeDefined();
      expect(route.platform).toBeDefined();
      expect(route.preferredChannel).toBeDefined();
    });

    it('Unknown 平台遇到 Service Worker 错误应该假设有流动性', async () => {
      const tokenAddress = '0x3753dd32cbc376ce6efd85f334b7289ae6d004af';

      mockPublicClient.readContract.mockRejectedValue(
        new Error('import() is disallowed on ServiceWorkerGlobalScope')
      );

      const route = await service.queryRoute(tokenAddress, 'unknown');

      expect(route.platform).toBe('unknown');
      expect(route.preferredChannel).toBe('pancake');
      expect(route.readyForPancake).toBe(true);
    });
  });

  describe('无效数据处理', () => {
    it('应该处理返回 null 的合约调用', async () => {
      const tokenAddress = '0xd86eb37348f72ddff0c0b9873531dd0fe4d7ffff';

      mockPublicClient.readContract.mockResolvedValue(null);

      const route = await service.queryRoute(tokenAddress, 'four');

      expect(route).toBeDefined();
      expect(route.platform).toBeDefined();
    });

    it('应该处理返回 undefined 的合约调用', async () => {
      const tokenAddress = '0xd86eb37348f72ddff0c0b9873531dd0fe4d7ffff';

      mockPublicClient.readContract.mockResolvedValue(undefined);

      const route = await service.queryRoute(tokenAddress, 'four');

      expect(route).toBeDefined();
      expect(route.platform).toBeDefined();
    });

    it('应该处理返回空对象的合约调用', async () => {
      const tokenAddress = '0xd86eb37348f72ddff0c0b9873531dd0fe4d7ffff';

      mockPublicClient.readContract.mockResolvedValue({});

      const route = await service.queryRoute(tokenAddress, 'four');

      expect(route).toBeDefined();
      expect(route.platform).toBeDefined();
    });

    it('应该处理返回无效 BigInt 的合约调用', async () => {
      const tokenAddress = '0xd86eb37348f72ddff0c0b9873531dd0fe4d7ffff';

      mockPublicClient.readContract.mockResolvedValue({
        liquidityAdded: false,
        quote: '0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c',
        launchTime: 'invalid' as any,
        offers: 'invalid' as any,
        maxOffers: 'invalid' as any,
        funds: 'invalid' as any,
        maxFunds: 'invalid' as any
      });

      const route = await service.queryRoute(tokenAddress, 'four');

      expect(route).toBeDefined();
      expect(route.platform).toBeDefined();
    });
  });

  describe('零地址和零值处理', () => {
    it('应该处理零地址的 quote token', async () => {
      const tokenAddress = '0xd86eb37348f72ddff0c0b9873531dd0fe4d7ffff';

      mockPublicClient.readContract.mockResolvedValue({
        liquidityAdded: false,
        quote: '0x0000000000000000000000000000000000000000',
        launchTime: BigInt(Math.floor(Date.now() / 1000)),
        offers: 5000n,
        maxOffers: 10000n,
        funds: 50000000000000000000n,
        maxFunds: 100000000000000000000n
      });

      const route = await service.queryRoute(tokenAddress, 'four');

      expect(route).toBeDefined();
      expect(route.platform).toBeDefined();
    });

    it('应该处理零值的 offers 和 funds', async () => {
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

      const route = await service.queryRoute(tokenAddress, 'four');

      expect(route).toBeDefined();
      expect(route.platform).toBeDefined();
      // progress 应该是 0，因为 offers 和 funds 都是 0
      if (route.platform === 'four') {
        expect(route.progress).toBe(0);
      }
    });
  });

  describe('边界值测试', () => {
    it('应该处理极大的 BigInt 值', async () => {
      const tokenAddress = '0xd86eb37348f72ddff0c0b9873531dd0fe4d7ffff';

      mockPublicClient.readContract.mockResolvedValue({
        liquidityAdded: false,
        quote: '0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c',
        launchTime: BigInt(Math.floor(Date.now() / 1000)),
        offers: BigInt('999999999999999999999999999999'),
        maxOffers: BigInt('1000000000000000000000000000000'),
        funds: BigInt('999999999999999999999999999999'),
        maxFunds: BigInt('1000000000000000000000000000000')
      });

      const route = await service.queryRoute(tokenAddress, 'four');

      expect(route).toBeDefined();
      expect(route.platform).toBeDefined();
      if (route.platform === 'four' && route.progress !== undefined) {
        expect(route.progress).toBeGreaterThanOrEqual(0);
        expect(route.progress).toBeLessThanOrEqual(1);
      }
    });

    it('应该处理 progress 为 1 的情况（完全筹集）', async () => {
      const tokenAddress = '0xd86eb37348f72ddff0c0b9873531dd0fe4d7ffff';

      mockPublicClient.readContract.mockResolvedValue({
        liquidityAdded: false,
        quote: '0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c',
        launchTime: BigInt(Math.floor(Date.now() / 1000)),
        offers: 10000n,
        maxOffers: 10000n,
        funds: 100000000000000000000n,
        maxFunds: 100000000000000000000n
      });

      const route = await service.queryRoute(tokenAddress, 'four');

      expect(route).toBeDefined();
      expect(route.platform).toBeDefined();
      if (route.platform === 'four') {
        expect(route.progress).toBe(1);
      }
    });

    it('应该处理 maxOffers 为 0 的情况', async () => {
      const tokenAddress = '0xd86eb37348f72ddff0c0b9873531dd0fe4d7ffff';

      mockPublicClient.readContract.mockResolvedValue({
        liquidityAdded: false,
        quote: '0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c',
        launchTime: BigInt(Math.floor(Date.now() / 1000)),
        offers: 5000n,
        maxOffers: 0n,
        funds: 50000000000000000000n,
        maxFunds: 100000000000000000000n
      });

      const route = await service.queryRoute(tokenAddress, 'four');

      expect(route).toBeDefined();
      expect(route.platform).toBeDefined();
    });

    it('应该处理 maxFunds 为 0 的情况', async () => {
      const tokenAddress = '0xd86eb37348f72ddff0c0b9873531dd0fe4d7ffff';

      mockPublicClient.readContract.mockResolvedValue({
        liquidityAdded: false,
        quote: '0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c',
        launchTime: BigInt(Math.floor(Date.now() / 1000)),
        offers: 5000n,
        maxOffers: 10000n,
        funds: 50000000000000000000n,
        maxFunds: 0n
      });

      const route = await service.queryRoute(tokenAddress, 'four');

      expect(route).toBeDefined();
      expect(route.platform).toBeDefined();
    });
  });

  describe('并发请求测试', () => {
    it('应该能够处理多个并发请求', async () => {
      const tokens = [
        '0xd86eb37348f72ddff0c0b9873531dd0fe4d7ffff',
        '0x3e2a009d420512627a2791be63eeb04c94674444',
        '0x1234567890123456789012345678901234567777',
        '0x3753dd32cbc376ce6efd85f334b7289ae6d004af'
      ];

      mockPublicClient.readContract.mockRejectedValue(
        new Error('import() is disallowed on ServiceWorkerGlobalScope')
      );

      const promises = tokens.map(token => {
        const platform = detectTokenPlatform(token);
        return service.queryRoute(token, platform);
      });

      const routes = await Promise.all(promises);

      expect(routes).toHaveLength(4);
      expect(routes[0].platform).toBe('four');
      expect(routes[1].platform).toBe('four');
      expect(routes[2].platform).toBe('flap');
      expect(routes[3].platform).toBe('unknown');
    });
  });

  describe('回退机制测试', () => {
    it('当主平台失败时应该尝试其他平台', async () => {
      const tokenAddress = '0xd86eb37348f72ddff0c0b9873531dd0fe4d7ffff';

      mockPublicClient.readContract.mockRejectedValue(
        new Error('import() is disallowed on ServiceWorkerGlobalScope')
      );

      const route = await service.queryRoute(tokenAddress, 'four');

      // 即使失败，也应该返回有效的路由信息
      expect(route).toBeDefined();
      expect(route.platform).toBe('four');
      expect(route.preferredChannel).toBeDefined();
    });
  });

  describe('特殊场景测试', () => {
    it('应该处理已迁移但 Pancake 查询失败的情况', async () => {
      const tokenAddress = '0xd86eb37348f72ddff0c0b9873531dd0fe4d7ffff';

      // 第一次调用：getTokenInfo - 返回已迁移
      mockPublicClient.readContract.mockResolvedValueOnce({
        liquidityAdded: true,
        quote: '0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c',
        launchTime: BigInt(Math.floor(Date.now() / 1000)),
        offers: 10000n,
        maxOffers: 10000n,
        funds: 100000000000000000000n,
        maxFunds: 100000000000000000000n
      });

      // 第二次调用：getPancakePair - 失败
      mockPublicClient.readContract.mockRejectedValueOnce(
        new Error('Network error')
      );

      const route = await service.queryRoute(tokenAddress, 'four');

      expect(route).toBeDefined();
      expect(route.platform).toBeDefined();
      // 如果是 four 平台，应该已迁移
      if (route.platform === 'four') {
        expect(route.preferredChannel).toBe('pancake');
        expect(route.readyForPancake).toBe(true);
      }
    });

    it('应该处理 liquidityAdded 为 true 但没有 pair 的情况', async () => {
      const tokenAddress = '0xd86eb37348f72ddff0c0b9873531dd0fe4d7ffff';

      // 第一次调用：getTokenInfo
      mockPublicClient.readContract.mockResolvedValueOnce({
        liquidityAdded: true,
        quote: '0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c',
        launchTime: BigInt(Math.floor(Date.now() / 1000))
      });

      // 第二次调用：getPancakePair - 返回零地址
      mockPublicClient.readContract.mockResolvedValueOnce(
        '0x0000000000000000000000000000000000000000'
      );

      const route = await service.queryRoute(tokenAddress, 'four');

      expect(route).toBeDefined();
      expect(route.platform).toBeDefined();
    });
  });
});
