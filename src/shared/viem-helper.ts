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
import { RPC_CONFIG } from './trading-config.js';

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

export function buildChainConfig(rpcUrl?: string | null, wsUrl: string | null = null) {
  const httpUrls = rpcUrl ? [rpcUrl] : [];
  const wsUrls = wsUrl ? [wsUrl] : [];
  return {
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
