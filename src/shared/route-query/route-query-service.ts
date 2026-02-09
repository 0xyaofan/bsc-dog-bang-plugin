/**
 * 路由查询服务
 * 统一的路由查询入口
 */

import type { Address } from 'viem';
import { structuredLogger } from '../structured-logger.js';
import type { RouteFetchResult, TokenPlatform } from './types.js';
import { platformDetector } from './platform-detector.js';
import { routeCacheManager } from './route-cache-manager.js';
import { QueryExecutor } from './query-executor.js';

/**
 * 路由查询服务
 */
export class RouteQueryService {
  private executor: QueryExecutor;

  constructor(publicClient: any) {
    this.executor = new QueryExecutor(publicClient);
  }

  /**
   * 查询代币路由（主入口）
   */
  async queryRoute(tokenAddress: Address, platform?: TokenPlatform): Promise<RouteFetchResult> {
    // 1. 检测平台（如果未指定）
    const detectedPlatform = platform || platformDetector.detect(tokenAddress);

    structuredLogger.debug('[RouteQueryService] 开始查询', {
      tokenAddress,
      platform: detectedPlatform
    });

    // 2. 检查缓存
    const cached = routeCacheManager.getRoute(tokenAddress);
    if (cached && routeCacheManager.shouldUseCache(cached)) {
      structuredLogger.debug('[RouteQueryService] 使用缓存', {
        tokenAddress,
        platform: cached.route.platform,
        migrationStatus: cached.migrationStatus
      });
      return cached.route;
    }

    // 3. 执行查询（带 fallback）
    const route = await this.executor.executeWithFallback(tokenAddress, detectedPlatform);

    // 4. 更新缓存
    if (routeCacheManager.shouldUpdateCache(tokenAddress, route)) {
      routeCacheManager.setRoute(tokenAddress, route);
      structuredLogger.debug('[RouteQueryService] 缓存已更新', {
        tokenAddress,
        platform: route.platform
      });
    }

    return route;
  }

  /**
   * 批量查询路由
   */
  async queryRoutes(tokenAddresses: Address[]): Promise<Map<string, RouteFetchResult>> {
    const results = new Map<string, RouteFetchResult>();

    structuredLogger.info('[RouteQueryService] 批量查询开始', {
      count: tokenAddresses.length
    });

    // 并发查询
    const promises = tokenAddresses.map(async address => {
      try {
        const route = await this.queryRoute(address);
        results.set(address.toLowerCase(), route);
      } catch (error) {
        structuredLogger.error('[RouteQueryService] 查询失败', {
          tokenAddress: address,
          error: error instanceof Error ? error.message : String(error)
        });
      }
    });

    await Promise.all(promises);

    structuredLogger.info('[RouteQueryService] 批量查询完成', {
      total: tokenAddresses.length,
      succeeded: results.size,
      failed: tokenAddresses.length - results.size
    });

    return results;
  }

  /**
   * 清除缓存
   */
  clearCache(tokenAddress?: string): void {
    if (tokenAddress) {
      routeCacheManager.deleteRoute(tokenAddress);
      structuredLogger.debug('[RouteQueryService] 缓存已清除', { tokenAddress });
    } else {
      routeCacheManager.clearAll();
      structuredLogger.info('[RouteQueryService] 所有缓存已清除');
    }
  }

  /**
   * 获取缓存统计
   */
  getCacheStats() {
    return routeCacheManager.getStats();
  }

  /**
   * 预热缓存
   */
  async warmupCache(tokenAddresses: Address[]): Promise<void> {
    structuredLogger.info('[RouteQueryService] 开始预热缓存', {
      count: tokenAddresses.length
    });

    await routeCacheManager.warmup(
      null, // publicClient 不需要，因为会调用 queryRoute
      tokenAddresses,
      async (_, address) => {
        return await this.queryRoute(address as Address);
      }
    );

    structuredLogger.info('[RouteQueryService] 缓存预热完成');
  }
}

/**
 * 创建路由查询服务实例
 */
export function createRouteQueryService(publicClient: any): RouteQueryService {
  return new RouteQueryService(publicClient);
}
