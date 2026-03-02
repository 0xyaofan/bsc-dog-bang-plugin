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
   * 使用原始 eth_call 避免 Service Worker 中的动态 import 问题
   */
  async checkV2PairLiquidity(
    publicClient: any,
    pairAddress: string,
    tokenAddress: string,
    quoteToken: string
  ): Promise<boolean> {
    try {
      // 手动编码函数调用，避免 Service Worker 限制
      // function getReserves() returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)
      // 函数选择器: keccak256("getReserves()") = 0x0902f1ac
      const getReservesData = '0x0902f1ac' as `0x${string}`;

      // function token0() returns (address)
      // 函数选择器: keccak256("token0()") = 0x0dfe1681
      const token0Data = '0x0dfe1681' as `0x${string}`;

      // function token1() returns (address)
      // 函数选择器: keccak256("token1()") = 0xd21220a7
      const token1Data = '0xd21220a7' as `0x${string}`;

      // 并发查询储备量、token0 和 token1
      const [reservesResult, token0Result, token1Result] = await Promise.all([
        publicClient.request({
          method: 'eth_call',
          params: [{ to: pairAddress as Address, data: getReservesData }, 'latest'],
        }),
        publicClient.request({
          method: 'eth_call',
          params: [{ to: pairAddress as Address, data: token0Data }, 'latest'],
        }),
        publicClient.request({
          method: 'eth_call',
          params: [{ to: pairAddress as Address, data: token1Data }, 'latest'],
        }),
      ]);

      // 解码 getReserves 返回值
      // 返回值: (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)
      // reserve0: bytes 0-32 (实际只用后14字节，uint112)
      // reserve1: bytes 32-64 (实际只用后14字节，uint112)
      const reserve0 = BigInt(`0x${reservesResult.slice(2, 66)}`);
      const reserve1 = BigInt(`0x${reservesResult.slice(66, 130)}`);

      // 解码 token0 和 token1
      const token0 = `0x${token0Result.slice(26, 66)}`.toLowerCase();
      const token1 = `0x${token1Result.slice(26, 66)}`.toLowerCase();
      const normalizedQuote = quoteToken.toLowerCase();

      // 确定哪个是报价代币的储备量
      let quoteReserve: bigint;
      if (token0 === normalizedQuote) {
        quoteReserve = reserve0;
      } else if (token1 === normalizedQuote) {
        quoteReserve = reserve1;
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
