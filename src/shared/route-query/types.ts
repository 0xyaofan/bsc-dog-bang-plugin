/**
 * 路由查询类型定义
 */

import type { Address } from 'viem';

/**
 * 代币平台类型
 */
export type TokenPlatform = 'four' | 'xmode' | 'flap' | 'luna' | 'unknown';

/**
 * 交易渠道类型
 */
export type TradingChannel = 'pancake' | 'four' | 'xmode' | 'flap';

/**
 * 路由查询结果（基础）
 */
export interface BaseRouteResult {
  /** 代币所属平台 */
  platform: TokenPlatform;
  /** 推荐的交易渠道 */
  preferredChannel: TradingChannel;
  /** 是否已准备好在 Pancake 交易 */
  readyForPancake: boolean;
  /** 迁移进度 (0-1) */
  progress: number;
  /** 是否正在迁移中 */
  migrating: boolean;
}

/**
 * Pancake 元数据
 */
export interface PancakeMetadata {
  /** 报价代币地址 */
  quoteToken: string;
  /** Pair/Pool 地址 */
  pairAddress: string;
  /** 协议版本 */
  version: 'v2' | 'v3';
  /** 推荐的交易模式 */
  preferredMode?: 'v2' | 'v3';
}

/**
 * Four.meme 元数据
 */
export interface FourMetadata {
  /** 代币符号 */
  symbol?: string;
  /** 代币名称 */
  name?: string;
  /** 报价代币地址 */
  quoteToken?: string;
}

/**
 * Flap 元数据
 */
export interface FlapMetadata {
  /** 是否启用原生代币到报价代币的兑换 */
  nativeToQuoteSwapEnabled?: boolean;
  /** 使用的状态读取器版本 */
  stateReader?: string;
}

/**
 * Luna 元数据
 */
export interface LunaMetadata {
  /** 代币名称 */
  name?: string;
  /** 代币符号 */
  symbol?: string;
}

/**
 * 路由查询结果（完整）
 */
export interface RouteFetchResult extends BaseRouteResult {
  /** Pancake 相关元数据 */
  pancake?: PancakeMetadata;
  /** Four.meme 相关元数据 */
  four?: FourMetadata;
  /** Flap 相关元数据 */
  flap?: FlapMetadata;
  /** Luna 相关元数据 */
  luna?: LunaMetadata;
  /** 额外说明 */
  notes?: string;
  /** 报价代币地址（向后兼容） */
  quoteToken?: string;
  /** 通用元数据（向后兼容） */
  metadata?: Record<string, any>;
}

/**
 * Pancake Pair 检查结果
 */
export interface PancakePairCheckResult {
  /** 是否有流动性 */
  hasLiquidity: boolean;
  /** 报价代币地址 */
  quoteToken?: string;
  /** Pair/Pool 地址 */
  pairAddress?: string;
  /** 协议版本 */
  version?: 'v2' | 'v3';
  /** 流动性数量（用于比较） */
  liquidityAmount?: bigint;
}

/**
 * Pancake Pair 信息
 */
export interface PancakePairInfo {
  /** Pair/Pool 地址 */
  pairAddress: string;
  /** 报价代币地址 */
  quoteToken: string;
  /** 协议版本 */
  version: 'v2' | 'v3';
  /** 缓存时间戳 */
  timestamp: number;
}

/**
 * 路由缓存条目
 */
export interface RouteCache {
  /** 路由信息 */
  route: RouteFetchResult;
  /** 缓存时间戳 */
  timestamp: number;
  /** 迁移状态 */
  migrationStatus: 'not_migrated' | 'migrated';
}

/**
 * 平台查询配置
 */
export interface PlatformQueryConfig {
  /** 是否启用重试 */
  enableRetry?: boolean;
  /** 重试次数 */
  maxRetries?: number;
  /** 超时时间（毫秒） */
  timeout?: number;
}

/**
 * 流动性检查配置
 */
export interface LiquidityCheckConfig {
  /** 最小流动性阈值（自定义） */
  minThreshold?: bigint;
  /** 是否跳过流动性检查 */
  skipCheck?: boolean;
}
