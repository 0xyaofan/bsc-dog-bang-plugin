/**
 * 路由查询模块
 * 统一的路由查询接口
 */

// 类型定义
export type {
  TokenPlatform,
  TradingChannel,
  BaseRouteResult,
  PancakeMetadata,
  FourMetadata,
  FlapMetadata,
  LunaMetadata,
  RouteFetchResult,
  PancakePairCheckResult,
  PancakePairInfo,
  RouteCache,
  PlatformQueryConfig,
  LiquidityCheckConfig
} from './types.js';

// 常量
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
} from './constants.js';

// 错误类型
export {
  RouteQueryError,
  ServiceWorkerError,
  InvalidPlatformDataError,
  InsufficientLiquidityError,
  PancakePairNotFoundError,
  isServiceWorkerError,
  toServiceWorkerError
} from './errors.js';

// 工具类
export {
  LiquidityChecker,
  createLiquidityChecker
} from './liquidity-checker.js';

export {
  PancakePairFinder,
  createPancakePairFinder,
  pancakePairFinder
} from './pancake-pair-finder.js';

export {
  RouteCacheManager,
  createRouteCacheManager,
  routeCacheManager
} from './route-cache-manager.js';

export {
  PlatformDetector,
  createPlatformDetector,
  platformDetector,
  detectTokenPlatform
} from './platform-detector.js';

// 基类
export { BasePlatformQuery } from './base-platform-query.js';

// 具体平台查询类
export {
  FourPlatformQuery,
  createFourPlatformQuery
} from './four-platform-query.js';

export {
  FlapPlatformQuery,
  createFlapPlatformQuery
} from './flap-platform-query.js';

export {
  LunaPlatformQuery,
  createLunaPlatformQuery
} from './luna-platform-query.js';

export {
  DefaultPlatformQuery,
  createDefaultPlatformQuery
} from './default-platform-query.js';

// 查询执行器和服务
export {
  QueryExecutor,
  createQueryExecutor
} from './query-executor.js';

export {
  RouteQueryService,
  createRouteQueryService
} from './route-query-service.js';
