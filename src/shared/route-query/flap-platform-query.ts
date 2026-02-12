/**
 * Flap 平台查询
 */

import type { Address } from 'viem';
import { CONTRACTS } from '../config/sdk-config-adapter.js';
import { structuredLogger } from '../structured-logger.js';
import flapPortalAbi from '../../../abis/flap-portal.json';
import { BasePlatformQuery } from './base-platform-query.js';
import type { RouteFetchResult, PancakePairCheckResult } from './types.js';
import { FLAP_STATE_READERS, ZERO_ADDRESS } from './constants.js';
import { isServiceWorkerError } from './errors.js';

/**
 * Flap 平台查询类
 */
export class FlapPlatformQuery extends BasePlatformQuery {
  constructor(publicClient: any) {
    super(publicClient, 'flap');
  }

  /**
   * 查询路由信息
   */
  async queryRoute(tokenAddress: Address): Promise<RouteFetchResult> {
    this.logQueryStart(tokenAddress);

    try {
      // 1. 查询代币状态（尝试多个版本的读取器）
      const { state, stateReaderUsed } = await this.fetchTokenState(tokenAddress);

      // 2. 处理空状态
      if (!state || this.isStructEffectivelyEmpty(state)) {
        return await this.handleEmptyState(tokenAddress);
      }

      // 3. 解析状态信息
      const result = this.parseStateInfo(state, stateReaderUsed);

      this.logQuerySuccess(tokenAddress, result);
      return result;
    } catch (error) {
      this.logQueryError(tokenAddress, error as Error);

      // 处理 Service Worker 错误
      if (isServiceWorkerError(error)) {
        return this.handleServiceWorkerError(tokenAddress, error as Error, 'fetchTokenState');
      }

      throw error;
    }
  }

  /**
   * 查询代币状态
   */
  private async fetchTokenState(tokenAddress: Address): Promise<{
    state: any;
    stateReaderUsed: string | null;
  }> {
    let state: any = null;
    let stateReaderUsed: string | null = null;

    // 尝试所有版本的状态读取器
    for (const reader of FLAP_STATE_READERS) {
      try {
        const result = await this.publicClient.readContract({
          address: CONTRACTS.FLAP_PORTAL as Address,
          abi: flapPortalAbi as any,
          functionName: reader.functionName,
          args: [tokenAddress]
        });

        state = result?.state ?? result;
        if (state) {
          stateReaderUsed = reader.functionName;
          structuredLogger.debug('[FlapQuery] 使用状态读取器', {
            reader: reader.functionName,
            tokenAddress
          });
          break;
        }
      } catch (error: any) {
        const msg = String(error?.message || error || '');

        // 检查是否是 Service Worker 错误
        if (msg.includes('import() is disallowed on ServiceWorkerGlobalScope')) {
          throw error;
        }

        // 如果是函数选择器错误，继续尝试下一个版本
        if (msg.includes('function selector')) {
          continue;
        }

        // 其他错误也继续尝试
        structuredLogger.debug('[FlapQuery] 状态读取器失败，尝试下一个', {
          reader: reader.functionName,
          error: msg
        });
      }
    }

    return { state, stateReaderUsed };
  }

  /**
   * 处理空状态
   */
  private async handleEmptyState(tokenAddress: Address): Promise<RouteFetchResult> {
    structuredLogger.warn('[FlapQuery] Flap Portal 返回空状态');

    try {
      // 尝试查询 Pancake
      const fallbackPair = await this.checkPancakeFallback(tokenAddress);

      if (fallbackPair.hasLiquidity) {
        structuredLogger.info('[FlapQuery] 切换到 Pancake');
        return {
          platform: 'unknown', // 空状态时切换到 unknown 平台
          preferredChannel: 'pancake',
          readyForPancake: true,
          progress: 1,
          migrating: false,
          metadata: this.mergePancakeMetadata(undefined, fallbackPair),
          notes: 'Flap Portal 无记录或返回空状态，自动切换 Pancake'
        };
      }
    } catch (error) {
      if (isServiceWorkerError(error)) {
        structuredLogger.warn('[FlapQuery] Service Worker 限制，假设未迁移');
        return {
          platform: 'flap',
          preferredChannel: 'flap',
          readyForPancake: false,
          progress: 0,
          migrating: false,
          metadata: {},
          notes: 'Service Worker 限制，Flap Portal 返回空状态，假设未迁移'
        };
      }
      throw error;
    }

    throw new Error('Flap Portal 未返回有效数据');
  }

  /**
   * 解析状态信息
   */
  private parseStateInfo(state: any, stateReaderUsed: string | null): RouteFetchResult {
    // 提取状态信息
    const reserve = BigInt(state.reserve ?? 0n);
    const threshold = BigInt(state.dexSupplyThresh ?? 0n);
    const pool = typeof state.pool === 'string' ? state.pool.toLowerCase() : ZERO_ADDRESS;

    // 计算进度
    let progress = 0;
    if (threshold > 0n) {
      progress = this.calculateRatio(reserve, threshold);
    }

    // 提取报价代币地址
    const quoteTokenAddress =
      (state as any)?.quoteTokenAddress ||
      (state as any)?.quoteToken ||
      (Array.isArray(state) ? state[7] : undefined);

    const normalizedQuote =
      typeof quoteTokenAddress === 'string' && quoteTokenAddress !== ZERO_ADDRESS
        ? quoteTokenAddress
        : undefined;

    // 判断是否已迁移
    // pool 地址存在且不为零地址，说明已迁移到 Pancake
    const readyForPancake = Boolean(pool && pool !== ZERO_ADDRESS);
    const pancakePair: PancakePairCheckResult | null = readyForPancake
      ? { hasLiquidity: true, quoteToken: normalizedQuote, pairAddress: pool, version: 'v2' }
      : null;

    const migrating = !readyForPancake && progress >= 0.99;

    // 构建元数据
    const metadata = this.mergePancakeMetadata(
      {
        nativeToQuoteSwapEnabled: Boolean((state as any)?.nativeToQuoteSwapEnabled),
        flapStateReader: stateReaderUsed || undefined
      },
      pancakePair ?? { hasLiquidity: false }
    );

    return {
      platform: 'flap',
      preferredChannel: readyForPancake ? 'pancake' : 'flap',
      readyForPancake,
      progress,
      migrating,
      quoteToken: normalizedQuote,
      metadata
    };
  }
}

/**
 * 创建 Flap 平台查询实例
 */
export function createFlapPlatformQuery(publicClient: any): FlapPlatformQuery {
  return new FlapPlatformQuery(publicClient);
}
