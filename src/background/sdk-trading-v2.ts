/**
 * SDK 交易模块（使用新的 TradingManager）
 *
 * 使用 @bsc-trading/manager 统一接口实现的交易函数
 */

import type { Address } from 'viem';
import { parseEther, formatUnits } from 'viem';
import { sdkManagerAdapter } from '../shared/sdk-manager-adapter.js';
import { logger } from '../shared/logger.js';
import { getPerformanceTimer, releasePerformanceTimer } from '../shared/performance.js';

/**
 * 判断是否可以使用 SDK
 */
export function canUseSDK(channel: string, routeInfo: any): boolean {
  // 支持所有主流平台
  const supportedChannels = ['four', 'xmode', 'flap', 'luna', 'pancake', 'pancake-v3'];

  // 不支持 Custom Aggregator（暂时）
  if (routeInfo?.useCustomAggregator) {
    return false;
  }

  // 不支持 Quote Bridge（暂时）
  if (routeInfo?.useQuoteBridge) {
    return false;
  }

  return supportedChannels.includes(channel);
}

/**
 * 使用 SDK 买入代币
 */
export async function buyTokenWithSDK(params: {
  tokenAddress: string;
  amount: number;
  slippage: number;
  channel?: string;
}): Promise<{ success: boolean; txHash?: string; error?: string; gasUsed?: string }> {
  const timer = getPerformanceTimer('sdk-buy');

  try {
    // 1. 检查 SDK 是否已初始化
    if (!sdkManagerAdapter.isInitialized()) {
      await sdkManagerAdapter.initialize();
      timer.step('SDK 初始化');
    }

    // 2. 查询路由信息（如果没有指定 channel）
    let channel = params.channel;
    if (!channel) {
      const route = await sdkManagerAdapter.queryRoute(params.tokenAddress as Address);
      channel = route.preferredChannel;
      timer.step('路由查询');

      logger.debug('[SDK Buy] 自动选择通道', {
        tokenAddress: params.tokenAddress,
        platform: route.platform,
        channel,
        readyForPancake: route.readyForPancake,
      });
    }

    // 3. 解析参数
    const slippageBps = Math.floor(params.slippage * 100);
    timer.step('参数解析');

    logger.debug('[SDK Buy] 开始交易', {
      tokenAddress: params.tokenAddress,
      amount: params.amount,
      slippage: params.slippage,
      channel,
    });

    // 4. 执行买入
    const result = await sdkManagerAdapter.buyToken({
      tokenAddress: params.tokenAddress as Address,
      amountBnb: params.amount,
      slippageBps,
      channel,
    });
    timer.step('执行交易');

    // 5. 返回结果
    if (result.status === 'success') {
      logger.debug('[SDK Buy] 交易成功', {
        txHash: result.hash,
        channel: result.channel,
      });

      return {
        success: true,
        txHash: result.hash,
        gasUsed: result.gasPrice?.toString(),
      };
    } else {
      throw new Error(result.error || '交易失败');
    }
  } catch (error) {
    logger.error('[SDK Buy] 交易失败', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    releasePerformanceTimer('sdk-buy', timer);
  }
}

/**
 * 使用 SDK 卖出代币
 */
export async function sellTokenWithSDK(params: {
  tokenAddress: string;
  amount?: bigint;
  percent?: number;
  slippage: number;
  channel?: string;
  tokenInfo?: any;
}): Promise<{ success: boolean; txHash?: string; error?: string; gasUsed?: string }> {
  const timer = getPerformanceTimer('sdk-sell');

  try {
    // 1. 检查 SDK 是否已初始化
    if (!sdkManagerAdapter.isInitialized()) {
      await sdkManagerAdapter.initialize();
      timer.step('SDK 初始化');
    }

    // 2. 计算卖出数量
    let amountToSell: bigint;
    if (params.amount) {
      amountToSell = params.amount;
    } else if (params.percent !== undefined && params.tokenInfo?.balance) {
      // 根据百分比计算
      const balance = BigInt(params.tokenInfo.balance);
      amountToSell = (balance * BigInt(Math.floor(params.percent * 100))) / 10000n;
    } else {
      throw new Error('必须提供 amount 或 percent + tokenInfo');
    }

    // 3. 查询路由信息（如果没有指定 channel）
    let channel = params.channel;
    if (!channel) {
      const route = await sdkManagerAdapter.queryRoute(params.tokenAddress as Address);
      channel = route.preferredChannel;
      timer.step('路由查询');

      logger.debug('[SDK Sell] 自动选择通道', {
        tokenAddress: params.tokenAddress,
        platform: route.platform,
        channel,
        readyForPancake: route.readyForPancake,
      });
    }

    // 4. 解析参数
    const slippageBps = Math.floor(params.slippage * 100);
    const decimals = params.tokenInfo?.decimals || 18;
    const amountToken = formatUnits(amountToSell, decimals);
    timer.step('参数解析');

    logger.debug('[SDK Sell] 开始交易', {
      tokenAddress: params.tokenAddress,
      amount: amountToSell.toString(),
      amountToken,
      percent: params.percent,
      slippage: params.slippage,
      channel,
    });

    // 5. 执行卖出
    const result = await sdkManagerAdapter.sellToken({
      tokenAddress: params.tokenAddress as Address,
      amountToken,
      slippageBps,
      channel,
    });
    timer.step('执行交易');

    // 6. 返回结果
    if (result.status === 'success') {
      logger.debug('[SDK Sell] 交易成功', {
        txHash: result.hash,
        channel: result.channel,
      });

      return {
        success: true,
        txHash: result.hash,
        gasUsed: result.gasPrice?.toString(),
      };
    } else {
      throw new Error(result.error || '交易失败');
    }
  } catch (error) {
    logger.error('[SDK Sell] 交易失败', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    releasePerformanceTimer('sdk-sell', timer);
  }
}

/**
 * 使用 SDK 获取报价
 */
export async function getQuoteWithSDK(params: {
  tokenAddress: Address;
  amountIn: bigint;
  direction: 'buy' | 'sell';
  channel?: string;
}): Promise<{ success: boolean; quote?: any; error?: string }> {
  try {
    // 检查 SDK 是否已初始化
    if (!sdkManagerAdapter.isInitialized()) {
      await sdkManagerAdapter.initialize();
    }

    const result = await sdkManagerAdapter.getQuote({
      tokenAddress: params.tokenAddress,
      amountIn: params.amountIn,
      direction: params.direction,
      channel: params.channel,
    });

    if (result.status === 'success') {
      return {
        success: true,
        quote: result.quote,
      };
    } else {
      throw new Error(result.error || '获取报价失败');
    }
  } catch (error) {
    logger.error('[SDK Quote] 获取报价失败', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * 查询代币路由信息
 */
export async function queryTokenRoute(tokenAddress: string): Promise<{
  success: boolean;
  route?: any;
  error?: string;
}> {
  try {
    // 检查 SDK 是否已初始化
    if (!sdkManagerAdapter.isInitialized()) {
      await sdkManagerAdapter.initialize();
    }

    const route = await sdkManagerAdapter.queryRoute(tokenAddress as Address);

    logger.debug('[SDK Route] 路由查询成功', {
      tokenAddress,
      platform: route.platform,
      preferredChannel: route.preferredChannel,
      readyForPancake: route.readyForPancake,
    });

    return {
      success: true,
      route,
    };
  } catch (error) {
    logger.error('[SDK Route] 路由查询失败', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * 批量查询代币路由信息
 */
export async function queryTokenRouteBatch(tokenAddresses: string[]): Promise<{
  success: boolean;
  routes?: Map<Address, any>;
  error?: string;
}> {
  try {
    // 检查 SDK 是否已初始化
    if (!sdkManagerAdapter.isInitialized()) {
      await sdkManagerAdapter.initialize();
    }

    const routes = await sdkManagerAdapter.queryRouteBatch(
      tokenAddresses as Address[]
    );

    logger.debug('[SDK Route] 批量路由查询成功', {
      count: routes.size,
    });

    return {
      success: true,
      routes,
    };
  } catch (error) {
    logger.error('[SDK Route] 批量路由查询失败', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * 清除路由缓存
 */
export function clearRouteCache(tokenAddress?: string): void {
  if (sdkManagerAdapter.isInitialized()) {
    sdkManagerAdapter.clearRouteCache(tokenAddress as Address | undefined);
  }
}

/**
 * 获取路由缓存统计
 */
export function getRouteCacheStats() {
  if (!sdkManagerAdapter.isInitialized()) {
    return { size: 0, maxSize: 0, entries: [] };
  }

  return sdkManagerAdapter.getRouteCacheStats();
}
