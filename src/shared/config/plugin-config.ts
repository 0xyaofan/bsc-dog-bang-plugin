/**
 * 插件特有配置
 * 不涉及交易逻辑，只涉及插件功能
 */

// ========== 调试和日志配置 ==========
export const DEBUG_CONFIG = {
  // 是否启用调试日志（开发时设为 true，生产环境设为 false）
  ENABLED: false,

  // 是否启用性能日志（记录每个步骤的耗时）
  PERF_ENABLED: false,

  // 日志级别
  LEVELS: {
    ERROR: 0,   // 总是显示
    WARN: 1,    // 总是显示
    INFO: 2,    // debug 模式才显示
    DEBUG: 3    // debug 模式才显示
  }
};

// ========== 网络配置 ==========
export const NETWORK_CONFIG = {
  // BSC RPC 节点
  BSC_RPC: 'https://api.zan.top/node/v1/bsc/mainnet/9ca4f22e10234d7ab736c8a8dc2911a6/',
  BSC_CHAIN_ID: 56,

  // RPC 备用节点列表
  BSC_RPC_FALLBACK: [
    'https://bsc-mainnet.nodereal.io/v1/cafa270f244d4dd0b3edd33c1665767f/',
    'https://bsc-dataseed.bnbchain.org/',
  ]
};

// ========== RPC 请求配置 ==========
export const RPC_CONFIG = {
  // viem http transport 超时时间，避免节点响应过慢导致请求错误
  REQUEST_TIMEOUT_MS: 10000 // 10秒
};

// ========== 钱包配置 ==========
export const WALLET_CONFIG = {
  // Service Worker Keep-Alive 配置
  // 解锁后保持活跃的时间（毫秒），避免频繁需要重新解锁
  KEEP_ALIVE_DURATION: 30 * 60 * 1000, // 30 分钟

  // Keep-Alive 心跳间隔（毫秒）
  // Chrome Service Worker 空闲约 30 秒后会被终止，所以设置 25 秒
  KEEP_ALIVE_INTERVAL: 25000, // 25 秒

  // 是否在解锁后自动启用 Keep-Alive
  AUTO_KEEP_ALIVE_ON_UNLOCK: true,
};

// ========== UI 配置 ==========
export const UI_CONFIG = {
  // 自动更新余额间隔（毫秒）
  // 优化：从 2000ms 提高到 10000ms，减少轮询频率
  // 关键操作（解锁钱包、SidePanel打开、交易完成）会主动触发刷新
  BALANCE_UPDATE_INTERVAL: 10000, // 10秒

  // 状态消息自动隐藏时间（毫秒）
  STATUS_MESSAGE_TIMEOUT: 1200,

  // URL变化检测延迟（毫秒）
  URL_CHANGE_DELAY: 800
};

// ========== WebSocket 配置 ==========
export const TX_WATCHER_CONFIG = {
  // BSC WebSocket 节点地址（直接连接区块链节点）
  BSC_WS_URLS: [
    'wss://api.zan.top/node/ws/v1/bsc/mainnet/9ca4f22e10234d7ab736c8a8dc2911a6',
    'wss://bsc-mainnet.nodereal.io/ws/v1/cafa270f244d4dd0b3edd33c1665767f',
  ],

  // HTTP 轮询间隔（毫秒）- WebSocket 不可用时的降级方案
  POLLING_INTERVAL: 800,

  // 交易确认超时（毫秒），超过该时间仍未确认则提示用户
  TIMEOUT_MS: 10000, // 10秒

  // WebSocket 重连配置
  MAX_RECONNECT_ATTEMPTS: 3,
  RECONNECT_DELAY: 2000, // 2秒

  // 连接超时（毫秒）
  CONNECTION_TIMEOUT: 10000, // 10秒

  // 是否启用 WebSocket（可在设置中关闭）
  ENABLED: false
};

// ========== Background 任务配置 ==========
export const BACKGROUND_TASK_CONFIG = {
  // 买入时触发自动授权，前端为了避免重复操作会把代币状态锁定，后台也需要保持同样的锁定时长
  APPROVE_LOCK_DURATION_MS: 60 * 1000,

  // Four.meme 内盘卖出后，后台等待多少毫秒再去读取 quote 余额（给链上处理时间）
  FOUR_QUOTE_BALANCE_SETTLE_DELAY_MS: 400,

  // 自动兑换 quote→BNB 时允许的重试次数与间隔
  FOUR_QUOTE_BALANCE_RETRY_MAX: 6,
  FOUR_QUOTE_BALANCE_RETRY_DELAY_MS: 500,

  // quote 授权缓存的超时时间（优化：从5分钟增加到1天，减少链上查询）
  QUOTE_ALLOWANCE_CACHE_TTL_MS: 24 * 60 * 60 * 1000,

  // 与 offscreen document 通信时的 RPC 超时
  OFFSCREEN_RPC_TIMEOUT_MS: 15000,

  // 等待 offscreen port 建立连接的超时时间（毫秒）
  OFFSCREEN_PORT_TIMEOUT_MS: 5000
};

// ========== 自定义聚合器配置 ==========
export const CUSTOM_AGGREGATOR_CONFIG = {
  DEFAULT_ADDRESS: '0xBbAc12e854a88D3771B5ca38301b35401b87e84a',
  SUPPORTED_CHANNELS: ['four', 'xmode', 'flap'] as const,
  ROUTER_ADDRESS: '0x10ED43C718714eb63d5aA57B78B54704E256024E', // PancakeSwap Router
  DEFAULT_V3_FEE: 0,
  DEFAULT_FLAP_METHOD: 'getTokenV7'
};

// ========== 聚合器运行时配置 ==========
export const AGGREGATOR_RUNTIME_CONFIG = {
  ALLOWANCE_CACHE_TTL_MS: 60 * 1000
};

// ========== 交易参数配置 ==========
export const TX_CONFIG = {
  // 交易截止时间（秒）
  DEADLINE_SECONDS: 60 * 20, // 20分钟

  // Gas Limit 配置
  GAS_LIMIT: {
    APPROVE: 100000,           // 代币授权
    PANCAKE_SWAP: 350000,      // PancakeSwap 交易
    FOUR_SWAP: 1500000,        // Four.meme 交易
    FLAP_SWAP: 1500000,        // Flap Portal 交易
    LUNA_SWAP: 1500000         // Luna.fun 交易
  },

  // 默认滑点（百分比）
  DEFAULT_SLIPPAGE: 15,

  // 默认 Gas Price (Gwei)
  DEFAULT_GAS_PRICE: 0.05,

  // 最低 Gas Price (Gwei)，避免发送过低被节点拒绝
  MIN_GAS_PRICE: 0.05,

  // 最大滑点限制
  MAX_SLIPPAGE: 100,

  // 最小滑点限制
  MIN_SLIPPAGE: 1,

  // 路径优化配置
  PATH_OPTIMIZATION: {
    // 是否启用智能路径选择（优先尝试直接路径）
    SMART_PATH_ENABLED: true,

    // 直接路径失败后是否尝试其他路径
    TRY_ALTERNATIVE_PATHS: false
  },

  // 授权默认 Gas Price (Gwei)
  APPROVE_GAS_PRICE: 0.05
};

// ========== 募集币种池子配置 ==========
export type QuoteTokenPoolConfigEntry = {
  swapMode: 'v2' | 'v3';
  path: string[];
  fee?: number;
};

/**
 * 募集币种池子配置
 * 定义各种募集币种与 WBNB 的交换路径和费率
 *
 * 注意：这个配置依赖 CONTRACTS，所以需要在运行时动态构建
 * 这里导出一个工厂函数，由使用方传入 CONTRACTS
 */
export function createQuoteTokenPoolConfig(CONTRACTS: {
  WBNB: string;
  ASTER?: string;
  USD1?: string;
  UNITED_STABLES_U?: string;
  USDT: string;
  USDC: string;
  USAT?: string;
  CAKE: string;
}): Record<string, QuoteTokenPoolConfigEntry> {
  const config: Record<string, QuoteTokenPoolConfigEntry> = {};

  if (CONTRACTS.ASTER) {
    config[CONTRACTS.ASTER.toLowerCase()] = {
      swapMode: 'v2',
      path: [CONTRACTS.WBNB, CONTRACTS.ASTER]
    };
  }

  if (CONTRACTS.USD1) {
    config[CONTRACTS.USD1.toLowerCase()] = {
      swapMode: 'v3',
      path: [CONTRACTS.WBNB, CONTRACTS.USD1],
      fee: 100
    };
  }

  if (CONTRACTS.UNITED_STABLES_U) {
    config[CONTRACTS.UNITED_STABLES_U.toLowerCase()] = {
      swapMode: 'v3',
      path: [CONTRACTS.WBNB, CONTRACTS.UNITED_STABLES_U],
      fee: 500
    };
  }

  config[CONTRACTS.USDT.toLowerCase()] = {
    swapMode: 'v3',
    path: [CONTRACTS.WBNB, CONTRACTS.USDT],
    fee: 100
  };

  config[CONTRACTS.USDC.toLowerCase()] = {
    swapMode: 'v3',
    path: [CONTRACTS.WBNB, CONTRACTS.USDC],
    fee: 100
  };

  if (CONTRACTS.USAT) {
    config[CONTRACTS.USAT.toLowerCase()] = {
      swapMode: 'v2',
      path: [CONTRACTS.WBNB, CONTRACTS.USAT]
    };
  }

  config[CONTRACTS.CAKE.toLowerCase()] = {
    swapMode: 'v3',
    path: [CONTRACTS.WBNB, CONTRACTS.CAKE],
    fee: 500
  };

  return config;
}

// ========== 通道配置 ==========
export const CHANNELS = {
  PANCAKE: {
    name: 'PancakeSwap',
    id: 'pancake' as const,
    description: '官方DEX，流动性最好',
  },
  FOUR: {
    name: 'Four.meme',
    id: 'four' as const,
    description: '聚合器，自动寻找最优路径',
  },
  XMODE: {
    name: 'X Mode',
    id: 'xmode' as const,
    description: '使用Four.meme合约',
  },
  FLAP: {
    name: 'Flap',
    id: 'flap' as const,
    description: 'Flap Portal聚合协议',
  }
};

/**
 * 通道定义（供通道工厂使用）
 *
 * 注意：这个配置依赖 CONTRACTS、ABIs 和 TX_CONFIG，所以需要在运行时动态构建
 * 这里导出一个工厂函数，由使用方传入依赖
 */
export function createChannelDefinitions(deps: {
  CONTRACTS: any;
  ROUTER_ABI: any;
  PANCAKE_FACTORY_ABI: any;
  PANCAKE_V3_SMART_ROUTER_ABI: any;
  PANCAKE_V3_FACTORY_ABI: any;
  PANCAKE_V3_QUOTER_ABI: any;
  FOUR_TOKEN_MANAGER_ABI: any;
  FLAP_PORTAL_ABI: any;
  TX_CONFIG: typeof TX_CONFIG;
}) {
  const { CONTRACTS, ROUTER_ABI, PANCAKE_FACTORY_ABI, PANCAKE_V3_SMART_ROUTER_ABI,
          PANCAKE_V3_FACTORY_ABI, PANCAKE_V3_QUOTER_ABI, FOUR_TOKEN_MANAGER_ABI,
          FLAP_PORTAL_ABI, TX_CONFIG } = deps;

  const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

  return {
    pancake: {
      id: 'pancake',
      name: CHANNELS.PANCAKE.name,
      type: 'router',
      contractAddress: CONTRACTS.PANCAKE_ROUTER,
      abi: ROUTER_ABI,
      gasLimit: TX_CONFIG.GAS_LIMIT.PANCAKE_SWAP,
      options: {
        nativeWrapper: CONTRACTS.WBNB,
        stableTokens: [CONTRACTS.USDT, CONTRACTS.USDC, CONTRACTS.BUSD],
        helperTokens: [CONTRACTS.ASTER, CONTRACTS.USD1, CONTRACTS.UNITED_STABLES_U, CONTRACTS.USAT].filter(
          (token): token is string => Boolean(token)
        ),
        buyFunction: 'swapExactETHForTokens',
        sellFunction: 'swapExactTokensForETHSupportingFeeOnTransferTokens',
        factoryAddress: CONTRACTS.PANCAKE_FACTORY,
        factoryAbi: PANCAKE_FACTORY_ABI,
        dynamicBridgeTokens: [CONTRACTS.USD1, CONTRACTS.UNITED_STABLES_U, CONTRACTS.USAT].filter(
          (token): token is string => Boolean(token)
        ),
        smartRouterAddress: CONTRACTS.PANCAKE_SMART_ROUTER,
        smartRouterAbi: PANCAKE_V3_SMART_ROUTER_ABI,
        v3FactoryAddress: CONTRACTS.PANCAKE_V3_FACTORY,
        v3FactoryAbi: PANCAKE_V3_FACTORY_ABI,
        v3QuoterAddress: CONTRACTS.PANCAKE_V3_QUOTER,
        v3QuoterAbi: PANCAKE_V3_QUOTER_ABI
      }
    },
    four: {
      id: 'four',
      name: CHANNELS.FOUR.name,
      type: 'tokenManager',
      contractAddress: CONTRACTS.FOUR_TOKEN_MANAGER_V2,
      abi: FOUR_TOKEN_MANAGER_ABI,
      gasLimit: TX_CONFIG.GAS_LIMIT.FOUR_SWAP,
      buyFunction: 'buyTokenAMAP',
      buyMinAmountOut: 1n,
      sellFunction: 'sellToken',
      sellMinFunds: 0n
    },
    xmode: {
      id: 'xmode',
      name: CHANNELS.XMODE.name,
      type: 'alias',
      aliasOf: 'four'
    },
    flap: {
      id: 'flap',
      name: CHANNELS.FLAP.name,
      type: 'quotePortal',
      contractAddress: CONTRACTS.FLAP_PORTAL,
      abi: FLAP_PORTAL_ABI,
      gasLimit: TX_CONFIG.GAS_LIMIT.FLAP_SWAP,
      options: {
        nativeTokenAddress: ZERO_ADDRESS,
        quoteFunction: 'quoteExactInput',
        swapFunction: 'swapExactInput'
      }
    }
  } as const;
}
