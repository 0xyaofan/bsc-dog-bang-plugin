/**
 * 平台查询基类
 * 提供通用的查询逻辑和错误处理
 */

import type { Address } from 'viem';
import { structuredLogger } from '../structured-logger.js';
import { CONTRACTS } from '../trading-config.js';
import type { RouteFetchResult, TokenPlatform, PancakePairCheckResult } from './types.js';
import { ServiceWorkerError, isServiceWorkerError, toServiceWorkerError } from './errors.js';
import { pancakePairFinder } from './pancake-pair-finder.js';

/**
 * 平台查询基类
 */
export abstract class BasePlatformQuery {
  protected publicClient: any;
  protected platform: TokenPlatform;

  constructor(publicClient: any, platform: TokenPlatform) {
    this.publicClient = publicClient;
    this.platform = platform;
  }

  /**
   * 查询路由信息（子类实现）
   */
  abstract queryRoute(tokenAddress: Address): Promise<RouteFetchResult>;

  /**
   * 处理 Service Worker 错误的通用逻辑
   */
  protected handleServiceWorkerError(
    tokenAddress: Address,
    error: Error,
    operation: string
  ): RouteFetchResult {
    structuredLogger.warn('[BasePlatformQuery] Service Worker 限制', {
      platform: this.platform,
      tokenAddress,
      operation
    });

    // 返回默认的未迁移状态
    return this.getDefaultUnmigratedRoute(tokenAddress);
  }

  /**
   * 获取默认的未迁移路由
   */
  protected getDefaultUnmigratedRoute(tokenAddress: Address): RouteFetchResult {
    const preferredChannel = this.getDefaultChannel();

    return {
      platform: this.platform,
      preferredChannel,
      readyForPancake: false,
      progress: 0,
      migrating: false,
      metadata: {},
      notes: 'Service Worker 限制，无法查询代币信息，假设未迁移'
    };
  }

  /**
   * 获取默认交易渠道
   */
  protected getDefaultChannel(): 'pancake' | 'four' | 'xmode' | 'flap' {
    switch (this.platform) {
      case 'four':
        return 'four';
      case 'xmode':
        return 'xmode';
      case 'flap':
        return 'flap';
      case 'luna':
        return 'pancake';
      default:
        return 'pancake';
    }
  }

  /**
   * 检查并返回 Pancake fallback
   */
  protected async checkPancakeFallback(
    tokenAddress: Address,
    quoteToken?: string
  ): Promise<PancakePairCheckResult> {
    try {
      return await pancakePairFinder.findBestPair(
        this.publicClient,
        tokenAddress,
        quoteToken
      );
    } catch (error) {
      // 如果是 Service Worker 错误，返回一个标记
      if (isServiceWorkerError(error)) {
        structuredLogger.warn('[BasePlatformQuery] Service Worker 限制，无法检查 Pancake pair');
        return {
          hasLiquidity: true,
          quoteToken,
          pairAddress: undefined,
          version: 'v2'
        };
      }

      throw error;
    }
  }

  /**
   * 合并 Pancake 元数据
   */
  protected mergePancakeMetadata(
    baseMetadata: Record<string, any> | undefined,
    pairInfo: PancakePairCheckResult
  ): Record<string, any> {
    if (!pairInfo?.hasLiquidity) {
      return baseMetadata || {};
    }

    const metadata = baseMetadata ? { ...baseMetadata } : {};

    if (pairInfo.quoteToken) {
      metadata.pancakeQuoteToken = pairInfo.quoteToken;

      // 设置推荐模式
      const preferredMode = this.resolvePancakePreferredMode(pairInfo.quoteToken);
      if (preferredMode) {
        metadata.pancakePreferredMode = preferredMode;
      }
    }

    if (pairInfo.pairAddress) {
      metadata.pancakePairAddress = pairInfo.pairAddress;
    }

    if (pairInfo.version) {
      metadata.pancakeVersion = pairInfo.version;
    }

    return metadata;
  }

  /**
   * 解析 Pancake 推荐模式
   */
  protected resolvePancakePreferredMode(quoteToken?: string | null): 'v2' | 'v3' | undefined {
    if (!quoteToken) {
      return undefined;
    }

    const normalized = quoteToken.toLowerCase();

    // 从 CONTRACTS 获取 WBNB 地址
    const wbnb = CONTRACTS.WBNB?.toLowerCase();

    if (!normalized || !wbnb) {
      return undefined;
    }

    // 如果不是 WBNB，推荐使用 V3
    return normalized === wbnb ? undefined : 'v3';
  }

  /**
   * 检查数据是否为空
   */
  protected isStructEffectivelyEmpty(struct: any): boolean {
    if (!struct) {
      return true;
    }

    return this.isZeroLikeValue(struct);
  }

  /**
   * 检查值是否为零值
   */
  protected isZeroLikeValue(value: any): boolean {
    if (value === null || value === undefined) {
      return true;
    }

    if (typeof value === 'boolean') {
      return value === false;
    }

    if (typeof value === 'number') {
      return value === 0;
    }

    if (typeof value === 'bigint') {
      return value === 0n;
    }

    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (!trimmed) {
        return true;
      }
      if (trimmed === '0' || trimmed === '0x') {
        return true;
      }
      if (trimmed.startsWith('0x')) {
        return /^0x0+$/i.test(trimmed) || this.isZeroAddress(trimmed);
      }
      return false;
    }

    if (Array.isArray(value)) {
      return value.length === 0 || value.every(v => this.isZeroLikeValue(v));
    }

    if (typeof value === 'object') {
      const entries = Object.values(value);
      return entries.length === 0 || entries.every(v => this.isZeroLikeValue(v));
    }

    return false;
  }

  /**
   * 检查是否为零地址
   */
  protected isZeroAddress(value?: string | null): boolean {
    if (typeof value !== 'string') {
      return false;
    }
    return value.toLowerCase() === '0x0000000000000000000000000000000000000000';
  }

  /**
   * 计算进度比率
   */
  protected calculateRatio(current: bigint, target: bigint): number {
    if (target === 0n) {
      return 0;
    }

    // 转换为浮点数计算
    const currentNum = Number(current);
    const targetNum = Number(target);

    return currentNum / targetNum;
  }

  /**
   * 标准化地址
   */
  protected normalizeAddress(address: string): string {
    return (address || '').toLowerCase();
  }

  /**
   * 执行查询并处理错误
   */
  protected async executeQuery<T>(
    operation: string,
    queryFn: () => Promise<T>
  ): Promise<T> {
    try {
      return await queryFn();
    } catch (error) {
      // 检查是否是 Service Worker 错误
      const swError = toServiceWorkerError(error, operation);
      if (swError) {
        throw swError;
      }

      // 其他错误继续抛出
      throw error;
    }
  }

  /**
   * 记录查询开始
   */
  protected logQueryStart(tokenAddress: Address): void {
    structuredLogger.debug(`[${this.platform}Query] 开始查询`, {
      platform: this.platform,
      tokenAddress
    });
  }

  /**
   * 记录查询成功
   */
  protected logQuerySuccess(tokenAddress: Address, result: RouteFetchResult): void {
    structuredLogger.info(`[${this.platform}Query] 查询成功`, {
      platform: this.platform,
      tokenAddress,
      preferredChannel: result.preferredChannel,
      readyForPancake: result.readyForPancake,
      progress: result.progress
    });
  }

  /**
   * 记录查询失败
   */
  protected logQueryError(tokenAddress: Address, error: Error): void {
    structuredLogger.error(`[${this.platform}Query] 查询失败`, {
      platform: this.platform,
      tokenAddress,
      error: error.message,
      stack: error.stack
    });
  }
}
