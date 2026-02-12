/**
 * Custom Aggregator Adapter
 * 使用 SDK 的 @bsc-trading/aggregator 包来实现自定义聚合器功能
 */

import type { Address, PublicClient } from 'viem';
import {
  createRouteSelector,
  createQuoteCalculator,
  createSwapBuilder,
  type RouteOption,
  type QuoteResult,
  type SwapTransaction,
} from '@bsc-trading/aggregator';
import { CUSTOM_AGGREGATOR_CONFIG, PANCAKE_CONTRACTS, WBNB_ADDRESS } from '../shared/config/index.js';
import { structuredLogger } from '../shared/structured-logger.js';

/**
 * 自定义聚合器适配器
 * 桥接 SDK aggregator 和插件接口
 */
export class CustomAggregatorAdapter {
  private routeSelector: ReturnType<typeof createRouteSelector>;
  private quoteCalculator: ReturnType<typeof createQuoteCalculator>;
  private swapBuilder: ReturnType<typeof createSwapBuilder>;

  constructor(private publicClient: PublicClient) {
    // 初始化 SDK 组件
    this.routeSelector = createRouteSelector(publicClient, {
      enableV2: true,
      enableV3: true,
      v3FeePriority: [500, 2500, 10000],
      maxRoutes: 5,
    });

    this.quoteCalculator = createQuoteCalculator(publicClient, {
      v2FactoryAddress: PANCAKE_CONTRACTS.FACTORY as Address,
      v3QuoterAddress: PANCAKE_CONTRACTS.V3_QUOTER as Address,
      v3FactoryAddress: PANCAKE_CONTRACTS.V3_FACTORY as Address,
    });

    this.swapBuilder = createSwapBuilder();
  }

  /**
   * 获取买入报价
   */
  async getBuyQuote(params: {
    tokenAddress: Address;
    amountIn: bigint;
    quoteToken?: Address;
    slippageBps?: number;
  }): Promise<{
    route: RouteOption;
    quote: QuoteResult;
  } | null> {
    const { tokenAddress, amountIn, quoteToken, slippageBps = 50 } = params;

    try {
      structuredLogger.debug('[CustomAggregatorAdapter] 获取买入报价', {
        tokenAddress,
        amountIn: amountIn.toString(),
        quoteToken,
      });

      // 1. 选择最优路由
      const route = await this.routeSelector.selectBestRoute({
        tokenIn: WBNB_ADDRESS,
        tokenOut: tokenAddress,
        amountIn,
        quoteToken,
      });

      if (!route) {
        structuredLogger.warn('[CustomAggregatorAdapter] 未找到可用路由');
        return null;
      }

      // 2. 获取报价
      const quote = await this.quoteCalculator.getQuote({
        route,
        amountIn,
        slippageBps,
      });

      structuredLogger.info('[CustomAggregatorAdapter] 报价成功', {
        mode: route.mode,
        amountOut: quote.amountOut.toString(),
        priceImpact: quote.priceImpact,
      });

      return { route, quote };
    } catch (error) {
      structuredLogger.error('[CustomAggregatorAdapter] 报价失败', {
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  /**
   * 获取卖出报价
   */
  async getSellQuote(params: {
    tokenAddress: Address;
    amountIn: bigint;
    quoteToken?: Address;
    slippageBps?: number;
  }): Promise<{
    route: RouteOption;
    quote: QuoteResult;
  } | null> {
    const { tokenAddress, amountIn, quoteToken, slippageBps = 50 } = params;

    try {
      structuredLogger.debug('[CustomAggregatorAdapter] 获取卖出报价', {
        tokenAddress,
        amountIn: amountIn.toString(),
        quoteToken,
      });

      // 1. 选择最优路由
      const route = await this.routeSelector.selectBestRoute({
        tokenIn: tokenAddress,
        tokenOut: WBNB_ADDRESS,
        amountIn,
        quoteToken,
      });

      if (!route) {
        structuredLogger.warn('[CustomAggregatorAdapter] 未找到可用路由');
        return null;
      }

      // 2. 获取报价
      const quote = await this.quoteCalculator.getQuote({
        route,
        amountIn,
        slippageBps,
      });

      structuredLogger.info('[CustomAggregatorAdapter] 报价成功', {
        mode: route.mode,
        amountOut: quote.amountOut.toString(),
        priceImpact: quote.priceImpact,
      });

      return { route, quote };
    } catch (error) {
      structuredLogger.error('[CustomAggregatorAdapter] 报价失败', {
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  /**
   * 构建买入交易
   */
  buildBuyTransaction(params: {
    route: RouteOption;
    amountIn: bigint;
    minAmountOut: bigint;
    recipient: Address;
    deadline?: bigint;
  }): SwapTransaction {
    const { route, amountIn, minAmountOut, recipient, deadline } = params;

    return this.swapBuilder.buildBuyTransaction({
      route,
      amountIn,
      minAmountOut,
      recipient,
      deadline: deadline || this.swapBuilder.calculateDeadline(300),
      aggregatorAddress: CUSTOM_AGGREGATOR_CONFIG.DEFAULT_ADDRESS as Address,
    });
  }

  /**
   * 构建卖出交易
   */
  buildSellTransaction(params: {
    route: RouteOption;
    amountIn: bigint;
    minAmountOut: bigint;
    recipient: Address;
    deadline?: bigint;
  }): SwapTransaction {
    const { route, amountIn, minAmountOut, recipient, deadline } = params;

    return this.swapBuilder.buildSellTransaction({
      route,
      amountIn,
      minAmountOut,
      recipient,
      deadline: deadline || this.swapBuilder.calculateDeadline(300),
      aggregatorAddress: CUSTOM_AGGREGATOR_CONFIG.DEFAULT_ADDRESS as Address,
    });
  }

  /**
   * 计算最小输出金额（考虑滑点）
   */
  calculateMinAmountOut(expectedOutput: bigint, slippageBps: number): bigint {
    return this.swapBuilder.calculateMinAmountOut(expectedOutput, slippageBps);
  }

  /**
   * 计算截止时间
   */
  calculateDeadline(secondsFromNow: number = 300): bigint {
    return this.swapBuilder.calculateDeadline(secondsFromNow);
  }

  /**
   * 比较 V2 和 V3 报价
   */
  async compareV2V3(params: {
    tokenIn: Address;
    tokenOut: Address;
    amountIn: bigint;
  }): Promise<{
    v2: QuoteResult | null;
    v3: QuoteResult[];
    best: QuoteResult | null;
  }> {
    const { tokenIn, tokenOut, amountIn } = params;

    return this.quoteCalculator.compareV2V3(tokenIn, tokenOut, amountIn);
  }
}

/**
 * 创建自定义聚合器适配器
 */
export function createCustomAggregatorAdapter(
  publicClient: PublicClient
): CustomAggregatorAdapter {
  return new CustomAggregatorAdapter(publicClient);
}
