import '../shared/sw-polyfills.js';
import { logger } from '../shared/logger.js';
import {
  CUSTOM_AGGREGATOR_CONFIG,
  MEME_SWAP_AGGREGATOR_ABI,
  CONTRACTS,
  TX_CONFIG,
  PANCAKE_V3_FACTORY_ABI,
  PANCAKE_V3_QUOTER_ABI,
  NETWORK_CONFIG,
  ERC20_ABI,
  AGGREGATOR_RUNTIME_CONFIG
} from '../shared/trading-config.js';
import {
  estimateQuoteAmount,
  isBnbQuote,
  normalizeAddress,
  resolveSwapSlippageBps,
  resolveQuoteTokenPreset,
  quotePancakeV2Path
} from './four-quote-bridge.js';
import {
  encodeFunctionData,
  parseUnits,
  createHttpClient
} from '../shared/viem-helper.js';
import { prepareTokenSell } from '../shared/trading-channels.js';
import type { Address } from 'viem';
import { PerformanceTimer, perf } from '../shared/performance.js';

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';
const V3_FEE_TIERS = [100, 250, 500, 2500, 10000];

/**
 * Fee Candidates 缓存（Aggregator）
 * 预计算所有可能的 fee 排列组合，避免每次都 filter
 */
const aggregatorFeeCandidatesCache = new Map<number | null, readonly number[]>();

// 预计算所有可能的排列
function initializeAggregatorFeeCandidatesCache() {
  // null 的情况：使用默认顺序
  aggregatorFeeCandidatesCache.set(null, Object.freeze([...V3_FEE_TIERS]));

  // 为每个 fee tier 预计算排列
  V3_FEE_TIERS.forEach((preferredFee) => {
    const candidates = [preferredFee, ...V3_FEE_TIERS.filter((fee) => fee !== preferredFee)];
    aggregatorFeeCandidatesCache.set(preferredFee, Object.freeze(candidates));
  });
}

// 初始化缓存
initializeAggregatorFeeCandidatesCache();

/**
 * 获取 Fee Candidates（从缓存）
 * 返回冻结的数组，防止外部修改
 */
function getAggregatorFeeCandidates(preferredFee?: number): readonly number[] {
  const key = typeof preferredFee === 'number' ? preferredFee : null;
  return aggregatorFeeCandidatesCache.get(key) || Object.freeze([...V3_FEE_TIERS]);
}
const V3_DIRECT_QUOTE_TOKENS = new Set(
  [
    CONTRACTS.USD1,
    CONTRACTS.UNITED_STABLES_U,
    CONTRACTS.USDT,
    CONTRACTS.BUSD,
    CONTRACTS.CAKE,
    CONTRACTS.KGST,
    CONTRACTS.lisUSD
  ]
    .filter((token): token is string => Boolean(token))
    .map((token) => normalizeAddress(token))
    .filter((token) => Boolean(token))
);
const V3_FALLBACK_RPC_URLS = [
  NETWORK_CONFIG.BSC_RPC,
  ...(NETWORK_CONFIG.BSC_RPC_FALLBACK ?? [])
]
  .map((url) => url?.trim())
  .filter((url): url is string => Boolean(url));
const fallbackClientCache = new Map<string, any>();
const FOUR_AGGREGATOR_CHANNELS = new Set(['four', 'xmode']);
const UINT256_MAX = (1n << 256n) - 1n;
const LARGE_ALLOWANCE_THRESHOLD = UINT256_MAX / 2n;
const AGGREGATOR_ALLOWANCE_CACHE_TTL_MS = AGGREGATOR_RUNTIME_CONFIG.ALLOWANCE_CACHE_TTL_MS ?? 60_000;

type AllowanceCacheEntry = { amount: bigint; updatedAt: number };
const aggregatorAllowanceCache = new Map<string, AllowanceCacheEntry>();

function normalizeCacheComponent(value?: string | null) {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function createAllowanceCacheKey(token: string, owner: Address, spender: Address | string) {
  const tokenKey = normalizeCacheComponent(token);
  const ownerKey = normalizeCacheComponent(owner);
  const spenderKey = normalizeCacheComponent(spender);
  return `${tokenKey}::${ownerKey}::${spenderKey}`;
}

function getCachedAllowance(key: string | null | undefined) {
  if (!key) {
    return null;
  }
  const cached = aggregatorAllowanceCache.get(key);
  if (!cached) {
    return null;
  }
  if (Date.now() - cached.updatedAt > AGGREGATOR_ALLOWANCE_CACHE_TTL_MS) {
    aggregatorAllowanceCache.delete(key);
    return null;
  }
  return cached.amount;
}

function updateAllowanceCache(key: string | null | undefined, amount: bigint) {
  if (!key) {
    return;
  }
  aggregatorAllowanceCache.set(key, { amount, updatedAt: Date.now() });
}

function invalidateAllowanceCache(key: string | null | undefined) {
  if (!key) {
    return;
  }
  aggregatorAllowanceCache.delete(key);
}

function isAllowanceError(error: any) {
  const text = `${error?.shortMessage || ''} ${error?.details || ''} ${error?.message || ''}`.toLowerCase();
  if (!text) {
    return false;
  }
  return (
    text.includes('insufficient allowance') ||
    text.includes('transfer amount exceeds allowance')
  );
}

export type AggregatorExecutionMode = 'contract' | 'legacy';

export type AggregatorRuntimeSettings = {
  enabled: boolean;
  executionMode: AggregatorExecutionMode;
  contractAddress: string;
};

const SUPPORTED_CHANNELS = new Set<string>(CUSTOM_AGGREGATOR_CONFIG.SUPPORTED_CHANNELS);

type AggregatorRouteInfo = {
  quoteToken?: string;
  metadata?: {
    flapStateReader?: string;
    [key: string]: any;
  };
} | null;

type AggregatorContext = {
  publicClient: any;
  walletClient: any;
  account: { address: Address };
  chain: any;
  gasPriceWei: bigint;
  nonceExecutor: (label: string, sender: (nonce: number) => Promise<any>) => Promise<any>;
};

type AggregatorBuyParams = {
  channelId: string;
  tokenAddress: string;
  amountBnb: string | number;
  slippage: number;
  quoteToken: string;
  aggregatorAddress: string;
  routeInfo?: AggregatorRouteInfo;
} & AggregatorContext;

type AggregatorSellParams = {
  channelId: string;
  tokenAddress: string;
  percent: number;
  slippage: number;
  aggregatorAddress: string;
  routeInfo?: AggregatorRouteInfo;
} & AggregatorContext;

function normalizeAggregatorAddress(address?: string | null) {
  if (!address || typeof address !== 'string') {
    return null;
  }
  const trimmed = address.trim();
  if (!/^0x[a-fA-F0-9]{40}$/.test(trimmed)) {
    return null;
  }
  return `0x${trimmed.slice(2).toLowerCase()}` as `0x${string}`;
}

function shouldUseV3QuoteToken(address?: string | null) {
  const normalized = normalizeAddress(address);
  return normalized ? V3_DIRECT_QUOTE_TOKENS.has(normalized) : false;
}
type AggregatorSwapMode = { kind: 'v2' } | { kind: 'v3'; fee: number };

type AggregatorQuotePlan = {
  swapMode: AggregatorSwapMode;
  minPaymentAmount: bigint;
  minTargetAmount: bigint;
};

function getOrCreateFallbackClient(rpcUrl: string) {
  const key = rpcUrl.toLowerCase();
  let client = fallbackClientCache.get(key);
  if (!client) {
    try {
      client = createHttpClient(rpcUrl);
      fallbackClientCache.set(key, client);
    } catch (error) {
      logger.warn('[Aggregator] 创建备用 RPC 客户端失败:', error?.message || error);
      return null;
    }
  }
  return client;
}

/**
 * Fallback Client 数组缓存
 * 避免每次调用都重新构建数组
 */
let cachedAggregatorFallbackClients: any[] | null = null;
let cachedAggregatorPrimaryClient: any = null;

function buildFallbackClients(primaryClient: any) {
  // 如果 primaryClient 没变，直接返回缓存的数组
  if (cachedAggregatorPrimaryClient === primaryClient && cachedAggregatorFallbackClients) {
    return cachedAggregatorFallbackClients;
  }

  // 重新构建数组
  const clients: any[] = [];
  V3_FALLBACK_RPC_URLS.forEach((rpcUrl) => {
    const fallbackClient = getOrCreateFallbackClient(rpcUrl);
    if (fallbackClient && fallbackClient !== primaryClient) {
      clients.push(fallbackClient);
    }
  });

  // 更新缓存
  cachedAggregatorPrimaryClient = primaryClient;
  cachedAggregatorFallbackClients = clients;

  return clients;
}

function isRecoverableRpcError(error: any) {
  const text = `${error?.shortMessage || ''} ${error?.details || ''} ${error?.message || ''}`.toLowerCase();
  if (!text) {
    return false;
  }
  return (
    text.includes('http request failed') ||
    text.includes('fetch failed') ||
    text.includes('unauthorized') ||
    text.includes('invalid api key') ||
    text.includes('missing or invalid parameters') ||
    text.includes('rate limit') ||
    text.includes('429') ||
    text.includes('timeout')
  );
}

async function readContractWithFallback(
  primaryClient: any,
  request: any,
  options?: { label?: string; quoteToken?: string }
) {
  const fallbackClients = buildFallbackClients(primaryClient);
  const clients = [primaryClient, ...fallbackClients];

  for (let index = 0; index < clients.length; index += 1) {
    const client = clients[index];
    try {
      return await client.readContract(request);
    } catch (error) {
      const recoverable = isRecoverableRpcError(error);
      const hasNext = index < clients.length - 1;
      if (recoverable && hasNext) {
        logger.warn(
          `[Aggregator] ${options?.label || 'V3 报价'}失败，尝试备用 RPC (${options?.quoteToken || 'unknown'}):`,
          error?.shortMessage || error?.message || error
        );
        continue;
      }
      throw error;
    }
  }
  throw new Error('V3 报价调用失败');
}

export function shouldUseCustomAggregator(
  settings: AggregatorRuntimeSettings | undefined,
  channelId: string,
  routeInfo?: AggregatorRouteInfo
) {
  if (!settings || !settings.enabled || settings.executionMode === 'legacy') {
    return false;
  }
  if (!SUPPORTED_CHANNELS.has(channelId)) {
    return false;
  }
  if (channelId === 'flap' && routeInfo?.metadata?.nativeToQuoteSwapEnabled) {
    return false;
  }
  if (!routeInfo?.quoteToken || isBnbQuote(routeInfo.quoteToken)) {
    return false;
  }
  const normalizedAddress = normalizeAggregatorAddress(settings.contractAddress);
  if (!normalizedAddress) {
    logger.warn('[Aggregator] 合约地址无效，自动回退到代码执行');
    return false;
  }
  return true;
}

export const AGGREGATOR_ERROR_CODES = {
  UNSUPPORTED_PATH: 'AGGREGATOR_UNSUPPORTED_PATH'
} as const;

export function isAggregatorUnsupportedError(error: any) {
  return error?.code === AGGREGATOR_ERROR_CODES.UNSUPPORTED_PATH;
}

function createUnsupportedPathError(cause?: any) {
  const unsupportedError = new Error('Aggregator unsupported quote path');
  (unsupportedError as any).code = AGGREGATOR_ERROR_CODES.UNSUPPORTED_PATH;
  if (cause) {
    (unsupportedError as any).cause = cause;
  }
  return unsupportedError;
}

function isDirectWbnbPath(path: readonly unknown[] | undefined, quoteToken: string) {
  if (!Array.isArray(path) || path.length !== 2) {
    return false;
  }
  return (
    normalizeAddress(path[0] as string) === normalizeAddress(CONTRACTS.WBNB) &&
    normalizeAddress(path[1] as string) === normalizeAddress(quoteToken)
  );
}

async function quoteViaPancakeV3(params: {
  publicClient: any;
  tokenIn: string;
  tokenOut: string;
  amountInWei: bigint;
  slippage?: number;
  preferredFee?: number;
}) {
  const { publicClient, tokenIn, tokenOut, amountInWei, slippage, preferredFee } = params;
  if (!CONTRACTS.PANCAKE_V3_FACTORY || !CONTRACTS.PANCAKE_V3_QUOTER) {
    throw new Error('Pancake V3 合约未配置');
  }
  const factoryAddress = CONTRACTS.PANCAKE_V3_FACTORY as Address;
  const quoterAddress = CONTRACTS.PANCAKE_V3_QUOTER as Address;
  let lastError: any = null;
  const feeCandidates = getAggregatorFeeCandidates(preferredFee);

  for (const fee of feeCandidates) {
    try {
      const pool = await readContractWithFallback(
        publicClient,
        {
          address: factoryAddress,
          abi: PANCAKE_V3_FACTORY_ABI,
          functionName: 'getPool',
          args: [tokenIn as Address, tokenOut as Address, fee]
        },
        { label: 'Pancake V3 getPool', quoteToken: tokenOut }
      );
      if (!pool || normalizeAddress(pool) === ZERO_ADDRESS) {
        continue;
      }
      const quoteResult = await readContractWithFallback(
        publicClient,
        {
          address: quoterAddress,
          abi: PANCAKE_V3_QUOTER_ABI,
          functionName: 'quoteExactInputSingle',
          args: [
            {
              tokenIn: tokenIn as Address,
              tokenOut: tokenOut as Address,
              amountIn: amountInWei,
              fee,
              sqrtPriceLimitX96: 0n
            }
          ]
        },
        { label: 'Pancake V3 quote', quoteToken: tokenOut }
      );
      const amountOut =
        typeof quoteResult === 'bigint'
          ? quoteResult
          : Array.isArray(quoteResult)
            ? quoteResult[0]
            : quoteResult?.amountOut;
      if (typeof amountOut !== 'bigint' || amountOut <= 0n) {
        continue;
      }
      const slippageBps = resolveSwapSlippageBps(slippage);
      const minQuote = amountOut * BigInt(10000 - slippageBps) / 10000n;
      if (minQuote <= 0n) {
        continue;
      }
      return { minQuote, fee };
    } catch (error) {
      lastError = error;
      continue;
    }
  }

  throw lastError || new Error('未找到匹配的 V3 流动池');
}

async function resolveV3FeeTier(publicClient: any, tokenA: string, tokenB: string) {
  if (!CONTRACTS.PANCAKE_V3_FACTORY) {
    return null;
  }
  for (const fee of V3_FEE_TIERS) {
    try {
      const pool = await readContractWithFallback(
        publicClient,
        {
          address: CONTRACTS.PANCAKE_V3_FACTORY,
          abi: PANCAKE_V3_FACTORY_ABI,
          functionName: 'getPool',
          args: [tokenA as Address, tokenB as Address, fee]
        },
        { label: 'Pancake V3 fee probe', quoteToken: tokenB }
      );
      if (pool && normalizeAddress(pool) !== ZERO_ADDRESS) {
        return fee;
      }
    } catch (error) {
      continue;
    }
  }
  return null;
}

async function planAggregatorQuoteSwap(params: {
  publicClient: any;
  quoteToken: string;
  amountInWei: bigint;
  slippage?: number;
}) {
  const { publicClient, quoteToken, amountInWei, slippage } = params;
  let lastError: any = null;

  const preset = resolveQuoteTokenPreset(quoteToken);
  if (preset && preset.path.length >= 2) {
    try {
      if (preset.swapMode === 'v2') {
        const presetQuote = await quotePancakeV2Path({
          publicClient,
          path: preset.path,
          amountIn: amountInWei,
          slippage
        });
        return {
          swapMode: { kind: 'v2' } as AggregatorSwapMode,
          minPaymentAmount: presetQuote.minQuote,
          minTargetAmount: 1n
        };
      }
      if (preset.swapMode === 'v3') {
        const tokenIn = preset.path[0];
        const tokenOut = preset.path[preset.path.length - 1];
        const v3Quote = await quoteViaPancakeV3({
          publicClient,
          tokenIn,
          tokenOut,
          amountInWei,
          slippage,
          preferredFee: preset.fee
        });
        return {
          swapMode: { kind: 'v3', fee: v3Quote.fee } as AggregatorSwapMode,
          minPaymentAmount: v3Quote.minQuote,
          minTargetAmount: 1n
        };
      }
    } catch (error) {
      lastError = error;
      logger.warn(
        `[Aggregator] 预设路径兑换失败(${quoteToken}):`,
        error?.message || error
      );
    }
  }

  try {
    const estimate = await estimateQuoteAmount({
      publicClient,
      quoteToken,
      amountInWei,
      slippage
    });
    if (isDirectWbnbPath(estimate.path, quoteToken)) {
      return {
        swapMode: { kind: 'v2' } as AggregatorSwapMode,
        minPaymentAmount: estimate.minQuote,
        minTargetAmount: 1n
      };
    }
    lastError = lastError || new Error('Direct path not supported');
  } catch (error) {
    lastError = error;
  }

  try {
    const directPath = [CONTRACTS.WBNB as Address, quoteToken as Address];
    const directQuote = await quotePancakeV2Path({
      publicClient,
      path: directPath,
      amountIn: amountInWei,
      slippage
    });
    return {
      swapMode: { kind: 'v2' } as AggregatorSwapMode,
      minPaymentAmount: directQuote.minQuote,
      minTargetAmount: 1n
    };
  } catch (error) {
    lastError = lastError || error;
  }

  const normalizedQuoteToken = normalizeAddress(quoteToken);
  if (V3_DIRECT_QUOTE_TOKENS.has(normalizedQuoteToken)) {
    try {
      const v3Quote = await quoteViaPancakeV3({
        publicClient,
        tokenIn: CONTRACTS.WBNB,
        tokenOut: quoteToken,
        amountInWei,
        slippage
      });
      return {
        swapMode: { kind: 'v3', fee: v3Quote.fee } as AggregatorSwapMode,
        minPaymentAmount: v3Quote.minQuote,
        minTargetAmount: 1n
      };
    } catch (error) {
      lastError = error;
      logger.warn(
        `[Aggregator] Pancake V3 兑换失败(${quoteToken}):`,
        error?.message || error
      );
    }
  }

  throw createUnsupportedPathError(lastError);
}

async function resolveSellSwapMode(publicClient: any, quoteToken: string): Promise<AggregatorSwapMode> {
  if (!shouldUseV3QuoteToken(quoteToken)) {
    return { kind: 'v2' };
  }
  try {
    const fee = await resolveV3FeeTier(publicClient, quoteToken, CONTRACTS.WBNB);
    if (typeof fee === 'number') {
      return { kind: 'v3', fee };
    }
  } catch (error) {
    logger.warn(
      `[Aggregator] 获取 V3 费率失败(${quoteToken}):`,
      error?.message || error
    );
  }
  return { kind: 'v2' };
}

export async function executeCustomAggregatorBuy(params: AggregatorBuyParams) {
  const fnStart = perf.now();
  const {
    channelId,
    tokenAddress,
    amountBnb,
    slippage,
    quoteToken,
    aggregatorAddress,
    routeInfo,
    publicClient,
    walletClient,
    account,
    chain,
    gasPriceWei,
    nonceExecutor
  } = params;

  // 5.2.1: 参数验证
  let stepStart = perf.now();
  const timer = new PerformanceTimer('agg-buy');
  const normalizedAggregator = normalizeAggregatorAddress(aggregatorAddress);
  if (!normalizedAggregator) {
    throw new Error('自定义合约地址无效');
  }
  if (!quoteToken) {
    throw new Error('缺少募集币种信息，无法执行合约交易');
  }

  const amountString = typeof amountBnb === 'string' ? amountBnb : `${amountBnb ?? 0}`;
  const amountWei = parseUnits(amountString, 18);
  if (amountWei <= 0n) {
    throw new Error('买入数量必须大于 0');
  }
  logger.debug(`[Aggregator] 参数验证完成 (${perf.measure(stepStart).toFixed(2)}ms)`);

  // 5.2.2: 规划 Quote 兑换路径
  stepStart = perf.now();
  const quotePlan = await planAggregatorQuoteSwap({
    publicClient,
    quoteToken,
    amountInWei: amountWei,
    slippage
  });
  const swapMode = quotePlan.swapMode;
  logger.debug(`[Aggregator] 规划 Quote 兑换路径完成 (${perf.measure(stepStart).toFixed(2)}ms)`, {
    swapMode: swapMode.kind,
    minPaymentAmount: quotePlan.minPaymentAmount.toString()
  });

  // 5.2.3: 构建交易参数
  stepStart = perf.now();
  const deadline = BigInt(Math.floor(Date.now() / 1000) + TX_CONFIG.DEADLINE_SECONDS);
  const args = buildAggregatorArgs(channelId, {
    tokenAddress,
    quoteToken,
    minPaymentAmount: quotePlan.minPaymentAmount,
    minTargetAmount: quotePlan.minTargetAmount,
    deadline,
    routeInfo,
    swapMode
  });
  const functionName = channelId === 'flap' ? 'buyFlap' : 'buyFourMeme';
  logger.debug(`[Aggregator] 构建交易参数完成 (${perf.measure(stepStart).toFixed(2)}ms)`);

  // 5.2.4: 执行买入交易
  stepStart = perf.now();
  logger.debug('[Aggregator] 使用自定义合约买入', {
    channelId,
    tokenAddress,
    quoteToken,
    contract: normalizedAggregator,
    mode: swapMode.kind
  });

  const txHash = await nonceExecutor('aggregator-buy', async (nonce) => {
    const hash = await walletClient.sendTransaction({
      account,
      chain,
      to: normalizedAggregator,
      nonce: BigInt(nonce),
      value: amountWei,
      gasPrice: gasPriceWei,
      gas: BigInt(TX_CONFIG.GAS_LIMIT?.FOUR_SWAP ?? 2_000_000),
      data: encodeFunctionData({
        abi: MEME_SWAP_AGGREGATOR_ABI,
        functionName,
        args
      })
    });
    return hash;
  });
  timer.step('send_tx');
  logger.debug(`[Aggregator] 执行买入交易完成 (${perf.measure(stepStart).toFixed(2)}ms)`, { txHash });

  logger.debug(`[Aggregator] ✅ 总耗时: ${perf.measure(fnStart).toFixed(2)}ms`);

  return txHash;
}

export async function executeCustomAggregatorSell(params: AggregatorSellParams) {
  const fnStart = perf.now();
  const {
    channelId,
    tokenAddress,
    percent,
    slippage,
    aggregatorAddress,
    routeInfo,
    publicClient,
    walletClient,
    account,
    chain,
    gasPriceWei,
    nonceExecutor
  } = params;

  // 5.2.1: 参数验证
  let stepStart = perf.now();
  if (!FOUR_AGGREGATOR_CHANNELS.has(channelId)) {
    throw createUnsupportedPathError(new Error(`Sell aggregator not supported for ${channelId}`));
  }

  const normalizedAggregator = normalizeAggregatorAddress(aggregatorAddress);
  if (!normalizedAggregator) {
    throw new Error('自定义合约地址无效');
  }

  const quoteToken = routeInfo?.quoteToken;
  if (!quoteToken || isBnbQuote(quoteToken)) {
    throw new Error('缺少募集币种信息，无法执行合约卖出');
  }

  const percentValue = Number(percent);
  if (!Number.isFinite(percentValue) || percentValue <= 0) {
    throw new Error('卖出比例无效');
  }
  const sellPercent = Math.min(100, Math.max(1, Math.floor(percentValue)));
  logger.debug(`[Aggregator] 参数验证完成 (${perf.measure(stepStart).toFixed(2)}ms)`);

  // 5.2.2: 准备卖出状态（查询余额和授权）
  stepStart = perf.now();
  const fourTokenManager = CONTRACTS.FOUR_TOKEN_MANAGER_V2 as Address;
  const aggregatorSpender = normalizedAggregator as Address;
  const quoteAllowanceCacheKey = createAllowanceCacheKey(quoteToken, account.address, aggregatorSpender);
  const sellState = await prepareTokenSell({
    publicClient,
    tokenAddress,
    accountAddress: account.address,
    spenderAddress: fourTokenManager,
    percent: sellPercent,
    options: { requireGweiPrecision: true }
  });
  const amountToSell = sellState.amountToSell;
  if (amountToSell <= 0n) {
    throw new Error('卖出数量必须大于 0');
  }
  logger.debug(`[Aggregator] 准备卖出状态完成 (${perf.measure(stepStart).toFixed(2)}ms)`, {
    amountToSell: amountToSell.toString()
  });

  // 5.2.3: 确保代币授权（Token -> FourTokenManager）
  stepStart = perf.now();
  const timer = new PerformanceTimer('agg-sell');
  await ensureAggregatorTokenApproval({
    publicClient,
    walletClient,
    account,
    chain,
    tokenAddress,
    spender: fourTokenManager,
    amount: amountToSell,
    currentAllowance: sellState.allowance,
    totalSupply: sellState.totalSupply,
    gasPriceWei,
    nonceExecutor
  });
  logger.debug(`[Aggregator] 确保代币授权完成 (${perf.measure(stepStart).toFixed(2)}ms)`);

  // 5.2.4: 确保 Quote Token 授权（Quote -> Aggregator）
  stepStart = perf.now();
  const quoteAllowance = await readAllowanceOrZero(
    publicClient,
    quoteToken,
    account.address,
    aggregatorSpender,
    quoteAllowanceCacheKey
  );
  const quoteApproveTarget = await readTotalSupplyOrFallback(publicClient, quoteToken);
  const quoteApproveThreshold = quoteApproveTarget > LARGE_ALLOWANCE_THRESHOLD
    ? LARGE_ALLOWANCE_THRESHOLD
    : quoteApproveTarget;

  await ensureAggregatorTokenApproval({
    publicClient,
    walletClient,
    account,
    chain,
    tokenAddress: quoteToken,
    spender: normalizedAggregator,
    amount: quoteApproveThreshold,
    currentAllowance: quoteAllowance,
    totalSupply: quoteApproveTarget,
    gasPriceWei,
    nonceExecutor,
    allowanceCacheKey: quoteAllowanceCacheKey
  });
  logger.debug(`[Aggregator] 确保 Quote Token 授权完成 (${perf.measure(stepStart).toFixed(2)}ms)`);

  // 5.2.5: 构建交易参数
  stepStart = perf.now();
  const swapMode = await resolveSellSwapMode(publicClient, quoteToken);
  const minPaymentAmount = 0n;
  const minBnbAmount = 1n;
  const deadline = BigInt(Math.floor(Date.now() / 1000) + TX_CONFIG.DEADLINE_SECONDS);
  const args = buildAggregatorSellArgs(channelId, {
    tokenAddress,
    quoteToken,
    amountToSell,
    minPaymentAmount,
    minBnbAmount,
    deadline,
    swapMode,
    routeInfo
  });

  logger.debug('[Aggregator] 使用自定义合约卖出', {
    channelId,
    tokenAddress,
    percent: sellPercent,
    quoteToken,
    mode: swapMode.kind
  });

  const txData = encodeFunctionData({
    abi: MEME_SWAP_AGGREGATOR_ABI,
    functionName: 'sellFourMeme',
    args
  });
  logger.debug(`[Aggregator] 构建交易参数完成 (${perf.measure(stepStart).toFixed(2)}ms)`);

  // 5.2.6: 模拟交易
  stepStart = perf.now();
  let simulationError: any = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      await publicClient.call({
        account: account.address,
        to: normalizedAggregator,
        data: txData,
        value: 0n
      });
      simulationError = null;
      break;
    } catch (error) {
      const shouldRetry = attempt === 0 && isAllowanceError(error);
      if (shouldRetry) {
        invalidateAllowanceCache(quoteAllowanceCacheKey);
        await ensureAggregatorTokenApproval({
          publicClient,
          walletClient,
          account,
          chain,
          tokenAddress: quoteToken,
          spender: normalizedAggregator,
          amount: quoteApproveThreshold,
          currentAllowance: 0n,
          totalSupply: quoteApproveTarget,
          gasPriceWei,
          nonceExecutor,
          allowanceCacheKey: quoteAllowanceCacheKey
        });
        continue;
      }
      simulationError = error;
      break;
    }
  }
  if (simulationError) {
    logger.warn('[Aggregator] 卖出模拟失败，回退到默认逻辑:', simulationError?.shortMessage || simulationError?.message || simulationError);
    throw createUnsupportedPathError(simulationError);
  }
  logger.debug(`[Aggregator] 模拟交易完成 (${perf.measure(stepStart).toFixed(2)}ms)`);

  // 5.2.7: 执行卖出交易
  stepStart = perf.now();
  const txHash = await nonceExecutor('aggregator-sell', async (nonce) => {
    const hash = await walletClient.sendTransaction({
      account,
      chain,
      to: normalizedAggregator,
      nonce: BigInt(nonce),
      value: 0n,
      gasPrice: gasPriceWei,
      gas: BigInt(TX_CONFIG.GAS_LIMIT?.FOUR_SWAP ?? 2_000_000),
      data: txData
    });
    return hash;
  });
  timer.step('send_tx');
  logger.debug(`[Aggregator] 执行卖出交易完成 (${perf.measure(stepStart).toFixed(2)}ms)`, { txHash });

  logger.debug(`[Aggregator] ✅ 总耗时: ${perf.measure(fnStart).toFixed(2)}ms`);

  return txHash;
}

function buildAggregatorArgs(
  channelId: string,
  params: {
    tokenAddress: string;
    quoteToken: string;
    minPaymentAmount: bigint;
    minTargetAmount: bigint;
    deadline: bigint;
    routeInfo?: AggregatorRouteInfo;
    swapMode: AggregatorSwapMode;
  }
): readonly unknown[] {
  const isV3 = params.swapMode.kind === 'v3';
  const router = (isV3 ? CONTRACTS.PANCAKE_SMART_ROUTER : CUSTOM_AGGREGATOR_CONFIG.ROUTER_ADDRESS) as Address;
  let activeFee = CUSTOM_AGGREGATOR_CONFIG.DEFAULT_V3_FEE as number;
  if (isV3) {
    activeFee = params.swapMode.kind === 'v3' ? params.swapMode.fee : activeFee;
  }
  const common = [router, isV3, activeFee] as const;

  if (channelId === 'flap') {
    const flapMethod =
      params.routeInfo?.metadata?.flapStateReader || CUSTOM_AGGREGATOR_CONFIG.DEFAULT_FLAP_METHOD;
    return [
      ...common,
      params.quoteToken as Address,
      CONTRACTS.FLAP_PORTAL as Address,
      params.tokenAddress as Address,
      flapMethod,
      params.minPaymentAmount,
      params.minTargetAmount,
      params.deadline
    ];
  }

  return [
    ...common,
    params.quoteToken as Address,
    CONTRACTS.FOUR_HELPER_V3 as Address,
    CONTRACTS.FOUR_TOKEN_MANAGER_V2 as Address,
    params.tokenAddress as Address,
    params.minPaymentAmount,
    params.minTargetAmount,
    params.deadline
  ];
}

function buildAggregatorSellArgs(
  channelId: string,
  params: {
    tokenAddress: string;
    quoteToken: string;
    amountToSell: bigint;
    minPaymentAmount: bigint;
    minBnbAmount: bigint;
    deadline: bigint;
    swapMode: AggregatorSwapMode;
    routeInfo?: AggregatorRouteInfo;
  }
): readonly unknown[] {
  if (!FOUR_AGGREGATOR_CHANNELS.has(channelId)) {
    throw createUnsupportedPathError(new Error(`Sell aggregator not implemented for channel ${channelId}`));
  }

  const isV3 = params.swapMode.kind === 'v3';
  const router = (isV3 ? CONTRACTS.PANCAKE_SMART_ROUTER : CUSTOM_AGGREGATOR_CONFIG.ROUTER_ADDRESS) as Address;
  const fee = params.swapMode.kind === 'v3' ? params.swapMode.fee : CUSTOM_AGGREGATOR_CONFIG.DEFAULT_V3_FEE;
  return [
    router,
    isV3,
    fee,
    params.tokenAddress as Address,
    CONTRACTS.FOUR_HELPER_V3 as Address,
    CONTRACTS.FOUR_TOKEN_MANAGER_V2 as Address,
    params.quoteToken as Address,
    params.amountToSell,
    params.minPaymentAmount,
    params.minBnbAmount,
    params.deadline
  ];
}

async function readAllowanceOrZero(publicClient: any, tokenAddress: string, owner: Address, spender: Address, cacheKey?: string) {
  const key = cacheKey || createAllowanceCacheKey(tokenAddress, owner, spender);
  const cached = getCachedAllowance(key);
  if (cached !== null) {
    return cached;
  }
  let allowance = 0n;
  try {
    allowance = await publicClient.readContract({
      address: tokenAddress as Address,
      abi: ERC20_ABI,
      functionName: 'allowance',
      args: [owner, spender]
    });
  } catch (error) {
    logger.debug('[Aggregator] 读取授权失败:', error?.message || error);
    allowance = 0n;
  }
  updateAllowanceCache(key, allowance);
  return allowance;
}

async function readTotalSupplyOrFallback(publicClient: any, tokenAddress: string) {
  try {
    const totalSupply = await publicClient.readContract({
      address: tokenAddress as Address,
      abi: ERC20_ABI,
      functionName: 'totalSupply'
    });
    if (typeof totalSupply === 'bigint' && totalSupply > 0n) {
      return totalSupply;
    }
  } catch (error) {
    logger.debug('[Aggregator] 读取 totalSupply 失败:', error?.message || error);
  }
  return UINT256_MAX;
}

async function ensureAggregatorTokenApproval(params: {
  publicClient: any;
  walletClient: any;
  account: { address: Address };
  chain: any;
  tokenAddress: string;
  spender: string;
  amount: bigint;
  currentAllowance: bigint;
  totalSupply: bigint;
  gasPriceWei: bigint;
  nonceExecutor: AggregatorContext['nonceExecutor'];
  allowanceCacheKey?: string | null;
}) {
  const { publicClient, walletClient, account, chain, tokenAddress, spender, amount, currentAllowance, totalSupply, gasPriceWei, nonceExecutor, allowanceCacheKey } = params;
  if (amount <= 0n) {
    return;
  }
  if (currentAllowance >= amount) {
    updateAllowanceCache(allowanceCacheKey, currentAllowance);
    return;
  }
  await nonceExecutor('aggregator-sell-approve', async (nonce) => {
    const hash = await walletClient.sendTransaction({
      account,
      chain,
      to: tokenAddress as Address,
      nonce: BigInt(nonce),
      gasPrice: gasPriceWei,
      data: encodeFunctionData({
        abi: ERC20_ABI,
        functionName: 'approve',
        args: [spender as Address, totalSupply]
      })
    });
    await publicClient.waitForTransactionReceipt({ hash });
    updateAllowanceCache(allowanceCacheKey, totalSupply);
    return hash;
  });
}
