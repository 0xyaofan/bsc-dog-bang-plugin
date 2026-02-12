/**
 * 配置模块统一导出
 */

// 插件特有配置
export {
  DEBUG_CONFIG,
  NETWORK_CONFIG,
  WALLET_CONFIG,
  UI_CONFIG,
  TX_WATCHER_CONFIG,
  BACKGROUND_TASK_CONFIG,
  CUSTOM_AGGREGATOR_CONFIG,
  AGGREGATOR_RUNTIME_CONFIG,
  RPC_CONFIG,
  TX_CONFIG,
  CHANNELS,
  createQuoteTokenPoolConfig,
  createChannelDefinitions,
  type QuoteTokenPoolConfigEntry,
} from './plugin-config.js';

// UI 配置
export {
  CHANNEL_UI_CONFIG,
  type ChannelId,
  getChannelDisplayName,
  getChannelShortName,
  getChannelIcon,
  getChannelColor,
} from './ui-config.js';

// ABI 定义
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

// SDK 配置适配器
export {
  createPluginTransportConfig,
  createPluginTradingConfig,
  FOUR_MEME_CONTRACTS,
  FLAP_CONTRACTS,
  LUNA_CONTRACTS,
  WBNB_ADDRESS,
  PANCAKE_CONTRACTS,
  TOKEN_ADDRESSES,
  CONTRACTS,
  // 临时重新导出（向后兼容）
  QUOTE_TOKEN_POOL_CONFIG,
  CHANNEL_DEFINITIONS,
} from './sdk-config-adapter.js';
