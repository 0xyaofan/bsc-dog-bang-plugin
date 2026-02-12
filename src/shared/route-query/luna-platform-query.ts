/**
 * Luna 平台查询
 */

import type { Address } from 'viem';
import { CONTRACTS } from '../config/sdk-config-adapter.js';
import { structuredLogger } from '../structured-logger.js';
import lunaLaunchpadAbi from '../../../abis/luna-fun-launchpad.json';
import { BasePlatformQuery } from './base-platform-query.js';
import type { RouteFetchResult, PancakePairCheckResult } from './types.js';
import { ZERO_ADDRESS } from './constants.js';
import { isServiceWorkerError } from './errors.js';

/**
 * Luna 平台查询类
 */
export class LunaPlatformQuery extends BasePlatformQuery {
  constructor(publicClient: any) {
    super(publicClient, 'luna');
  }

  /**
   * 查询路由信息
   */
  async queryRoute(tokenAddress: Address): Promise<RouteFetchResult> {
    this.logQueryStart(tokenAddress);

    try {
      // 1. 查询代币信息
      const info = await this.fetchTokenInfo(tokenAddress);

      // 2. 验证代币信息
      if (this.isInvalidLunaInfo(info, tokenAddress)) {
        return await this.handleInvalidInfo(tokenAddress);
      }

      // 3. 解析代币信息
      const result = this.parseTokenInfo(info, tokenAddress);

      this.logQuerySuccess(tokenAddress, result);
      return result;
    } catch (error) {
      this.logQueryError(tokenAddress, error as Error);

      // 处理 Service Worker 错误
      if (isServiceWorkerError(error)) {
        return this.handleServiceWorkerError(tokenAddress, error as Error, 'fetchTokenInfo');
      }

      throw error;
    }
  }

  /**
   * 查询代币信息
   */
  private async fetchTokenInfo(tokenAddress: Address): Promise<any> {
    return this.executeQuery('fetchTokenInfo', async () => {
      return await this.publicClient.readContract({
        address: CONTRACTS.LUNA_FUN_LAUNCHPAD as Address,
        abi: lunaLaunchpadAbi as any,
        functionName: 'tokenInfo',
        args: [tokenAddress]
      });
    });
  }

  /**
   * 验证代币信息是否有效
   */
  private isInvalidLunaInfo(info: any, tokenAddress: Address): boolean {
    // 检查是否为空
    if (this.isStructEffectivelyEmpty(info)) {
      return true;
    }

    const infoArray = Array.isArray(info) ? info : [];

    // 提取代币地址
    const reportedToken =
      (info as any)?.token ||
      (typeof infoArray[1] === 'string' ? infoArray[1] : undefined);

    const metaToken =
      (info as any)?.data?.token ||
      (typeof infoArray[3]?.token === 'string' ? infoArray[3].token : undefined);

    // 标准化地址
    const normalizedInput = tokenAddress.toLowerCase();
    const normalizedReported = typeof reportedToken === 'string' ? reportedToken.toLowerCase() : '';
    const normalizedMeta = typeof metaToken === 'string' ? metaToken.toLowerCase() : '';

    // 检查地址是否匹配
    const addressMismatch =
      (normalizedReported && normalizedReported !== normalizedInput) ||
      (normalizedMeta && normalizedMeta !== normalizedInput);

    return addressMismatch;
  }

  /**
   * 处理无效信息
   */
  private async handleInvalidInfo(tokenAddress: Address): Promise<RouteFetchResult> {
    structuredLogger.warn('[LunaQuery] Luna Launchpad 返回无效数据');

    try {
      // 尝试查询 Pancake
      const fallbackPair = await this.checkPancakeFallback(tokenAddress);

      if (fallbackPair.hasLiquidity) {
        structuredLogger.info('[LunaQuery] 切换到 Pancake');
        return {
          platform: 'luna',
          preferredChannel: 'pancake',
          readyForPancake: true,
          progress: 1,
          migrating: false,
          metadata: this.mergePancakeMetadata(undefined, fallbackPair),
          notes: 'Luna Launchpad 返回空数据，自动切换 Pancake'
        };
      }
    } catch (error) {
      if (isServiceWorkerError(error)) {
        structuredLogger.warn('[LunaQuery] Service Worker 限制，假设未迁移');
        return {
          platform: 'luna',
          preferredChannel: 'pancake',
          readyForPancake: false,
          progress: 0,
          migrating: false,
          metadata: {},
          notes: 'Service Worker 限制，Luna Launchpad 返回空数据，假设未迁移'
        };
      }
      throw error;
    }

    throw new Error('Luna Launchpad 未返回有效数据');
  }

  /**
   * 解析代币信息
   */
  private parseTokenInfo(info: any, tokenAddress: Address): RouteFetchResult {
    // 提取 pair 信息
    const pairValue = (info as any)?.pair || (Array.isArray(info) ? info[2] : undefined) || '';
    const pair = typeof pairValue === 'string' ? pairValue.toLowerCase() : '';

    // 提取交易状态
    const tradingOnUniswap = Boolean(
      (info as any)?.tradingOnUniswap ?? (Array.isArray(info) ? info[8] : undefined)
    );

    // 提取报价代币
    const quoteToken =
      (info as any)?.quote ||
      (info as any)?.data?.quote ||
      (Array.isArray(info) ? info[3] : undefined);

    // 提取元数据
    const name = info?.data?.name;
    const symbol = info?.data?.ticker;

    // 判断是否已迁移
    // pair 地址存在 + tradingOnUniswap=true 说明已迁移
    const readyForPancake = pair && pair !== ZERO_ADDRESS && tradingOnUniswap;

    const pancakePair: PancakePairCheckResult | null = readyForPancake
      ? { hasLiquidity: true, quoteToken: quoteToken as string, pairAddress: pair, version: 'v2' }
      : null;

    // 构建元数据
    const metadata = this.mergePancakeMetadata(
      { name, symbol },
      pancakePair ?? { hasLiquidity: false }
    );

    return {
      platform: 'luna',
      preferredChannel: 'pancake', // Luna 总是使用 pancake 作为 preferredChannel
      readyForPancake,
      progress: readyForPancake ? 1 : 0,
      migrating: false,
      quoteToken: quoteToken as string | undefined,
      metadata
    };
  }

  /**
   * 获取默认交易渠道
   */
  protected getDefaultChannel(): 'pancake' | 'four' | 'xmode' | 'flap' {
    return 'pancake'; // Luna 总是使用 pancake
  }
}

/**
 * 创建 Luna 平台查询实例
 */
export function createLunaPlatformQuery(publicClient: any): LunaPlatformQuery {
  return new LunaPlatformQuery(publicClient);
}
