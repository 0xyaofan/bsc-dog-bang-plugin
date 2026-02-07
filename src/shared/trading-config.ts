/**
 * Trading Configuration
 * 包含所有合约地址、ABI定义和交易参数
 *
 * 注意：日志和性能监控功能已移至独立模块
 * - 日志: import { logger } from './logger'
 * - 性能: import { PerformanceTimer, perf } from './performance'
 */

import { parseAbi, type Abi } from 'viem';
import pancakeRouterAbi from '../../abis/pancake-router.json';
import pancakeFactoryAbi from '../../abis/pancake-factory.json';
import tokenManagerV2Abi from '../../abis/fourmeme/TokenManager2.lite.abi.json';
import flapPortalAbi from '../../abis/flap-portal.json';
import lunaFunLaunchpadAbi from '../../abis/luna-fun-launchpad.json';
import memeSwapAggregatorAbi from '../../abis/MemeSwapContract.abi.json';

type AbiEntry = {
  type?: string;
  name?: string;
  inputs?: Array<{ name?: string; type?: string }>;
};

function ensureAbiFunction(source: AbiEntry[], name: string, inputTypes: string[]) {
  const match = source.some((item) => {
    if (item.type !== 'function' || item.name !== name || !item.inputs) {
      return false;
    }
    if (item.inputs.length !== inputTypes.length) {
      return false;
    }
    return inputTypes.every((type, index) => (item.inputs?.[index]?.type || '').toLowerCase() === type.toLowerCase());
  });
  if (!match) {
    throw new Error(`[trading-config] ABI 缺少函数 ${name}(${inputTypes.join(', ')})`);
  }
}

// ========== 调试和日志配置 ==========
export const DEBUG_CONFIG = {
  // 是否启用调试日志（开发时设为 true，生产环境设为 false）
  ENABLED: false,  // 改为 true 可以启用所有日志

  // 是否启用性能日志（记录每个步骤的耗时）
  PERF_ENABLED: false,  // 改为 false 可以关闭性能日志

  // 日志级别
  LEVELS: {
    ERROR: 0,   // 总是显示
    WARN: 1,    // 总是显示
    INFO: 2,    // debug 模式才显示
    DEBUG: 3    // debug 模式才显示
  }
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

// ========== 网络配置 ==========
export const NETWORK_CONFIG = {
  // BSC RPC 节点
  BSC_RPC: 'https://api.zan.top/node/v1/bsc/mainnet/9ca4f22e10234d7ab736c8a8dc2911a6/',
  BSC_CHAIN_ID: 56,

  // RPC 备用节点列表
  BSC_RPC_FALLBACK: [
    'https://bsc-mainnet.nodereal.io/v1/cafa270f244d4dd0b3edd33c1665767f/',
    'https://bsc-dataseed.bnbchain.org/',
    // 'https://bsc-rpc.publicnode.com/',
  ]
};

// ========== RPC 请求配置 ==========
export const RPC_CONFIG = {
  // viem http transport 超时时间，避免节点响应过慢导致请求错误
  REQUEST_TIMEOUT_MS: 10000 // 10秒
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

// ========== UI 配置 ==========
export const UI_CONFIG = {
  // 自动更新余额间隔（毫秒）
  // 优化：从 2000ms 提高到 10000ms，减少轮询频率
  // 关键操作（解锁钱包、SidePanel打开、交易完成）会主动触发刷新
  BALANCE_UPDATE_INTERVAL: 10000, // 10秒

  // 状态消息自动隐藏时间（毫秒）
  STATUS_MESSAGE_TIMEOUT: 1200, // 800毫秒

  // URL变化检测延迟（毫秒）
  URL_CHANGE_DELAY: 800 // 800毫秒
};

// ========== WebSocket 配置 ==========
export const TX_WATCHER_CONFIG = {
  // BSC WebSocket 节点地址（直接连接区块链节点）
  BSC_WS_URLS: [
    'wss://api.zan.top/node/ws/v1/bsc/mainnet/9ca4f22e10234d7ab736c8a8dc2911a6',
    'wss://bsc-mainnet.nodereal.io/ws/v1/cafa270f244d4dd0b3edd33c1665767f',
    // 'wss://bsc-dataseed.bnbchain.org/ws',
    // 'wss://bsc.publicnode.com'
  ],

  // HTTP 轮询间隔（毫秒）- WebSocket 不可用时的降级方案
  POLLING_INTERVAL: 800, // 800豪秒

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

// ========== 合约地址 ==========
export const CONTRACTS = {
  // PancakeSwap Router V2
  PANCAKE_ROUTER: '0x10ED43C718714eb63d5aA57B78B54704E256024E',
  PANCAKE_FACTORY: '0xCa143Ce32Fe78f1f7019d7d551a6402fC5350c73',
  PANCAKE_SMART_ROUTER: '0x13f4EA83D0bd40E75C8222255bc855a974568Dd4',
  PANCAKE_V3_FACTORY: '0x0BFbCF9fa4f9C56B0F40a671Ad40E0805A091865',
  PANCAKE_V3_QUOTER: '0xB048Bbc1Ee6b733FFfCFb9e9CeF7375518e25997',

  // 代币地址
  WBNB: '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c',
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

  // Four.meme 合约（XMode使用相同合约）
  FOUR_TOKEN_MANAGER_V2: '0x5c952063c7fc8610FFDB798152D69F0B9550762b',
  FOUR_HELPER_V3: '0xF251F83e40a78868FcfA3FA4599Dad6494E46034',

  // Flap Portal 合约
  FLAP_PORTAL: '0xe2cE6ab80874Fa9Fa2aAE65D277Dd6B8e65C9De0',

  // Luna.fun Launchpad
  LUNA_FUN_LAUNCHPAD: '0x7fdC3c5c4eC798150462D040526B6A89190b459c'
};

// ========== 募集币种池子配置 ==========
export type QuoteTokenPoolConfigEntry = {
  swapMode: 'v2' | 'v3';
  path: string[];
  fee?: number;
};

const quoteTokenPoolConfig: Record<string, QuoteTokenPoolConfigEntry> = {};

function registerQuoteTokenPreset(token?: string, entry?: QuoteTokenPoolConfigEntry) {
  if (!token || !entry) {
    return;
  }
  quoteTokenPoolConfig[token.toLowerCase()] = entry;
}

registerQuoteTokenPreset(CONTRACTS.ASTER, {
  swapMode: 'v2',
  path: [CONTRACTS.WBNB, CONTRACTS.ASTER]
});

registerQuoteTokenPreset(CONTRACTS.USD1, {
  swapMode: 'v3',
  path: [CONTRACTS.WBNB, CONTRACTS.USD1],
  fee: 100
});

registerQuoteTokenPreset(CONTRACTS.UNITED_STABLES_U, {
  swapMode: 'v3',
  path: [CONTRACTS.WBNB, CONTRACTS.UNITED_STABLES_U],
  fee: 500
});

registerQuoteTokenPreset(CONTRACTS.USDT, {
  swapMode: 'v3',
  path: [CONTRACTS.WBNB, CONTRACTS.USDT],
  fee: 100
});

registerQuoteTokenPreset(CONTRACTS.USDC, {
  swapMode: 'v3',
  path: [CONTRACTS.WBNB, CONTRACTS.USDC],
  fee: 100
});

registerQuoteTokenPreset(CONTRACTS.USAT, {
  swapMode: 'v2',
  path: [CONTRACTS.WBNB, CONTRACTS.USAT]
});

registerQuoteTokenPreset(CONTRACTS.CAKE, {
  swapMode: 'v3',
  path: [CONTRACTS.WBNB, CONTRACTS.CAKE],
  fee: 500
});

export const QUOTE_TOKEN_POOL_CONFIG = quoteTokenPoolConfig;

// ========== 合约 ABI ==========

// PancakeSwap Router / Factory ABI（保持与 JSON 同步，使用字符串定义）
ensureAbiFunction(pancakeRouterAbi as AbiEntry[], 'swapExactETHForTokens', ['uint256', 'address[]', 'address', 'uint256']);
ensureAbiFunction(pancakeRouterAbi as AbiEntry[], 'swapExactTokensForETH', ['uint256', 'uint256', 'address[]', 'address', 'uint256']);
ensureAbiFunction(pancakeRouterAbi as AbiEntry[], 'swapExactTokensForETHSupportingFeeOnTransferTokens', ['uint256', 'uint256', 'address[]', 'address', 'uint256']);
ensureAbiFunction(pancakeRouterAbi as AbiEntry[], 'getAmountsOut', ['uint256', 'address[]']);
ensureAbiFunction(pancakeFactoryAbi as AbiEntry[], 'getPair', ['address', 'address']);

export const ROUTER_ABI = parseAbi([
  'function swapExactETHForTokens(uint amountOutMin, address[] path, address to, uint deadline) payable returns (uint[] amounts)',
  'function swapExactTokensForETH(uint amountIn, uint amountOutMin, address[] path, address to, uint deadline) returns (uint[] amounts)',
  'function swapExactTokensForETHSupportingFeeOnTransferTokens(uint amountIn, uint amountOutMin, address[] path, address to, uint deadline)',
  'function swapExactTokensForTokens(uint amountIn, uint amountOutMin, address[] path, address to, uint deadline) returns (uint[] amounts)',
  'function getAmountsOut(uint amountIn, address[] path) view returns (uint[] amounts)'
]);

export const PANCAKE_FACTORY_ABI = parseAbi([
  'function getPair(address tokenA, address tokenB) view returns (address pair)'
]);

export const PANCAKE_V3_FACTORY_ABI = parseAbi([
  'function getPool(address tokenA, address tokenB, uint24 fee) view returns (address pool)'
]);

export const PANCAKE_V3_SMART_ROUTER_ABI = parseAbi([
  'function exactInputSingle((address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 amountIn, uint256 amountOutMinimum, uint160 sqrtPriceLimitX96) params) payable returns (uint256 amountOut)',
  'function exactInput((bytes path, address recipient, uint256 amountIn, uint256 amountOutMinimum) params) payable returns (uint256 amountOut)',
  'function unwrapWETH9(uint256 amountMinimum, address recipient) payable',
  'function multicall(bytes[] data) payable returns (bytes[] results)'
]);

export const PANCAKE_V3_QUOTER_ABI = parseAbi([
  'function quoteExactInputSingle((address tokenIn, address tokenOut, uint256 amountIn, uint24 fee, uint160 sqrtPriceLimitX96) params) returns (uint256 amountOut, uint160 sqrtPriceX96After, uint32 initializedTicksCrossed, uint256 gasEstimate)',
  'function quoteExactInput(bytes path, uint256 amountIn) returns (uint256 amountOut, uint160[] sqrtPriceX96AfterList, uint32[] initializedTicksCrossedList, uint256 gasEstimate)'
]);

// ERC20 ABI（最小化）
export const ERC20_ABI = parseAbi([
  'function balanceOf(address owner) view returns (uint256)',
  'function decimals() view returns (uint8)',
  'function approve(address spender, uint256 amount) returns (bool)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function symbol() view returns (string)',
  'function name() view returns (string)',
  'function totalSupply() view returns (uint256)'
]);

// Four.meme Token Manager ABI
ensureAbiFunction(tokenManagerV2Abi as AbiEntry[], 'buyToken', ['bytes', 'uint256', 'bytes']);
ensureAbiFunction(tokenManagerV2Abi as AbiEntry[], 'buyTokenAMAP', ['address', 'uint256', 'uint256']);
ensureAbiFunction(tokenManagerV2Abi as AbiEntry[], 'sellToken', ['address', 'uint256', 'uint256']);
export const FOUR_TOKEN_MANAGER_ABI = parseAbi([
  'function buyToken(bytes args, uint256 time, bytes signature) payable',
  'function buyTokenAMAP(address token, uint256 amountIn, uint256 minAmountOut) payable returns (uint256)',
  'function sellToken(address token, uint256 amountIn, uint256 minFunds) returns (uint256)'
]);

// Flap Portal ABI
ensureAbiFunction(flapPortalAbi as AbiEntry[], 'quoteExactInput', ['tuple']);
ensureAbiFunction(flapPortalAbi as AbiEntry[], 'swapExactInput', ['tuple']);
export const FLAP_PORTAL_ABI = parseAbi([
  'function quoteExactInput((address inputToken, address outputToken, uint256 inputAmount) params) view returns (uint256 amountOut)',
  'function swapExactInput((address inputToken, address outputToken, uint256 inputAmount, uint256 minOutputAmount, bytes permitData) params) payable returns (uint256 amountOut)'
]);

// Luna.fun Launchpad ABI
ensureAbiFunction(lunaFunLaunchpadAbi as AbiEntry[], 'buy', ['uint256', 'address', 'uint256', 'uint256']);
ensureAbiFunction(lunaFunLaunchpadAbi as AbiEntry[], 'sell', ['uint256', 'address', 'uint256', 'uint256']);
export const LUNA_FUN_ABI = parseAbi([
  'function buy(uint256 amountIn, address tokenAddress, uint256 amountOutMin, uint256 deadline) returns (bool)',
  'function sell(uint256 amountIn, address tokenAddress, uint256 amountOutMin, uint256 deadline) returns (bool)'
]);

ensureAbiFunction(memeSwapAggregatorAbi as AbiEntry[], 'buyFourMeme', [
  'address',
  'bool',
  'uint24',
  'address',
  'address',
  'address',
  'address',
  'uint256',
  'uint256',
  'uint256'
]);
ensureAbiFunction(memeSwapAggregatorAbi as AbiEntry[], 'sellFourMeme', [
  'address',
  'bool',
  'uint24',
  'address',
  'address',
  'address',
  'address',
  'uint256',
  'uint256',
  'uint256',
  'uint256'
]);
ensureAbiFunction(memeSwapAggregatorAbi as AbiEntry[], 'buyFlap', [
  'address',
  'bool',
  'uint24',
  'address',
  'address',
  'address',
  'string',
  'uint256',
  'uint256',
  'uint256'
]);
ensureAbiFunction(memeSwapAggregatorAbi as AbiEntry[], 'sellFlap', [
  'address',
  'bool',
  'uint24',
  'address',
  'address',
  'address',
  'uint256',
  'string',
  'uint256',
  'uint256',
  'uint256'
]);
export const MEME_SWAP_AGGREGATOR_ABI = memeSwapAggregatorAbi as Abi;

export const CUSTOM_AGGREGATOR_CONFIG = {
  DEFAULT_ADDRESS: '0xBbAc12e854a88D3771B5ca38301b35401b87e84a',
  SUPPORTED_CHANNELS: ['four', 'xmode', 'flap'] as const,
  ROUTER_ADDRESS: CONTRACTS.PANCAKE_ROUTER,
  DEFAULT_V3_FEE: 0,
  DEFAULT_FLAP_METHOD: 'getTokenV7'
};

export const AGGREGATOR_RUNTIME_CONFIG = {
  ALLOWANCE_CACHE_TTL_MS: 60 * 1000
};

// ========== 通道配置 ==========
export const CHANNELS = {
  PANCAKE: {
    name: 'PancakeSwap',
    id: 'pancake',
    description: '官方DEX，流动性最好',
  },
  FOUR: {
    name: 'Four.meme',
    id: 'four',
    description: '聚合器，自动寻找最优路径',
  },
  XMODE: {
    name: 'X Mode',
    id: 'xmode',
    description: '使用Four.meme合约',
  },
  FLAP: {
    name: 'Flap',
    id: 'flap',
    description: 'Flap Portal聚合协议',
  }
};

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

// 供通道工厂使用的合约定义
export const CHANNEL_DEFINITIONS = {
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
