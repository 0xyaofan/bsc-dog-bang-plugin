/**
 * Pancake Pair 查找器
 * 统一 V2 和 V3 的 pair 查找逻辑
 */

import type { Address } from 'viem';
import { createLRUCacheWithTTL } from '../lru-cache.js';
import { cacheMonitorManager } from '../cache-monitor.js';
import { structuredLogger } from '../structured-logger.js';
import { CONTRACTS, PANCAKE_FACTORY_ABI, PANCAKE_V3_FACTORY_ABI } from '../trading-config.js';
import { getFourQuoteTokenList } from '../channel-config.js';
import {
  ZERO_ADDRESS,
  PANCAKE_V3_FEE_TIERS,
  SPECIAL_PAIR_MAPPINGS,
  PANCAKE_PAIR_CACHE_CONFIG
} from './constants.js';
import type { PancakePairCheckResult, PancakePairInfo } from './types.js';
import { LiquidityChecker } from './liquidity-checker.js';
import { PancakePairNotFoundError, isServiceWorkerError } from './errors.js';

/**
 * Pancake Pair 查找器
 */
export class PancakePairFinder {
  private cache: ReturnType<typeof createLRUCacheWithTTL<string, PancakePairInfo>>;
  private liquidityChecker: LiquidityChecker;

  constructor() {
    // 创建缓存
    this.cache = createLRUCacheWithTTL<string, PancakePairInfo>(
      PANCAKE_PAIR_CACHE_CONFIG.MAX_SIZE,
      PANCAKE_PAIR_CACHE_CONFIG.TTL
    );

    // 注册监控
    cacheMonitorManager.register('pancake-pair-cache', this.cache);

    // 创建流动性检查器
    this.liquidityChecker = new LiquidityChecker();
  }

  /**
   * 查找最佳 Pancake pair
   */
  async findBestPair(
    publicClient: any,
    tokenAddress: Address,
    quoteToken?: string
  ): Promise<PancakePairCheckResult> {
    const normalizedToken = tokenAddress.toLowerCase();

    // 1. 检查特殊配对映射
    const specialPair = SPECIAL_PAIR_MAPPINGS[normalizedToken];
    if (specialPair) {
      structuredLogger.info('[PancakePairFinder] 使用预定义的特殊配对', {
        tokenAddress: normalizedToken,
        pairAddress: specialPair.pairAddress,
        quoteToken: specialPair.quoteToken,
        version: specialPair.version
      });

      // 缓存特殊配对
      this.cache.set(normalizedToken, {
        pairAddress: specialPair.pairAddress,
        quoteToken: specialPair.quoteToken,
        version: specialPair.version,
        timestamp: Date.now()
      });

      return {
        hasLiquidity: true,
        quoteToken: specialPair.quoteToken,
        pairAddress: specialPair.pairAddress,
        version: specialPair.version
      };
    }

    // 2. 检查缓存
    const cached = this.cache.get(normalizedToken);
    if (cached) {
      structuredLogger.debug('[PancakePairFinder] 使用缓存的 pair', {
        tokenAddress: normalizedToken,
        pairAddress: cached.pairAddress,
        version: cached.version
      });

      return {
        hasLiquidity: true,
        quoteToken: cached.quoteToken,
        pairAddress: cached.pairAddress,
        version: cached.version
      };
    }

    // 3. 如果指定了 quoteToken，只查询这一个
    if (quoteToken && typeof quoteToken === 'string') {
      let normalizedQuote = quoteToken.toLowerCase();

      // 零地址表示 BNB 筹集，需要转换为 WBNB 来查询 Pancake pair
      if (normalizedQuote === ZERO_ADDRESS.toLowerCase()) {
        structuredLogger.debug('[PancakePairFinder] quoteToken 是零地址（BNB 筹集），转换为 WBNB 查询', {
          tokenAddress: normalizedToken
        });
        normalizedQuote = CONTRACTS.WBNB.toLowerCase();
      }

      try {
        // 并发查询 V2 和 V3（性能优化：减少 50% 查询时间）
        const [v2Result, v3Result] = await Promise.all([
          this.findV2Pair(publicClient, tokenAddress, normalizedQuote),
          this.findV3Pool(publicClient, tokenAddress, normalizedQuote)
        ]);

        // 优先使用 V3（通常流动性更好）
        if (v3Result) {
          this.cacheResult(normalizedToken, v3Result);
          return v3Result;
        }

        // 使用 V2
        if (v2Result) {
          this.cacheResult(normalizedToken, v2Result);
          return v2Result;
        }

        // 都没找到
        return { hasLiquidity: false };
      } catch (error) {
        if (isServiceWorkerError(error)) {
          structuredLogger.warn('[PancakePairFinder] Service Worker 限制，跳过流动性检查');
          // 返回一个标记，表示可能存在但无法验证
          return {
            hasLiquidity: true,
            quoteToken: normalizedQuote,
            pairAddress: undefined,
            version: 'v2'
          };
        }
        throw error;
      }
    }

    // 4. 未指定 quoteToken，遍历所有候选
    return this.findBestPairFromCandidates(publicClient, tokenAddress);
  }

  /**
   * 从候选列表中查找最佳 pair
   */
  private async findBestPairFromCandidates(
    publicClient: any,
    tokenAddress: Address
  ): Promise<PancakePairCheckResult> {
    const candidates = this.buildCandidateList();

    structuredLogger.debug('[PancakePairFinder] 开始查询候选配对', {
      tokenAddress,
      candidatesCount: candidates.length
    });

    // 并发查询所有候选
    const results = await Promise.all(
      candidates.map(candidate => this.queryCandidate(publicClient, tokenAddress, candidate))
    );

    // 过滤有效结果
    const validResults = results.filter(r => r !== null && r.hasLiquidity) as PancakePairCheckResult[];

    if (validResults.length === 0) {
      structuredLogger.warn('[PancakePairFinder] 没有找到流动性充足的配对', {
        tokenAddress,
        totalCandidates: candidates.length
      });
      return { hasLiquidity: false };
    }

    // 选择流动性最大的 pair
    const bestResult = this.selectBestPair(validResults);

    structuredLogger.info('[PancakePairFinder] 选择流动性最大的配对', {
      pairAddress: bestResult.pairAddress,
      quoteToken: bestResult.quoteToken,
      version: bestResult.version,
      liquidity: bestResult.liquidityAmount?.toString(),
      totalCandidates: validResults.length
    });

    // 缓存结果
    if (bestResult.pairAddress && bestResult.quoteToken) {
      this.cacheResult(tokenAddress.toLowerCase(), {
        hasLiquidity: true,
        quoteToken: bestResult.quoteToken,
        pairAddress: bestResult.pairAddress,
        version: bestResult.version || 'v2'
      });
    }

    return bestResult;
  }

  /**
   * 查询单个候选
   */
  private async queryCandidate(
    publicClient: any,
    tokenAddress: Address,
    candidate: string
  ): Promise<PancakePairCheckResult | null> {
    try {
      // 查询 V2 pair
      const pair = await publicClient.readContract({
        address: CONTRACTS.PANCAKE_FACTORY,
        abi: PANCAKE_FACTORY_ABI,
        functionName: 'getPair',
        args: [tokenAddress, candidate as Address]
      }) as string;

      if (typeof pair !== 'string' || pair === ZERO_ADDRESS) {
        return null;
      }

      // 获取储备量
      const quoteReserve = await this.liquidityChecker.getQuoteReserve(
        publicClient,
        pair,
        candidate
      );

      if (quoteReserve === null) {
        return null;
      }

      // 检查流动性阈值
      const threshold = this.liquidityChecker.getMinLiquidityThreshold(candidate);
      if (quoteReserve < threshold) {
        structuredLogger.warn('[PancakePairFinder] 候选配对流动性不足', {
          pair,
          quoteToken: candidate,
          quoteReserve: quoteReserve.toString(),
          threshold: threshold.toString()
        });
        return null;
      }

      return {
        hasLiquidity: true,
        quoteToken: candidate,
        pairAddress: pair,
        version: 'v2',
        liquidityAmount: quoteReserve
      };
    } catch (error) {
      if (isServiceWorkerError(error)) {
        // Service Worker 限制，假设可能存在
        return {
          hasLiquidity: true,
          quoteToken: candidate,
          pairAddress: 'unknown',
          version: 'v2',
          liquidityAmount: BigInt(1e20) // 高流动性值
        };
      }

      structuredLogger.error('[PancakePairFinder] 查询候选失败', {
        candidate,
        error: error instanceof Error ? error.message : String(error)
      });
      return null;
    }
  }

  /**
   * 查找 V2 pair
   */
  private async findV2Pair(
    publicClient: any,
    tokenAddress: Address,
    quoteToken: string
  ): Promise<PancakePairCheckResult | null> {
    try {
      const pair = await publicClient.readContract({
        address: CONTRACTS.PANCAKE_FACTORY,
        abi: PANCAKE_FACTORY_ABI,
        functionName: 'getPair',
        args: [tokenAddress, quoteToken as Address]
      }) as string;

      if (typeof pair !== 'string' || pair === ZERO_ADDRESS) {
        return null;
      }

      // 检查流动性
      const hasLiquidity = await this.liquidityChecker.checkV2PairLiquidity(
        publicClient,
        pair,
        tokenAddress,
        quoteToken
      );

      if (!hasLiquidity) {
        return null;
      }

      structuredLogger.debug('[PancakePairFinder] 找到 V2 pair', { pair, quoteToken });

      return {
        hasLiquidity: true,
        quoteToken,
        pairAddress: pair,
        version: 'v2'
      };
    } catch (error) {
      structuredLogger.error('[PancakePairFinder] 查询 V2 pair 失败', {
        tokenAddress,
        quoteToken,
        error: error instanceof Error ? error.message : String(error)
      });
      return null;
    }
  }

  /**
   * 查找 V3 pool
   */
  private async findV3Pool(
    publicClient: any,
    tokenAddress: Address,
    quoteToken: string
  ): Promise<PancakePairCheckResult | null> {
    try {
      // 并发查询所有费率级别的 pool（性能优化：减少 66% 查询时间）
      const poolPromises = PANCAKE_V3_FEE_TIERS.map(async (fee) => {
        try {
          const pool = await publicClient.readContract({
            address: CONTRACTS.PANCAKE_V3_FACTORY,
            abi: PANCAKE_V3_FACTORY_ABI,
            functionName: 'getPool',
            args: [tokenAddress, quoteToken as Address, fee]
          }) as string;

          if (typeof pool !== 'string' || pool === ZERO_ADDRESS) {
            return null;
          }

          // 检查流动性
          const hasLiquidity = await this.liquidityChecker.checkV3PoolLiquidity(publicClient, pool);

          if (!hasLiquidity) {
            structuredLogger.warn('[PancakePairFinder] V3 池子流动性不足', { pool, fee });
            return null;
          }

          structuredLogger.debug('[PancakePairFinder] 找到 V3 pool', { pool, quoteToken, fee });

          return {
            hasLiquidity: true,
            quoteToken,
            pairAddress: pool,
            version: 'v3' as const,
            fee
          };
        } catch (error) {
          // 忽略单个费率级别的错误
          return null;
        }
      });

      // 等待所有查询完成
      const results = await Promise.all(poolPromises);

      // 返回第一个有效结果
      const validResult = results.find(r => r !== null);
      return validResult || null;
    } catch (error) {
      structuredLogger.error('[PancakePairFinder] 查询 V3 pool 失败', {
        tokenAddress,
        quoteToken,
        error: error instanceof Error ? error.message : String(error)
      });
      return null;
    }
  }

  /**
   * 选择流动性最大的 pair
   */
  private selectBestPair(pairs: PancakePairCheckResult[]): PancakePairCheckResult {
    // 过滤掉 pairAddress 为 'unknown' 的结果
    const validPairs = pairs.filter(p => p.pairAddress && p.pairAddress !== 'unknown');

    if (validPairs.length === 0) {
      // 所有结果都是 'unknown'，返回第一个
      return pairs[0];
    }

    // 选择流动性最大的
    return validPairs.reduce((best, current) => {
      const bestLiquidity = best.liquidityAmount || BigInt(0);
      const currentLiquidity = current.liquidityAmount || BigInt(0);
      return currentLiquidity > bestLiquidity ? current : best;
    });
  }

  /**
   * 构建候选列表
   */
  private buildCandidateList(): string[] {
    const candidates: string[] = [];

    // 优先添加 Four.meme 的报价代币
    getFourQuoteTokenList().forEach(token => {
      const normalized = token.toLowerCase();
      if (!candidates.includes(normalized)) {
        candidates.push(normalized);
      }
    });

    // 添加标准报价代币
    [
      CONTRACTS.WBNB,
      CONTRACTS.BUSD,
      CONTRACTS.USDT,
      CONTRACTS.ASTER,
      CONTRACTS.USD1,
      CONTRACTS.UNITED_STABLES_U
    ].forEach(token => {
      if (token) {
        const normalized = token.toLowerCase();
        if (!candidates.includes(normalized)) {
          candidates.push(normalized);
        }
      }
    });

    return candidates;
  }

  /**
   * 缓存查询结果
   */
  private cacheResult(tokenAddress: string, result: PancakePairCheckResult): void {
    if (result.hasLiquidity && result.pairAddress && result.quoteToken && result.version) {
      this.cache.set(tokenAddress, {
        pairAddress: result.pairAddress,
        quoteToken: result.quoteToken,
        version: result.version,
        timestamp: Date.now()
      });
    }
  }

  /**
   * 清除缓存
   */
  clearCache(tokenAddress?: string): void {
    if (tokenAddress) {
      this.cache.delete(tokenAddress.toLowerCase());
    } else {
      this.cache.clear();
    }
  }
}

/**
 * 创建 Pancake pair 查找器实例
 */
export function createPancakePairFinder(): PancakePairFinder {
  return new PancakePairFinder();
}

/**
 * 全局 Pancake pair 查找器实例
 */
export const pancakePairFinder = new PancakePairFinder();
