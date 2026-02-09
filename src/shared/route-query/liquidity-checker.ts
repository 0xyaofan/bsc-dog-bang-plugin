/**
 * 流动性检查器
 * 统一 V2 和 V3 的流动性检查逻辑
 */

import type { Address } from 'viem';
import { structuredLogger } from '../structured-logger.js';
import {
  MIN_LIQUIDITY_THRESHOLDS,
  MIN_V3_LIQUIDITY,
  PAIR_ABI,
  V3_POOL_ABI
} from './constants.js';
import { InsufficientLiquidityError } from './errors.js';

/**
 * 流动性检查器
 */
export class LiquidityChecker {
  /**
   * 检查 V2 pair 流动性
   */
  async checkV2PairLiquidity(
    publicClient: any,
    pairAddress: string,
    tokenAddress: string,
    quoteToken: string
  ): Promise<boolean> {
    try {
      // 并发查询储备量、token0 和 token1（性能优化：减少 33% 查询时间）
      const [reserves, token0, token1] = await Promise.all([
        publicClient.readContract({
          address: pairAddress as Address,
          abi: PAIR_ABI,
          functionName: 'getReserves'
        }),
        publicClient.readContract({
          address: pairAddress as Address,
          abi: PAIR_ABI,
          functionName: 'token0'
        }),
        publicClient.readContract({
          address: pairAddress as Address,
          abi: PAIR_ABI,
          functionName: 'token1'
        })
      ]);

      // 确定哪个是报价代币的储备量
      const normalizedToken0 = (token0 as string).toLowerCase();
      const normalizedToken1 = (token1 as string).toLowerCase();
      const normalizedQuote = quoteToken.toLowerCase();

      let quoteReserve: bigint;
      if (normalizedToken0 === normalizedQuote) {
        quoteReserve = reserves[0] as bigint;
      } else if (normalizedToken1 === normalizedQuote) {
        quoteReserve = reserves[1] as bigint;
      } else {
        structuredLogger.error('[LiquidityChecker] 报价代币不匹配', {
          pairAddress,
          token0,
          token1,
          quoteToken
        });
        return false;
      }

      // 获取最小流动性阈值
      const threshold = this.getMinLiquidityThreshold(normalizedQuote);

      // 检查流动性是否足够
      const hasEnoughLiquidity = quoteReserve >= threshold;

      if (!hasEnoughLiquidity) {
        structuredLogger.warn('[LiquidityChecker] V2 流动性不足', {
          pairAddress,
          quoteToken,
          quoteReserve: quoteReserve.toString(),
          threshold: threshold.toString(),
          ratio: Number(quoteReserve) / Number(threshold)
        });
      } else {
        structuredLogger.debug('[LiquidityChecker] V2 流动性充足', {
          pairAddress,
          quoteToken,
          quoteReserve: quoteReserve.toString()
        });
      }

      return hasEnoughLiquidity;
    } catch (error) {
      structuredLogger.error('[LiquidityChecker] 查询 V2 流动性失败', {
        pairAddress,
        error: error instanceof Error ? error.message : String(error)
      });
      return false;
    }
  }

  /**
   * 检查 V3 pool 流动性
   */
  async checkV3PoolLiquidity(
    publicClient: any,
    poolAddress: string
  ): Promise<boolean> {
    try {
      // 查询 V3 池子的流动性
      const liquidity = await publicClient.readContract({
        address: poolAddress as Address,
        abi: V3_POOL_ABI,
        functionName: 'liquidity'
      }) as bigint;

      const hasEnoughLiquidity = liquidity >= MIN_V3_LIQUIDITY;

      if (!hasEnoughLiquidity) {
        structuredLogger.warn('[LiquidityChecker] V3 池子流动性不足', {
          poolAddress,
          liquidity: liquidity.toString(),
          threshold: MIN_V3_LIQUIDITY.toString(),
          ratio: Number(liquidity) / Number(MIN_V3_LIQUIDITY)
        });
      } else {
        structuredLogger.debug('[LiquidityChecker] V3 池子流动性充足', {
          poolAddress,
          liquidity: liquidity.toString()
        });
      }

      return hasEnoughLiquidity;
    } catch (error) {
      structuredLogger.error('[LiquidityChecker] 查询 V3 流动性失败', {
        poolAddress,
        error: error instanceof Error ? error.message : String(error)
      });
      return false;
    }
  }

  /**
   * 获取报价代币的储备量
   */
  async getQuoteReserve(
    publicClient: any,
    pairAddress: string,
    quoteToken: string
  ): Promise<bigint | null> {
    try {
      // 并发查询储备量、token0 和 token1（性能优化）
      const [reserves, token0, token1] = await Promise.all([
        publicClient.readContract({
          address: pairAddress as Address,
          abi: PAIR_ABI,
          functionName: 'getReserves'
        }),
        publicClient.readContract({
          address: pairAddress as Address,
          abi: PAIR_ABI,
          functionName: 'token0'
        }),
        publicClient.readContract({
          address: pairAddress as Address,
          abi: PAIR_ABI,
          functionName: 'token1'
        })
      ]);

      const normalizedToken0 = (token0 as string).toLowerCase();
      const normalizedToken1 = (token1 as string).toLowerCase();
      const normalizedQuote = quoteToken.toLowerCase();

      if (normalizedToken0 === normalizedQuote) {
        return reserves[0] as bigint;
      } else if (normalizedToken1 === normalizedQuote) {
        return reserves[1] as bigint;
      }

      return null;
    } catch (error) {
      structuredLogger.error('[LiquidityChecker] 获取储备量失败', {
        pairAddress,
        quoteToken,
        error: error instanceof Error ? error.message : String(error)
      });
      return null;
    }
  }

  /**
   * 获取最小流动性阈值
   */
  getMinLiquidityThreshold(quoteToken: string): bigint {
    const normalized = quoteToken.toLowerCase();
    return MIN_LIQUIDITY_THRESHOLDS[normalized] || MIN_LIQUIDITY_THRESHOLDS.default;
  }

  /**
   * 验证流动性是否满足阈值
   */
  validateLiquidity(
    liquidity: bigint,
    threshold: bigint,
    pairAddress: string,
    quoteToken: string
  ): void {
    if (liquidity < threshold) {
      throw new InsufficientLiquidityError(
        `Insufficient liquidity in pair ${pairAddress}`,
        pairAddress,
        quoteToken,
        liquidity,
        threshold
      );
    }
  }
}

/**
 * 创建流动性检查器实例
 */
export function createLiquidityChecker(): LiquidityChecker {
  return new LiquidityChecker();
}
