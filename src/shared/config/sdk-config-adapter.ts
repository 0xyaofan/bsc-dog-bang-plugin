/**
 * SDK 配置适配器
 * 将插件配置转换为 SDK 配置
 */

import { createTransportConfig, BSC_RPC_NODES } from '@bsc-trading/core';
import { loadUserSettings } from '../user-settings.js';
import {
  FOUR_MEME_CONTRACTS,
  FLAP_CONTRACTS,
  LUNA_CONTRACTS,
  PANCAKE_CONTRACTS,
  WBNB_ADDRESS,
  TOKEN_ADDRESSES,
  CONTRACTS,
} from './contracts.js';

// 重新导出合约地址
export {
  FOUR_MEME_CONTRACTS,
  FLAP_CONTRACTS,
  LUNA_CONTRACTS,
  PANCAKE_CONTRACTS,
  WBNB_ADDRESS,
  TOKEN_ADDRESSES,
  CONTRACTS,
};

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
