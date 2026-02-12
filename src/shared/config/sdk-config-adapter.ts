/**
 * SDK 配置适配器
 * 将插件配置转换为 SDK 配置
 */

import { createTransportConfig, BSC_RPC_NODES } from '@bsc-trading/core';
import { loadUserSettings } from '../user-settings.js';

/**
 * 创建 Transport 配置
 * 根据用户设置创建 RPC 节点配置
 */
export async function createPluginTransportConfig() {
  const settings = await loadUserSettings();

  const builder = createTransportConfig();

  // 如果用户设置了 SDK 专用自定义 RPC，添加为最高优先级
  if (settings.sdk.useCustomRpc && settings.sdk.customRpcUrl) {
    builder.addNode({
      id: 'sdk-custom-primary',
      url: settings.sdk.customRpcUrl,
      priority: 0, // 最高优先级
      timeout: 10000,
    });
  } else if (settings.system.primaryRpc) {
    // 使用系统配置的主节点
    builder.addNode({
      id: 'user-primary',
      url: settings.system.primaryRpc,
      priority: 0,
      timeout: 10000,
    });
  }

  // 添加系统配置的备用节点
  settings.system.fallbackRpcs.forEach((url, index) => {
    builder.addNode({
      id: `user-fallback-${index}`,
      url,
      priority: index + 1,
      timeout: 10000,
    });
  });

  // 添加 SDK 默认节点
  builder.useBscNodes();

  // 启用动态选择（自动选择最快的节点）
  builder.enableDynamicSelection({
    interval: 30000,        // 30秒检查一次
    sampleCount: 10,        // 保留最近10个样本
    switchThreshold: 0.2,   // 20%改善才切换
    minStableTime: 300000,  // 5分钟最小稳定时间
    latencyFloor: 50,       // 50ms延迟下限
    weights: {
      latency: 0.5,         // 延迟权重50%
      stability: 0.3,       // 稳定性权重30%
      successRate: 0.2,     // 成功率权重20%
    },
  });

  return builder.build();
}

/**
 * 创建 TradingManager 配置
 * 根据用户设置创建交易配置
 */
export async function createPluginTradingConfig() {
  const settings = await loadUserSettings();

  return {
    // 默认滑点（转换为 bps: 15% -> 1500 bps）
    defaultSlippage: Math.floor(settings.sdk.defaultSlippage * 100),

    // 默认 deadline（秒）
    defaultDeadline: settings.sdk.preferredDeadline,

    // 是否自动选择最佳通道
    autoSelectBestChannel: settings.sdk.autoSelectChannel,
  };
}

/**
 * 导出 SDK 提供的合约地址
 * 插件不再维护合约地址，直接从 SDK 导入
 */

// 注意：由于插件不直接依赖服务包（由 TradingManager 动态加载），
// 这里暂时定义常量，未来可以从 SDK 导出

/**
 * Four.meme 合约地址
 */
export const FOUR_MEME_CONTRACTS = {
  TOKEN_MANAGER_V2: '0x5c952063c7fc8610FFDB798152D69F0B9550762b',
  TOKEN_MANAGER_HELPER: '0xF251F83e40a78868FcfA3FA4599Dad6494E46034',
} as const;

/**
 * Flap 合约地址
 */
export const FLAP_CONTRACTS = {
  PORTAL: '0xe2cE6ab80874Fa9Fa2aAE65D277Dd6B8e65C9De0',
} as const;

/**
 * Luna 合约地址
 */
export const LUNA_CONTRACTS = {
  LAUNCHPAD: '0x7fdC3c5c4eC798150462D040526B6A89190b459c',
} as const;

// PancakeSwap 合约地址（从 aggregator 获取）
// 注意：aggregator 包可能没有导出这些常量，需要检查
// 如果没有，可以在这里定义或从 trading-config.ts 临时保留

/**
 * PancakeSwap 合约地址
 */
export const PANCAKE_CONTRACTS = {
  ROUTER: '0x10ED43C718714eb63d5aA57B78B54704E256024E',
  FACTORY: '0xcA143Ce32Fe78f1f7019d7d551a6402fC5350c73',
  SMART_ROUTER: '0x13f4EA83D0bd40E75C8222255bc855a974568Dd4',
  V3_FACTORY: '0x0BFbCF9fa4f9C56B0F40a671Ad40E0805A091865',
  V3_QUOTER: '0xB048Bbc1Ee6b733FFfCFb9e9CeF7375518e25997',
} as const;

/**
 * 常用代币地址
 */
export const WBNB_ADDRESS = '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c' as const;

export const TOKEN_ADDRESSES = {
  WBNB: WBNB_ADDRESS,
  CAKE: '0x0E09FaBB73Bd3Ade0a17ECC321fD13a19e81cE82',
  ASTER: '0x000Ae314E2A2172a039B26378814C252734f556A',
  USDT: '0x55d398326f99059fF775485246999027B3197955',
  USDC: '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d',
  BUSD: '0xe9e7CEA3DedcA5984780Bafc599bD69ADd087D56',
  USD1: '0x8d0D000Ee44948FC98c9B98A4FA4921476f08B0d',
  UNITED_STABLES_U: '0xcE24439F2D9C6a2289F741120FE202248B666666',
  USAT: '0xdb7a6d5a127ea5c0a3576677112f13d731232a27',
  KGST: '0x94be0bbA8E1E303fE998c9360B57b826F1A4f828',
  lisUSD: '0x0782b6d8c4551b9760e74c0545a9bcd90bdc41e5',
} as const;

/**
 * 统一的合约地址对象（向后兼容）
 * 整合了 PancakeSwap、Four.meme、Flap、Luna 的合约地址
 */
export const CONTRACTS = {
  // PancakeSwap - 使用旧的命名约定
  PANCAKE_ROUTER: PANCAKE_CONTRACTS.ROUTER,
  PANCAKE_FACTORY: PANCAKE_CONTRACTS.FACTORY,
  PANCAKE_SMART_ROUTER: PANCAKE_CONTRACTS.SMART_ROUTER,
  PANCAKE_V3_FACTORY: PANCAKE_CONTRACTS.V3_FACTORY,
  PANCAKE_V3_QUOTER: PANCAKE_CONTRACTS.V3_QUOTER,

  // 代币地址
  WBNB: WBNB_ADDRESS,
  CAKE: TOKEN_ADDRESSES.CAKE,
  ASTER: TOKEN_ADDRESSES.ASTER,
  USDT: TOKEN_ADDRESSES.USDT,
  USDC: TOKEN_ADDRESSES.USDC,
  BUSD: TOKEN_ADDRESSES.BUSD,
  USD1: TOKEN_ADDRESSES.USD1,
  UNITED_STABLES_U: TOKEN_ADDRESSES.UNITED_STABLES_U,
  USAT: TOKEN_ADDRESSES.USAT,
  KGST: TOKEN_ADDRESSES.KGST,
  lisUSD: TOKEN_ADDRESSES.lisUSD,

  // Four.meme 合约（XMode使用相同合约）
  FOUR_TOKEN_MANAGER_V2: FOUR_MEME_CONTRACTS.TOKEN_MANAGER_V2,
  FOUR_HELPER_V3: FOUR_MEME_CONTRACTS.TOKEN_MANAGER_HELPER,

  // Flap Portal 合约
  FLAP_PORTAL: FLAP_CONTRACTS.PORTAL,

  // Luna.fun Launchpad
  LUNA_FUN_LAUNCHPAD: LUNA_CONTRACTS.LAUNCHPAD,
} as const;

/**
 * 临时：从旧配置重新导出其他配置
 * TODO: 这些应该逐步迁移到新的配置结构
 */
export {
  RPC_CONFIG,
  TX_CONFIG,
  CHANNELS,
  createQuoteTokenPoolConfig,
  createChannelDefinitions,
  type QuoteTokenPoolConfigEntry,
} from './plugin-config.js';

/**
 * ABI 定义（从新的 abis.ts 导出）
 */
export {
  ERC20_ABI,
  ROUTER_ABI,
  PANCAKE_FACTORY_ABI,
  PANCAKE_V3_FACTORY_ABI,
  PANCAKE_V3_SMART_ROUTER_ABI,
  PANCAKE_V3_QUOTER_ABI,
  FOUR_TOKEN_MANAGER_ABI,
  FLAP_PORTAL_ABI,
  LUNA_FUN_ABI,
  MEME_SWAP_AGGREGATOR_ABI,
} from './abis.js';

/**
 * 创建 QUOTE_TOKEN_POOL_CONFIG（向后兼容）
 */
import { createQuoteTokenPoolConfig as _createQuoteTokenPoolConfig } from './plugin-config.js';
export const QUOTE_TOKEN_POOL_CONFIG = _createQuoteTokenPoolConfig(TOKEN_ADDRESSES);

/**
 * 创建 CHANNEL_DEFINITIONS（向后兼容）
 */
import { createChannelDefinitions as _createChannelDefinitions } from './plugin-config.js';
import { TX_CONFIG } from './plugin-config.js';
import {
  ERC20_ABI,
  ROUTER_ABI,
  PANCAKE_FACTORY_ABI,
  PANCAKE_V3_SMART_ROUTER_ABI,
  PANCAKE_V3_FACTORY_ABI,
  PANCAKE_V3_QUOTER_ABI,
  FOUR_TOKEN_MANAGER_ABI,
  FLAP_PORTAL_ABI,
  LUNA_FUN_ABI,
  MEME_SWAP_AGGREGATOR_ABI,
} from './abis.js';

export const CHANNEL_DEFINITIONS = _createChannelDefinitions({
  CONTRACTS,
  ROUTER_ABI,
  PANCAKE_FACTORY_ABI,
  PANCAKE_V3_SMART_ROUTER_ABI,
  PANCAKE_V3_FACTORY_ABI,
  PANCAKE_V3_QUOTER_ABI,
  FOUR_TOKEN_MANAGER_ABI,
  FLAP_PORTAL_ABI,
  TX_CONFIG,
});
