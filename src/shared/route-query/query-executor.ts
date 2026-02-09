/**
 * 查询执行器
 * 负责执行查询和 fallback 逻辑
 */

import type { Address } from 'viem';
import { structuredLogger } from '../structured-logger.js';
import { routeTracer } from '../route-tracer.js';
import { withRetry, RETRY_STRATEGIES } from '../retry.js';
import type { TokenPlatform, RouteFetchResult } from './types.js';
import { PLATFORM_FALLBACK_ORDER } from './constants.js';
import { BasePlatformQuery } from './base-platform-query.js';
import { FourPlatformQuery } from './four-platform-query.js';
import { FlapPlatformQuery } from './flap-platform-query.js';
import { LunaPlatformQuery } from './luna-platform-query.js';
import { DefaultPlatformQuery } from './default-platform-query.js';
import { ServiceWorkerError, isServiceWorkerError } from './errors.js';

/**
 * 查询执行器
 */
export class QueryExecutor {
  private publicClient: any;
  private platformQueries: Map<TokenPlatform, BasePlatformQuery>;

  constructor(publicClient: any) {
    this.publicClient = publicClient;

    // 初始化平台查询实例
    this.platformQueries = new Map([
      ['four', new FourPlatformQuery(publicClient, 'four')],
      ['xmode', new FourPlatformQuery(publicClient, 'xmode')],
      ['flap', new FlapPlatformQuery(publicClient)],
      ['luna', new LunaPlatformQuery(publicClient)],
      ['unknown', new DefaultPlatformQuery(publicClient)]
    ]);
  }

  /**
   * 执行查询（带 fallback）
   */
  async executeWithFallback(
    tokenAddress: Address,
    initialPlatform: TokenPlatform
  ): Promise<RouteFetchResult> {
    const traceId = routeTracer.startTrace(tokenAddress, initialPlatform);

    try {
      structuredLogger.debug('[QueryExecutor] 开始查询', {
        tokenAddress,
        initialPlatform
      });

      routeTracer.addStep(traceId, 'start', { tokenAddress, initialPlatform });

      // 构建探测顺序
      const probeOrder = this.buildProbeOrder(initialPlatform);
      routeTracer.addStep(traceId, 'build-probe-order', { order: probeOrder });

      let lastValidRoute: RouteFetchResult | null = null;
      let lastError: unknown = null;

      // 依次尝试各个平台
      for (const platform of probeOrder) {
        structuredLogger.debug('[QueryExecutor] 尝试平台', { platform });
        routeTracer.addStep(traceId, `try-platform-${platform}`);

        try {
          const route = await this.queryPlatform(tokenAddress, platform);

          structuredLogger.debug('[QueryExecutor] 平台查询成功', {
            platform,
            preferredChannel: route.preferredChannel,
            readyForPancake: route.readyForPancake
          });

          routeTracer.addStep(traceId, `platform-${platform}-success`, {
            preferredChannel: route.preferredChannel,
            readyForPancake: route.readyForPancake
          });

          lastValidRoute = route;

          // 检查是否需要 fallback
          if (!this.shouldFallback(route)) {
            structuredLogger.debug('[QueryExecutor] 使用平台路由', { platform });
            routeTracer.addStep(traceId, `use-platform-${platform}`);
            routeTracer.endTrace(traceId, route);
            return route;
          }

          structuredLogger.debug('[QueryExecutor] 需要 fallback，继续尝试', { platform });
          routeTracer.addStep(traceId, `platform-${platform}-fallback`);
        } catch (error) {
          structuredLogger.warn('[QueryExecutor] 平台查询失败', {
            platform,
            error: error instanceof Error ? error.message : String(error)
          });

          routeTracer.addError(traceId, `platform-${platform}-error`, error as Error);
          lastError = error;

          // 如果是 Service Worker 错误，直接跳到 unknown 平台
          if (isServiceWorkerError(error)) {
            structuredLogger.info('[QueryExecutor] Service Worker 错误，跳到 unknown 平台');
            routeTracer.addStep(traceId, 'skip-to-unknown');

            try {
              const unknownRoute = await this.queryPlatform(tokenAddress, 'unknown');
              routeTracer.addStep(traceId, 'unknown-platform-success');
              routeTracer.endTrace(traceId, unknownRoute);
              return unknownRoute;
            } catch (unknownError) {
              structuredLogger.warn('[QueryExecutor] Unknown 平台也失败', {
                error: unknownError instanceof Error ? unknownError.message : String(unknownError)
              });
              routeTracer.addError(traceId, 'unknown-platform-error', unknownError as Error);
            }
          }
        }
      }

      // 如果有最后一个有效路由，使用它
      if (lastValidRoute) {
        structuredLogger.debug('[QueryExecutor] 使用最后一个有效路由', {
          platform: lastValidRoute.platform
        });
        routeTracer.addStep(traceId, 'use-last-valid-route', {
          platform: lastValidRoute.platform
        });
        routeTracer.endTrace(traceId, lastValidRoute);
        return lastValidRoute;
      }

      // 如果有错误，抛出
      if (lastError) {
        structuredLogger.warn('[QueryExecutor] 所有平台都失败');
        routeTracer.addError(traceId, 'all-platforms-failed', lastError as Error);
        routeTracer.endTrace(traceId);
        throw lastError;
      }

      // 返回默认路由
      structuredLogger.warn('[QueryExecutor] 返回默认路由');
      routeTracer.addStep(traceId, 'use-default-route');

      const defaultRoute: RouteFetchResult = {
        platform: 'unknown',
        preferredChannel: 'pancake',
        readyForPancake: true,
        progress: 1,
        migrating: false
      };

      routeTracer.endTrace(traceId, defaultRoute);
      return defaultRoute;
    } catch (error) {
      routeTracer.endTrace(traceId);
      throw error;
    }
  }

  /**
   * 查询指定平台（带重试）
   */
  private async queryPlatform(
    tokenAddress: Address,
    platform: TokenPlatform
  ): Promise<RouteFetchResult> {
    const query = this.platformQueries.get(platform);
    if (!query) {
      throw new Error(`Unknown platform: ${platform}`);
    }

    // 使用重试机制
    return withRetry(
      async () => {
        return await query.queryRoute(tokenAddress);
      },
      {
        ...RETRY_STRATEGIES.onchain,
        maxAttempts: 2, // 减少重试次数，因为有 fallback
        onRetry: (error, attempt) => {
          structuredLogger.warn('[QueryExecutor] 重试查询', {
            platform,
            tokenAddress,
            attempt,
            error: error.message
          });
        }
      }
    );
  }

  /**
   * 构建探测顺序
   */
  private buildProbeOrder(initial: TokenPlatform): TokenPlatform[] {
    // 如果是 unknown，直接返回
    if (initial === 'unknown') {
      return ['unknown'];
    }

    // 构建顺序：初始平台 + fallback 顺序
    const order: TokenPlatform[] = [initial];
    PLATFORM_FALLBACK_ORDER.forEach(platform => {
      if (!order.includes(platform)) {
        order.push(platform);
      }
    });

    return order;
  }

  /**
   * 判断是否需要 fallback
   */
  private shouldFallback(route: RouteFetchResult): boolean {
    // 如果推荐 pancake 但没有准备好，需要 fallback
    return route.preferredChannel === 'pancake' && !route.readyForPancake;
  }
}

/**
 * 创建查询执行器实例
 */
export function createQueryExecutor(publicClient: any): QueryExecutor {
  return new QueryExecutor(publicClient);
}
