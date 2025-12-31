import { createHttpClient, formatEther, formatUnits } from '../shared/viem-helper.js';
import { NETWORK_CONFIG, ERC20_ABI, CONTRACTS, DEBUG_CONFIG } from '../shared/trading-config.js';
import type { Address } from 'viem';

const PORT_NAME = 'dog-bang-offscreen';
let port: chrome.runtime.Port | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
let autoStopTimer: ReturnType<typeof setTimeout> | null = null;
const publicClient = createHttpClient(NETWORK_CONFIG.BSC_RPC);
const typedPublicClient = publicClient as any;

function sendPortMessage(payload: any) {
  if (!port) {
    console.warn('[Offscreen] Port unavailable, drop message:', payload?.action);
    return;
  }
  try {
    port.postMessage(payload);
  } catch (error) {
    console.error('[Offscreen] Failed to post message:', error);
  }
}

function scheduleReconnect() {
  if (reconnectTimer) return;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connectPort();
  }, 500);
}

function handlePortDisconnect() {
  stopHeartbeat(false);
  port = null;
  scheduleReconnect();
}

function connectPort() {
  try {
    port = chrome.runtime.connect({ name: PORT_NAME });
    port.onMessage.addListener(handlePortMessage);
    port.onDisconnect.addListener(handlePortDisconnect);
    if (typeof console !== 'undefined' && typeof console.debug === 'function') {
      console.debug('[Offscreen] Port connected');
    }
  } catch (error) {
    console.error('[Offscreen] Failed to connect port:', error);
    scheduleReconnect();
  }
}

function startHeartbeat(interval = 25000, duration = 0) {
  stopHeartbeat();

  heartbeatTimer = setInterval(() => {
    sendPortMessage({
      action: 'keep_alive_ping',
      timestamp: Date.now()
    });
  }, interval);

  if (duration > 0) {
    autoStopTimer = setTimeout(() => {
      stopHeartbeat(true);
    }, duration);
  }
}

function stopHeartbeat(auto = false) {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }

  if (autoStopTimer) {
    clearTimeout(autoStopTimer);
    autoStopTimer = null;
  }

  sendPortMessage({
    action: 'keep_alive_stopped',
    reason: auto ? 'auto' : 'manual'
  });
}

async function executeWithRetry<T>(fn: () => Promise<T>, maxRetries = 2): Promise<T> {
  let attempt = 0;
  while (true) {
    try {
      return await fn();
    } catch (error) {
      attempt++;
      if (attempt > maxRetries) {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, attempt * 500));
    }
  }
}

async function rpcGetWalletStatus(payload: { address: string; tokenAddress?: string }) {
  const walletAddress = payload.address as Address;
  const tokenAddress = payload.tokenAddress as Address | undefined;

  const balance = await executeWithRetry(() => publicClient.getBalance({ address: walletAddress }));
  const bnbBalance = parseFloat(formatEther(balance)).toFixed(4);
  const result: { bnbBalance: string; tokenBalance?: string } = { bnbBalance };

  if (tokenAddress) {
    try {
      const [tokenBalance, decimals] = await executeWithRetry(async () => {
        const balanceValue = await typedPublicClient.readContract({
          address: tokenAddress,
          abi: ERC20_ABI,
          functionName: 'balanceOf',
          args: [walletAddress]
        });
        const tokenDecimals = await typedPublicClient.readContract({
          address: tokenAddress,
          abi: ERC20_ABI,
          functionName: 'decimals'
        });
        return [balanceValue, tokenDecimals] as const;
      });
      result.tokenBalance = parseFloat(formatUnits(tokenBalance, Number(decimals))).toFixed(4);
    } catch (error) {
      console.error('[Offscreen RPC] Failed to fetch token balance:', error);
      result.tokenBalance = '0.00';
    }
  }

  return result;
}

async function rpcGetTokenInfo(payload: { tokenAddress: string; walletAddress: string; needApproval: boolean }) {
  const tokenAddress = payload.tokenAddress as Address;
  const walletAddress = payload.walletAddress as Address;
  const pancakeRouter = CONTRACTS.PANCAKE_ROUTER as Address;
  const fourRouter = CONTRACTS.FOUR_TOKEN_MANAGER_V2 as Address;
  const flapRouter = CONTRACTS.FLAP_PORTAL as Address;

  const queries = [
    typedPublicClient.readContract({ address: tokenAddress, abi: ERC20_ABI, functionName: 'symbol' }),
    typedPublicClient.readContract({ address: tokenAddress, abi: ERC20_ABI, functionName: 'decimals' }),
    typedPublicClient.readContract({ address: tokenAddress, abi: ERC20_ABI, functionName: 'totalSupply' }),
    typedPublicClient.readContract({ address: tokenAddress, abi: ERC20_ABI, functionName: 'balanceOf', args: [walletAddress] })
  ];

  if (payload.needApproval) {
    queries.push(
      typedPublicClient.readContract({ address: tokenAddress, abi: ERC20_ABI, functionName: 'allowance', args: [walletAddress, pancakeRouter] }),
      typedPublicClient.readContract({ address: tokenAddress, abi: ERC20_ABI, functionName: 'allowance', args: [walletAddress, fourRouter] }),
      typedPublicClient.readContract({ address: tokenAddress, abi: ERC20_ABI, functionName: 'allowance', args: [walletAddress, flapRouter] })
    );
  }

  const results = await executeWithRetry(() => Promise.all(queries));

  const data: any = {
    symbol: results[0],
    decimals: Number(results[1]),
    totalSupply: results[2].toString(),
    balance: results[3].toString()
  };

  if (payload.needApproval) {
    data.allowances = {
      pancake: results[4].toString(),
      four: results[5].toString(),
      flap: results[6].toString(),
      xmode: results[5].toString()
    };
  }

  return data;
}

function isDebugLoggingEnabled() {
  return Boolean(DEBUG_CONFIG?.ENABLED || DEBUG_CONFIG?.PERF_ENABLED);
}

function getStorageLocal() {
  try {
    return chrome?.storage?.local ?? null;
  } catch (error) {
    if (isDebugLoggingEnabled()) {
      console.warn('[Offscreen] 无法访问 chrome.storage.local:', error);
    }
    return null;
  }
}

async function rpcWriteLog(payload: { eventType: string; payload: any; timestamp: number }) {
  if (!isDebugLoggingEnabled()) {
    return { success: false, skipped: true };
  }

  const record = {
    eventType: payload.eventType,
    payload: payload.payload,
    timestamp: payload.timestamp ?? Date.now()
  };

  const storageLocal = getStorageLocal();
  if (!storageLocal) {
    if (isDebugLoggingEnabled()) {
      console.warn('[Offscreen RPC] storage.local 不可用，跳过日志持久化');
    }
    return { success: false, skipped: true };
  }

  const existing = await storageLocal.get(['performanceLogs']);
  const logs = Array.isArray(existing.performanceLogs) ? existing.performanceLogs : [];
  logs.push(record);
  if (logs.length > 100) {
    logs.shift();
  }
  await storageLocal.set({ performanceLogs: logs });
  return { success: true };
}

async function handleRpcTask(task: string, payload: any) {
  switch (task) {
    case 'rpc_get_wallet_status':
      return rpcGetWalletStatus(payload);
    case 'rpc_get_token_info':
      return rpcGetTokenInfo(payload);
    case 'rpc_write_log':
      return rpcWriteLog(payload);
    default:
      throw new Error('Unknown RPC task: ' + task);
  }
}

async function handlePortMessage(message: any) {
  if (!message || !message.action) return;

  if (message.action === 'start_keep_alive') {
    startHeartbeat(message.interval, message.duration);
  } else if (message.action === 'stop_keep_alive') {
    stopHeartbeat(false);
  } else if (message.action === 'rpc_task') {
    const { requestId, task, payload } = message;
    try {
      const result = await handleRpcTask(task, payload);
      sendPortMessage({ action: 'rpc_result', requestId, success: true, data: result });
    } catch (error) {
      const err = error instanceof Error ? error.message : 'Unknown RPC error';
      sendPortMessage({ action: 'rpc_result', requestId, success: false, error: err });
    }
  }
}

connectPort();
