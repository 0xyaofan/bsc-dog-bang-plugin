import {
  createPublicClient,
  createWalletClient,
  createNonceManager,
  encodeFunctionData,
  formatEther,
  formatUnits,
  http,
  parseEther,
  parseUnits,
  webSocket,
  withCache
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { bsc } from 'viem/chains';
import { RPC_CONFIG } from './config/index.js';

const BASE_CHAIN = {
  ...bsc,
  rpcUrls: {
    default: {
      http: [],
      webSocket: []
    },
    public: {
      http: [],
      webSocket: []
    }
  }
};

const RPC_TIMEOUT_MS = RPC_CONFIG?.REQUEST_TIMEOUT_MS ?? 30000;

/**
 * Chain Config 缓存
 * 避免重复创建相同的 chain config 对象
 */
const chainConfigCache = new Map<string, any>();

export function buildChainConfig(rpcUrl?: string | null, wsUrl: string | null = null) {
  // 生成缓存键
  const cacheKey = `${rpcUrl || ''}:${wsUrl || ''}`;

  // 检查缓存
  const cached = chainConfigCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  // 创建新的 chain config
  const httpUrls = rpcUrl ? [rpcUrl] : [];
  const wsUrls = wsUrl ? [wsUrl] : [];
  const config = {
    ...BASE_CHAIN,
    rpcUrls: {
      default: {
        http: httpUrls,
        webSocket: wsUrls
      },
      public: {
        http: httpUrls,
        webSocket: wsUrls
      }
    }
  };

  // 缓存并返回
  chainConfigCache.set(cacheKey, config);
  return config;
}

export function createHttpClient(rpcUrl: string, chain?: any) {
  return createPublicClient({
    chain: chain ?? buildChainConfig(rpcUrl),
    transport: http(rpcUrl, { timeout: RPC_TIMEOUT_MS }),
    ccipRead: false
  });
}

export function createWebSocketClient(wsUrl: string, chain?: any) {
  return createPublicClient({
    chain: chain ?? buildChainConfig(wsUrl ? undefined : null, wsUrl),
    transport: webSocket(wsUrl),
    ccipRead: false
  });
}

export function createWallet(privateKey: `0x${string}`, rpcUrl: string, chain?: any, options: { nonceManager?: any } = {}) {
  const account = options?.nonceManager
    ? privateKeyToAccount(privateKey, { nonceManager: options.nonceManager })
    : privateKeyToAccount(privateKey);
  const client = createWalletClient({
    account,
    chain: chain ?? buildChainConfig(rpcUrl),
    transport: http(rpcUrl, { timeout: RPC_TIMEOUT_MS }),
    ccipRead: false
  });
  return { account, client };
}

export {
  createNonceManager,
  encodeFunctionData,
  formatEther,
  formatUnits,
  parseEther,
  parseUnits,
  withCache
};
