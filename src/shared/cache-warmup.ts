/**
 * 缓存预热机制
 *
 * 提前加载常用数据到缓存，提升首次访问性能
 */

import type { Address } from 'viem';
import { structuredLogger } from './structured-logger.js';
import { detectTokenPlatform, fetchRouteWithFallback } from './token-route.js';
import type { TokenPlatform } from './token-route.js';

/**
 * 预热配置
 */
export interface WarmupConfig {
  /** 要预热的代币地址列表 */
  tokenAddresses: string[];
  /** 并发数 */
  concurrency?: number;
  /** 超时时间（毫秒） */
  timeout?: number;
  /** 失败时是否继续 */
  continueOnError?: boolean;
  /** 预热完成回调 */
  onComplete?: (results: WarmupResult[]) => void;
  /** 预热进度回调 */
  onProgress?: (completed: number, total: number) => void;
}

/**
 * 预热结果
 */
export interface WarmupResult {
  /** 代币地址 */
  tokenAddress: string;
  /** 是否成功 */
  success: boolean;
  /** 耗时（毫秒） */
  duration: number;
  /** 错误信息 */
  error?: string;
  /** 平台 */
  platform?: TokenPlatform;
}

/**
 * 预热统计
 */
export interface WarmupStats {
  /** 总数 */
  total: number;
  /** 成功数 */
  success: number;
  /** 失败数 */
  failed: number;
  /** 成功率 */
  successRate: number;
  /** 总耗时（毫秒） */
  totalDuration: number;
  /** 平均耗时（毫秒） */
  avgDuration: number;
  /** 最大耗时（毫秒） */
  maxDuration: number;
  /** 最小耗时（毫秒） */
  minDuration: number;
}

/**
 * 缓存预热器
 */
export class CacheWarmer {
  private publicClient: any;

  constructor(publicClient: any) {
    this.publicClient = publicClient;
  }

  /**
   * 预热单个代币
   */
  async warmupToken(tokenAddress: string): Promise<WarmupResult> {
    const start = Date.now();

    try {
      structuredLogger.debug('[CacheWarmer] 开始预热', { tokenAddress });

      const platform = detectTokenPlatform(tokenAddress);
      await fetchRouteWithFallback(
        this.publicClient,
        tokenAddress as Address,
        platform
      );

      const duration = Date.now() - start;

      structuredLogger.info('[CacheWarmer] 预热成功', {
        tokenAddress,
        platform,
        duration
      });

      return {
        tokenAddress,
        success: true,
        duration,
        platform
      };
    } catch (error) {
      const duration = Date.now() - start;
      const errorMessage = error instanceof Error ? error.message : String(error);

      structuredLogger.warn('[CacheWarmer] 预热失败', {
        tokenAddress,
        error: errorMessage,
        duration
      });

      return {
        tokenAddress,
        success: false,
        duration,
        error: errorMessage
      };
    }
  }

  /**
   * 批量预热代币
   */
  async warmupTokens(config: WarmupConfig): Promise<WarmupResult[]> {
    const {
      tokenAddresses,
      concurrency = 3,
      timeout = 30000,
      continueOnError = true,
      onComplete,
      onProgress
    } = config;

    structuredLogger.info('[CacheWarmer] 开始批量预热', {
      total: tokenAddresses.length,
      concurrency
    });

    const results: WarmupResult[] = [];
    const chunks = this.chunkArray(tokenAddresses, concurrency);

    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];

      // 并发预热当前批次
      const chunkResults = await Promise.allSettled(
        chunk.map(address =>
          this.warmupTokenWithTimeout(address, timeout)
        )
      );

      // 处理结果
      for (const result of chunkResults) {
        if (result.status === 'fulfilled') {
          results.push(result.value);
        } else {
          // Promise rejected
          const error = result.reason;
          results.push({
            tokenAddress: 'unknown',
            success: false,
            duration: 0,
            error: error instanceof Error ? error.message : String(error)
          });
        }
      }

      // 报告进度
      if (onProgress) {
        onProgress(results.length, tokenAddresses.length);
      }

      // 如果不继续错误，检查是否有失败
      if (!continueOnError && results.some(r => !r.success)) {
        structuredLogger.warn('[CacheWarmer] 遇到错误，停止预热');
        break;
      }
    }

    // 完成回调
    if (onComplete) {
      onComplete(results);
    }

    // 记录统计
    const stats = this.calculateStats(results);
    structuredLogger.info('[CacheWarmer] 预热完成', stats);

    return results;
  }

  /**
   * 带超时的预热
   */
  private async warmupTokenWithTimeout(
    tokenAddress: string,
    timeout: number
  ): Promise<WarmupResult> {
    return Promise.race([
      this.warmupToken(tokenAddress),
      new Promise<WarmupResult>((_, reject) =>
        setTimeout(() => reject(new Error('Warmup timeout')), timeout)
      )
    ]);
  }

  /**
   * 将数组分块
   */
  private chunkArray<T>(array: T[], size: number): T[][] {
    const chunks: T[][] = [];

    for (let i = 0; i < array.length; i += size) {
      chunks.push(array.slice(i, i + size));
    }

    return chunks;
  }

  /**
   * 计算统计信息
   */
  private calculateStats(results: WarmupResult[]): WarmupStats {
    const total = results.length;
    const success = results.filter(r => r.success).length;
    const failed = total - success;
    const successRate = total > 0 ? success / total : 0;

    const durations = results.map(r => r.duration);
    const totalDuration = durations.reduce((a, b) => a + b, 0);
    const avgDuration = total > 0 ? totalDuration / total : 0;
    const maxDuration = durations.length > 0 ? Math.max(...durations) : 0;
    const minDuration = durations.length > 0 ? Math.min(...durations) : 0;

    return {
      total,
      success,
      failed,
      successRate,
      totalDuration,
      avgDuration,
      maxDuration,
      minDuration
    };
  }
}

/**
 * 智能预热策略
 */
export class SmartWarmupStrategy {
  private publicClient: any;
  private warmer: CacheWarmer;
  private popularTokens: Map<string, number>; // 代币地址 -> 访问次数

  constructor(publicClient: any) {
    this.publicClient = publicClient;
    this.warmer = new CacheWarmer(publicClient);
    this.popularTokens = new Map();
  }

  /**
   * 记录代币访问
   */
  recordAccess(tokenAddress: string): void {
    const count = this.popularTokens.get(tokenAddress) || 0;
    this.popularTokens.set(tokenAddress, count + 1);
  }

  /**
   * 获取热门代币
   */
  getPopularTokens(limit: number = 10): string[] {
    const sorted = Array.from(this.popularTokens.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit);

    return sorted.map(([address]) => address);
  }

  /**
   * 预热热门代币
   */
  async warmupPopularTokens(limit: number = 10): Promise<WarmupResult[]> {
    const popularTokens = this.getPopularTokens(limit);

    if (popularTokens.length === 0) {
      structuredLogger.info('[SmartWarmup] 没有热门代币需要预热');
      return [];
    }

    structuredLogger.info('[SmartWarmup] 预热热门代币', {
      count: popularTokens.length
    });

    return this.warmer.warmupTokens({
      tokenAddresses: popularTokens,
      concurrency: 5,
      continueOnError: true
    });
  }

  /**
   * 启动定期预热
   */
  startPeriodicWarmup(intervalMs: number = 300000): () => void {
    const timer = setInterval(() => {
      this.warmupPopularTokens();
    }, intervalMs);

    return () => clearInterval(timer);
  }

  /**
   * 清除访问记录
   */
  clearAccessRecords(): void {
    this.popularTokens.clear();
  }

  /**
   * 获取访问统计
   */
  getAccessStats(): Map<string, number> {
    return new Map(this.popularTokens);
  }
}

/**
 * 预热常用代币列表
 */
export const COMMON_TOKENS = [
  // 主流稳定币
  '0x55d398326f99059ff775485246999027b3197955', // USDT
  '0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d', // USDC
  '0xe9e7cea3dedca5984780bafc599bd69add087d56', // BUSD

  // 主流代币
  '0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c', // WBNB
  '0x0e09fabb73bd3ade0a17ecc321fd13a19e81ce82', // CAKE
  '0x2170ed0880ac9a755fd29b2688956bd959f933f8', // ETH
  '0x7130d2a12b9bcbfae4f2634d864a1ee1ce3ead9c', // BTCB
];

/**
 * 预热常用代币
 */
export async function warmupCommonTokens(
  publicClient: any
): Promise<WarmupResult[]> {
  const warmer = new CacheWarmer(publicClient);

  structuredLogger.info('[CacheWarmer] 预热常用代币', {
    count: COMMON_TOKENS.length
  });

  return warmer.warmupTokens({
    tokenAddresses: COMMON_TOKENS,
    concurrency: 5,
    continueOnError: true
  });
}

/**
 * 创建缓存预热器
 */
export function createCacheWarmer(publicClient: any): CacheWarmer {
  return new CacheWarmer(publicClient);
}

/**
 * 创建智能预热策略
 */
export function createSmartWarmupStrategy(publicClient: any): SmartWarmupStrategy {
  return new SmartWarmupStrategy(publicClient);
}
