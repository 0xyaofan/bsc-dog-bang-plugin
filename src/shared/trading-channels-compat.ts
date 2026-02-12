/**
 * Trading Channels 兼容层
 *
 * 提供与旧 trading-channels.ts 兼容的接口
 * 内部使用 SDK 适配器实现
 *
 * @deprecated 此文件用于向后兼容，新代码请直接使用 SDK
 */

import { logger } from './logger.js';
// import { sdkAdapter } from './sdk-adapter.js'; // Deprecated - using new SDK Manager
import type { Address } from 'viem';

/**
 * 通道 ID 类型
 */
export type ChannelId = 'four' | 'xmode' | 'flap' | 'luna' | 'pancake';

/**
 * 旧的通道处理器接口（兼容性）
 * 注意：为了完全兼容旧接口，quoteBuy/quoteSell 返回 bigint，buy/sell 返回 string
 */
export interface LegacyChannelHandler {
  quoteBuy?: (params: {
    publicClient: any;
    tokenAddress: string;
    amount: bigint;
    slippage?: number;
  }) => Promise<bigint | null>;

  quoteSell?: (params: {
    publicClient: any;
    tokenAddress: string;
    amount: bigint;
    slippage?: number;
  }) => Promise<bigint | null>;

  buy?: (params: {
    publicClient: any;
    walletClient: any;
    account: any;
    chain?: any;
    tokenAddress: string;
    amount: bigint;
    slippage?: number;
    gasPrice?: number | bigint;
    nonce?: number;
    nonceExecutor?: any;
    quoteToken?: string;
    routeInfo?: any;
  }) => Promise<string>;

  sell?: (params: {
    publicClient: any;
    walletClient: any;
    account: any;
    chain?: any;
    tokenAddress: string;
    amount?: bigint;
    percent?: number;
    slippage?: number;
    gasPrice?: number | bigint;
    nonce?: number;
    nonceExecutor?: any;
    tokenInfo?: any;
    routeInfo?: any;
  }) => Promise<string>;
}

const WBNB = '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c' as Address;

/**
 * 从 SDK 获取通道处理器（兼容层）
 *
 * @deprecated 使用 SDK 直接调用
 */
export function getChannel(channelId: ChannelId | string): LegacyChannelHandler {
  logger.debug('[Trading Channels Compat] Getting channel:', channelId);

  // NOTE: This compatibility layer is deprecated.
  // The old sdkAdapter has been replaced with sdkManagerAdapter.
  // For new code, use sdk-trading-v2.ts functions directly.

  return {
    quoteBuy: async () => {
      logger.error('[Trading Channels Compat] quoteBuy is deprecated, use SDK Manager');
      return null;
    },
    quoteSell: async () => {
      logger.error('[Trading Channels Compat] quoteSell is deprecated, use SDK Manager');
      return null;
    },
    buy: async () => {
      throw new Error('[Trading Channels Compat] buy is deprecated, use SDK Manager');
    },
    sell: async () => {
      throw new Error('[Trading Channels Compat] sell is deprecated, use SDK Manager');
    },
  };
}

// ============ 其他兼容函数 ============

/**
 * Pancake 偏好模式缓存
 */
const pancakePreferredModeCache = new Map<string, 'v2' | 'v3' | null>();

/**
 * 设置 Pancake 偏好模式
 * @deprecated 仅用于兼容
 */
export function setPancakePreferredMode(tokenAddress: string, mode: 'v2' | 'v3' | null): void {
  const normalized = tokenAddress.toLowerCase();
  if (mode === null) {
    pancakePreferredModeCache.delete(normalized);
  } else {
    pancakePreferredModeCache.set(normalized, mode);
  }
}


/**
 * 代币交易提示缓存
 */
const tokenTradeHintCache = new Map<string, any>();

/**
 * 设置代币交易提示
 * @deprecated 仅用于兼容
 */
export function setTokenTradeHint(tokenAddress: string, hint: any): void {
  tokenTradeHintCache.set(tokenAddress.toLowerCase(), hint);
}

/**
 * 获取代币交易提示
 * @deprecated 仅用于兼容
 */
export function getTokenTradeHint(tokenAddress: string): any {
  return tokenTradeHintCache.get(tokenAddress.toLowerCase());
}

/**
 * 授权缓存
 */
const allowanceCache = new Map<string, bigint>();

/**
 * 创建授权缓存键
 */
function createAllowanceCacheKey(token: string, owner: string, spender: string): string {
  return `${token.toLowerCase()}-${owner.toLowerCase()}-${spender.toLowerCase()}`;
}

/**
 * 获取缓存的授权
 * @deprecated 仅用于兼容
 */
export function getCachedAllowance(token: string, spender: string): bigint | undefined {
  // 需要 owner 地址，但旧接口没有提供，返回 undefined
  return undefined;
}

/**
 * 清除授权缓存
 * @deprecated 仅用于兼容
 */
export function clearAllowanceCache(token?: string, spender?: string): void {
  if (token && spender) {
    // 清除特定缓存（需要遍历所有 owner）
    const prefix = `${token.toLowerCase()}-`;
    const suffix = `-${spender.toLowerCase()}`;
    for (const key of allowanceCache.keys()) {
      if (key.startsWith(prefix) && key.endsWith(suffix)) {
        allowanceCache.delete(key);
      }
    }
  } else if (token) {
    // 清除特定代币的所有缓存
    const prefix = `${token.toLowerCase()}-`;
    for (const key of allowanceCache.keys()) {
      if (key.startsWith(prefix)) {
        allowanceCache.delete(key);
      }
    }
  } else {
    // 清除所有缓存
    allowanceCache.clear();
  }
}

// ============ 路由缓存检查函数 ============

const ROUTE_CACHE_TTL_MS = 60 * 60 * 1000; // 1 小时

/**
 * 规范化代币地址
 */
function normalizeTokenKey(tokenAddress: string): string | null {
  try {
    return tokenAddress.toLowerCase();
  } catch {
    return null;
  }
}

/**
 * 检查路由缓存是否有效
 */
function isRouteCacheValid(hint: any, direction: 'buy' | 'sell'): boolean {
  if (!hint) return false;
  const loadedAt = direction === 'buy' ? hint.buyRouteLoadedAt : hint.sellRouteLoadedAt;
  if (!loadedAt) return false;
  return Date.now() - loadedAt < ROUTE_CACHE_TTL_MS;
}

/**
 * 检查路由缓存状态
 *
 * @deprecated 仅用于兼容，建议使用 route-query 模块
 */
export function checkRouteCache(
  tokenAddress: string,
  direction: 'buy' | 'sell' = 'buy'
): { needsQuery: boolean; cacheAge?: number; status?: string } {
  const key = normalizeTokenKey(tokenAddress);
  if (!key) {
    return { needsQuery: true };
  }

  const hint = getTokenTradeHint(tokenAddress);

  // 检查缓存是否有效（1 小时内）
  if (isRouteCacheValid(hint, direction)) {
    const cacheAge = Math.floor((Date.now() - (direction === 'buy' ? hint!.buyRouteLoadedAt! : hint!.sellRouteLoadedAt!)) / 1000);
    const status = direction === 'buy' ? hint?.buyRouteStatus : hint?.sellRouteStatus;
    return { needsQuery: false, cacheAge, status };
  }

  return { needsQuery: true };
}

/**
 * 检查缓存是否即将过期（还有5分钟）
 *
 * @deprecated 仅用于兼容，建议使用 route-query 模块
 */
export function isRouteCacheExpiringSoon(
  tokenAddress: string,
  direction: 'buy' | 'sell'
): boolean {
  const hint = getTokenTradeHint(tokenAddress);
  if (!hint) return false;

  const loadedAt = direction === 'buy' ? hint.buyRouteLoadedAt : hint.sellRouteLoadedAt;
  if (!loadedAt) return false;

  const age = Date.now() - loadedAt;
  const expiringThreshold = ROUTE_CACHE_TTL_MS - (5 * 60 * 1000); // 还有5分钟过期

  // 缓存年龄在 55分钟 到 60分钟 之间
  return age > expiringThreshold && age < ROUTE_CACHE_TTL_MS;
}
