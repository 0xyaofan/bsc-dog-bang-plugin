/**
 * Four.meme 平台查询
 * 支持 Four.meme 和 XMode 平台
 */

import type { Address } from 'viem';
import { CONTRACTS } from '../trading-config.js';
import { structuredLogger } from '../structured-logger.js';
import tokenManagerHelperAbi from '../../../abis/fourmeme/TokenManagerHelper3.abi.json';
import { BasePlatformQuery } from './base-platform-query.js';
import type { RouteFetchResult, TokenPlatform, PancakePairCheckResult } from './types.js';
import { ServiceWorkerError, isServiceWorkerError } from './errors.js';

/**
 * Four.meme 平台查询类
 */
export class FourPlatformQuery extends BasePlatformQuery {
  constructor(publicClient: any, platform: TokenPlatform = 'four') {
    super(publicClient, platform);
  }

  /**
   * 查询路由信息
   */
  async queryRoute(tokenAddress: Address): Promise<RouteFetchResult> {
    this.logQueryStart(tokenAddress);

    try {
      // 1. 查询代币信息
      const info = await this.fetchTokenInfo(tokenAddress);

      // 2. 解析代币信息
      const parsedInfo = this.parseTokenInfo(info, tokenAddress);

      // 3. 处理空数据情况
      if (parsedInfo.isEmpty) {
        return await this.handleEmptyData(tokenAddress, parsedInfo);
      }

      // 4. 处理正常数据
      const result = await this.handleNormalData(tokenAddress, parsedInfo);

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
        address: CONTRACTS.FOUR_HELPER_V3 as Address,
        abi: tokenManagerHelperAbi as any,
        functionName: 'getTokenInfo',
        args: [tokenAddress]
      });
    });
  }

  /**
   * 解析代币信息
   */
  private parseTokenInfo(info: any, tokenAddress: Address) {
    const infoArray = Array.isArray(info) ? info : [];

    // 提取基础信息
    const rawLaunchTime = BigInt((info as any)?.launchTime ?? infoArray[6] ?? 0n);
    const quoteCandidate =
      (info as any)?.quote ||
      (info as any)?.quoteToken ||
      (typeof infoArray[2] === 'string' ? infoArray[2] : undefined);

    // 零地址表示原生 BNB，需要转换为 WBNB
    const normalizedQuote = quoteCandidate?.toLowerCase() === '0x0000000000000000000000000000000000000000'
      ? CONTRACTS.WBNB
      : quoteCandidate;

    // 检查是否为空数据
    const isEmpty =
      (rawLaunchTime === 0n && this.isStructEffectivelyEmpty(info)) ||
      (!normalizedQuote && this.isStructEffectivelyEmpty(info));

    // 提取迁移相关信息
    const liquidityAdded = Boolean(info?.liquidityAdded ?? infoArray[11]);
    const offers = BigInt(info?.offers ?? infoArray[7] ?? 0n);
    const maxOffers = BigInt(info?.maxOffers ?? infoArray[8] ?? 0n);
    const funds = BigInt(info?.funds ?? infoArray[9] ?? 0n);
    const maxFunds = BigInt(info?.maxFunds ?? infoArray[10] ?? 0n);
    const symbol = (info as any)?.symbol;
    const name = (info as any)?.name;

    return {
      isEmpty,
      liquidityAdded,
      quoteToken: normalizedQuote,
      offers,
      maxOffers,
      funds,
      maxFunds,
      symbol,
      name,
      infoArray
    };
  }

  /**
   * 处理空数据情况
   */
  private async handleEmptyData(
    tokenAddress: Address,
    parsedInfo: ReturnType<typeof this.parseTokenInfo>
  ): Promise<RouteFetchResult> {
    const liquidityAddedFromArray = Boolean(parsedInfo.infoArray[11]);

    structuredLogger.warn('[FourQuery] Helper 返回空数据', {
      tokenAddress,
      liquidityAdded: liquidityAddedFromArray
    });

    // 只有在已迁移时才检查 Pancake
    if (liquidityAddedFromArray) {
      try {
        const pancakePair = await this.checkPancakeFallback(
          tokenAddress,
          parsedInfo.quoteToken
        );

        if (pancakePair.hasLiquidity) {
          structuredLogger.info('[FourQuery] 代币已迁移，切换到 Pancake');
          return {
            platform: this.platform,
            preferredChannel: 'pancake',
            readyForPancake: true,
            progress: 1,
            migrating: false,
            quoteToken: parsedInfo.quoteToken,
            metadata: this.mergePancakeMetadata(undefined, pancakePair),
            notes: 'Four.meme helper 返回空数据但代币已迁移，切换 Pancake'
          };
        }
      } catch (error) {
        if (isServiceWorkerError(error)) {
          structuredLogger.warn('[FourQuery] Service Worker 限制，假设已迁移');
          return {
            platform: this.platform,
            preferredChannel: 'pancake',
            readyForPancake: true,
            progress: 1,
            migrating: false,
            quoteToken: parsedInfo.quoteToken,
            metadata: {},
            notes: 'Service Worker 限制，Four.meme helper 返回空数据，假设已迁移'
          };
        }
        throw error;
      }
    }

    // 未迁移或 Pancake 无流动性
    const baseChannel = this.getDefaultChannel();
    return {
      platform: this.platform,
      preferredChannel: baseChannel,
      readyForPancake: false,
      progress: 0,
      migrating: false,
      quoteToken: undefined,
      metadata: {},
      notes: 'Four.meme helper 返回空数据且未迁移，使用 Four.meme 合约'
    };
  }

  /**
   * 处理正常数据
   */
  private async handleNormalData(
    tokenAddress: Address,
    parsedInfo: ReturnType<typeof this.parseTokenInfo>
  ): Promise<RouteFetchResult> {
    const { liquidityAdded, quoteToken, offers, maxOffers, funds, maxFunds, symbol, name } = parsedInfo;
    const normalizedQuote = typeof quoteToken === 'string' ? quoteToken : undefined;

    // 如果已迁移，查询 Pancake pair
    let pancakePair: PancakePairCheckResult | null = null;
    if (liquidityAdded) {
      pancakePair = await this.fetchPancakePair(tokenAddress, normalizedQuote);
    }

    // 计算进度
    const offerProgress = maxOffers > 0n ? this.calculateRatio(offers, maxOffers) : null;
    const fundProgress = maxFunds > 0n ? this.calculateRatio(funds, maxFunds) : null;
    const progress = fundProgress ?? offerProgress ?? 0;
    const migrating = !liquidityAdded && (fundProgress ?? offerProgress ?? 0) >= 0.99;

    // 构建元数据
    const baseChannel = this.getDefaultChannel();
    const metadata = this.mergePancakeMetadata(
      { symbol, name },
      pancakePair ?? { hasLiquidity: false }
    );

    return {
      platform: this.platform,
      preferredChannel: liquidityAdded ? 'pancake' : baseChannel,
      readyForPancake: liquidityAdded,
      progress,
      migrating,
      quoteToken: normalizedQuote,
      metadata
    };
  }

  /**
   * 查询 Pancake pair
   */
  private async fetchPancakePair(
    tokenAddress: Address,
    quoteToken?: string
  ): Promise<PancakePairCheckResult | null> {
    try {
      // 先尝试通过 helper 获取 pair 地址
      const pairAddress = await this.executeQuery('getPancakePair', async () => {
        return await this.publicClient.readContract({
          address: CONTRACTS.FOUR_HELPER_V3 as Address,
          abi: tokenManagerHelperAbi as any,
          functionName: 'getPancakePair',
          args: [tokenAddress]
        }) as string;
      });

      if (pairAddress && !this.isZeroAddress(pairAddress)) {
        return {
          hasLiquidity: true,
          quoteToken,
          pairAddress,
          version: 'v2' // Four.meme helper 返回的是 V2 pair
        };
      }

      // getPancakePair 返回零地址，通过 Factory 查找
      structuredLogger.debug('[FourQuery] getPancakePair 返回零地址，尝试通过 Factory 查找');
      return await this.checkPancakeFallback(tokenAddress, quoteToken);
    } catch (error) {
      if (isServiceWorkerError(error)) {
        structuredLogger.warn('[FourQuery] Service Worker 限制，假设配对存在');
        return {
          hasLiquidity: true,
          quoteToken,
          pairAddress: undefined,
          version: 'v2'
        };
      }

      // 非 Service Worker 错误，尝试通过 Factory 查找
      structuredLogger.debug('[FourQuery] getPancakePair 失败，尝试通过 Factory 查找');
      if (quoteToken) {
        return await this.checkPancakeFallback(tokenAddress, quoteToken);
      }

      return null;
    }
  }
}

/**
 * 创建 Four.meme 平台查询实例
 */
export function createFourPlatformQuery(publicClient: any, platform: TokenPlatform = 'four'): FourPlatformQuery {
  return new FourPlatformQuery(publicClient, platform);
}
