/**
 * 代币路由查询模块
 *
 * 本文件提供向后兼容的接口，内部使用重构后的 route-query 模块
 *
 * @deprecated 建议直接使用 route-query 模块中的新接口
 */

import type { Address } from 'viem';

// 导出新模块的类型和函数
export type {
  TokenPlatform,
  TradingChannel,
  RouteFetchResult,
  PancakePairCheckResult,
  BaseRouteResult,
  PancakeMetadata,
  FourMetadata,
  FlapMetadata,
  LunaMetadata
} from './route-query/types.js';

// 导出新模块的工具类
export {
  PlatformDetector,
  createPlatformDetector,
  platformDetector,
  detectTokenPlatform
} from './route-query/platform-detector.js';

export {
  RouteQueryService,
  createRouteQueryService
} from './route-query/route-query-service.js';

export {
  RouteCacheManager,
  createRouteCacheManager,
  routeCacheManager
} from './route-query/route-cache-manager.js';

export {
  LiquidityChecker,
  createLiquidityChecker
} from './route-query/liquidity-checker.js';

export {
  PancakePairFinder,
  createPancakePairFinder,
  pancakePairFinder
} from './route-query/pancake-pair-finder.js';

// 导出错误类型
export {
  RouteQueryError,
  ServiceWorkerError,
  InvalidPlatformDataError,
  InsufficientLiquidityError,
  PancakePairNotFoundError,
  isServiceWorkerError,
  toServiceWorkerError
} from './route-query/errors.js';

// 导出常量
export {
  ZERO_ADDRESS,
  PLATFORM_FALLBACK_ORDER,
  MIN_LIQUIDITY_THRESHOLDS,
  MIN_V3_LIQUIDITY,
  PANCAKE_V3_FEE_TIERS,
  FLAP_STATE_READERS,
  SPECIAL_PAIR_MAPPINGS,
  ROUTE_CACHE_CONFIG,
  PANCAKE_PAIR_CACHE_CONFIG
} from './route-query/constants.js';

import { routeCacheManager } from './route-query/route-cache-manager.js';
import { createRouteQueryService } from './route-query/route-query-service.js';
import type { RouteFetchResult, TokenPlatform } from './route-query/types.js';

// 全局服务实例（延迟初始化）
let globalServiceInstance: ReturnType<typeof createRouteQueryService> | null = null;

/**
 * 获取或创建全局服务实例
 */
function getGlobalService(publicClient: any) {
  if (!globalServiceInstance) {
    globalServiceInstance = createRouteQueryService(publicClient);
  }
  return globalServiceInstance;
}

/**
 * 清除路由缓存
 *
 * @deprecated 使用 routeCacheManager.clearAll() 或 routeCacheManager.deleteRoute(tokenAddress)
 * @param tokenAddress 可选的代币地址，如果提供则只清除该代币的缓存，否则清除所有缓存
 */
export function clearRouteCache(tokenAddress?: string): void {
  if (tokenAddress) {
    routeCacheManager.deleteRoute(tokenAddress);
  } else {
    routeCacheManager.clearAll();
  }
}

/**
 * 查询代币路由状态
 *
 * @deprecated 使用 RouteQueryService.queryRoute() 代替
 * @param publicClient Viem public client
 * @param tokenAddress 代币地址
 * @param platform 代币平台（可选，会自动检测）
 * @returns 路由查询结果
 */
export async function fetchTokenRouteState(
  publicClient: any,
  tokenAddress: Address,
  platform: TokenPlatform
): Promise<RouteFetchResult> {
  const service = getGlobalService(publicClient);
  return service.queryRoute(tokenAddress, platform);
}

/**
 * 带 fallback 的路由查询
 *
 * @deprecated 使用 RouteQueryService.queryRoute() 代替（已内置 fallback）
 * @param publicClient Viem public client
 * @param tokenAddress 代币地址
 * @param initialPlatform 初始平台（可选，会自动检测）
 * @returns 路由查询结果
 */
export async function fetchRouteWithFallback(
  publicClient: any,
  tokenAddress: Address,
  initialPlatform?: TokenPlatform
): Promise<RouteFetchResult> {
  const service = getGlobalService(publicClient);
  return service.queryRoute(tokenAddress, initialPlatform);
}

/**
 * 批量查询代币路由
 *
 * @param publicClient Viem public client
 * @param tokenAddresses 代币地址列表
 * @returns 代币地址到路由结果的映射
 */
export async function batchFetchRoutes(
  publicClient: any,
  tokenAddresses: Address[]
): Promise<Map<string, RouteFetchResult>> {
  const service = getGlobalService(publicClient);
  return service.queryRoutes(tokenAddresses);
}

/**
 * 预热路由缓存
 *
 * @param publicClient Viem public client
 * @param tokenAddresses 代币地址列表
 */
export async function warmupRouteCache(
  publicClient: any,
  tokenAddresses: Address[]
): Promise<void> {
  const service = getGlobalService(publicClient);
  return service.warmupCache(tokenAddresses);
}

/**
 * 获取缓存统计信息
 *
 * @returns 缓存统计信息
 */
export function getRouteCacheStats() {
  return routeCacheManager.getStats();
}

// 重新导出所有新模块的内容，方便使用
export * from './route-query/index.js';
