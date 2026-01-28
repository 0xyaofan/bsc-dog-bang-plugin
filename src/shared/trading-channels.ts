/**
 * Trading Channels Module
 * 实现不同通道的买卖逻辑
 */

import { logger } from './logger.js';
import { getAddress } from 'viem';
import {
  ERC20_ABI,
  TX_CONFIG,
  CHANNEL_DEFINITIONS,
  CONTRACTS
} from './trading-config.js';
import { getFourHelperTokenList } from './channel-config.js';
import { parseEther, parseUnits, formatEther, encodeFunctionData, withCache } from 'viem';
import { dedupePromise } from './promise-dedupe.js';
import tokenManagerHelperAbi from '../../abis/token-manager-helper-v3.json';

// ========== 路径缓存（优化4：减少 getAmountsOut 调用）==========
// 注意：此缓存存储的是兑换金额（价格敏感数据），必须保持短期缓存以反映市场价格变化
const pathCache = new Map<string, { time: number; amountOut: bigint }>();
const PATH_CACHE_TTL = 1200; // 1.2秒缓存（balance between freshness and performance）
const GWEI_DECIMALS = 9;
const RPC_CACHE_TTL = 1500;

function toWeiFromGwei(value) {
  return parseUnits(value.toString(), GWEI_DECIMALS);
}

function getClientScopeId(client) {
  if (!client) return 'default';
  if (client.uid) return client.uid;
  if (client.chain?.id) return `chain-${client.chain.id}`;
  return 'default';
}

function callRpcWithTransportCache(client, cacheKey, cacheTime, fn) {
  const scopedKey = `${getClientScopeId(client)}:${cacheKey}`;
  return dedupePromise(scopedKey, () => withCache(fn, { cacheKey: scopedKey, cacheTime }));
}

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';
const pairExistenceCache = new Map<string, boolean>();
// 动态桥接路径缓存：存储流动池的存在性（永久缓存，流动池创建后不会消失）
const dynamicBridgeCache = new Map<string, { buy: string[][]; sell: string[][] }>();
const dynamicGasCache = new Map<string, { gas: bigint; updatedAt: number }>();
const DYNAMIC_GAS_CACHE_TTL = 5 * 60 * 1000;
const V3_FEE_TIERS = [100, 250, 500, 2500, 10000];
const v3PoolCache = new Map<string, { fee: number; pool: string } | null>();

// ========== 授权缓存（性能优化：避免重复查询链上授权状态）==========
type AllowanceCacheEntry = {
  amount: bigint;
  updatedAt: number;
};
const allowanceCache = new Map<string, AllowanceCacheEntry>();
const ALLOWANCE_CACHE_TTL = 24 * 60 * 60 * 1000; // 24小时

function getCachedAllowance(tokenAddress: string, spenderAddress: string): bigint | null {
  const cacheKey = `${tokenAddress.toLowerCase()}:${spenderAddress.toLowerCase()}`;
  const cached = allowanceCache.get(cacheKey);
  if (!cached) {
    return null;
  }
  if (Date.now() - cached.updatedAt > ALLOWANCE_CACHE_TTL) {
    allowanceCache.delete(cacheKey);
    return null;
  }
  return cached.amount;
}

function setCachedAllowance(tokenAddress: string, spenderAddress: string, amount: bigint) {
  const cacheKey = `${tokenAddress.toLowerCase()}:${spenderAddress.toLowerCase()}`;
  allowanceCache.set(cacheKey, { amount, updatedAt: Date.now() });
  logger.debug('[AllowanceCache] 缓存授权状态:', { tokenAddress: tokenAddress.slice(0, 10), spender: spenderAddress.slice(0, 10), amount: amount.toString() });
}

function clearAllowanceCache(tokenAddress: string, spenderAddress: string) {
  const cacheKey = `${tokenAddress.toLowerCase()}:${spenderAddress.toLowerCase()}`;
  allowanceCache.delete(cacheKey);
  logger.debug('[AllowanceCache] 清除授权缓存:', { tokenAddress: tokenAddress.slice(0, 10), spender: spenderAddress.slice(0, 10) });
}

// 代币元数据永久缓存：symbol 和 decimals 是 ERC20 标准中的 view 函数，永不改变
type TokenMetadata = {
  symbol?: string;
  decimals?: number;
};
const tokenMetadataCache = new Map<string, TokenMetadata>();

type TokenTradeHint = {
  channelId: string;
  routerAddress?: string;
  lastMode?: 'v2' | 'v3';
  lastBuyPath?: string[];
  lastSellPath?: string[];
  lastBuyFees?: number[];
  lastSellFees?: number[];
  updatedAt: number;
  forcedMode?: 'v2' | 'v3';
  // 失败缓存：记录哪些路由模式失败了
  v2BuyFailed?: boolean;
  v2SellFailed?: boolean;
  v3BuyFailed?: boolean;
  v3SellFailed?: boolean;
};

const tokenTradeHints = new Map<string, TokenTradeHint>();

// 持久化缓存配置
const CACHE_STORAGE_KEY = 'tokenTradeHintsCache';
const CACHE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 天
const CACHE_MAX_ENTRIES = 100; // 最多缓存 100 个代币

// 从持久化存储加载缓存
async function loadTokenTradeHintsFromStorage() {
  try {
    if (typeof chrome === 'undefined' || !chrome.storage) {
      return;
    }
    const result = await chrome.storage.local.get(CACHE_STORAGE_KEY);
    const cached = result[CACHE_STORAGE_KEY];
    if (cached && typeof cached === 'object') {
      const now = Date.now();
      let loadedCount = 0;
      for (const [key, hint] of Object.entries(cached)) {
        // 过滤过期的缓存（7 天）
        if (hint && typeof hint === 'object' && hint.updatedAt && (now - hint.updatedAt < CACHE_MAX_AGE_MS)) {
          tokenTradeHints.set(key, hint as TokenTradeHint);
          loadedCount++;
        }
      }
      logger.debug(`[Cache] 从存储加载 ${loadedCount} 个代币路由缓存`);
    }
  } catch (error) {
    logger.warn('[Cache] 加载路由缓存失败:', error);
  }
}

// 保存缓存到持久化存储
async function saveTokenTradeHintsToStorage() {
  try {
    if (typeof chrome === 'undefined' || !chrome.storage) {
      return;
    }
    const now = Date.now();
    const cacheObject: Record<string, TokenTradeHint> = {};

    // 转换 Map 为普通对象，并清理过期数据
    const entries = Array.from(tokenTradeHints.entries())
      .filter(([_, hint]) => now - hint.updatedAt < CACHE_MAX_AGE_MS)
      .sort((a, b) => b[1].updatedAt - a[1].updatedAt) // 按更新时间降序
      .slice(0, CACHE_MAX_ENTRIES); // 只保留最新的 100 个

    for (const [key, hint] of entries) {
      cacheObject[key] = hint;
    }

    await chrome.storage.local.set({ [CACHE_STORAGE_KEY]: cacheObject });
    logger.debug(`[Cache] 保存 ${entries.length} 个代币路由缓存到存储`);
  } catch (error) {
    logger.warn('[Cache] 保存路由缓存失败:', error);
  }
}

// 初始化时加载缓存
loadTokenTradeHintsFromStorage().catch((error) => {
  logger.warn('[Cache] 初始化加载缓存失败:', error);
});

// ========== 通用工具函数 ==========
function toChecksumAddress(address?: string | null, context = 'address'): `0x${string}` | null {
  if (!address) return null;
  const normalized = address.trim();
  if (!normalized) return null;
  try {
    return getAddress(normalized as `0x${string}`);
  } catch (error) {
    try {
      return getAddress(normalized.toLowerCase() as `0x${string}`);
    } catch (finalError) {
      logger.warn(`[Channel] 无效地址(${context}): ${address}`, finalError?.message || finalError);
      return null;
    }
  }
}

function normalizeTokenKey(address?: string | null) {
  if (!address) return '';
  return address.trim().toLowerCase();
}

function updateTokenTradeHint(tokenAddress: string, channelId: string, direction: 'buy' | 'sell', info: { routerAddress?: string; path?: string[]; fees?: number[]; mode?: 'v2' | 'v3' }) {
  const key = normalizeTokenKey(tokenAddress);
  if (!key) {
    return;
  }
  const existing = tokenTradeHints.get(key);
  const next: TokenTradeHint = {
    channelId,
    routerAddress: info.routerAddress ?? existing?.routerAddress,
    lastBuyPath: existing?.lastBuyPath,
    lastSellPath: existing?.lastSellPath,
    lastBuyFees: existing?.lastBuyFees,
    lastSellFees: existing?.lastSellFees,
    updatedAt: Date.now(),
    lastMode: info.mode ?? existing?.lastMode,
    forcedMode: existing?.forcedMode,
    // 保留失败状态
    v2BuyFailed: existing?.v2BuyFailed,
    v2SellFailed: existing?.v2SellFailed,
    v3BuyFailed: existing?.v3BuyFailed,
    v3SellFailed: existing?.v3SellFailed
  };
  if (direction === 'buy' && info.path) {
    next.lastBuyPath = info.path;
    next.lastBuyFees = info.fees;
  } else if (direction === 'sell' && info.path) {
    next.lastSellPath = info.path;
    next.lastSellFees = info.fees;
  }

  tokenTradeHints.set(key, next);

  // 异步保存到持久化存储（不阻塞主流程）
  saveTokenTradeHintsToStorage().catch((error) => {
    logger.debug('[Cache] 保存缓存失败:', error);
  });
}

// 更新路由失败状态
function updateRouteFailureStatus(
  tokenAddress: string,
  direction: 'buy' | 'sell',
  status: { v2Failed: boolean; v3Failed: boolean }
) {
  const key = normalizeTokenKey(tokenAddress);
  if (!key) {
    return;
  }
  const existing = tokenTradeHints.get(key);
  const next: TokenTradeHint = existing
    ? { ...existing }
    : {
        channelId: 'pancake',
        updatedAt: Date.now()
      };

  if (direction === 'buy') {
    next.v2BuyFailed = status.v2Failed;
    next.v3BuyFailed = status.v3Failed;
  } else {
    next.v2SellFailed = status.v2Failed;
    next.v3SellFailed = status.v3Failed;
  }
  next.updatedAt = Date.now();

  tokenTradeHints.set(key, next);

  // 异步保存到持久化存储
  saveTokenTradeHintsToStorage().catch((error) => {
    logger.debug('[Cache] 保存缓存失败:', error);
  });
}

export function getTokenTradeHint(tokenAddress: string) {
  const key = normalizeTokenKey(tokenAddress);
  return key ? tokenTradeHints.get(key) ?? null : null;
}

export function setPancakePreferredMode(tokenAddress: string, mode: 'v2' | 'v3' | null) {
  const key = normalizeTokenKey(tokenAddress);
  if (!key) {
    return;
  }
  const existing = tokenTradeHints.get(key);
  if (!mode) {
    if (existing?.forcedMode) {
      const next = { ...existing };
      delete next.forcedMode;
      tokenTradeHints.set(key, next);
      // 异步保存到持久化存储
      saveTokenTradeHintsToStorage().catch((error) => {
        logger.debug('[Cache] 保存缓存失败:', error);
      });
    }
    return;
  }
  const base: TokenTradeHint = existing
    ? { ...existing }
    : {
        channelId: 'pancake',
        updatedAt: Date.now()
      };
  base.forcedMode = mode;
  base.updatedAt = Date.now();
  tokenTradeHints.set(key, base);

  // 异步保存到持久化存储
  saveTokenTradeHintsToStorage().catch((error) => {
    logger.debug('[Cache] 保存缓存失败:', error);
  });
}

function extractFirstBigInt(result: any) {
  if (typeof result === 'bigint') {
    return result;
  }
  if (Array.isArray(result) && result.length > 0) {
    const value = result[0];
    return typeof value === 'bigint' ? value : 0n;
  }
  if (result && typeof result === 'object') {
    if (typeof result.amountOut === 'bigint') {
      return result.amountOut;
    }
    if (typeof result[0] === 'bigint') {
      return result[0];
    }
  }
  return 0n;
}

/**
 * 准备代币卖出：获取余额、授权状态、计算卖出数量
 */
type PrepareTokenSellParams = {
  publicClient: any;
  tokenAddress: string;
  accountAddress: string;
  spenderAddress: string;
  percent: number;
  tokenInfo?: any;
  options?: {
    requireGweiPrecision?: boolean;
  };
};

function alignAmountToGweiPrecision(amount: bigint, decimals?: number) {
  if (amount <= 0n) {
    return amount;
  }
  const tokenDecimals = typeof decimals === 'number' && decimals >= 0 ? decimals : 18;
  if (tokenDecimals <= GWEI_DECIMALS) {
    return amount;
  }
  const precisionUnit = 10n ** BigInt(tokenDecimals - GWEI_DECIMALS);
  if (precisionUnit <= 1n) {
    return amount;
  }
  return amount - (amount % precisionUnit);
}

export async function prepareTokenSell({ publicClient, tokenAddress, accountAddress, spenderAddress, percent, tokenInfo, options }: PrepareTokenSellParams) {
  const requireGweiPrecision = Boolean(options?.requireGweiPrecision);
  // 使用缓存的信息或重新查询
  let balance, allowance, totalSupply;
  let decimals: number | undefined;

  if (tokenInfo && tokenInfo.balance && tokenInfo.allowance !== undefined) {
    // 使用前端缓存的信息（性能优化）
    balance = BigInt(tokenInfo.balance);
    allowance = BigInt(tokenInfo.allowance);
    totalSupply = BigInt(tokenInfo.totalSupply);
    if (requireGweiPrecision && tokenInfo.decimals !== undefined) {
      decimals = Number(tokenInfo.decimals);
    }
    logger.debug('[prepareTokenSell] 使用缓存的代币信息');
  } else {
    // 降级到重新查询
    logger.debug('[prepareTokenSell] 缓存不可用，重新查询代币信息');
    const state = await fetchTokenState(
      publicClient,
      tokenAddress,
      accountAddress,
      spenderAddress,
      { includeDecimals: requireGweiPrecision }
    );
    balance = state.balance;
    allowance = state.allowance;
    totalSupply = state.totalSupply;
    if (requireGweiPrecision) {
      decimals = state.decimals;
    }
  }

  if (balance === 0n) {
    throw new Error('代币余额为 0');
  }

  // 计算卖出数量
  let amountToSell = percent === 100
    ? balance  // 100%直接使用余额，避免精度损失
    : balance * BigInt(percent) / 100n;

  if (requireGweiPrecision) {
    amountToSell = alignAmountToGweiPrecision(amountToSell, decimals);
    if (amountToSell <= 0n) {
      throw new Error('卖出数量过小，无法满足 Four.meme 的 Gwei 精度限制');
    }
  }

  return { balance, allowance, totalSupply, amountToSell };
}

/**
 * 确保代币授权：如果授权不足则执行授权
 */
type NonceExecutor = <T>(label: string, sender: (nonce: number) => Promise<T>) => Promise<T>;

async function ensureTokenApproval({
  publicClient,
  walletClient,
  account,
  chain,
  tokenAddress,
  spenderAddress,
  amount,
  currentAllowance,
  totalSupply,
  gasPrice,
  nonceExecutor
}: {
  publicClient: any;
  walletClient: any;
  account: any;
  chain: any;
  tokenAddress: string;
  spenderAddress: string;
  amount: bigint;
  currentAllowance: bigint;
  totalSupply: bigint;
  gasPrice?: number | bigint;
  nonceExecutor?: NonceExecutor;
}) {
  if (currentAllowance < amount) {
    logger.debug(`[ensureTokenApproval] 授权代币给 ${spenderAddress.slice(0, 6)}...`);
    const sendApprove = (nonce?: number) =>
      sendContractTransaction({
        walletClient,
        account,
        chain,
        to: tokenAddress,
        abi: ERC20_ABI,
        functionName: 'approve',
        args: [spenderAddress, totalSupply],
        gasPrice,
        fallbackGasLimit: BigInt(TX_CONFIG.GAS_LIMIT.APPROVE),
        nonce
      });
    const approveHash = nonceExecutor
      ? await nonceExecutor('approve', (nonce) => sendApprove(nonce))
      : await sendApprove();
    await publicClient.waitForTransactionReceipt({ hash: approveHash });
    logger.debug('[ensureTokenApproval] 授权完成');

    // 授权成功后更新缓存
    setCachedAllowance(tokenAddress, spenderAddress, totalSupply);
  }
}

function uniquePaths(paths: string[][]) {
  const seen = new Set<string>();
  return paths.filter((path) => {
    const key = path.map((a) => a.toLowerCase()).join('-');
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function encodeV3Path(tokens: string[], fees: number[]) {
  if (!tokens?.length || tokens.length !== fees.length + 1) {
    throw new Error('[V3] 无效的路径定义');
  }
  const parts: string[] = [];
  tokens.forEach((token, index) => {
    const normalized = token.replace(/^0x/i, '').toLowerCase().padStart(40, '0');
    parts.push(normalized);
    if (index < fees.length) {
      const feeHex = Number(fees[index]).toString(16).padStart(6, '0');
      parts.push(feeHex);
    }
  });
  return `0x${parts.join('')}`;
}

async function sendContractTransaction({
  walletClient,
  account,
  chain,
  to,
  abi,
  functionName,
  args,
  value = 0n,
  gasPrice,
  fallbackGasLimit,
  publicClient = null,
  dynamicGas,
  nonce
}: {
  walletClient: any;
  account: any;
  chain: any;
  to: string;
  abi: any;
  functionName: string;
  args: any[];
  value?: bigint;
  gasPrice?: number | bigint;
  fallbackGasLimit?: bigint;
  publicClient?: any;
  dynamicGas?: DynamicGasOptions;
  nonce?: number;
}) {
  const request: any = {
    account,
    chain,
    to,
    data: encodeFunctionData({ abi, functionName, args }),
    value
  };

  if (typeof nonce === 'number' && Number.isFinite(nonce)) {
    request.nonce = BigInt(nonce);
  }
  if (typeof gasPrice === 'number' && Number.isFinite(gasPrice) && gasPrice > 0) {
    request.gasPrice = toWeiFromGwei(gasPrice);
  } else if (typeof gasPrice === 'bigint') {
    request.gasPrice = gasPrice;
  }

  let shouldRefreshDynamicGas = false;
  if (dynamicGas?.enabled && publicClient) {
    const cacheEntry = dynamicGasCache.get(dynamicGas.key);
    const effectiveTtl = dynamicGas.ttl ?? DYNAMIC_GAS_CACHE_TTL;
    if (cacheEntry && Date.now() - cacheEntry.updatedAt < effectiveTtl) {
      request.gas = cacheEntry.gas;
    } else if (fallbackGasLimit) {
      request.gas = fallbackGasLimit;
      shouldRefreshDynamicGas = true;
    } else {
      shouldRefreshDynamicGas = true;
    }

    if (shouldRefreshDynamicGas) {
      const estimationRequest = { ...request };
      delete estimationRequest.gas;
      resolveDynamicGasLimit(publicClient, estimationRequest, dynamicGas).catch((error) =>
        logger.debug(`[Channel] 动态 Gas 刷新失败 (${functionName}):`, error?.message || error)
      );
    }
  }

  try {
    return await walletClient.sendTransaction(request);
  } catch (error) {
    if (!fallbackGasLimit) {
      throw error;
    }

    logger.debug(`[Channel] sendTransaction 失败 (${functionName})，使用 fallback gas 重新尝试:`, error?.message || error);

    return await walletClient.sendTransaction({
      ...request,
      gas: fallbackGasLimit
    });
  }
}

function getPathCacheKey(path, amountIn) {
  return `${path.join('-')}_${amountIn.toString()}`;
}

function getCachedPathAmount(path, amountIn) {
  const key = getPathCacheKey(path, amountIn);
  const cached = pathCache.get(key);
  if (cached && Date.now() - cached.time < PATH_CACHE_TTL) {
    logger.debug(`[Path Cache] 缓存命中: ${path.map(a => a.slice(0, 6)).join(' -> ')}`);
    return cached.amountOut;
  }
  if (cached) {
    pathCache.delete(key);
  }
  return null;
}

function setPathCache(path, amountIn, amountOut) {
  const key = getPathCacheKey(path, amountIn);
  pathCache.set(key, {
    time: Date.now(),
    amountOut
  });
}

async function fetchPathAmounts(publicClient, amountIn, paths, routerAddress, routerAbi, channelLabel = '[Router]') {
  const resolved = new Map<number, bigint>();
  const pending = [];

  paths.forEach((path, index) => {
    const cached = getCachedPathAmount(path, amountIn);
    if (cached !== null) {
      resolved.set(index, cached);
    } else {
      pending.push({ path, index });
    }
  });

  if (pending.length === 0) {
    return paths.map((path, index) => ({
      path,
      amountOut: resolved.get(index)
    })).filter(item => item.amountOut !== undefined);
  }

  const runFallback = async (items) => {
    await Promise.allSettled(items.map(async ({ path, index }) => {
      try {
        const cacheKey = `getAmountsOut:${getPathCacheKey(path, amountIn)}`;
        const amountsOut = await callRpcWithTransportCache(
          publicClient,
          cacheKey,
          PATH_CACHE_TTL,
          () =>
            publicClient.readContract({
              address: routerAddress,
              abi: routerAbi,
              functionName: 'getAmountsOut',
              args: [amountIn, path]
            })
        ) as bigint[];
        const amountOut = amountsOut[amountsOut.length - 1];
        setPathCache(path, amountIn, amountOut);
        resolved.set(index, amountOut);
      } catch (error) {
        logger.debug(`${channelLabel} 路径失败: ${path.map(a => a.slice(0, 6)).join(' -> ')}`);
      }
    }));
  };

  try {
    const multicallResults = await publicClient.multicall({
      allowFailure: true,
      contracts: pending.map(({ path }) => ({
        address: routerAddress,
        abi: routerAbi,
        functionName: 'getAmountsOut',
        args: [amountIn, path]
      }))
    });

    const unresolved = [];
    multicallResults.forEach((result, idx) => {
      const { path, index } = pending[idx];
      if (result.status === 'success' && Array.isArray(result.result)) {
        const amountsOut = result.result as bigint[];
        const amountOut = amountsOut[amountsOut.length - 1];
        setPathCache(path, amountIn, amountOut);
        resolved.set(index, amountOut);
      } else {
        unresolved.push({ path, index });
      }
    });

    if (unresolved.length) {
      await runFallback(unresolved);
    }
  } catch (error) {
    logger.warn(`${channelLabel} Multicall 查询失败，回退单独请求: ${error.message}`);
    await runFallback(pending);
  }

  return paths
    .map((path, index) => {
      const amountOut = resolved.get(index);
      if (amountOut === undefined) {
        return null;
      }
      return { path, amountOut };
    })
    .filter(Boolean);
}

async function fetchTokenState(publicClient, tokenAddress, ownerAddress, spenderAddress, options: { includeDecimals?: boolean } = {}) {
  const { includeDecimals = false } = options;
  const contracts = [
    {
      address: tokenAddress,
      abi: ERC20_ABI,
      functionName: 'balanceOf',
      args: [ownerAddress]
    },
    {
      address: tokenAddress,
      abi: ERC20_ABI,
      functionName: 'allowance',
      args: [ownerAddress, spenderAddress]
    },
    {
      address: tokenAddress,
      abi: ERC20_ABI,
      functionName: 'totalSupply'
    }
  ];

  if (includeDecimals) {
    contracts.push({
      address: tokenAddress,
      abi: ERC20_ABI,
      functionName: 'decimals'
    });
  }

  try {
    const results = await publicClient.multicall({
      allowFailure: false,
      contracts
    });

    const [balance, allowance, totalSupply, decimals] = results as unknown[];
    return {
      balance: balance as bigint,
      allowance: allowance as bigint,
      totalSupply: totalSupply as bigint,
      decimals: includeDecimals ? Number(decimals) : undefined
    };
  } catch (error) {
    logger.warn(`[Channel] Multicall 获取代币状态失败，回退单独请求: ${error.message}`);

    const fallbackPromises = [
      callRpcWithTransportCache(
        publicClient,
        `readContract:${tokenAddress}:balanceOf:${ownerAddress}`,
        RPC_CACHE_TTL,
        () =>
          publicClient.readContract({
            address: tokenAddress,
            abi: ERC20_ABI,
            functionName: 'balanceOf',
            args: [ownerAddress]
          })
      ),
      callRpcWithTransportCache(
        publicClient,
        `readContract:${tokenAddress}:allowance:${ownerAddress}:${spenderAddress}`,
        RPC_CACHE_TTL,
        () =>
          publicClient.readContract({
            address: tokenAddress,
            abi: ERC20_ABI,
            functionName: 'allowance',
            args: [ownerAddress, spenderAddress]
          })
      ),
      callRpcWithTransportCache(
        publicClient,
        `readContract:${tokenAddress}:totalSupply`,
        RPC_CACHE_TTL,
        () =>
          publicClient.readContract({
            address: tokenAddress,
            abi: ERC20_ABI,
            functionName: 'totalSupply'
          })
      )
    ];

    if (includeDecimals) {
      // 优先使用永久缓存
      const cacheKey = tokenAddress.toLowerCase();
      const cached = tokenMetadataCache.get(cacheKey);
      if (cached?.decimals !== undefined) {
        fallbackPromises.push(Promise.resolve(cached.decimals));
      } else {
        // 首次查询：从链上读取并永久缓存
        fallbackPromises.push(
          publicClient.readContract({
            address: tokenAddress,
            abi: ERC20_ABI,
            functionName: 'decimals'
          }).then((result: any) => {
            const decimals = Number(result);
            const existing = tokenMetadataCache.get(cacheKey) || {};
            tokenMetadataCache.set(cacheKey, { ...existing, decimals });
            return decimals;
          })
        );
      }
    }

    const results = await Promise.all(fallbackPromises);
    return {
      balance: results[0] as bigint,
      allowance: results[1] as bigint,
      totalSupply: results[2] as bigint,
      decimals: includeDecimals ? Number(results[3]) : undefined
    };
  }
}

function getPairCacheKey(factoryAddress: string, tokenA: string, tokenB: string) {
  const [a, b] = [tokenA.toLowerCase(), tokenB.toLowerCase()].sort();
  return `${factoryAddress.toLowerCase()}:${a}:${b}`;
}

async function hasPair(publicClient, factoryAddress: string, factoryAbi, tokenA: string, tokenB: string) {
  if (!factoryAddress || !factoryAbi || !tokenA || !tokenB) {
    return false;
  }
  const checksumFactory = toChecksumAddress(factoryAddress, 'factory');
  const checksumA = toChecksumAddress(tokenA, 'tokenA');
  const checksumB = toChecksumAddress(tokenB, 'tokenB');
  if (!checksumFactory || !checksumA || !checksumB || checksumA === checksumB) {
    return false;
  }

  const cacheKey = getPairCacheKey(checksumFactory, checksumA, checksumB);
  if (pairExistenceCache.has(cacheKey)) {
    return pairExistenceCache.get(cacheKey);
  }

  try {
    const pairAddress = await publicClient.readContract({
      address: checksumFactory,
      abi: factoryAbi,
      functionName: 'getPair',
      args: [checksumA, checksumB]
    });
    const exists = typeof pairAddress === 'string' && pairAddress !== ZERO_ADDRESS;
    pairExistenceCache.set(cacheKey, exists);
    return exists;
  } catch (error) {
    logger.debug(`[Channel] getPair 查询失败: ${error.message}`);
    pairExistenceCache.set(cacheKey, false);
    return false;
  }
}

function getV3PoolCacheKey(factoryAddress: string, tokenA: string, tokenB: string) {
  const [a, b] = [tokenA.toLowerCase(), tokenB.toLowerCase()].sort();
  return `${factoryAddress.toLowerCase()}:${a}:${b}`;
}

async function getV3Pool(publicClient, factoryAddress: string, factoryAbi, tokenA: string, tokenB: string) {
  if (!factoryAddress || !factoryAbi || !tokenA || !tokenB) {
    return null;
  }
  const checksumFactory = toChecksumAddress(factoryAddress, 'v3Factory');
  const checksumA = toChecksumAddress(tokenA, 'tokenA');
  const checksumB = toChecksumAddress(tokenB, 'tokenB');
  if (!checksumFactory || !checksumA || !checksumB || checksumA === checksumB) {
    return null;
  }

  const cacheKey = getV3PoolCacheKey(checksumFactory, checksumA, checksumB);
  if (v3PoolCache.has(cacheKey)) {
    return v3PoolCache.get(cacheKey);
  }

  for (const feeTier of V3_FEE_TIERS) {
    try {
      const poolAddress = await publicClient.readContract({
        address: checksumFactory,
        abi: factoryAbi,
        functionName: 'getPool',
        args: [checksumA, checksumB, feeTier]
      });
      if (typeof poolAddress === 'string' && poolAddress !== ZERO_ADDRESS) {
        const info = { fee: feeTier, pool: poolAddress };
        v3PoolCache.set(cacheKey, info);
        return info;
      }
    } catch (error) {
      logger.debug(`[V3] getPool 查询失败: ${error?.message || error}`);
    }
  }

  v3PoolCache.set(cacheKey, null);
  return null;
}

async function getDynamicBridgePaths(publicClient, tokenAddress: string, options: {
  nativeWrapper: string;
  factoryAddress?: string;
  factoryAbi?: any;
  dynamicBridgeTokens?: string[];
}) {
  const { nativeWrapper, factoryAddress, factoryAbi, dynamicBridgeTokens = [] } = options;

  if (!factoryAddress || !factoryAbi || dynamicBridgeTokens.length === 0) {
    return { buy: [], sell: [] };
  }

  const cacheKey = `${factoryAddress.toLowerCase()}:${tokenAddress.toLowerCase()}`;
  const cached = dynamicBridgeCache.get(cacheKey);
  // 永久缓存：流动池一旦创建就存在，不会消失
  if (cached) {
    return cached;
  }

  const buyPaths: string[][] = [];
  const sellPaths: string[][] = [];

  await Promise.all(dynamicBridgeTokens.map(async (bridgeToken) => {
    if (!bridgeToken || bridgeToken.toLowerCase() === tokenAddress.toLowerCase()) {
      return;
    }

    try {
      const [hasNativeBridge, hasTokenBridge] = await Promise.all([
        hasPair(publicClient, factoryAddress, factoryAbi, nativeWrapper, bridgeToken),
        hasPair(publicClient, factoryAddress, factoryAbi, tokenAddress, bridgeToken)
      ]);

      if (hasNativeBridge && hasTokenBridge) {
        buyPaths.push([nativeWrapper, bridgeToken, tokenAddress]);
        sellPaths.push([tokenAddress, bridgeToken, nativeWrapper]);
      }
    } catch (error) {
      logger.debug(`[Channel] 构建动态路径失败: ${error.message}`);
    }
  }));

  const paths = { buy: buyPaths, sell: sellPaths };
  dynamicBridgeCache.set(cacheKey, paths);
  return paths;
}

// ========== Quote Token 发现和 3-hop 路由支持 ==========

// Pair ABI - 用于查询 Pair 的 token0 和 token1
const PAIR_ABI = [
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
 * 发现代币的 quote token（募集币种）
 * 通过查询代币的 Pair 合约来获取其配对的代币
 */
async function discoverTokenQuoteToken(
  publicClient,
  factoryAddress: string,
  factoryAbi: any,
  tokenAddress: string
): Promise<string | null> {
  if (!publicClient || !factoryAddress || !factoryAbi || !tokenAddress) {
    return null;
  }

  try {
    const checksumToken = toChecksumAddress(tokenAddress, 'discoverQuote');
    if (!checksumToken) {
      return null;
    }

    // 扩展的配对代币列表，包括更多可能的 quote token
    const commonPairTokens = [
      '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c', // WBNB
      '0x55d398326f99059fF775485246999027B3197955', // USDT
      '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d', // USDC
      '0xe9e7CEA3DedcA5984780Bafc599bD69ADd087D56', // BUSD
      '0x1AF3F329e8BE154074D8769D1FFa4eE058B1DBc3', // DAI
      '0x0E09FaBB73Bd3Ade0a17ECC321fD13a19e81cE82', // CAKE
      '0x2170Ed0880ac9A755fd29B2688956BD959F933F8', // ETH
      '0x7130d2A12B9BCbFAe4f2634d864A1Ee1Ce3Ead9c', // BTCB
      // 添加更多可能的 quote token
      '0x8d0D000Ee44948FC98c9B98A4FA4921476f08B0d', // USD1
      '0xdb7a6d5a127ea5c0a3576677112f13d731232a27', // USAT
      '0xce24439f2d9c6a2289f741120fe202248b666666', // UNITED_STABLES_U
    ];

    logger.debug(`[QuoteDiscovery] 开始检测代币 ${checksumToken.slice(0, 10)} 的 quote token...`);

    for (const pairToken of commonPairTokens) {
      const checksumPairToken = toChecksumAddress(pairToken, 'pairToken');
      if (!checksumPairToken || checksumPairToken === checksumToken) {
        continue;
      }

      try {
        // 检查是否存在 Pair
        const pairAddress = await publicClient.readContract({
          address: toChecksumAddress(factoryAddress, 'factory'),
          abi: factoryAbi,
          functionName: 'getPair',
          args: [checksumToken, checksumPairToken]
        });

        if (pairAddress && pairAddress !== ZERO_ADDRESS) {
          // 找到了 Pair，查询其 token0 和 token1
          const [token0, token1] = await Promise.all([
            publicClient.readContract({
              address: pairAddress,
              abi: PAIR_ABI,
              functionName: 'token0'
            }),
            publicClient.readContract({
              address: pairAddress,
              abi: PAIR_ABI,
              functionName: 'token1'
            })
          ]);

          // 返回不是目标代币的那个（即 quote token）
          const quoteToken = token0.toLowerCase() === checksumToken.toLowerCase() ? token1 : token0;
          logger.info(`[QuoteDiscovery] ✅ 发现代币 ${checksumToken.slice(0, 10)} 的 quote token: ${quoteToken.slice(0, 10)} (Pair: ${pairAddress.slice(0, 10)})`);
          return quoteToken;
        }
      } catch (error) {
        logger.debug(`[QuoteDiscovery] 检查配对 ${checksumPairToken.slice(0, 10)} 失败: ${error?.message || error}`);
      }
    }

    logger.warn(`[QuoteDiscovery] ❌ 未找到代币 ${checksumToken.slice(0, 10)} 的 quote token`);
    return null;
  } catch (error) {
    logger.error(`[QuoteDiscovery] 发现 quote token 失败: ${error?.message || error}`);
    return null;
  }
}

/**
 * 构建 3-hop 路径
 * WBNB → Bridge → QuoteToken → Token
 */
async function build3HopPaths(
  publicClient,
  factoryAddress: string,
  factoryAbi: any,
  nativeWrapper: string,
  tokenAddress: string,
  quoteToken: string,
  bridgeTokens: string[]
): Promise<{ buy: string[][], sell: string[][] }> {
  const buyPaths: string[][] = [];
  const sellPaths: string[][] = [];

  if (!publicClient || !factoryAddress || !factoryAbi || !quoteToken) {
    return { buy: buyPaths, sell: sellPaths };
  }

  const checksumNative = toChecksumAddress(nativeWrapper, '3hopNative');
  const checksumToken = toChecksumAddress(tokenAddress, '3hopToken');
  const checksumQuote = toChecksumAddress(quoteToken, '3hopQuote');

  if (!checksumNative || !checksumToken || !checksumQuote) {
    return { buy: buyPaths, sell: sellPaths };
  }

  // 检查 QuoteToken 与 Token 的 Pair 是否存在
  const quoteTokenPairExists = await hasPair(
    publicClient,
    factoryAddress,
    factoryAbi,
    checksumQuote,
    checksumToken
  );

  if (!quoteTokenPairExists) {
    logger.warn(`[3HopPath] QuoteToken-Token Pair 不存在: ${checksumQuote.slice(0, 10)} - ${checksumToken.slice(0, 10)}`);
    return { buy: buyPaths, sell: sellPaths };
  }

  logger.debug(`[3HopPath] ✅ QuoteToken-Token Pair 存在，开始检查桥接代币...`);

  // 尝试每个桥接代币
  for (const bridge of bridgeTokens) {
    const checksumBridge = toChecksumAddress(bridge, '3hopBridge');
    if (!checksumBridge || checksumBridge === checksumNative || checksumBridge === checksumQuote || checksumBridge === checksumToken) {
      continue;
    }

    try {
      // 检查 WBNB → Bridge 和 Bridge → QuoteToken 的 Pair 是否都存在
      const [nativeBridgeExists, bridgeQuoteExists] = await Promise.all([
        hasPair(publicClient, factoryAddress, factoryAbi, checksumNative, checksumBridge),
        hasPair(publicClient, factoryAddress, factoryAbi, checksumBridge, checksumQuote)
      ]);

      if (nativeBridgeExists && bridgeQuoteExists) {
        // 构建 3-hop 路径
        const buyPath = [checksumNative, checksumBridge, checksumQuote, checksumToken];
        const sellPath = [checksumToken, checksumQuote, checksumBridge, checksumNative];

        buyPaths.push(buyPath);
        sellPaths.push(sellPath);

        logger.info(`[3HopPath] ✅ 找到有效路径: ${buyPath.map(a => a.slice(0, 6)).join(' → ')}`);
      }
    } catch (error) {
      logger.debug(`[3HopPath] 检查桥接代币 ${checksumBridge.slice(0, 10)} 失败: ${error?.message || error}`);
    }
  }

  return { buy: buyPaths, sell: sellPaths };
}

/**
 * 检测混合 V2/V3 路由
 * 检查是否存在需要同时使用 V2 和 V3 池的路径
 */
async function detectMixedV2V3Route(
  publicClient,
  v2FactoryAddress: string,
  v2FactoryAbi: any,
  v3FactoryAddress: string,
  v3FactoryAbi: any,
  startToken: string,
  targetToken: string,
  bridgeTokens: string[]
): Promise<{ description: string; v3Segment?: string; v2Segment?: string; v3First: boolean; bridgeToken: string } | null> {
  if (!publicClient || !v2FactoryAddress || !v3FactoryAddress) {
    return null;
  }

  try {
    // 检查每个桥接代币
    for (const bridge of bridgeTokens) {
      const checksumBridge = toChecksumAddress(bridge, 'mixedBridge');
      if (!checksumBridge || checksumBridge === startToken || checksumBridge === targetToken) {
        continue;
      }

      // 检查 V3: startToken → bridge
      const v3Pool = await getV3Pool(publicClient, v3FactoryAddress, v3FactoryAbi, startToken, checksumBridge);

      if (v3Pool) {
        // 检查 V2: bridge → targetToken
        const v2Pair = await hasPair(publicClient, v2FactoryAddress, v2FactoryAbi, checksumBridge, targetToken);

        if (v2Pair) {
          return {
            description: `${startToken.slice(0, 6)} → ${checksumBridge.slice(0, 6)} (V3) → ${targetToken.slice(0, 6)} (V2)`,
            v3Segment: `${startToken} → ${checksumBridge}`,
            v2Segment: `${checksumBridge} → ${targetToken}`,
            v3First: true,
            bridgeToken: checksumBridge
          };
        }
      }

      // 反向检查：V2: startToken → bridge, V3: bridge → targetToken
      const v2Pair = await hasPair(publicClient, v2FactoryAddress, v2FactoryAbi, startToken, checksumBridge);

      if (v2Pair) {
        const v3Pool2 = await getV3Pool(publicClient, v3FactoryAddress, v3FactoryAbi, checksumBridge, targetToken);

        if (v3Pool2) {
          return {
            description: `${startToken.slice(0, 6)} → ${checksumBridge.slice(0, 6)} (V2) → ${targetToken.slice(0, 6)} (V3)`,
            v2Segment: `${startToken} → ${checksumBridge}`,
            v3Segment: `${checksumBridge} → ${targetToken}`,
            v3First: false,
            bridgeToken: checksumBridge
          };
        }
      }
    }

    return null;
  } catch (error) {
    logger.debug(`[MixedRouteDetection] 检测失败: ${error?.message || error}`);
    return null;
  }
}

/**
 * 执行混合 V2/V3 路由交易（两步交易）
 * 第一步：V3 swap
 * 第二步：V2 swap
 */
async function executeMixedV2V3Trade(params: {
  publicClient: any;
  walletClient: any;
  account: any;
  chain: any;
  mixedRouteInfo: {
    description: string;
    v3Segment?: string;
    v2Segment?: string;
    v3First: boolean;
    bridgeToken: string;
  };
  direction: 'buy' | 'sell';
  amountIn: bigint;
  slippage: number;
  gasPrice?: number | bigint;
  v2RouterAddress: string;
  v2RouterAbi: any;
  v3RouterAddress: string;
  v3RouterAbi: any;
  v3FactoryAddress: string;
  v3FactoryAbi: any;
  v3QuoterAddress: string;
  v3QuoterAbi: any;
  nativeWrapper: string;
  targetToken: string;
  nonceExecutor?: any;
  channelLabel: string;
}) {
  const {
    publicClient,
    walletClient,
    account,
    chain,
    mixedRouteInfo,
    direction,
    amountIn,
    slippage,
    gasPrice,
    v2RouterAddress,
    v2RouterAbi,
    v3RouterAddress,
    v3RouterAbi,
    v3FactoryAddress,
    v3FactoryAbi,
    v3QuoterAddress,
    v3QuoterAbi,
    nativeWrapper,
    targetToken,
    nonceExecutor,
    channelLabel
  } = params;

  logger.info(`${channelLabel} 开始执行混合 V2/V3 路由交易: ${mixedRouteInfo.description}`);

  try {
    if (mixedRouteInfo.v3First) {
      // 第一步：V3 swap (WBNB → Bridge Token)
      logger.info(`${channelLabel} 第一步：V3 swap ${nativeWrapper.slice(0, 6)} → ${mixedRouteInfo.bridgeToken.slice(0, 6)}`);

      // 获取 V3 池信息
      const v3Pool = await getV3Pool(
        publicClient,
        v3FactoryAddress,
        v3FactoryAbi,
        nativeWrapper,
        mixedRouteInfo.bridgeToken
      );

      if (!v3Pool) {
        throw new Error('V3 池不存在');
      }

      // 获取预期输出
      const quoteResult = await publicClient.readContract({
        address: v3QuoterAddress,
        abi: v3QuoterAbi,
        functionName: 'quoteExactInputSingle',
        args: [{
          tokenIn: nativeWrapper,
          tokenOut: mixedRouteInfo.bridgeToken,
          amountIn,
          fee: v3Pool.fee,
          sqrtPriceLimitX96: 0n
        }]
      });

      const bridgeAmountOut = extractFirstBigInt(quoteResult);
      const bridgeAmountOutMin = bridgeAmountOut * BigInt(10000 - slippage * 100) / 10000n;

      logger.debug(`${channelLabel} V3 预期输出: ${bridgeAmountOut.toString()}, 最小: ${bridgeAmountOutMin.toString()}`);

      // 执行 V3 swap
      const deadline = BigInt(Math.floor(Date.now() / 1000) + TX_CONFIG.DEADLINE_SECONDS);

      const v3SwapData = encodeFunctionData({
        abi: v3RouterAbi,
        functionName: 'exactInputSingle',
        args: [{
          tokenIn: nativeWrapper,
          tokenOut: mixedRouteInfo.bridgeToken,
          fee: v3Pool.fee,
          recipient: account.address,
          amountIn,
          amountOutMinimum: bridgeAmountOutMin,
          sqrtPriceLimitX96: 0n
        }]
      });

      const v3TxHash = await sendContractTransaction({
        walletClient,
        account,
        chain,
        to: v3RouterAddress,
        abi: v3RouterAbi,
        functionName: 'exactInputSingle',
        args: [{
          tokenIn: nativeWrapper,
          tokenOut: mixedRouteInfo.bridgeToken,
          fee: v3Pool.fee,
          recipient: account.address,
          amountIn,
          amountOutMinimum: bridgeAmountOutMin,
          sqrtPriceLimitX96: 0n
        }],
        value: amountIn,
        gasPrice,
        fallbackGasLimit: 500000n,
        publicClient
      });

      logger.info(`${channelLabel} V3 交易已发送: ${v3TxHash}`);

      // 等待第一步交易确认
      logger.info(`${channelLabel} 等待 V3 交易确认...`);
      const v3Receipt = await publicClient.waitForTransactionReceipt({
        hash: v3TxHash,
        confirmations: 1
      });

      if (v3Receipt.status !== 'success') {
        throw new Error('V3 交易失败');
      }

      logger.info(`${channelLabel} ✅ V3 交易确认成功`);

      // 查询实际获得的桥接代币数量
      const bridgeBalance = await publicClient.readContract({
        address: mixedRouteInfo.bridgeToken,
        abi: ERC20_ABI,
        functionName: 'balanceOf',
        args: [account.address]
      });

      logger.info(`${channelLabel} 获得桥接代币: ${bridgeBalance.toString()}`);

      // 第二步：V2 swap (Bridge Token → Target Token)
      logger.info(`${channelLabel} 第二步：V2 swap ${mixedRouteInfo.bridgeToken.slice(0, 6)} → ${targetToken.slice(0, 6)}`);

      // 检查并授权桥接代币
      const currentAllowance = await publicClient.readContract({
        address: mixedRouteInfo.bridgeToken,
        abi: ERC20_ABI,
        functionName: 'allowance',
        args: [account.address, v2RouterAddress]
      });

      const totalSupply = await publicClient.readContract({
        address: mixedRouteInfo.bridgeToken,
        abi: ERC20_ABI,
        functionName: 'totalSupply'
      });

      await ensureTokenApproval({
        publicClient,
        walletClient,
        account,
        chain,
        tokenAddress: mixedRouteInfo.bridgeToken,
        spenderAddress: v2RouterAddress,
        amount: bridgeBalance,
        currentAllowance,
        totalSupply,
        gasPrice,
        nonceExecutor
      });

      // 执行 V2 swap
      const v2Path = [mixedRouteInfo.bridgeToken, targetToken];
      const v2AmountOutMin = 0n; // 已经在 V3 中考虑了滑点

      const v2Deadline = BigInt(Math.floor(Date.now() / 1000) + TX_CONFIG.DEADLINE_SECONDS);

      const v2TxHash = await sendContractTransaction({
        walletClient,
        account,
        chain,
        to: v2RouterAddress,
        abi: v2RouterAbi,
        functionName: 'swapExactTokensForTokens',
        args: [bridgeBalance, v2AmountOutMin, v2Path, account.address, v2Deadline],
        value: 0n,
        gasPrice,
        fallbackGasLimit: 300000n,
        publicClient
      });

      logger.info(`${channelLabel} V2 交易已发送: ${v2TxHash}`);
      logger.info(`${channelLabel} ✅ 混合路由交易完成`);

      return v2TxHash;
    } else {
      // V2 first, then V3
      throw new Error('暂不支持 V2 → V3 的混合路由');
    }
  } catch (error) {
    logger.error(`${channelLabel} 混合路由交易失败: ${error?.message || error}`);
    throw error;
  }
}

type DynamicGasOptions = {
  enabled?: boolean;
  key: string;
  bufferBps?: number;
  minGas?: bigint;
  ttl?: number;
};

function isBenignDynamicGasError(error: any) {
  const text = `${error?.shortMessage || ''} ${error?.details || ''} ${error?.message || ''}`.toLowerCase();
  if (!text) {
    return false;
  }
  return (
    text.includes('transferhelper: transfer_from_failed') ||
    text.includes('transfer amount exceeds balance') ||
    text.includes('insufficient allowance') ||
    text.includes('insufficient funds') ||
    text.includes('execution reverted')
  );
}

async function resolveDynamicGasLimit(publicClient, request, options: DynamicGasOptions) {
  if (!options?.enabled || !options.key || !publicClient) {
    return null;
  }

  const cacheEntry = dynamicGasCache.get(options.key);
  const effectiveTtl = options.ttl ?? DYNAMIC_GAS_CACHE_TTL;
  if (cacheEntry && Date.now() - cacheEntry.updatedAt < effectiveTtl) {
    return cacheEntry.gas;
  }

  let estimate: bigint;
  try {
    estimate = await publicClient.estimateGas({
      account: request.account,
      to: request.to,
      data: request.data,
      value: request.value
    });
  } catch (error) {
    if (!isBenignDynamicGasError(error)) {
      throw error;
    }
    const fallbackGas = typeof request?.gas === 'bigint'
      ? request.gas
      : (options.minGas ?? 0n);
    if (fallbackGas > 0n) {
      dynamicGasCache.set(options.key, { gas: fallbackGas, updatedAt: Date.now() });
      logger.debug(`[Channel] 动态 Gas 估算失败，使用兜底值 (${options.key}):`, error?.message || error);
      return fallbackGas;
    }
    logger.debug(`[Channel] 动态 Gas 估算失败(${options.key}):`, error?.message || error);
    return null;
  }

  const bufferBps = options.bufferBps ?? 1000; // 默认 10% buffer
  let buffered = estimate + (estimate * BigInt(bufferBps) / 10000n) + 10000n;
  const minGas = options.minGas ?? 200000n;
  if (buffered < minGas) {
    buffered = minGas;
  }

  dynamicGasCache.set(options.key, { gas: buffered, updatedAt: Date.now() });
  return buffered;
}

type BuyActionParams = {
  publicClient: any;
  walletClient: any;
  account: any;
  chain: any;
  tokenAddress: string;
  amount: string;
  slippage: number;
  gasPrice?: number | bigint;
  nonceExecutor: NonceExecutor;
};

type SellActionParams = {
  publicClient: any;
  walletClient: any;
  account: any;
  chain: any;
  tokenAddress: string;
  percent: number;
  slippage: number;
  gasPrice?: number | bigint;
  tokenInfo?: any;
  nonceExecutor: NonceExecutor;
};

type SellQuoteParams = {
  publicClient: any;
  tokenAddress: string;
  amount: bigint;
};

type TradingChannel = {
  buy(params: BuyActionParams): Promise<string>;
  sell(params: SellActionParams): Promise<string>;
  quoteSell?(params: SellQuoteParams): Promise<bigint | null>;
};

type RouterChannelOptions = {
  nativeWrapper: string;
  stableTokens?: string[];
  helperTokens?: string[];
  buyFunction?: string;
  sellFunction?: string;
  factoryAddress?: string;
  factoryAbi?: any;
  dynamicBridgeTokens?: string[];
  smartRouterAddress?: string;
  smartRouterAbi?: any;
  v3FactoryAddress?: string;
  v3FactoryAbi?: any;
  v3QuoterAddress?: string;
  v3QuoterAbi?: any;
};

type RouterChannelDefinition = {
  id: string;
  name?: string;
  type: 'router';
  contractAddress: string;
  abi: any;
  gasLimit: number;
  options: RouterChannelOptions;
};

type TokenManagerChannelDefinition = {
  id: string;
  name?: string;
  type: 'tokenManager';
  contractAddress: string;
  abi: any;
  gasLimit: number;
  buyFunction: string;
  sellFunction: string;
  buyMinAmountOut?: bigint;
  sellMinFunds?: bigint;
  buyValueMode?: 'amountIn' | 'none';
  buildBuyArgs?: (params: { tokenAddress: string; amountIn: bigint; minAmountOut: bigint; deadline: number }) => any[];
  buildSellArgs?: (params: { tokenAddress: string; amount: bigint; minFunds: bigint; deadline: number }) => any[];
};

type QuotePortalChannelDefinition = {
  id: string;
  name?: string;
  type: 'quotePortal';
  contractAddress: string;
  abi: any;
  gasLimit: number;
  options?: {
    nativeTokenAddress?: string;
    quoteFunction?: string;
    swapFunction?: string;
  };
};

type AliasChannelDefinition = {
  id: string;
  name?: string;
  type: 'alias';
  aliasOf: string;
};

type ChannelDefinition = RouterChannelDefinition | TokenManagerChannelDefinition | QuotePortalChannelDefinition | AliasChannelDefinition;

type ChannelBuilder = (definition: ChannelDefinition) => TradingChannel;

function createChannelFactory(builders: Record<string, ChannelBuilder>) {
  return function instantiateChannels(definitions: Record<string, ChannelDefinition>) {
    const instances: Record<string, TradingChannel> = {};
    const aliases: AliasChannelDefinition[] = [];

    Object.values(definitions).forEach((definition) => {
      if (!definition) {
        return;
      }

      if (definition.type === 'alias') {
        aliases.push(definition);
        return;
      }

      const builder = builders[definition.type];
      if (!builder) {
        throw new Error(`未注册的通道策略: ${definition.type}`);
      }

      instances[definition.id] = builder(definition);
    });

    aliases.forEach((aliasDef) => {
      const target = instances[aliasDef.aliasOf];
      if (!target) {
        throw new Error(`别名通道 ${aliasDef.id} 指向未知通道: ${aliasDef.aliasOf}`);
      }
      instances[aliasDef.id] = target;
    });

    return instances;
  };
}

function getPathTemplates(direction: 'buy' | 'sell', tokenAddress: string, nativeWrapper: string, stableTokens: string[], helperTokens: string[]) {
  const tokenLower = tokenAddress.toLowerCase();
  const directPath = direction === 'buy'
    ? [nativeWrapper, tokenAddress]
    : [tokenAddress, nativeWrapper];

  const stablePaths = stableTokens.map((stable) => direction === 'buy'
    ? [nativeWrapper, stable, tokenAddress]
    : [tokenAddress, stable, nativeWrapper]
  );

  const helperPaths = helperTokens
    .filter((helper) => helper.toLowerCase() !== tokenLower)
    .map((helper) => direction === 'buy'
      ? [nativeWrapper, helper, tokenAddress]
      : [tokenAddress, helper, nativeWrapper]
    );

  const bridgeHelperPaths: string[][] = [];
  helperTokens.forEach((helper) => {
    if (!helper) return;
    const helperLower = helper.toLowerCase();
    stableTokens.forEach((stable) => {
      if (!stable) return;
      const stableLower = stable.toLowerCase();
      if (stableLower === helperLower || stableLower === tokenLower) {
        return;
      }
      if (direction === 'buy') {
        bridgeHelperPaths.push([nativeWrapper, stable, helper, tokenAddress]);
      } else {
        bridgeHelperPaths.push([tokenAddress, helper, stable, nativeWrapper]);
      }
    });
  });

  const alternativePaths = uniquePaths([
    ...stablePaths,
    ...helperPaths,
    ...bridgeHelperPaths
  ]);

  return { directPath, alternativePaths };
}

function createRouterChannel(definition: RouterChannelDefinition): TradingChannel {
  const {
    contractAddress,
    abi,
    gasLimit,
    options: {
      nativeWrapper,
      stableTokens = [],
      helperTokens: baseHelperTokens = [],
      buyFunction = 'swapExactETHForTokens',
      sellFunction = 'swapExactTokensForETH',
      factoryAddress,
      factoryAbi,
      dynamicBridgeTokens: baseDynamicBridgeTokens = [],
      smartRouterAddress,
      smartRouterAbi,
      v3FactoryAddress,
      v3FactoryAbi,
      v3QuoterAddress,
      v3QuoterAbi
    }
  } = definition;
  const helperTokenPool = baseHelperTokens.slice();
  const dynamicBridgeTokenPool = baseDynamicBridgeTokens.slice();
  if (definition.id === 'pancake') {
    const extraTokens = getFourHelperTokenList();
    extraTokens.forEach((token) => {
      if (!token) return;
      const normalized = token.toLowerCase();
      if (!helperTokenPool.some((existing) => existing?.toLowerCase() === normalized)) {
        helperTokenPool.push(token);
      }
      if (!dynamicBridgeTokenPool.some((existing) => existing?.toLowerCase() === normalized)) {
        dynamicBridgeTokenPool.push(token);
      }
    });
  }
  const channelLabel = `[${definition.name || definition.id}]`;
  const channelId = definition.id;
  const fallbackGasLimit = BigInt(gasLimit ?? TX_CONFIG.GAS_LIMIT.PANCAKE_SWAP);

  const findBestV2Path = async (
    direction: 'buy' | 'sell',
    publicClient,
    tokenAddress: string,
    amountIn: bigint,
    preferredPath?: string[]
  ) => {
    if (preferredPath && preferredPath.length >= 2) {
      try {
        const preferredResults = await fetchPathAmounts(
          publicClient,
          amountIn,
          [preferredPath],
          contractAddress,
          abi,
          channelLabel
        );
        if (preferredResults.length > 0 && preferredResults[0].amountOut > 0n) {
          logger.debug(`${channelLabel} 缓存路径命中: ${preferredPath.map(a => a.slice(0, 6)).join(' -> ')}`);
          return { path: preferredPath, amountOut: preferredResults[0].amountOut };
        }
      } catch (error) {
        logger.debug(`${channelLabel} 缓存路径失效，重新搜索: ${error?.message || error}`);
      }
    }

    const dynamicPaths = await getDynamicBridgePaths(publicClient, tokenAddress, {
      nativeWrapper,
      factoryAddress,
      factoryAbi,
      dynamicBridgeTokens: dynamicBridgeTokenPool
    });
    const { directPath, alternativePaths: staticAlternativePaths } = getPathTemplates(
      direction,
      tokenAddress,
      nativeWrapper,
      stableTokens,
      helperTokenPool
    );
    const alternativePaths = uniquePaths([
      ...dynamicPaths[direction],
      ...staticAlternativePaths
    ]);

    // 🚀 性能优化：直接路径成功后不再尝试其他路径
    // 原因：尝试所有路径会浪费大量时间（每个路径需要 RPC 调用）
    // 只有在直接路径失败时才尝试其他路径
    const shouldEvaluateAlternativesOnSuccess = false;

    if (TX_CONFIG.PATH_OPTIMIZATION.SMART_PATH_ENABLED) {
      try {
        const directResults = await fetchPathAmounts(
          publicClient,
          amountIn,
          [directPath],
          contractAddress,
          abi,
          channelLabel
        );

        if (directResults.length > 0 && directResults[0].amountOut > 0n) {
          logger.debug(`${channelLabel} 直接路径成功: ${directResults[0].amountOut.toString()}`);
          let bestPath = directPath;
          let bestAmountOut = directResults[0].amountOut;

          if (!shouldEvaluateAlternativesOnSuccess) {
            return { path: bestPath, amountOut: bestAmountOut };
          }

          const altResults = await fetchPathAmounts(
            publicClient,
            amountIn,
            alternativePaths,
            contractAddress,
            abi,
            channelLabel
          );

          for (const result of altResults) {
            if (result && result.amountOut > bestAmountOut) {
              bestAmountOut = result.amountOut;
              bestPath = result.path;
              logger.debug(`${channelLabel} 找到更优路径: ${result.path.map(a => a.slice(0, 6)).join(' -> ')}`);
            }
          }

          return { path: bestPath, amountOut: bestAmountOut };
        }
      } catch (error) {
        logger.debug(`${channelLabel} 直接路径失败，尝试全部路径`);
      }
    }

    const evaluatedPaths = uniquePaths([directPath, ...alternativePaths]);
    const results = await fetchPathAmounts(
      publicClient,
      amountIn,
      evaluatedPaths,
      contractAddress,
      abi,
      channelLabel
    );

    let bestPath = null;
    let bestAmountOut = 0n;

    for (const result of results) {
      if (result && result.amountOut > bestAmountOut) {
        bestAmountOut = result.amountOut;
        bestPath = result.path;
      }
    }

    if (!bestPath) {
      // 回退机制：尝试发现代币的 quote token 并构建 3-hop 路径
      logger.info(`${channelLabel} 标准路径失败，尝试发现 quote token...`);

      try {
        const quoteToken = await discoverTokenQuoteToken(
          publicClient,
          factoryAddress,
          factoryAbi,
          tokenAddress
        );

        if (quoteToken) {
          logger.info(`${channelLabel} ✅ 发现 quote token: ${quoteToken.slice(0, 10)}`);

          // 构建 3-hop 路径
          const allBridgeTokens = [
            ...(stableTokens || []),
            ...(helperTokenPool || []),
            ...(dynamicBridgeTokenPool || [])
          ];

          logger.debug(`${channelLabel} 使用 ${allBridgeTokens.length} 个桥接代币构建 3-hop 路径...`);

          const threeHopPaths = await build3HopPaths(
            publicClient,
            factoryAddress,
            factoryAbi,
            nativeWrapper,
            tokenAddress,
            quoteToken,
            allBridgeTokens
          );

          if (threeHopPaths[direction].length > 0) {
            logger.info(`${channelLabel} ✅ 找到 ${threeHopPaths[direction].length} 个 3-hop 路径`);

            // 评估 3-hop 路径
            const threeHopResults = await fetchPathAmounts(
              publicClient,
              amountIn,
              threeHopPaths[direction],
              contractAddress,
              abi,
              channelLabel
            );

            for (const result of threeHopResults) {
              if (result && result.amountOut > bestAmountOut) {
                bestAmountOut = result.amountOut;
                bestPath = result.path;
                logger.info(`${channelLabel} ✅ 找到有效 3-hop 路径: ${result.path.map(a => a.slice(0, 6)).join(' → ')}, 输出: ${result.amountOut.toString()}`);
              }
            }

            if (!bestPath) {
              logger.warn(`${channelLabel} ❌ 3-hop 路径评估失败，所有路径输出为 0`);
            }
          } else {
            logger.warn(`${channelLabel} ❌ 未找到有效的 3-hop 路径`);
          }
        } else {
          logger.warn(`${channelLabel} ❌ 未发现 quote token`);
        }
      } catch (error) {
        logger.error(`${channelLabel} 3-hop 路径回退失败: ${error?.message || error}`);
      }
    }

    if (!bestPath) {
      // 检查是否检测到混合路由
      const mixedRouteInfo = (globalThis as any).__mixedRouteDetected;
      if (mixedRouteInfo) {
        throw new Error(
          `${channelLabel} 此代币需要混合 V2/V3 路由（${mixedRouteInfo.description}），` +
          `当前系统暂不支持。请使用 PancakeSwap 官网 (https://pancakeswap.finance) 或其他聚合器进行交易。`
        );
      }
      throw new Error(`${channelLabel} 所有路径都失败，代币可能没有流动性`);
    }

    return { path: bestPath, amountOut: bestAmountOut };
  };

  type V3RoutePlan = {
    tokens: string[];
    fees: number[];
    encodedPath?: string;
    amountOut: bigint;
  };

  const hasSmartRouterSupport = Boolean(
    smartRouterAddress &&
    smartRouterAbi &&
    v3FactoryAddress &&
    v3FactoryAbi &&
    v3QuoterAddress &&
    v3QuoterAbi
  );

  const findBestV3Route = async (
    direction: 'buy' | 'sell',
    publicClient,
    tokenAddress: string,
    amountIn: bigint
  ): Promise<V3RoutePlan | null> => {
    if (!hasSmartRouterSupport || !publicClient || !tokenAddress || !amountIn || amountIn <= 0n) {
      return null;
    }

    const startToken = direction === 'buy' ? nativeWrapper : tokenAddress;
    const targetToken = direction === 'buy' ? tokenAddress : nativeWrapper;
    const startChecksum = toChecksumAddress(startToken, 'v3Start');
    const targetChecksum = toChecksumAddress(targetToken, 'v3Target');
    if (!startChecksum || !targetChecksum || startChecksum === targetChecksum) {
      return null;
    }

    const bridgeCandidates = new Set<string>();
    [...(stableTokens || []), ...(helperTokenPool || []), ...(dynamicBridgeTokenPool || [])].forEach((token) => {
      const normalized = toChecksumAddress(token, 'v3Bridge');
      if (normalized && normalized !== startChecksum && normalized !== targetChecksum) {
        bridgeCandidates.add(normalized);
      }
    });

    const evaluateDirectRoute = async () => {
      const directStartTime = Date.now();
      logger.debug(`${channelLabel} 开始评估 V3 直接路由...`);

      try {
        // 超时包装器：直接路由评估最多 3 秒
        const timeoutPromise = new Promise<null>((_, reject) => {
          setTimeout(() => reject(new Error('timeout')), 3000);
        });

        const evaluationPromise = (async () => {
          const poolInfo = await getV3Pool(publicClient, v3FactoryAddress, v3FactoryAbi, startChecksum, targetChecksum);
          if (!poolInfo) {
            logger.debug(`${channelLabel} V3 直接池不存在，耗时: ${Date.now() - directStartTime}ms`);
            return null;
          }

          const result = await publicClient.readContract({
            address: v3QuoterAddress,
            abi: v3QuoterAbi,
            functionName: 'quoteExactInputSingle',
            args: [{
              tokenIn: startChecksum,
              tokenOut: targetChecksum,
              amountIn,
              fee: poolInfo.fee,
              sqrtPriceLimitX96: 0n
            }]
          });
          const amountOut = extractFirstBigInt(result);
          if (amountOut > 0n) {
            logger.debug(`${channelLabel} V3 直接路由成功: ${amountOut.toString()}, 耗时: ${Date.now() - directStartTime}ms`);
            return {
              tokens: [startChecksum, targetChecksum],
              fees: [poolInfo.fee],
              amountOut
            } as V3RoutePlan;
          }
          logger.debug(`${channelLabel} V3 直接路由输出为 0，耗时: ${Date.now() - directStartTime}ms`);
          return null;
        })();

        return await Promise.race([evaluationPromise, timeoutPromise]);
      } catch (error) {
        if (error?.message === 'timeout') {
          logger.debug(`${channelLabel} V3 直接路由超时，耗时: ${Date.now() - directStartTime}ms`);
        } else {
          logger.debug(`${channelLabel} V3 直接报价失败: ${error?.message || error}, 耗时: ${Date.now() - directStartTime}ms`);
        }
        return null;
      }
    };

    // 🚀 性能优化：并行评估所有多跳路由，添加超时机制
    const evaluateMultiHopRoutes = async () => {
      const multiHopStartTime = Date.now();
      logger.debug(`${channelLabel} 开始评估 ${bridgeCandidates.size} 个 V3 多跳路由...`);

      // 为每个桥接代币创建评估任务
      const evaluationTasks = Array.from(bridgeCandidates).map(async (bridge) => {
        const bridgeStartTime = Date.now();
        try {
          // 超时包装器：单个桥接代币评估最多 2 秒
          const timeoutPromise = new Promise<null>((_, reject) => {
            setTimeout(() => reject(new Error('timeout')), 2000);
          });

          const evaluationPromise = (async () => {
            const firstPool = await getV3Pool(publicClient, v3FactoryAddress, v3FactoryAbi, startChecksum, bridge);
            if (!firstPool) return null;
            const secondPool = await getV3Pool(publicClient, v3FactoryAddress, v3FactoryAbi, bridge, targetChecksum);
            if (!secondPool) return null;

            const tokens = [startChecksum, bridge, targetChecksum];
            const fees = [firstPool.fee, secondPool.fee];
            const encoded = encodeV3Path(tokens, fees);
            const result = await publicClient.readContract({
              address: v3QuoterAddress,
              abi: v3QuoterAbi,
              functionName: 'quoteExactInput',
              args: [encoded, amountIn]
            });
            const amountOut = extractFirstBigInt(result);
            if (amountOut > 0n) {
              logger.debug(`${channelLabel} V3 多跳路由成功 (${bridge.slice(0, 6)}): ${amountOut.toString()}, 耗时: ${Date.now() - bridgeStartTime}ms`);
              return {
                tokens,
                fees,
                encodedPath: encoded,
                amountOut
              };
            }
            return null;
          })();

          return await Promise.race([evaluationPromise, timeoutPromise]);
        } catch (error) {
          if (error?.message === 'timeout') {
            logger.debug(`${channelLabel} V3 多跳路由超时 (${bridge.slice(0, 6)}), 耗时: ${Date.now() - bridgeStartTime}ms`);
          } else {
            logger.debug(`${channelLabel} V3 多跳报价失败(${bridge.slice(0, 6)}): ${error?.message || error}`);
          }
          return null;
        }
      });

      // 并行执行所有评估任务
      const results = await Promise.all(evaluationTasks);
      logger.debug(`${channelLabel} V3 多跳路由评估完成，总耗时: ${Date.now() - multiHopStartTime}ms`);

      // 选择最优路由
      let best: V3RoutePlan | null = null;
      for (const result of results) {
        if (result && (!best || result.amountOut > best.amountOut)) {
          best = result;
        }
      }
      return best;
    };

    const directRoute = await evaluateDirectRoute();
    const multiHopRoute = await evaluateMultiHopRoutes();

    if (!directRoute && !multiHopRoute) {
      // V3 路由失败，但不在这里检测混合路由
      // 混合路由检测应该在 V2 也失败后才进行，避免不必要的 RPC 调用
      return null;
    }
    if (directRoute && multiHopRoute) {
      return directRoute.amountOut >= multiHopRoute.amountOut ? directRoute : multiHopRoute;
    }
    return directRoute || multiHopRoute;
  };

  const reuseV3RouteFromHint = async (
    direction: 'buy' | 'sell',
    publicClient,
    tokenAddress: string,
    amountIn: bigint,
    hintOverride?: TokenTradeHint | null
  ): Promise<V3RoutePlan | null> => {
    if (!hasSmartRouterSupport || !publicClient) {
      return null;
    }
    const hint = hintOverride ?? getTokenTradeHint(tokenAddress);
    if (!hint) {
      return null;
    }
    const hintPath = direction === 'buy' ? hint.lastBuyPath : hint.lastSellPath;
    const hintFees = direction === 'buy' ? hint.lastBuyFees : hint.lastSellFees;
    if (!hintPath || !hintFees || hintPath.length !== hintFees.length + 1) {
      return null;
    }

    const normalizedPath: string[] = [];
    for (let i = 0; i < hintPath.length; i++) {
      const checksum = toChecksumAddress(hintPath[i], `hint-path-${i}`);
      if (!checksum) {
        return null;
      }
      normalizedPath.push(checksum);
    }

    try {
      if (normalizedPath.length === 2) {
        const result = await publicClient.readContract({
          address: v3QuoterAddress,
          abi: v3QuoterAbi,
          functionName: 'quoteExactInputSingle',
          args: [{
            tokenIn: normalizedPath[0],
            tokenOut: normalizedPath[1],
            amountIn,
            fee: hintFees[0],
            sqrtPriceLimitX96: 0n
          }]
        });
        const amountOut = extractFirstBigInt(result);
        if (amountOut > 0n) {
          logger.debug(`${channelLabel} 复用 V3 单跳路径`);
          return {
            tokens: normalizedPath,
            fees: hintFees,
            amountOut
          };
        }
      } else {
        const encoded = encodeV3Path(normalizedPath, hintFees);
        const result = await publicClient.readContract({
          address: v3QuoterAddress,
          abi: v3QuoterAbi,
          functionName: 'quoteExactInput',
          args: [encoded, amountIn]
        });
        const amountOut = extractFirstBigInt(result);
        if (amountOut > 0n) {
          logger.debug(`${channelLabel} 复用 V3 多跳路径`);
          return {
            tokens: normalizedPath,
            fees: hintFees,
            encodedPath: encoded,
            amountOut
          };
        }
      }
    } catch (error) {
      logger.debug(`${channelLabel} V3 缓存路径失效: ${error?.message || error}`);
    }
    return null;
  };

  const findBestRoute = async (
    direction: 'buy' | 'sell',
    publicClient,
    tokenAddress: string,
    amountIn: bigint
  ): Promise<
    | { kind: 'v2'; path: string[]; amountOut: bigint }
    | { kind: 'v3'; route: V3RoutePlan; amountOut: bigint }
    | { kind: 'mixed'; mixedRouteInfo: { description: string; v3Segment?: string; v2Segment?: string; v3First: boolean; bridgeToken: string }; amountOut: bigint }
  > => {
    const startTime = Date.now();
    logger.info(`${channelLabel} ⏱️ 开始路由查询 (${direction})`);

    let lastError: any = null;
    const hint = getTokenTradeHint(tokenAddress);
    const routerMatchesV3 = smartRouterAddress && hint?.routerAddress?.toLowerCase() === smartRouterAddress.toLowerCase();
    const forcedMode = hint?.forcedMode;

    // 记录路由提示信息，帮助调试
    if (hint) {
      logger.debug(`${channelLabel} 路由提示: forcedMode=${forcedMode}, lastMode=${hint.lastMode}, routerAddress=${hint.routerAddress?.slice(0, 10)}`);
    } else {
      logger.debug(`${channelLabel} 无路由提示，将比较 V2 和 V3`);
    }

    // 🚨 关键修复：忽略强制模式，始终比较 V2 和 V3
    // 原因：强制模式可能导致选择流动性差的路由，造成资金损失
    if (forcedMode) {
      logger.warn(`${channelLabel} ⚠️ 检测到强制模式 (${forcedMode})，但为了安全将忽略并比较所有路由`);
      // 清除强制模式，避免下次交易继续使用
      setPancakePreferredMode(tokenAddress, null);
    }

    const preferredV2Path = direction === 'buy' ? hint?.lastBuyPath : hint?.lastSellPath;

    // 🚀 性能优化：检查失败缓存，跳过已知会失败的查询
    const v2FailedKey = direction === 'buy' ? 'v2BuyFailed' : 'v2SellFailed';
    const v3FailedKey = direction === 'buy' ? 'v3BuyFailed' : 'v3SellFailed';
    const v2KnownFailed = hint?.[v2FailedKey] === true;
    const v3KnownFailed = hint?.[v3FailedKey] === true;

    // 如果 V2 已知失败且 V3 有缓存路径，跳过 V2 查询
    const skipV2 = v2KnownFailed && (hint?.lastMode === 'v3' || routerMatchesV3);
    if (skipV2) {
      logger.info(`${channelLabel} ⚡ V2 已知失败，跳过 V2 查询，直接使用 V3`);
    }

    logger.info(`${channelLabel} 🔍 ${skipV2 ? '仅查询 V3' : '并行查询 V2 和 V3'} 路由，选择最优...`);
    const queryStartTime = Date.now();

    // 🚀 性能优化：并行执行 V2 和 V3 查询（如果 V2 已知失败则跳过）
    const [v2Result, v3Result] = await Promise.allSettled([
      // V2 查询（如果已知失败则跳过）
      skipV2
        ? Promise.reject(new Error('V2 known to fail, skipped'))
        : (async () => {
            const v2Start = Date.now();
            logger.debug(`${channelLabel} 开始 V2 查询...`);
            try {
              const result = await findBestV2Path(direction, publicClient, tokenAddress, amountIn, preferredV2Path);
              logger.debug(`${channelLabel} V2 查询完成，耗时: ${Date.now() - v2Start}ms`);
              return result;
            } catch (error) {
              logger.debug(`${channelLabel} V2 查询失败，耗时: ${Date.now() - v2Start}ms`);
              throw error;
            }
          })(),
      // V3 查询
      hasSmartRouterSupport
        ? (async () => {
            const v3Start = Date.now();
            logger.debug(`${channelLabel} 开始 V3 查询...`);
            try {
              let v3Route = await reuseV3RouteFromHint(direction, publicClient, tokenAddress, amountIn, hint);
              if (!v3Route) {
                v3Route = await findBestV3Route(direction, publicClient, tokenAddress, amountIn);
              }
              logger.debug(`${channelLabel} V3 查询完成，耗时: ${Date.now() - v3Start}ms`);
              return v3Route;
            } catch (error) {
              logger.debug(`${channelLabel} V3 查询失败，耗时: ${Date.now() - v3Start}ms`);
              throw error;
            }
          })()
        : Promise.reject(new Error('V3 not supported'))
    ]);

    const queryEndTime = Date.now();
    logger.info(`${channelLabel} ⏱️ 并行查询完成，总耗时: ${queryEndTime - queryStartTime}ms`);

    // 处理 V2 结果
    let v2Data: { path: string[]; amountOut: bigint } | null = null;
    let v2Error: any = null;
    if (v2Result.status === 'fulfilled' && v2Result.value?.path && v2Result.value.amountOut > 0n) {
      v2Data = v2Result.value;
      logger.info(`${channelLabel} V2 路径成功，输出: ${v2Data.amountOut.toString()}`);
    } else if (v2Result.status === 'rejected') {
      v2Error = v2Result.reason;
      logger.debug(`${channelLabel} V2 路径失败: ${v2Error?.message || v2Error}`);
    }

    // 处理 V3 结果
    let v3Data: V3RoutePlan | null = null;
    let v3Error: any = null;
    if (v3Result.status === 'fulfilled' && v3Result.value) {
      v3Data = v3Result.value;
      logger.info(`${channelLabel} V3 路径成功，输出: ${v3Data.amountOut.toString()}`);
    } else if (v3Result.status === 'rejected') {
      v3Error = v3Result.reason;
      logger.debug(`${channelLabel} V3 路径失败: ${v3Error?.message || v3Error}`);
    }

    // 比较 V2 和 V3 的输出，选择最优的
    if (v2Data && v3Data) {
      // 两者都成功，清除失败标记
      updateRouteFailureStatus(tokenAddress, direction, { v2Failed: false, v3Failed: false });

      if (v2Data.amountOut > v3Data.amountOut) {
        const improvement = ((v2Data.amountOut - v3Data.amountOut) * 10000n / v3Data.amountOut);
        logger.info(`${channelLabel} ✅ V2 输出更优 (比 V3 多 ${improvement.toString()}bps)，选择 V2`);
        logger.info(`${channelLabel} ⏱️ 路由查询总耗时: ${Date.now() - startTime}ms`);
        return { kind: 'v2', path: v2Data.path, amountOut: v2Data.amountOut };
      } else {
        const improvement = ((v3Data.amountOut - v2Data.amountOut) * 10000n / v2Data.amountOut);
        logger.info(`${channelLabel} ✅ V3 输出更优 (比 V2 多 ${improvement.toString()}bps)，选择 V3`);
        logger.info(`${channelLabel} ⏱️ 路由查询总耗时: ${Date.now() - startTime}ms`);
        return { kind: 'v3', route: v3Data, amountOut: v3Data.amountOut };
      }
    } else if (v2Data) {
      // V2 成功，V3 失败
      updateRouteFailureStatus(tokenAddress, direction, { v2Failed: false, v3Failed: true });
      logger.info(`${channelLabel} ✅ 只有 V2 路径可用`);
      logger.info(`${channelLabel} ⏱️ 路由查询总耗时: ${Date.now() - startTime}ms`);
      return { kind: 'v2', path: v2Data.path, amountOut: v2Data.amountOut };
    } else if (v3Data) {
      // V3 成功，V2 失败
      updateRouteFailureStatus(tokenAddress, direction, { v2Failed: true, v3Failed: false });
      logger.info(`${channelLabel} ✅ 只有 V3 路径可用`);
      logger.info(`${channelLabel} ⏱️ 路由查询总耗时: ${Date.now() - startTime}ms`);
      return { kind: 'v3', route: v3Data, amountOut: v3Data.amountOut };
    }

    // V2 和 V3 都失败后，才检测混合路由
    if (v2Error && v3Error && hasSmartRouterSupport) {
      try {
        logger.debug(`${channelLabel} V2 和 V3 都失败，开始检测混合路由...`);
        const mixedRouteInfo = await detectMixedV2V3Route(
          publicClient,
          factoryAddress,
          factoryAbi,
          v3FactoryAddress,
          v3FactoryAbi,
          nativeWrapper,
          tokenAddress,
          [...(stableTokens || []), ...(helperTokenPool || []), ...(dynamicBridgeTokenPool || [])]
        );

        if (mixedRouteInfo) {
          logger.info(`${channelLabel} 检测到混合 V2/V3 路由: ${mixedRouteInfo.description}`);
          return {
            kind: 'mixed',
            mixedRouteInfo,
            amountOut: 0n
          };
        }
      } catch (error) {
        logger.debug(`${channelLabel} 混合路由检测失败: ${error?.message || error}`);
      }
    }

    throw v2Error || v3Error || new Error(`${channelLabel} 所有路径都失败，代币可能没有流动性`);
  };

  return {
    async buy({ publicClient, walletClient, account, chain, tokenAddress, amount, slippage, gasPrice, nonceExecutor }) {
      const buyStartTime = Date.now();
      logger.info(`${channelLabel} ⏱️ 开始买入交易`);
      logger.debug(`${channelLabel} 买入:`, { tokenAddress, amount, slippage });

      const amountIn = parseEther(amount);

      // 步骤1: 查询最佳路由
      const routeStartTime = Date.now();
      const routePlan = await findBestRoute('buy', publicClient, tokenAddress, amountIn);
      logger.info(`${channelLabel} ⏱️ 路由查询完成，耗时: ${Date.now() - routeStartTime}ms`);

      const slippageBp = Math.floor(slippage * 100);
      const deadline = Math.floor(Date.now() / 1000) + TX_CONFIG.DEADLINE_SECONDS;

      if (routePlan.kind === 'v2') {
        const { path, amountOut } = routePlan;
        updateTokenTradeHint(tokenAddress, channelId, 'buy', { routerAddress: contractAddress, path, mode: 'v2' });
        const amountOutMin = amountOut * BigInt(10000 - slippageBp) / 10000n;

        // 步骤2: 准备并发送 V2 交易
        const txStartTime = Date.now();
        logger.info(`${channelLabel} ⏱️ 开始发送 V2 交易...`);

        const sendSwap = (nonce?: number) =>
          sendContractTransaction({
            walletClient,
            account,
            chain,
            to: contractAddress,
            abi,
            functionName: buyFunction,
            args: [amountOutMin, path, account.address, deadline],
            value: amountIn,
            gasPrice,
            fallbackGasLimit,
            publicClient,
            dynamicGas: {
              enabled: true,
              key: `${channelId}:buy:v2`,
              bufferBps: 1000,
              minGas: fallbackGasLimit
            },
            nonce
          });
        const hash = nonceExecutor
          ? await nonceExecutor('buy', (nonce) => sendSwap(nonce))
          : await sendSwap();

        logger.info(`${channelLabel} ⏱️ V2 交易已发送，耗时: ${Date.now() - txStartTime}ms`);
        logger.info(`${channelLabel} ⏱️ 买入交易总耗时: ${Date.now() - buyStartTime}ms`);
        logger.debug(`${channelLabel} 交易发送:`, hash);
        return hash;
      }

      // 处理混合 V2/V3 路由
      if (routePlan.kind === 'mixed') {
        if (!smartRouterAddress || !smartRouterAbi) {
          throw new Error('Pancake V3 Router 未配置，无法执行混合路由');
        }
        if (!v3FactoryAddress || !v3FactoryAbi) {
          throw new Error('Pancake V3 Factory 未配置，无法执行混合路由');
        }
        if (!v3QuoterAddress || !v3QuoterAbi) {
          throw new Error('Pancake V3 Quoter 未配置，无法执行混合路由');
        }

        logger.info(`${channelLabel} 执行混合 V2/V3 路由交易: ${routePlan.mixedRouteInfo.description}`);

        const hash = await executeMixedV2V3Trade({
          publicClient,
          walletClient,
          account,
          chain,
          mixedRouteInfo: routePlan.mixedRouteInfo,
          direction: 'buy',
          amountIn,
          slippage,
          gasPrice,
          v2RouterAddress: contractAddress,
          v2RouterAbi: abi,
          v3RouterAddress: smartRouterAddress,
          v3RouterAbi: smartRouterAbi,
          v3FactoryAddress,
          v3FactoryAbi,
          v3QuoterAddress,
          v3QuoterAbi,
          nativeWrapper,
          targetToken: tokenAddress,
          nonceExecutor,
          channelLabel
        });

        logger.info(`${channelLabel} 混合路由交易完成:`, hash);
        return hash;
      }


      if (!smartRouterAddress || !smartRouterAbi) {
        throw new Error('Pancake V3 Router 未配置');
      }

      // 此时 routePlan 应该是 v3 类型
      if (routePlan.kind === 'v3') {
        const v3Route = routePlan.route;
      const pathHint = v3Route.tokens;
      updateTokenTradeHint(tokenAddress, channelId, 'buy', { routerAddress: smartRouterAddress, path: pathHint, fees: v3Route.fees, mode: 'v3' });
      const amountOutMin = routePlan.amountOut * BigInt(10000 - slippageBp) / 10000n;
      const isSingleHop = v3Route.tokens.length === 2;

      // 步骤2: 准备并发送 V3 交易
      const txStartTime = Date.now();
      logger.info(`${channelLabel} ⏱️ 开始发送 V3 交易...`);

      const sendV3Swap = (nonce?: number) => {
        if (isSingleHop) {
          const params = {
            tokenIn: v3Route.tokens[0],
            tokenOut: v3Route.tokens[1],
            fee: v3Route.fees[0],
            recipient: account.address,
            amountIn,
            amountOutMinimum: amountOutMin,
            sqrtPriceLimitX96: 0n
          };
          return sendContractTransaction({
            walletClient,
            account,
            chain,
            to: smartRouterAddress,
            abi: smartRouterAbi,
            functionName: 'exactInputSingle',
            args: [params],
            value: amountIn,
            gasPrice,
            fallbackGasLimit,
            publicClient,
            dynamicGas: {
              enabled: true,
              key: `${channelId}:buy:v3-single`,
              bufferBps: 1200,
              minGas: fallbackGasLimit
            },
            nonce
          });
        }
        const encodedPath = v3Route.encodedPath || encodeV3Path(v3Route.tokens, v3Route.fees);
        return sendContractTransaction({
          walletClient,
          account,
          chain,
          to: smartRouterAddress,
          abi: smartRouterAbi,
          functionName: 'exactInput',
          args: [{
            path: encodedPath,
            recipient: account.address,
            amountIn,
            amountOutMinimum: amountOutMin
          }],
          value: amountIn,
          gasPrice,
          fallbackGasLimit,
          publicClient,
            dynamicGas: {
              enabled: true,
              key: `${channelId}:buy:v3-multi`,
              bufferBps: 1200,
              minGas: fallbackGasLimit
            },
            nonce
          });
      };

      const hash = nonceExecutor
        ? await nonceExecutor('buy', (nonce) => sendV3Swap(nonce))
        : await sendV3Swap();

      logger.info(`${channelLabel} ⏱️ V3 交易已发送，耗时: ${Date.now() - txStartTime}ms`);
      logger.info(`${channelLabel} ⏱️ 买入交易总耗时: ${Date.now() - buyStartTime}ms`);
      logger.debug(`${channelLabel} 交易发送(V3):`, hash);
      return hash;
      } else {
        throw new Error(`意外的路由类型: ${(routePlan as any).kind}`);
      }
    },

    async sell({ publicClient, walletClient, account, chain, tokenAddress, percent, slippage, gasPrice, tokenInfo, nonceExecutor }) {
      logger.debug(`${channelLabel} 卖出:`, { tokenAddress, percent, slippage });

      // 性能优化：并发执行 prepareTokenSell 和 findBestRoute（使用预估金额）
      const preparePromise = prepareTokenSell({
        publicClient,
        tokenAddress,
        accountAddress: account.address,
        spenderAddress: contractAddress,
        percent,
        tokenInfo
      });

      // 优化预估金额逻辑：
      // 1. 如果有 tokenInfo 缓存，使用缓存余额计算预估金额（精度高）
      // 2. 如果没有缓存，使用 1 token 作为预估值（精度低，但可以并发查询）
      let estimatedAmount: bigint;
      let hasAccurateEstimate = false;
      if (tokenInfo && tokenInfo.balance) {
        const balance = BigInt(tokenInfo.balance);
        estimatedAmount = percent === 100 ? balance : balance * BigInt(percent) / 100n;
        hasAccurateEstimate = true; // 标记为高精度预估
      } else {
        // 如果没有缓存，使用一个合理的预估值（1 token）
        estimatedAmount = parseEther('1');
        hasAccurateEstimate = false; // 标记为低精度预估
      }

      // 性能优化：优先使用 tokenInfo 中的授权信息（来自现有缓存）
      // 如果 tokenInfo 包含授权信息，直接使用，避免链上查询
      let v2AllowanceFromCache: bigint | null = null;
      let v3AllowanceFromCache: bigint | null = null;

      if (tokenInfo && tokenInfo.allowances) {
        // tokenInfo 包含授权信息，直接使用
        if (tokenInfo.allowances.pancake) {
          v2AllowanceFromCache = BigInt(tokenInfo.allowances.pancake);
          logger.debug(`${channelLabel} 使用 tokenInfo 中的 V2 授权: ${v2AllowanceFromCache}`);
        }
        // V3 使用相同的 pancake 授权（因为都是 PancakeSwap）
        if (tokenInfo.allowances.pancake) {
          v3AllowanceFromCache = BigInt(tokenInfo.allowances.pancake);
          logger.debug(`${channelLabel} 使用 tokenInfo 中的 V3 授权: ${v3AllowanceFromCache}`);
        }
      }

      // 性能优化：并行查询 V2 和 V3 授权，避免等待路由结果
      // 这样无论最终使用哪个路由，都不需要再查询授权
      // 优先使用 tokenInfo 中的授权，如果没有才查询链上
      const v2AllowancePromise = smartRouterAddress
        ? (async () => {
            // 优先使用 tokenInfo 中的授权
            if (v2AllowanceFromCache !== null) {
              return v2AllowanceFromCache;
            }
            // 其次使用我们自己的缓存
            const cached = getCachedAllowance(tokenAddress, contractAddress);
            if (cached !== null) {
              logger.debug(`${channelLabel} 使用 V2 授权缓存: ${cached}`);
              return cached;
            }
            // 最后查询链上
            try {
              const allowance = await publicClient.readContract({
                address: tokenAddress,
                abi: ERC20_ABI,
                functionName: 'allowance',
                args: [account.address, contractAddress]
              });
              setCachedAllowance(tokenAddress, contractAddress, allowance);
              return allowance;
            } catch (err) {
              logger.warn(`${channelLabel} V2 授权查询失败: ${err?.message || err}`);
              return 0n;
            }
          })()
        : Promise.resolve(null);

      const v3AllowancePromise = smartRouterAddress
        ? (async () => {
            // 优先使用 tokenInfo 中的授权
            if (v3AllowanceFromCache !== null) {
              return v3AllowanceFromCache;
            }
            // 其次使用我们自己的缓存
            const cached = getCachedAllowance(tokenAddress, smartRouterAddress);
            if (cached !== null) {
              logger.debug(`${channelLabel} 使用 V3 授权缓存: ${cached}`);
              return cached;
            }
            // 最后查询链上
            try {
              const allowance = await publicClient.readContract({
                address: tokenAddress,
                abi: ERC20_ABI,
                functionName: 'allowance',
                args: [account.address, smartRouterAddress]
              });
              setCachedAllowance(tokenAddress, smartRouterAddress, allowance);
              return allowance;
            } catch (err) {
              logger.warn(`${channelLabel} V3 授权查询失败: ${err?.message || err}`);
              return 0n;
            }
          })()
        : Promise.resolve(null);

      const [initialState, routePlan, v2AllowanceValue, v3AllowanceValue] = await Promise.all([
        preparePromise,
        findBestRoute('sell', publicClient, tokenAddress, estimatedAmount),
        v2AllowancePromise,
        v3AllowancePromise
      ]);

      const { totalSupply, amountToSell } = initialState;
      let allowanceValue = initialState.allowance;

      // 优化重查逻辑：
      // 1. 如果预估精度高（有 tokenInfo），使用更严格的阈值（10%）
      // 2. 如果预估精度低（无 tokenInfo），使用更宽松的阈值（5%），因为肯定会有差异
      const amountDiff = amountToSell > estimatedAmount
        ? amountToSell - estimatedAmount
        : estimatedAmount - amountToSell;
      const diffPercent = estimatedAmount > 0n
        ? Number(amountDiff * 10000n / estimatedAmount) / 100
        : 100;

      // 根据预估精度选择阈值
      const reQueryThreshold = hasAccurateEstimate ? 10 : 5;
      let finalRoutePlan = routePlan;
      if (diffPercent > reQueryThreshold) {
        logger.debug(`${channelLabel} 实际金额与预估差异 ${diffPercent.toFixed(2)}%（阈值: ${reQueryThreshold}%），重新查询路由`);
        finalRoutePlan = await findBestRoute('sell', publicClient, tokenAddress, amountToSell);
      } else if (diffPercent > 1) {
        logger.debug(`${channelLabel} 实际金额与预估差异 ${diffPercent.toFixed(2)}%，在阈值内，使用预估路由`);
      }

      // 使用预查询的授权值（已在并发查询中获取）
      const spenderAddress = finalRoutePlan.kind === 'v2' ? contractAddress : smartRouterAddress;
      if (finalRoutePlan.kind === 'v2' && v2AllowanceValue !== null) {
        allowanceValue = v2AllowanceValue;
        logger.debug(`${channelLabel} 使用预查询的 V2 授权: ${allowanceValue}`);
      } else if (finalRoutePlan.kind === 'v3' && v3AllowanceValue !== null) {
        allowanceValue = v3AllowanceValue;
        logger.debug(`${channelLabel} 使用预查询的 V3 授权: ${allowanceValue}`);
      }

      await ensureTokenApproval({
        publicClient,
        walletClient,
        account,
        chain,
        tokenAddress,
        spenderAddress,
        amount: amountToSell,
        currentAllowance: allowanceValue,
        totalSupply,
        gasPrice,
        nonceExecutor
      });

      const slippageBp = Math.floor(slippage * 100);
      const amountOutMinBase = finalRoutePlan.amountOut * BigInt(10000 - slippageBp) / 10000n;
      if (finalRoutePlan.kind === 'v2') {
        const { path } = finalRoutePlan;
        const amountOutMin = amountOutMinBase;
        updateTokenTradeHint(tokenAddress, channelId, 'sell', { routerAddress: contractAddress, path, mode: 'v2' });
        const deadline = Math.floor(Date.now() / 1000) + TX_CONFIG.DEADLINE_SECONDS;

        const sendSell = (nonce?: number) =>
          sendContractTransaction({
            walletClient,
            account,
            chain,
            to: contractAddress,
            abi,
            functionName: sellFunction,
            args: [amountToSell, amountOutMin, path, account.address, deadline],
            gasPrice,
            fallbackGasLimit,
            publicClient,
            dynamicGas: {
              enabled: true,
              key: `${channelId}:sell:v2`,
              bufferBps: 1000,
              minGas: fallbackGasLimit
            },
            nonce
          });
        const hash = nonceExecutor
          ? await nonceExecutor('sell', (nonce) => sendSell(nonce))
          : await sendSell();

        logger.debug(`${channelLabel} 交易发送:`, hash);
        return hash;
      }

      // 处理混合 V2/V3 路由（卖出暂不支持）
      if (finalRoutePlan.kind === 'mixed') {
        throw new Error(`${channelLabel} 卖出暂不支持混合 V2/V3 路由，请使用 PancakeSwap 官网进行交易`);
      }

      if (!smartRouterAddress || !smartRouterAbi) {
        throw new Error('Pancake V3 Router 未配置');
      }

      // 此时 finalRoutePlan 应该是 v3 类型
      if (finalRoutePlan.kind === 'v3') {
        const v3Route = finalRoutePlan.route;
      updateTokenTradeHint(tokenAddress, channelId, 'sell', { routerAddress: smartRouterAddress, path: v3Route.tokens, fees: v3Route.fees, mode: 'v3' });
      const amountOutMin = amountOutMinBase > 0n ? amountOutMinBase : 1n;
      const isSingleHop = v3Route.tokens.length === 2;
      const encodedPath = v3Route.encodedPath || (!isSingleHop ? encodeV3Path(v3Route.tokens, v3Route.fees) : undefined);
      const swapCallData = isSingleHop
        ? encodeFunctionData({
            abi: smartRouterAbi,
            functionName: 'exactInputSingle',
            args: [{
              tokenIn: v3Route.tokens[0],
              tokenOut: v3Route.tokens[1],
              fee: v3Route.fees[0],
              recipient: smartRouterAddress,
              amountIn: amountToSell,
              amountOutMinimum: amountOutMin,
              sqrtPriceLimitX96: 0n
            }]
          })
        : encodeFunctionData({
            abi: smartRouterAbi,
            functionName: 'exactInput',
            args: [{
              path: encodedPath,
              recipient: smartRouterAddress,
              amountIn: amountToSell,
              amountOutMinimum: amountOutMin
            }]
          });
      const unwrapCallData = encodeFunctionData({
        abi: smartRouterAbi,
        functionName: 'unwrapWETH9',
        args: [amountOutMin, account.address]
      });
      const calls = [swapCallData, unwrapCallData];

      const sendV3Sell = (nonce?: number) =>
        sendContractTransaction({
          walletClient,
          account,
          chain,
          to: smartRouterAddress,
          abi: smartRouterAbi,
          functionName: 'multicall',
          args: [calls],
          gasPrice,
          fallbackGasLimit,
          publicClient,
          dynamicGas: {
            enabled: true,
            key: `${channelId}:sell:v3`,
            bufferBps: 1200,
            minGas: fallbackGasLimit
          },
          nonce
        });
      const hash = nonceExecutor
        ? await nonceExecutor('sell', (nonce) => sendV3Sell(nonce))
        : await sendV3Sell();

      logger.debug(`${channelLabel} 交易发送(V3):`, hash);
      return hash;
      } else {
        throw new Error(`意外的路由类型: ${(finalRoutePlan as any).kind}`);
      }
    },

    async quoteSell({ publicClient, tokenAddress, amount }) {
      if (!publicClient || !tokenAddress || !amount || amount <= 0n) {
        return null;
      }
      try {
        const routePlan = await findBestRoute('sell', publicClient, tokenAddress, amount);
        return routePlan.amountOut ?? null;
      } catch (error) {
        logger.debug(`${channelLabel} 卖出预估失败: ${error.message}`);
        return null;
      }
    }
  };
}

function createTokenManagerChannel(definition: TokenManagerChannelDefinition): TradingChannel {
  const channelLabel = `[${definition.name || definition.id}]`;
  const fallbackGasLimit = BigInt(definition.gasLimit ?? TX_CONFIG.GAS_LIMIT.FOUR_SWAP);
  const buyMinAmountOut = definition.buyMinAmountOut ?? 1n;
  const sellMinFunds = definition.sellMinFunds ?? 0n;
  const buyValueMode = definition.buyValueMode ?? 'amountIn';
  const buildBuyArgs = definition.buildBuyArgs;
  const buildSellArgs = definition.buildSellArgs;

  return {
    async buy({ publicClient, walletClient, account, chain, tokenAddress, amount, gasPrice, nonceExecutor }) {
      logger.debug(`${channelLabel} 买入:`, { tokenAddress, amount });

      const amountIn = parseEther(amount);
      updateTokenTradeHint(tokenAddress, definition.id, 'buy', { routerAddress: definition.contractAddress });
       const deadline = Math.floor(Date.now() / 1000) + TX_CONFIG.DEADLINE_SECONDS;
      const args = buildBuyArgs
        ? buildBuyArgs({ tokenAddress, amountIn, minAmountOut: buyMinAmountOut, deadline })
        : [tokenAddress, amountIn, buyMinAmountOut];
      const txValue = buyValueMode === 'amountIn' ? amountIn : 0n;
      const sendBuy = (nonce?: number) =>
        sendContractTransaction({
          walletClient,
          account,
          chain,
          to: definition.contractAddress,
          abi: definition.abi,
          functionName: definition.buyFunction,
          args,
          value: txValue,
          gasPrice,
          fallbackGasLimit,
          publicClient,
          dynamicGas: {
            enabled: true,
            key: `${definition.id}:buy`,
            bufferBps: 1000,
            minGas: fallbackGasLimit
          },
          nonce
        });
      const hash = nonceExecutor
        ? await nonceExecutor('buy', (nonce) => sendBuy(nonce))
        : await sendBuy();

      logger.debug(`${channelLabel} 交易发送:`, hash);
      return hash;
    },

    async sell({ publicClient, walletClient, account, chain, tokenAddress, percent, slippage, gasPrice, tokenInfo, nonceExecutor }) {
      logger.debug(`${channelLabel} 卖出:`, { tokenAddress, percent, slippage });

      const { allowance, totalSupply, amountToSell } = await prepareTokenSell({
        publicClient,
        tokenAddress,
        accountAddress: account.address,
        spenderAddress: definition.contractAddress,
        percent,
        tokenInfo,
        options: { requireGweiPrecision: true }
      });

      await ensureTokenApproval({
        publicClient,
        walletClient,
        account,
        chain,
        tokenAddress,
        spenderAddress: definition.contractAddress,
        amount: amountToSell,
        currentAllowance: allowance,
        totalSupply,
        gasPrice,
        nonceExecutor
      });

      const deadline = Math.floor(Date.now() / 1000) + TX_CONFIG.DEADLINE_SECONDS;
      updateTokenTradeHint(tokenAddress, definition.id, 'sell', { routerAddress: definition.contractAddress });
      const sellArgs = buildSellArgs
        ? buildSellArgs({ tokenAddress, amount: amountToSell, minFunds: sellMinFunds, deadline })
        : [tokenAddress, amountToSell, sellMinFunds];

      const sendSell = (nonce?: number) =>
        sendContractTransaction({
          walletClient,
          account,
          chain,
          to: definition.contractAddress,
          abi: definition.abi,
          functionName: definition.sellFunction,
          args: sellArgs,
          gasPrice,
          fallbackGasLimit,
          publicClient,
          dynamicGas: {
            enabled: true,
            key: `${definition.id}:sell`,
            bufferBps: 1000,
            minGas: fallbackGasLimit
          },
          nonce
        });
      const hash = nonceExecutor
        ? await nonceExecutor('sell', (nonce) => sendSell(nonce))
        : await sendSell();

      logger.debug(`${channelLabel} 交易发送:`, hash);
      return hash;
    },

    async quoteSell({ publicClient, tokenAddress, amount }) {
      if (!publicClient || !tokenAddress || !amount || amount <= 0n) {
        return null;
      }
      if (!CONTRACTS.FOUR_HELPER_V3) {
        return null;
      }
      try {
        const quote = await publicClient.readContract({
          address: CONTRACTS.FOUR_HELPER_V3,
          abi: tokenManagerHelperAbi as any,
          functionName: 'trySell',
          args: [tokenAddress, amount]
        }) as any;
        const funds = typeof quote?.funds === 'bigint'
          ? quote.funds
          : Array.isArray(quote) ? quote[2] : null;
        const fee = typeof quote?.fee === 'bigint'
          ? quote.fee
          : Array.isArray(quote) ? quote[3] : null;
        if (typeof funds !== 'bigint') {
          return null;
        }
        if (typeof fee !== 'bigint') {
          return funds;
        }
        const net = funds - fee;
        return net >= 0n ? net : 0n;
      } catch (error) {
        logger.debug(`${channelLabel} trySell 失败: ${error.message}`);
        return null;
      }
    }
  };
}

function createQuotePortalChannel(definition: QuotePortalChannelDefinition): TradingChannel {
  const channelLabel = `[${definition.name || definition.id}]`;
  const fallbackGasLimit = BigInt(definition.gasLimit ?? TX_CONFIG.GAS_LIMIT.FLAP_SWAP);
  const {
    nativeTokenAddress = '0x0000000000000000000000000000000000000000',
    quoteFunction = 'quoteExactInput',
    swapFunction = 'swapExactInput'
  } = definition.options || {};

  const getQuote = async (publicClient, inputToken, outputToken, amount) => {
    return await publicClient.readContract({
      address: definition.contractAddress,
      abi: definition.abi,
      functionName: quoteFunction,
      args: [{ inputToken, outputToken, inputAmount: amount }]
    });
  };

  const buildSwapArgs = (inputToken, outputToken, inputAmount, minOutputAmount) => ([{
    inputToken,
    outputToken,
    inputAmount,
    minOutputAmount,
    permitData: '0x'
  }]);

  return {
    async buy({ publicClient, walletClient, account, chain, tokenAddress, amount, slippage, gasPrice, nonceExecutor }) {
      logger.debug(`${channelLabel} 买入:`, { tokenAddress, amount, slippage });

      const amountIn = parseEther(amount);
      updateTokenTradeHint(tokenAddress, definition.id, 'buy', { routerAddress: definition.contractAddress });

      let estimatedTokens: bigint;
      try {
        estimatedTokens = await getQuote(publicClient, nativeTokenAddress, tokenAddress, amountIn);
        logger.debug(`${channelLabel} 预计获得代币:`, estimatedTokens.toString());
      } catch (error) {
        throw new Error(`${channelLabel} 获取报价失败: ${error.message}`);
      }

      const slippageBp = Math.floor(slippage * 100);
      const minTokens = estimatedTokens * BigInt(10000 - slippageBp) / 10000n;

      const sendBuy = (nonce?: number) =>
        sendContractTransaction({
          walletClient,
          account,
          chain,
          to: definition.contractAddress,
          abi: definition.abi,
          functionName: swapFunction,
          args: buildSwapArgs(nativeTokenAddress, tokenAddress, amountIn, minTokens),
          value: amountIn,
          gasPrice,
          fallbackGasLimit,
          publicClient,
          dynamicGas: {
            enabled: true,
            key: `${definition.id}:buy`,
            bufferBps: 1000,
            minGas: fallbackGasLimit
          },
          nonce
        });
      const hash = nonceExecutor
        ? await nonceExecutor('buy', (nonce) => sendBuy(nonce))
        : await sendBuy();

      logger.debug(`${channelLabel} 交易发送:`, hash);
      return hash;
    },

    async sell({ publicClient, walletClient, account, chain, tokenAddress, percent, slippage, gasPrice, tokenInfo, nonceExecutor }) {
      logger.debug(`${channelLabel} 卖出:`, { tokenAddress, percent, slippage });

      // 性能优化：并发执行 prepareTokenSell 和 getQuote（使用预估金额）
      const preparePromise = prepareTokenSell({
        publicClient,
        tokenAddress,
        accountAddress: account.address,
        spenderAddress: definition.contractAddress,
        percent,
        tokenInfo
      });

      // 使用缓存的余额或预估值来并发查询报价
      let estimatedAmount: bigint;
      if (tokenInfo && tokenInfo.balance) {
        const balance = BigInt(tokenInfo.balance);
        estimatedAmount = percent === 100 ? balance : balance * BigInt(percent) / 100n;
      } else {
        // 如果没有缓存，使用一个合理的预估值（1 token）
        estimatedAmount = parseEther('1');
      }

      const quotePromise = getQuote(publicClient, tokenAddress, nativeTokenAddress, estimatedAmount);

      const [{ allowance, totalSupply, amountToSell }, estimatedNativePreview] = await Promise.all([
        preparePromise,
        quotePromise.catch(() => 0n)  // 如果预估失败，稍后重试
      ]);

      await ensureTokenApproval({
        publicClient,
        walletClient,
        account,
        chain,
        tokenAddress,
        spenderAddress: definition.contractAddress,
        amount: amountToSell,
        currentAllowance: allowance,
        totalSupply,
        gasPrice,
        nonceExecutor
      });

      // 如果实际金额与预估金额差异较大，或预估失败，重新查询报价
      let estimatedNative = estimatedNativePreview;
      if (estimatedNative === 0n || amountToSell !== estimatedAmount) {
        try {
          estimatedNative = await getQuote(publicClient, tokenAddress, nativeTokenAddress, amountToSell);
          logger.debug(`${channelLabel} 预计获得原生币:`, formatEther(estimatedNative));
        } catch (error) {
          throw new Error(`${channelLabel} 获取报价失败: ${error.message}`);
        }
      } else {
        logger.debug(`${channelLabel} 预计获得原生币(缓存):`, formatEther(estimatedNative));
      }

      const slippageBp = Math.floor(slippage * 100);
      const minOutput = estimatedNative * BigInt(10000 - slippageBp) / 10000n;

      updateTokenTradeHint(tokenAddress, definition.id, 'sell', { routerAddress: definition.contractAddress });

      const sendSell = (nonce?: number) =>
        sendContractTransaction({
          walletClient,
          account,
          chain,
          to: definition.contractAddress,
          abi: definition.abi,
          functionName: swapFunction,
          args: buildSwapArgs(tokenAddress, nativeTokenAddress, amountToSell, minOutput),
          gasPrice,
          fallbackGasLimit,
          publicClient,
          dynamicGas: {
            enabled: true,
            key: `${definition.id}:sell`,
            bufferBps: 1000,
            minGas: fallbackGasLimit
          },
          nonce
        });
      const hash = nonceExecutor
        ? await nonceExecutor('sell', (nonce) => sendSell(nonce))
        : await sendSell();

      logger.debug(`${channelLabel} 交易发送:`, hash);
      return hash;
    },

    async quoteSell({ publicClient, tokenAddress, amount }) {
      if (!publicClient || !tokenAddress || !amount || amount <= 0n) {
        return null;
      }
      try {
        const quote = await getQuote(publicClient, tokenAddress, nativeTokenAddress, amount);
        return typeof quote === 'bigint' ? quote : null;
      } catch (error) {
        logger.debug(`${channelLabel} 卖出预估失败: ${error.message}`);
        return null;
      }
    }
  };
}

const channelFactory = createChannelFactory({
  router: (definition) => createRouterChannel(definition as RouterChannelDefinition),
  tokenManager: (definition) => createTokenManagerChannel(definition as TokenManagerChannelDefinition),
  quotePortal: (definition) => createQuotePortalChannel(definition as QuotePortalChannelDefinition)
});

const ChannelRouter = channelFactory(CHANNEL_DEFINITIONS as unknown as Record<string, ChannelDefinition>);

function getChannel(channelId) {
  const channel = ChannelRouter[channelId];
  if (!channel) {
    throw new Error(`未知的交易通道: ${channelId}`);
  }
  return channel;
}

export { getChannel, ChannelRouter, clearAllowanceCache };
