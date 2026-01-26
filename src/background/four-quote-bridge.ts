import '../shared/sw-polyfills.js';
import type { Address } from 'viem';
import { logger } from '../shared/logger.js';
import { encodeFunctionData, createHttpClient } from '../shared/viem-helper.js';
import {
  CONTRACTS,
  ERC20_ABI,
  ROUTER_ABI,
  TX_CONFIG,
  BACKGROUND_TASK_CONFIG,
  PANCAKE_V3_FACTORY_ABI,
  PANCAKE_V3_QUOTER_ABI,
  PANCAKE_V3_SMART_ROUTER_ABI,
  NETWORK_CONFIG,
  QUOTE_TOKEN_POOL_CONFIG
} from '../shared/trading-config.js';
import {
  resolveFourQuoteTokenLabel,
  getFourBridgeTokenList
} from '../shared/channel-config.js';

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

const QUOTE_SWAP_PATHS: Record<string, Address[]> = {};
export type QuoteTokenPreset = {
  swapMode: 'v2' | 'v3';
  path: Address[];
  fee?: number;
};
const V3_FEE_TIERS = [100, 250, 500, 2500, 10000];
const V3_DIRECT_QUOTE_TOKENS = new Set(
  [
    CONTRACTS.USD1,
    CONTRACTS.UNITED_STABLES_U,
    CONTRACTS.USDT,
    CONTRACTS.BUSD,
    CONTRACTS.CAKE
  ]
    .filter((token): token is string => Boolean(token))
    .map((token) => token.toLowerCase())
    .filter(Boolean)
);
const V3_FALLBACK_RPC_URLS = [
  NETWORK_CONFIG.BSC_RPC,
  ...(NETWORK_CONFIG.BSC_RPC_FALLBACK ?? [])
]
  .map((url) => url?.trim())
  .filter((url): url is string => Boolean(url));
const v3ClientCache = new Map<string, any>();

if (CONTRACTS.BUSD && CONTRACTS.USD1) {
  QUOTE_SWAP_PATHS[CONTRACTS.USD1.toLowerCase()] = [
    CONTRACTS.WBNB as Address,
    CONTRACTS.BUSD as Address,
    CONTRACTS.USD1 as Address
  ];
}

if (CONTRACTS.BUSD && CONTRACTS.UNITED_STABLES_U) {
  QUOTE_SWAP_PATHS[CONTRACTS.UNITED_STABLES_U.toLowerCase()] = [
    CONTRACTS.WBNB as Address,
    CONTRACTS.BUSD as Address,
    CONTRACTS.UNITED_STABLES_U as Address
  ];
}

Object.entries(QUOTE_TOKEN_POOL_CONFIG).forEach(([token, preset]) => {
  if (!token || !preset?.path || preset.path.length < 2) {
    return;
  }
  try {
    QUOTE_SWAP_PATHS[token] = preset.path.map((addr) => addr as Address);
  } catch (error) {
    logger.warn('[FourQuote] 预设路径注册失败:', error?.message || error);
  }
});

type AllowanceCacheEntry = {
  amount: bigint;
  updatedAt: number;
};
const allowanceCache = new Map<string, AllowanceCacheEntry>();
const ALLOWANCE_CACHE_TTL = BACKGROUND_TASK_CONFIG.QUOTE_ALLOWANCE_CACHE_TTL_MS ?? 5 * 60 * 1000;
function getCachedAllowance(key: string) {
  const cached = allowanceCache.get(key);
  if (!cached) {
    return null;
  }
  if (Date.now() - cached.updatedAt > ALLOWANCE_CACHE_TTL) {
    allowanceCache.delete(key);
    return null;
  }
  return cached.amount;
}

function setCachedAllowance(key: string, amount: bigint) {
  allowanceCache.set(key, { amount, updatedAt: Date.now() });
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
const MIN_BRIDGE_SLIPPAGE_BPS = 300; // 3% 保障，避免多跳路径导致频繁回滚

export function normalizeAddress(value?: string | null) {
  return typeof value === 'string' ? value.toLowerCase() : '';
}

export function resolveQuoteTokenName(address?: string | null) {
  return resolveFourQuoteTokenLabel(address);
}

export function isBnbQuote(address?: string | null) {
  const normalized = normalizeAddress(address);
  return !normalized || normalized === ZERO_ADDRESS || normalized === CONTRACTS.WBNB.toLowerCase();
}

function shouldUseV3QuoteToken(address?: string | null) {
  const normalized = normalizeAddress(address);
  return normalized ? V3_DIRECT_QUOTE_TOKENS.has(normalized) : false;
}

function getOrCreateV3Client(rpcUrl: string) {
  const key = rpcUrl.toLowerCase();
  let client = v3ClientCache.get(key);
  if (!client) {
    try {
      client = createHttpClient(rpcUrl);
      v3ClientCache.set(key, client);
    } catch (error) {
      logger.warn('[FourQuote] 创建 V3 备用 RPC 客户端失败:', error?.message || error);
      return null;
    }
  }
  return client;
}

function buildV3FallbackClients(primaryClient: any) {
  const clients: any[] = [];
  V3_FALLBACK_RPC_URLS.forEach((rpcUrl) => {
    const fallbackClient = getOrCreateV3Client(rpcUrl);
    if (fallbackClient && fallbackClient !== primaryClient) {
      clients.push(fallbackClient);
    }
  });
  return clients;
}

function isRecoverableV3Error(error: any) {
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

async function readContractWithV3Fallback(
  primaryClient: any,
  request: any,
  options?: { label?: string; quoteToken?: string }
) {
  const fallbackClients = buildV3FallbackClients(primaryClient);
  const clients = [primaryClient, ...fallbackClients];
  for (let index = 0; index < clients.length; index += 1) {
    const client = clients[index];
    try {
      return await client.readContract(request);
    } catch (error) {
      const recoverable = isRecoverableV3Error(error);
      const hasNext = index < clients.length - 1;
      if (recoverable && hasNext) {
        logger.warn(
          `[FourQuote] ${options?.label || 'V3 调用'}失败，尝试备用 RPC (${options?.quoteToken || 'unknown'})`,
          error?.shortMessage || error?.message || error
        );
        continue;
      }
      throw error;
    }
  }
  throw new Error('V3 调用失败');
}

async function quoteViaPancakeV3(params: {
  publicClient: any;
  tokenIn: string;
  tokenOut: string;
  amountIn: bigint;
  slippage?: number;
  label?: string;
  preferredFee?: number;
}) {
  const { publicClient, tokenIn, tokenOut, amountIn, slippage, label, preferredFee } = params;
  if (!CONTRACTS.PANCAKE_V3_FACTORY || !CONTRACTS.PANCAKE_V3_QUOTER) {
    throw new Error('Pancake V3 合约未配置');
  }
  let lastError: any = null;
  const requestedFee = typeof preferredFee === 'number' ? preferredFee : null;
  const feeCandidates =
    requestedFee !== null
      ? [requestedFee, ...V3_FEE_TIERS.filter((fee) => fee !== requestedFee)]
      : V3_FEE_TIERS;
  for (const fee of feeCandidates) {
    try {
      const pool = await readContractWithV3Fallback(
        publicClient,
        {
          address: CONTRACTS.PANCAKE_V3_FACTORY,
          abi: PANCAKE_V3_FACTORY_ABI,
          functionName: 'getPool',
          args: [tokenIn as Address, tokenOut as Address, fee]
        },
        { label: 'Pancake V3 getPool', quoteToken: tokenOut }
      );
      if (!pool || normalizeAddress(pool) === ZERO_ADDRESS) {
        continue;
      }
      const quoteResult = await readContractWithV3Fallback(
        publicClient,
        {
          address: CONTRACTS.PANCAKE_V3_QUOTER,
          abi: PANCAKE_V3_QUOTER_ABI,
          functionName: 'quoteExactInputSingle',
          args: [
            {
              tokenIn: tokenIn as Address,
              tokenOut: tokenOut as Address,
              amountIn,
              fee,
              sqrtPriceLimitX96: 0n
            }
          ]
        },
        { label: label || 'Pancake V3 quote', quoteToken: tokenOut }
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
      const minAmount = amountOut * BigInt(10000 - slippageBps) / 10000n;
      if (minAmount <= 0n) {
        continue;
      }
      return { amountOut, minAmount, fee, slippageBps };
    } catch (error) {
      lastError = error;
      continue;
    }
  }
  throw lastError || new Error('未找到匹配的 V3 流动池');
}

export function resolveQuoteTokenPreset(address?: string | null): QuoteTokenPreset | null {
  const normalized = normalizeAddress(address);
  if (!normalized) {
    return null;
  }
  const preset = QUOTE_TOKEN_POOL_CONFIG[normalized];
  if (!preset) {
    return null;
  }
  const basePath =
    Array.isArray(preset.path) && preset.path.length >= 2
      ? preset.path
      : [CONTRACTS.WBNB, normalized];
  const normalizedPath = basePath.map((token) => token as Address);
  return {
    swapMode: preset.swapMode,
    path: normalizedPath,
    fee: preset.fee
  };
}

export async function quotePancakeV2Path(params: {
  publicClient: any;
  path: Address[];
  amountIn: bigint;
  slippage?: number;
}) {
  const { publicClient, path, amountIn, slippage } = params;
  if (!CONTRACTS.PANCAKE_ROUTER) {
    throw new Error('Pancake V2 Router 未配置');
  }
  if (!Array.isArray(path) || path.length < 2) {
    throw new Error('无效的 V2 兑换路径');
  }
  const amountsOut = await publicClient.readContract({
    address: CONTRACTS.PANCAKE_ROUTER as Address,
    abi: ROUTER_ABI,
    functionName: 'getAmountsOut',
    args: [amountIn, path]
  });
  const expected = amountsOut[amountsOut.length - 1];
  if (typeof expected !== 'bigint' || expected <= 0n) {
    throw new Error('V2 报价无效');
  }
  const slippageBps = resolveSwapSlippageBps(slippage);
  const minQuote = expected * BigInt(10000 - slippageBps) / 10000n;
  if (minQuote <= 0n) {
    throw new Error('V2 报价滑点无效');
  }
  return { expected, minQuote, slippageBps };
}

function resolveQuoteSwapCandidates(quoteToken: string, direction: 'buy' | 'sell'): Address[][] {
  if (shouldUseV3QuoteToken(quoteToken)) {
    return [];
  }
  const normalized = normalizeAddress(quoteToken);
  const configured = normalized ? QUOTE_SWAP_PATHS[normalized] : undefined;
  const candidates: Address[][] = [];
  const addPath = (path: Address[]) => {
    if (path.length < 2) return;
    const key = path.join('-');
    if (!candidates.some((p) => p.join('-') === key)) {
      candidates.push(path);
    }
  };

  if (configured && configured.length >= 2) {
    addPath(direction === 'buy' ? configured : [...configured].reverse());
  }

  const bridgeTokens = getFourBridgeTokenList();
  bridgeTokens.forEach((bridgeToken) => {
    if (!bridgeToken || normalizeAddress(bridgeToken) === normalized) {
      return;
    }
    const bridgePath =
      direction === 'buy'
        ? [CONTRACTS.WBNB as Address, bridgeToken as Address, quoteToken as Address]
        : [quoteToken as Address, bridgeToken as Address, CONTRACTS.WBNB as Address];
    addPath(bridgePath);
  });

  const defaultPath =
    direction === 'buy'
      ? [CONTRACTS.WBNB as Address, quoteToken as Address]
      : [quoteToken as Address, CONTRACTS.WBNB as Address];
  addPath(defaultPath);

  return candidates;
}

async function selectSwapPath(params: {
  publicClient: any;
  quoteToken: string;
  amountIn: bigint;
  direction: 'buy' | 'sell';
}) {
  const { publicClient, quoteToken, amountIn, direction } = params;
  const candidates = resolveQuoteSwapCandidates(quoteToken, direction);
  let lastError: any = null;
  for (const path of candidates) {
    try {
      const amountsOut = await publicClient.readContract({
        address: CONTRACTS.PANCAKE_ROUTER,
        abi: ROUTER_ABI,
        functionName: 'getAmountsOut',
        args: [amountIn, path]
      });
      const expected = amountsOut[amountsOut.length - 1];
      if (typeof expected === 'bigint' && expected > 0n) {
        return { path, expected };
      }
    } catch (error) {
      lastError = error;
      continue;
    }
  }
  throw lastError || new Error('未找到可用的兑换路径');
}

export type SwapContext = {
  publicClient: any;
  walletClient: any;
  account: { address: Address };
  chain: any;
  gasPrice?: bigint | number;
  nonceExecutor: <T>(label: string, sender: (nonce: number) => Promise<T>) => Promise<T>;
};

type QuoteEstimateResult = {
  path?: Address[];
  expected: bigint;
  minQuote: bigint;
  slippageBps: number;
  mode: 'v2' | 'v3';
  v3Fee?: number;
};

function slippageToBps(slippage?: number) {
  if (!slippage || slippage <= 0) {
    return 0;
  }
  const bps = Math.floor(slippage * 100);
  if (bps < 0) return 0;
  if (bps > 9500) return 9500;
  return bps;
}

export function resolveSwapSlippageBps(slippage?: number) {
  const requested = slippageToBps(slippage);
  if (requested === 0) {
    return MIN_BRIDGE_SLIPPAGE_BPS;
  }
  return Math.max(requested, MIN_BRIDGE_SLIPPAGE_BPS);
}

export async function estimateQuoteAmount(params: {
  publicClient: any;
  quoteToken: string;
  amountInWei: bigint;
  slippage?: number;
  direction?: 'buy' | 'sell';
}): Promise<QuoteEstimateResult> {
  const { publicClient, quoteToken, amountInWei, slippage, direction = 'buy' } = params;
  const preset = resolveQuoteTokenPreset(quoteToken);
  if (preset && preset.path.length >= 2) {
    if (preset.swapMode === 'v2') {
      const path = direction === 'buy' ? preset.path : [...preset.path].reverse();
      const { expected, minQuote, slippageBps } = await quotePancakeV2Path({
        publicClient,
        path,
        amountIn: amountInWei,
        slippage
      });
      return {
        path,
        expected,
        minQuote,
        slippageBps,
        mode: 'v2' as const
      };
    }
    if (preset.swapMode === 'v3') {
      const tokenIn = direction === 'buy' ? preset.path[0] : preset.path[preset.path.length - 1];
      const tokenOut = direction === 'buy' ? preset.path[preset.path.length - 1] : preset.path[0];
      const v3Quote = await quoteViaPancakeV3({
        publicClient,
        tokenIn,
        tokenOut,
        amountIn: amountInWei,
        slippage,
        preferredFee: preset.fee,
        label: direction === 'buy' ? 'V3 预设买入报价' : 'V3 预设卖出报价'
      });
      return {
        path: undefined,
        expected: v3Quote.amountOut,
        minQuote: v3Quote.minAmount,
        slippageBps: v3Quote.slippageBps,
        mode: 'v3' as const,
        v3Fee: v3Quote.fee
      };
    }
  }
  const useV3 = shouldUseV3QuoteToken(quoteToken);
  if (useV3) {
    const tokenIn = direction === 'buy' ? CONTRACTS.WBNB : quoteToken;
    const tokenOut = direction === 'buy' ? quoteToken : CONTRACTS.WBNB;
    const v3Quote = await quoteViaPancakeV3({
      publicClient,
      tokenIn,
      tokenOut,
      amountIn: amountInWei,
      slippage,
      label: direction === 'buy' ? 'V3 买入报价' : 'V3 卖出报价'
    });
    return {
      path: undefined,
      expected: v3Quote.amountOut,
      minQuote: v3Quote.minAmount,
      slippageBps: v3Quote.slippageBps,
      mode: 'v3' as const,
      v3Fee: v3Quote.fee
    };
  }

  const { path, expected } = await selectSwapPath({
    publicClient,
    quoteToken,
    amountIn: amountInWei,
    direction
  });
  const slippageBps = resolveSwapSlippageBps(slippage);
  const minQuote = expected * BigInt(10000 - slippageBps) / 10000n;
  return { path, expected, minQuote, slippageBps, mode: 'v2' as const };
}

export async function estimateQuoteToBnbAmount(params: {
  publicClient: any;
  quoteToken: string;
  amountInWei: bigint;
}): Promise<bigint | null> {
  const { publicClient, quoteToken, amountInWei } = params;
  if (!publicClient || !quoteToken || amountInWei <= 0n) {
    return null;
  }
  if (isBnbQuote(quoteToken)) {
    return amountInWei;
  }
  try {
    const estimate = await estimateQuoteAmount({
      publicClient,
      quoteToken,
      amountInWei,
      direction: 'sell'
    });
    return estimate.expected;
  } catch (error) {
    logger.debug('[FourQuote] 募集币估值失败:', error?.message || error);
    return null;
  }
}

async function getTokenBalance(publicClient: any, token: string, owner: string, blockNumber?: bigint) {
  if (!token || !publicClient || !owner) return 0n;
  try {
    return await publicClient.readContract({
      address: token,
      abi: ERC20_ABI,
      functionName: 'balanceOf',
      args: [owner as Address],
      ...(blockNumber ? { blockNumber } : {})
    });
  } catch (error) {
    if (blockNumber) {
      return await getTokenBalance(publicClient, token, owner);
    }
    throw error;
  }
}

async function ensureAllowance(params: {
  publicClient: any;
  walletClient: any;
  account: { address: Address };
  chain: any;
  token: string;
  spender: string;
  required: bigint;
  nonceExecutor: SwapContext['nonceExecutor'];
}) {
  const { publicClient, walletClient, account, chain, token, spender, required, nonceExecutor } = params;
  if (required <= 0n) {
    return;
  }
  const cacheKey = `${token.toLowerCase()}:${spender.toLowerCase()}`;
  const cached = getCachedAllowance(cacheKey);
  if (cached !== undefined && cached >= required) {
    return;
  }
  const current = await publicClient.readContract({
    address: token,
    abi: ERC20_ABI,
    functionName: 'allowance',
    args: [account.address, spender as Address]
  });
  if (current >= required) {
    setCachedAllowance(cacheKey, current);
    return;
  }

  const total = await publicClient.readContract({
    address: token,
    abi: ERC20_ABI,
    functionName: 'totalSupply'
  });

  await nonceExecutor('quote-approve', async (nonce) => {
    const txHash = await walletClient.sendTransaction({
      account,
      chain,
      to: token,
      nonce: BigInt(nonce),
      data: encodeFunctionData({
        abi: ERC20_ABI,
        functionName: 'approve',
        args: [spender as Address, total]
      })
    });
    await publicClient.waitForTransactionReceipt({ hash: txHash });
    setCachedAllowance(cacheKey, total);
    return txHash;
  });
}

export async function ensureQuoteAllowance(params: {
  quoteToken: string;
  spender: string;
  amount: bigint;
  context: SwapContext;
}) {
  const { quoteToken, spender, amount, context } = params;
  if (amount <= 0n) {
    return;
  }
  await ensureAllowance({
    publicClient: context.publicClient,
    walletClient: context.walletClient,
    account: context.account,
    chain: context.chain,
    token: quoteToken,
    spender,
    required: amount,
    nonceExecutor: context.nonceExecutor
  });
}

export async function swapBnbForQuote(params: {
  quoteToken: string;
  amountInWei: bigint;
  slippage?: number;
  context: SwapContext;
}) {
  const { quoteToken, amountInWei, slippage, context } = params;
  const { publicClient, walletClient, account, chain, gasPrice, nonceExecutor } = context;
  const estimate = await estimateQuoteAmount({ publicClient, quoteToken, amountInWei, slippage });
  if (estimate.mode === 'v3') {
    return await swapBnbForQuoteV3({
      quoteToken,
      amountInWei,
      minQuote: estimate.minQuote,
      expected: estimate.expected,
      fee: estimate.v3Fee,
      context
    });
  }
  const { path, expected, minQuote } = estimate;
  const before = await getTokenBalance(publicClient, quoteToken, account.address);

  const deadline = Math.floor(Date.now() / 1000) + TX_CONFIG.DEADLINE_SECONDS;
  let receiptBlock: bigint | undefined;
  const txHash = await nonceExecutor('swap-bnb-quote', async (nonce) => {
    const hash = await walletClient.sendTransaction({
      account,
      chain,
      to: CONTRACTS.PANCAKE_ROUTER,
      nonce: BigInt(nonce),
      value: amountInWei,
      gasPrice,
      data: encodeFunctionData({
        abi: ROUTER_ABI,
        functionName: 'swapExactETHForTokens',
        args: [minQuote, path, account.address, BigInt(deadline)]
      })
    });
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    receiptBlock = receipt?.blockNumber;
    return hash;
  });

  let after = await getTokenBalance(publicClient, quoteToken, account.address, receiptBlock);
  let received = after > before ? after - before : 0n;
  if (received <= 0n) {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await delay(150 * (attempt + 1));
      after = await getTokenBalance(publicClient, quoteToken, account.address);
      if (after > before) {
        received = after - before;
        break;
      }
    }
  }
  return { txHash, quoteAmount: received, minQuote, expected };
}

async function swapBnbForQuoteV3(params: {
  quoteToken: string;
  amountInWei: bigint;
  minQuote: bigint;
  expected: bigint;
  fee?: number;
  context: SwapContext;
}) {
  const { quoteToken, amountInWei, minQuote, expected, fee, context } = params;
  if (!CONTRACTS.PANCAKE_SMART_ROUTER) {
    throw new Error('Pancake V3 Router 未配置');
  }
  if (typeof fee !== 'number') {
    throw new Error('缺少 V3 费率信息');
  }
  const { publicClient, walletClient, account, chain, gasPrice, nonceExecutor } = context;
  const before = await getTokenBalance(publicClient, quoteToken, account.address);

  let receiptBlock: bigint | undefined;
  const txHash = await nonceExecutor('swap-bnb-quote-v3', async (nonce) => {
    const data = encodeFunctionData({
      abi: PANCAKE_V3_SMART_ROUTER_ABI,
      functionName: 'exactInputSingle',
      args: [
        {
          tokenIn: CONTRACTS.WBNB as Address,
          tokenOut: quoteToken as Address,
          fee,
          recipient: account.address,
          amountIn: amountInWei,
          amountOutMinimum: minQuote,
          sqrtPriceLimitX96: 0n
        }
      ]
    });
    const hash = await walletClient.sendTransaction({
      account,
      chain,
      to: CONTRACTS.PANCAKE_SMART_ROUTER,
      nonce: BigInt(nonce),
      value: amountInWei,
      gasPrice,
      data
    });
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    receiptBlock = receipt?.blockNumber;
    return hash;
  });

  let after = await getTokenBalance(publicClient, quoteToken, account.address, receiptBlock);
  let received = after > before ? after - before : 0n;
  if (received <= 0n) {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await delay(150 * (attempt + 1));
      after = await getTokenBalance(publicClient, quoteToken, account.address);
      if (after > before) {
        received = after - before;
        break;
      }
    }
  }
  return { txHash, quoteAmount: received, minQuote, expected };
}

export async function swapQuoteForBnb(params: {
  quoteToken: string;
  amountIn: bigint;
  slippage?: number;
  context: SwapContext;
}) {
  const { quoteToken, amountIn, slippage, context } = params;
  if (amountIn <= 0n) {
    return { txHash: null, received: 0n };
  }
  const { publicClient, walletClient, account, chain, gasPrice, nonceExecutor } = context;
  const availableBalance = await getTokenBalance(publicClient, quoteToken, account.address);
  if (availableBalance <= 0n) {
    return { txHash: null, received: 0n };
  }
  const amountToSwap = amountIn > availableBalance ? availableBalance : amountIn;
  const useV3 = shouldUseV3QuoteToken(quoteToken);
  const routerAddress = useV3 ? CONTRACTS.PANCAKE_SMART_ROUTER : CONTRACTS.PANCAKE_ROUTER;
  if (!routerAddress) {
    throw new Error('Pancake Router 未配置');
  }
  await ensureAllowance({
    publicClient,
    walletClient,
    account,
    chain,
    token: quoteToken,
    spender: routerAddress,
    required: amountToSwap,
    nonceExecutor
  });
  if (useV3) {
    return await swapQuoteForBnbV3({
      quoteToken,
      amountIn: amountToSwap,
      slippage,
      context
    });
  }

  const { path, expected } = await selectSwapPath({
    publicClient,
    quoteToken,
    amountIn: amountToSwap,
    direction: 'sell'
  });
  const slippageBps = resolveSwapSlippageBps(slippage);
  const minBnb = expected * BigInt(10000 - slippageBps) / 10000n;
  const deadline = Math.floor(Date.now() / 1000) + TX_CONFIG.DEADLINE_SECONDS;

  const txHash = await nonceExecutor('swap-quote-bnb', async (nonce) => {
    const hash = await walletClient.sendTransaction({
      account,
      chain,
      to: CONTRACTS.PANCAKE_ROUTER,
      nonce: BigInt(nonce),
      gasPrice,
      data: encodeFunctionData({
        abi: ROUTER_ABI,
        functionName: 'swapExactTokensForETH',
        args: [amountToSwap, minBnb, path, account.address, BigInt(deadline)]
      })
    });
    await publicClient.waitForTransactionReceipt({ hash });
    return hash;
  });

  return { txHash };
}

async function swapQuoteForBnbV3(params: {
  quoteToken: string;
  amountIn: bigint;
  slippage?: number;
  context: SwapContext;
}) {
  const { quoteToken, amountIn, slippage, context } = params;
  if (!CONTRACTS.PANCAKE_SMART_ROUTER) {
    throw new Error('Pancake V3 Router 未配置');
  }
  const { publicClient, walletClient, account, chain, gasPrice, nonceExecutor } = context;
  const v3Quote = await quoteViaPancakeV3({
    publicClient,
    tokenIn: quoteToken,
    tokenOut: CONTRACTS.WBNB,
    amountIn,
    slippage,
    label: 'V3 卖出报价'
  });
  const fee = v3Quote.fee;
  if (typeof fee !== 'number') {
    throw new Error('缺少 V3 费率信息');
  }
  const swapData = encodeFunctionData({
    abi: PANCAKE_V3_SMART_ROUTER_ABI,
    functionName: 'exactInputSingle',
    args: [
      {
        tokenIn: quoteToken as Address,
        tokenOut: CONTRACTS.WBNB as Address,
        fee,
        recipient: CONTRACTS.PANCAKE_SMART_ROUTER as Address,
        amountIn,
        amountOutMinimum: v3Quote.minAmount,
        sqrtPriceLimitX96: 0n
      }
    ]
  });
  const unwrapData = encodeFunctionData({
    abi: PANCAKE_V3_SMART_ROUTER_ABI,
    functionName: 'unwrapWETH9',
    args: [0n, account.address]
  });
  const multicallData = encodeFunctionData({
    abi: PANCAKE_V3_SMART_ROUTER_ABI,
    functionName: 'multicall',
    args: [[swapData, unwrapData]]
  });

  const txHash = await nonceExecutor('swap-quote-bnb-v3', async (nonce) => {
    const hash = await walletClient.sendTransaction({
      account,
      chain,
      to: CONTRACTS.PANCAKE_SMART_ROUTER,
      nonce: BigInt(nonce),
      gasPrice,
      data: multicallData
    });
    await publicClient.waitForTransactionReceipt({ hash });
    return hash;
  });

  return { txHash };
}

export async function ensureTokenManagerQuoteApproval(params: {
  quoteToken: string;
  amount: bigint;
  context: SwapContext;
}) {
  const { quoteToken, amount, context } = params;
  await ensureAllowance({
    publicClient: context.publicClient,
    walletClient: context.walletClient,
    account: context.account,
    chain: context.chain,
    token: quoteToken,
    spender: CONTRACTS.FOUR_TOKEN_MANAGER_V2,
    required: amount,
    nonceExecutor: context.nonceExecutor
  });
}

export async function getQuoteBalance(publicClient: any, quoteToken: string, owner: string) {
  return await getTokenBalance(publicClient, quoteToken, owner);
}

export async function prepareQuoteFunds(params: {
  tokenAddress: string;
  quoteToken: string;
  amountInWei: bigint;
  slippage: number;
  spender: string;
  swapContext: SwapContext;
  publicClient: any;
  walletAddress: string;
}): Promise<{ quoteAmount: bigint; usedWalletQuote: boolean }> {
  const { tokenAddress, quoteToken, amountInWei, slippage, spender, swapContext, publicClient, walletAddress } = params;

  // 并发优化：同时查询价格估算和钱包余额
  const [quoteEstimate, walletQuoteBalance] = await Promise.all([
    estimateQuoteAmount({
      publicClient,
      quoteToken,
      amountInWei,
      slippage
    }),
    getTokenBalance(publicClient, quoteToken, walletAddress)
  ]);

  const targetQuoteAmount = quoteEstimate.expected;
  let quoteAmount: bigint = 0n;
  let usedWalletQuote = false;

  if (walletQuoteBalance >= targetQuoteAmount && targetQuoteAmount > 0n) {
    await ensureQuoteAllowance({
      quoteToken,
      spender,
      amount: targetQuoteAmount,
      context: swapContext
    });
    quoteAmount = targetQuoteAmount;
    usedWalletQuote = true;
    logger.debug('[QuoteBridge] 复用现有募集币种余额', {
      token: tokenAddress,
      quoteToken,
      required: targetQuoteAmount.toString(),
      walletQuoteBalance: walletQuoteBalance.toString()
    });
  } else {
    const approvalPromise = ensureQuoteAllowance({
      quoteToken,
      spender,
      amount: targetQuoteAmount,
      context: swapContext
    });
    const swapPromise = swapBnbForQuote({
      quoteToken,
      amountInWei,
      slippage,
      context: swapContext
    });
    const [swapResult] = await Promise.all([swapPromise, approvalPromise]);
    quoteAmount = BigInt(swapResult?.quoteAmount ?? 0n);

    if (!quoteAmount || quoteAmount <= 0n) {
      const label = resolveQuoteTokenName(quoteToken);
      throw new Error(`兑换 ${label} 失败，请稍后重试`);
    }
    if (quoteAmount > targetQuoteAmount) {
      await ensureQuoteAllowance({
        quoteToken,
        spender,
        amount: quoteAmount,
        context: swapContext
      });
    }
  }

  return { quoteAmount, usedWalletQuote };
}
