/**
 * 默认平台查询
 * 用于 unknown 平台，直接查询 PancakeSwap
 */

import type { Address } from 'viem';
import { structuredLogger } from '../structured-logger.js';
import { BasePlatformQuery } from './base-platform-query.js';
import type { RouteFetchResult } from './types.js';
import { isServiceWorkerError } from './errors.js';

/**
 * 默认平台查询类
 */
export class DefaultPlatformQuery extends BasePlatformQuery {
  constructor(publicClient: any) {
    super(publicClient, 'unknown');
  }

  /**
   * 查询路由信息
   */
  async queryRoute(tokenAddress: Address): Promise<RouteFetchResult> {
    this.logQueryStart(tokenAddress);

    try {
      // 直接查询 Pancake pair
      const pancakePair = await this.checkPancakeFallback(tokenAddress);

      const readyForPancake = pancakePair.hasLiquidity;

      const result: RouteFetchResult = {
        platform: 'unknown',
        preferredChannel: 'pancake',
        readyForPancake,
        progress: readyForPancake ? 1 : 0,
        migrating: false,
        quoteToken: pancakePair.quoteToken,
        metadata: this.mergePancakeMetadata(undefined, pancakePair)
      };

      this.logQuerySuccess(tokenAddress, result);
      return result;
    } catch (error) {
      this.logQueryError(tokenAddress, error as Error);

      // 处理 Service Worker 错误
      if (isServiceWorkerError(error)) {
        structuredLogger.warn('[DefaultQuery] Service Worker 限制，返回默认结果');
        return {
          platform: 'unknown',
          preferredChannel: 'pancake',
          readyForPancake: true,
          progress: 1,
          migrating: false,
          metadata: {},
          notes: 'Service Worker 限制，假设 Pancake 有流动性'
        };
      }

      throw error;
    }
  }
}

/**
 * 创建默认平台查询实例
 */
export function createDefaultPlatformQuery(publicClient: any): DefaultPlatformQuery {
  return new DefaultPlatformQuery(publicClient);
}
