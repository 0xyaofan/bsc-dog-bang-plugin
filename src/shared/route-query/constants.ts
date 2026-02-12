/**
 * 路由查询常量定义
 */

import { CONTRACTS } from '../config/sdk-config-adapter.js';
import type { TokenPlatform } from './types.js';

/**
 * 零地址
 */
export const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

/**
 * 平台 fallback 顺序
 */
export const PLATFORM_FALLBACK_ORDER: TokenPlatform[] = ['four', 'xmode', 'flap', 'luna', 'unknown'];

/**
 * 最小流动性阈值
 * 对于稳定币（USDT/BUSD/USDC/USD1）：至少 $100
 * 对于 WBNB：至少 0.2 BNB（约 $100）
 * 对于其他代币：至少 100 个代币
 */
export const MIN_LIQUIDITY_THRESHOLDS: Record<string, bigint> = {
  // 稳定币（18 decimals）
  [CONTRACTS.USDT?.toLowerCase() ?? '']: BigInt(100 * 1e18),
  [CONTRACTS.BUSD?.toLowerCase() ?? '']: BigInt(100 * 1e18),
  [CONTRACTS.USDC?.toLowerCase() ?? '']: BigInt(100 * 1e18),
  [CONTRACTS.USD1?.toLowerCase() ?? '']: BigInt(100 * 1e18),
  // WBNB（18 decimals）
  [CONTRACTS.WBNB?.toLowerCase() ?? '']: BigInt(0.2 * 1e18),
  // 默认阈值
  default: BigInt(100 * 1e18)
};

/**
 * V3 池子最小流动性阈值
 * V3 的 liquidity 是 sqrt(amount0 * amount1)，所以阈值需要相应调整
 */
export const MIN_V3_LIQUIDITY = BigInt(1e10);

/**
 * Pair ABI - 用于查询储备量
 */
export const PAIR_ABI = [
  {
    inputs: [],
    name: 'getReserves',
    outputs: [
      { internalType: 'uint112', name: 'reserve0', type: 'uint112' },
      { internalType: 'uint112', name: 'reserve1', type: 'uint112' },
      { internalType: 'uint32', name: 'blockTimestampLast', type: 'uint32' }
    ],
    stateMutability: 'view',
    type: 'function'
  },
  {
    inputs: [],
    name: 'token0',
    outputs: [{ internalType: 'address', name: '', type: 'address' }],
    stateMutability: 'view',
    type: 'function'
  },
  {
    inputs: [],
    name: 'token1',
    outputs: [{ internalType: 'address', name: '', type: 'address' }],
    stateMutability: 'view',
    type: 'function'
  }
] as const;

/**
 * V3 Pool ABI - 用于查询流动性
 */
export const V3_POOL_ABI = [
  {
    inputs: [],
    name: 'liquidity',
    outputs: [{ internalType: 'uint128', name: '', type: 'uint128' }],
    stateMutability: 'view',
    type: 'function'
  },
  {
    inputs: [],
    name: 'token0',
    outputs: [{ internalType: 'address', name: '', type: 'address' }],
    stateMutability: 'view',
    type: 'function'
  },
  {
    inputs: [],
    name: 'token1',
    outputs: [{ internalType: 'address', name: '', type: 'address' }],
    stateMutability: 'view',
    type: 'function'
  }
] as const;

/**
 * PancakeSwap V3 费率级别
 */
export const PANCAKE_V3_FEE_TIERS = [500, 2500, 10000] as const;

/**
 * Flap 状态读取器列表（按版本从新到旧）
 */
export const FLAP_STATE_READERS = [
  { functionName: 'getTokenV7' },
  { functionName: 'getTokenV6' },
  { functionName: 'getTokenV5' },
  { functionName: 'getTokenV4' },
  { functionName: 'getTokenV3' },
  { functionName: 'getTokenV2' }
] as const;

/**
 * 特殊代币的配对映射
 * 用于绕过 Service Worker 限制
 */
export const SPECIAL_PAIR_MAPPINGS: Record<string, { pairAddress: string; quoteToken: string; version: 'v2' | 'v3' }> = {
  // KDOG/KGST 配对
  '0x3753dd32cbc376ce6efd85f334b7289ae6d004af': {
    pairAddress: '0x14C90904dD8868c8E748e42D092250Ec17f748d1',
    quoteToken: '0x94be0bbA8E1E303fE998c9360B57b826F1A4f828', // KGST
    version: 'v2'
  }
};

/**
 * 路由缓存配置
 */
export const ROUTE_CACHE_CONFIG = {
  /** 最大缓存条目数 */
  MAX_SIZE: 50,
  /** 已迁移代币的 TTL（永久） */
  MIGRATED_TTL: Infinity,
  /** 未迁移代币的 TTL（1 分钟） */
  NOT_MIGRATED_TTL: 60000
} as const;

/**
 * Pancake Pair 缓存配置
 */
export const PANCAKE_PAIR_CACHE_CONFIG = {
  /** 最大缓存条目数 */
  MAX_SIZE: 100,
  /** TTL（永久，因为 pair 一旦创建就不会改变） */
  TTL: Infinity
} as const;
