import type { Address } from 'viem';
import { CONTRACTS, PANCAKE_FACTORY_ABI } from './trading-config.js';
import { getFourQuoteTokenList } from './channel-config.js';
import tokenManagerHelperAbi from '../../abis/token-manager-helper-v3.json';
import flapPortalAbi from '../../abis/flap-portal.json';
import lunaLaunchpadAbi from '../../abis/luna-fun-launchpad.json';

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

// Pair 地址缓存 - 避免重复查询同一个代币的 Pancake pair
// key: `${tokenAddress.toLowerCase()}-${quoteToken.toLowerCase()}`
// value: { pairAddress: string, timestamp: number }
const pancakePairCache = new Map<string, { pairAddress: string; quoteToken: string; timestamp: number }>();
const PAIR_CACHE_TTL = 10 * 60 * 1000; // 10分钟缓存

function isZeroAddress(value?: string | null) {
  if (typeof value !== 'string') {
    return false;
  }
  return value.toLowerCase() === ZERO_ADDRESS;
}

function isZeroLikeValue(value: any): boolean {
  if (value === null || value === undefined) {
    return true;
  }
  if (typeof value === 'boolean') {
    return value === false;
  }
  if (typeof value === 'number') {
    return value === 0;
  }
  if (typeof value === 'bigint') {
    return value === 0n;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) {
      return true;
    }
    if (trimmed === '0' || trimmed === '0x') {
      return true;
    }
    if (trimmed.startsWith('0x')) {
      return /^0x0+$/i.test(trimmed) || isZeroAddress(trimmed);
    }
    return false;
  }
  if (Array.isArray(value)) {
    return value.length === 0 || value.every(isZeroLikeValue);
  }
  if (typeof value === 'object') {
    const entries = Object.values(value);
    return entries.length === 0 || entries.every(isZeroLikeValue);
  }
  return false;
}

function isStructEffectivelyEmpty(struct: any) {
  if (!struct) {
    return true;
  }
  return isZeroLikeValue(struct);
}

export type TokenPlatform = 'four' | 'xmode' | 'flap' | 'luna' | 'unknown';

type PancakePairCheckResult = {
  hasLiquidity: boolean;
  quoteToken?: string;
  pairAddress?: string;
};

export type RouteFetchResult = {
  platform: TokenPlatform;
  preferredChannel: 'pancake' | 'four' | 'xmode' | 'flap';
  readyForPancake: boolean;
  progress: number;
  migrating: boolean;
  quoteToken?: string;
  metadata?: {
    name?: string;
    symbol?: string;
    nativeToQuoteSwapEnabled?: boolean;
    flapStateReader?: string;
    pancakeQuoteToken?: string;
    pancakePairAddress?: string;
    pancakePreferredMode?: 'v2' | 'v3';
  };
  notes?: string;
};

function normalizeAddress(address: string) {
  return (address || '').toLowerCase();
}

export function detectTokenPlatform(tokenAddress: string): TokenPlatform {
  const normalized = normalizeAddress(tokenAddress);
  if (!/^0x[a-f0-9]{40}$/.test(normalized)) {
    return 'unknown';
  }
  if (normalized.endsWith('4444')) {
    return 'four';
  }
  if (normalized.startsWith('0x4444')) {
    return 'xmode';
  }
  if (normalized.endsWith('7777') || normalized.endsWith('8888')) {
    return 'flap';
  }
  return 'luna';
}

const PLATFORM_FALLBACK_ORDER: TokenPlatform[] = ['four', 'xmode', 'flap', 'luna', 'unknown'];

function resolvePancakePreferredMode(quoteToken?: string | null) {
  if (!quoteToken) {
    return undefined;
  }
  const normalized = quoteToken.toLowerCase();
  const wbnb = CONTRACTS.WBNB?.toLowerCase();
  if (!normalized || !wbnb) {
    return undefined;
  }
  return normalized === wbnb ? undefined : 'v3';
}

function mergePancakeMetadata(
  metadata: Record<string, any> | undefined,
  pairInfo: PancakePairCheckResult
) {
  if (!pairInfo?.hasLiquidity) {
    return metadata;
  }
  const next = metadata ? { ...metadata } : {};
  if (pairInfo.quoteToken) {
    next.pancakeQuoteToken = pairInfo.quoteToken;
    const preferredMode = resolvePancakePreferredMode(pairInfo.quoteToken);
    if (preferredMode) {
      next.pancakePreferredMode = preferredMode;
    }
  }
  if (pairInfo.pairAddress) {
    next.pancakePairAddress = pairInfo.pairAddress;
  }
  return next;
}

async function checkPancakePair(
  publicClient: any,
  tokenAddress: Address,
  quoteToken?: Address | string | null
): Promise<PancakePairCheckResult> {
  const normalizedToken = tokenAddress.toLowerCase();

  // 检查缓存：如果之前查询过该代币，直接返回缓存结果
  const now = Date.now();
  const cacheKey = `${normalizedToken}`;
  const cached = pancakePairCache.get(cacheKey);
  if (cached && now - cached.timestamp < PAIR_CACHE_TTL) {
    return {
      hasLiquidity: true,
      quoteToken: cached.quoteToken,
      pairAddress: cached.pairAddress
    };
  }

  // 核心优化：如果明确传入了quoteToken，只查询这一个，不遍历其他候选
  // 因为Four.meme迁移到Pancake时会使用同一个quoteToken创建pair
  if (quoteToken && typeof quoteToken === 'string') {
    const normalizedQuote = quoteToken.toLowerCase();
    if (normalizedQuote && normalizedQuote !== ZERO_ADDRESS) {
      try {
        const pair = (await publicClient.readContract({
          address: CONTRACTS.PANCAKE_FACTORY,
          abi: PANCAKE_FACTORY_ABI,
          functionName: 'getPair',
          args: [tokenAddress, normalizedQuote as Address]
        })) as string;

        if (typeof pair === 'string' && pair !== ZERO_ADDRESS) {
          const result = {
            hasLiquidity: true,
            quoteToken: normalizedQuote,
            pairAddress: pair
          };
          // 缓存查询结果
          pancakePairCache.set(cacheKey, {
            pairAddress: pair,
            quoteToken: normalizedQuote,
            timestamp: now
          });
          return result;
        }
      } catch (error) {
        // 查询失败，继续执行兜底逻辑
      }

      // 如果明确的quoteToken没有找到pair，直接返回失败
      // 不再尝试其他候选（因为Four.meme不会换quote token）
      return { hasLiquidity: false };
    }
  }

  // 兜底逻辑：只在quoteToken未知时才遍历所有候选
  // 适用场景：Four.meme未返回quoteToken，或返回空值
  const candidates: string[] = [];
  [CONTRACTS.WBNB, CONTRACTS.BUSD, CONTRACTS.USDT, CONTRACTS.ASTER, CONTRACTS.USD1, CONTRACTS.UNITED_STABLES_U].forEach((token) => {
    if (token) {
      const normalized = token.toLowerCase();
      if (!candidates.includes(normalized)) {
        candidates.push(normalized);
      }
    }
  });
  getFourQuoteTokenList().forEach((token) => {
    const normalized = token.toLowerCase();
    if (!candidates.includes(normalized)) {
      candidates.push(normalized);
    }
  });

  // 并发查询所有候选token
  const pairPromises = candidates.map(async (candidate) => {
    try {
      const pair = (await publicClient.readContract({
        address: CONTRACTS.PANCAKE_FACTORY,
        abi: PANCAKE_FACTORY_ABI,
        functionName: 'getPair',
        args: [tokenAddress, candidate as Address]
      })) as string;
      if (typeof pair === 'string' && pair !== ZERO_ADDRESS) {
        return {
          hasLiquidity: true,
          quoteToken: candidate,
          pairAddress: pair
        };
      }
      return null;
    } catch {
      return null;
    }
  });

  // 等待所有查询完成，返回第一个有效结果
  const results = await Promise.all(pairPromises);
  for (const result of results) {
    if (result && result.hasLiquidity) {
      // 缓存查询结果
      pancakePairCache.set(cacheKey, {
        pairAddress: result.pairAddress,
        quoteToken: result.quoteToken,
        timestamp: now
      });
      return result;
    }
  }

  return { hasLiquidity: false };
}

function calculateRatio(current: bigint, target: bigint) {
  if (target === 0n) {
    return 0;
  }
  const scale = 10000n;
  const ratio = (current * scale) / target;
  return Number(ratio) / Number(scale);
}

async function fetchFourRoute(publicClient: any, tokenAddress: Address, platform: TokenPlatform): Promise<RouteFetchResult> {
  const info = await publicClient.readContract({
    address: CONTRACTS.FOUR_HELPER_V3 as Address,
    abi: tokenManagerHelperAbi as any,
    functionName: 'getTokenInfo',
    args: [tokenAddress]
  });

  const infoArray = Array.isArray(info) ? info : [];
  const rawLaunchTime = BigInt((info as any)?.launchTime ?? infoArray[6] ?? 0n);
  const quoteCandidate =
    (info as any)?.quote ||
    (info as any)?.quoteToken ||
    (typeof infoArray[2] === 'string' ? infoArray[2] : undefined);

  if ((rawLaunchTime === 0n && isStructEffectivelyEmpty(info)) || (!quoteCandidate && isStructEffectivelyEmpty(info))) {
    const pancakePair = await checkPancakePair(publicClient, tokenAddress, quoteCandidate as Address);
    if (pancakePair.hasLiquidity) {
      return {
        platform,
        preferredChannel: 'pancake',
        readyForPancake: true,
        progress: 1,
        migrating: false,
        metadata: mergePancakeMetadata(undefined, pancakePair),
        notes: 'Four.meme helper 返回空数据，自动切换 Pancake'
      };
    }
    throw new Error('Four.meme helper 未返回有效数据');
  }

  let liquidityAdded = Boolean(info?.liquidityAdded ?? infoArray[11]);
  const offers = BigInt(info?.offers ?? infoArray[7] ?? 0n);
  const maxOffers = BigInt(info?.maxOffers ?? infoArray[8] ?? 0n);
  const funds = BigInt(info?.funds ?? infoArray[9] ?? 0n);
  const maxFunds = BigInt(info?.maxFunds ?? infoArray[10] ?? 0n);
  const quoteToken = quoteCandidate;
  const normalizedQuote = typeof quoteToken === 'string' ? quoteToken : undefined;

  // 核心优化：完全信任 Four.meme 的 liquidityAdded 状态
  //
  // 未迁移时（liquidityAdded=false）：
  //   - 使用 Four.meme 合约交易
  //   - 合约内部自动处理 BNB → 筹集币种 → 代币
  //   - 不需要查询 Pancake 是否有 pair
  //
  // 已迁移时（liquidityAdded=true）：
  //   - 使用 Pancake 交易
  //   - 调用 helper.getPancakePair() 获取实际的 LP 地址
  //   - Helper 直接返回正确的 pair 地址，无需通过 Factory 查询
  let pancakePair: PancakePairCheckResult | null = null;
  if (liquidityAdded) {
    // 已迁移：调用 helper.getPancakePair() 获取实际 LP 地址
    try {
      const pairAddress = (await publicClient.readContract({
        address: CONTRACTS.FOUR_HELPER_V3 as Address,
        abi: tokenManagerHelperAbi as any,
        functionName: 'getPancakePair',
        args: [tokenAddress]
      })) as string;

      if (pairAddress && !isZeroAddress(pairAddress)) {
        pancakePair = {
          hasLiquidity: true,
          quoteToken: normalizedQuote,
          pairAddress: pairAddress
        };
      }
    } catch (error) {
      // getPancakePair 调用失败，回退到使用 quoteToken
      if (normalizedQuote) {
        pancakePair = {
          hasLiquidity: true,
          quoteToken: normalizedQuote,
          pairAddress: undefined
        };
      }
    }
  }
  // 注意：完全删除了未迁移时查询 Pancake 的逻辑
  // 因为未迁移时应该用 Four.meme 合约，不需要关心 Pancake

  const offerProgress = maxOffers > 0n ? calculateRatio(offers, maxOffers) : null;
  const fundProgress = maxFunds > 0n ? calculateRatio(funds, maxFunds) : null;
  const progress = fundProgress ?? offerProgress ?? 0;
  const migrating = !liquidityAdded && (fundProgress ?? offerProgress ?? 0) >= 0.99;

  const baseChannel: 'four' | 'xmode' = platform === 'xmode' ? 'xmode' : 'four';

  const metadata = mergePancakeMetadata(
    {
      symbol: (info as any)?.symbol,
      name: (info as any)?.name
    },
    pancakePair ?? { hasLiquidity: false }
  );

  return {
    platform,
    preferredChannel: liquidityAdded ? 'pancake' : baseChannel,
    readyForPancake: liquidityAdded,
    progress,
    migrating,
    quoteToken: normalizedQuote,
    metadata
  };
}

type FlapStateReader = {
  functionName: string;
};

const FLAP_STATE_READERS: FlapStateReader[] = [
  { functionName: 'getTokenV7' },
  { functionName: 'getTokenV6' },
  { functionName: 'getTokenV5' },
  { functionName: 'getTokenV4' },
  { functionName: 'getTokenV3' },
  { functionName: 'getTokenV2' }
];

async function fetchFlapRoute(publicClient: any, tokenAddress: Address): Promise<RouteFetchResult> {
  let state: any = null;
  let stateReaderUsed: string | null = null;
  for (const reader of FLAP_STATE_READERS) {
    try {
      const result = await publicClient.readContract({
        address: CONTRACTS.FLAP_PORTAL as Address,
        abi: flapPortalAbi as any,
        functionName: reader.functionName,
        args: [tokenAddress]
      });
      state = result?.state ?? result;
      if (state) {
        stateReaderUsed = reader.functionName;
        break;
      }
    } catch (error: any) {
      const msg = String(error?.message || error || '');
      if (msg.includes('function selector')) {
        continue;
      }
    }
  }

  if (!state || isStructEffectivelyEmpty(state)) {
    const fallbackPair = await checkPancakePair(publicClient, tokenAddress);
    if (fallbackPair.hasLiquidity) {
      return {
        platform: 'unknown',
        preferredChannel: 'pancake',
        readyForPancake: true,
        progress: 1,
        migrating: false,
        metadata: mergePancakeMetadata(undefined, fallbackPair),
        notes: 'Flap Portal 无记录或返回空状态，自动切换 Pancake'
      };
    }
    throw new Error('Flap Portal 未返回有效数据');
  }

  const reserve = BigInt(state.reserve ?? 0n);
  const threshold = BigInt(state.dexSupplyThresh ?? 0n);
  const pool = typeof state.pool === 'string' ? state.pool.toLowerCase() : ZERO_ADDRESS;

  let progress = 0;
  if (threshold > 0n) {
    progress = calculateRatio(reserve, threshold);
  }

  const quoteTokenAddress =
    (state as any)?.quoteTokenAddress ||
    (state as any)?.quoteToken ||
    (Array.isArray(state) ? state[7] : undefined);
  const normalizedQuote =
    typeof quoteTokenAddress === 'string' && quoteTokenAddress !== ZERO_ADDRESS
      ? quoteTokenAddress
      : undefined;

  // 信任 Flap 返回的状态
  // pool 地址存在且不为零地址，说明已迁移到 Pancake
  let readyForPancake = Boolean(pool && pool !== ZERO_ADDRESS);
  let pancakePair: PancakePairCheckResult | null = readyForPancake
    ? { hasLiquidity: true, quoteToken: normalizedQuote, pairAddress: pool }
    : null;
  // 删除：未迁移时不查询 Pancake（应该用 Flap 合约交易）
  // if (!readyForPancake) {
  //   pancakePair = await checkPancakePair(publicClient, tokenAddress, quoteTokenAddress);
  //   readyForPancake = pancakePair.hasLiquidity;
  // }
  const migrating = !readyForPancake && progress >= 0.99;

  return {
    platform: 'flap',
    preferredChannel: readyForPancake ? 'pancake' : 'flap',
    readyForPancake,
    progress,
    migrating,
    quoteToken: normalizedQuote,
    metadata: mergePancakeMetadata(
      {
        nativeToQuoteSwapEnabled: Boolean((state as any)?.nativeToQuoteSwapEnabled),
        flapStateReader: stateReaderUsed || undefined
      },
      pancakePair ?? { hasLiquidity: false }
    )
  };
}

async function fetchLunaRoute(publicClient: any, tokenAddress: Address): Promise<RouteFetchResult> {
  const info = await publicClient.readContract({
    address: CONTRACTS.LUNA_FUN_LAUNCHPAD as Address,
    abi: lunaLaunchpadAbi as any,
    functionName: 'tokenInfo',
    args: [tokenAddress]
  });

  const infoArray = Array.isArray(info) ? info : [];
  const reportedToken =
    (info as any)?.token ||
    (typeof infoArray[1] === 'string' ? infoArray[1] : undefined);
  const metaToken =
    (info as any)?.data?.token ||
    (typeof infoArray[3]?.token === 'string' ? infoArray[3].token : undefined);
  const normalizedInput = tokenAddress.toLowerCase();
  const normalizedReported = typeof reportedToken === 'string' ? reportedToken.toLowerCase() : '';
  const normalizedMeta = typeof metaToken === 'string' ? metaToken.toLowerCase() : '';
  const invalidLunaInfo =
    isStructEffectivelyEmpty(info) ||
    (normalizedReported && normalizedReported !== normalizedInput) ||
    (normalizedMeta && normalizedMeta !== normalizedInput);
  if (invalidLunaInfo) {
    const fallbackPair = await checkPancakePair(publicClient, tokenAddress);
    if (fallbackPair.hasLiquidity) {
      return {
        platform: 'luna',
        preferredChannel: 'pancake',
        readyForPancake: true,
        progress: 1,
        migrating: false,
        metadata: mergePancakeMetadata(undefined, fallbackPair),
        notes: 'Luna Launchpad 返回空数据，自动切换 Pancake'
      };
    }
    throw new Error('Luna Launchpad 未返回有效数据');
  }

  const pairValue = (info as any)?.pair || (Array.isArray(info) ? info[2] : undefined) || '';
  const pair = typeof pairValue === 'string' ? pairValue.toLowerCase() : '';
  const tradingOnUniswap = Boolean((info as any)?.tradingOnUniswap ?? (Array.isArray(info) ? info[8] : undefined));
  const quoteToken =
    (info as any)?.quote ||
    (info as any)?.data?.quote ||
    (Array.isArray(info) ? info[3] : undefined);

  // 信任 Luna 返回的状态
  // pair 地址存在 + tradingOnUniswap=true 说明已迁移
  let readyForPancake = pair && pair !== ZERO_ADDRESS && tradingOnUniswap;
  let pancakePair: PancakePairCheckResult | null = readyForPancake
    ? { hasLiquidity: true, quoteToken: quoteToken as string, pairAddress: pair }
    : null;
  // 删除：未迁移时不查询 Pancake（应该用 Luna 合约交易）
  // if (!readyForPancake) {
  //   pancakePair = await checkPancakePair(publicClient, tokenAddress, quoteToken as Address);
  //   readyForPancake = pancakePair.hasLiquidity;
  // }

  return {
    platform: 'luna',
    preferredChannel: 'pancake',
    readyForPancake,
    progress: readyForPancake ? 1 : 0,
    migrating: false,
    metadata: mergePancakeMetadata(
      {
      name: info?.data?.name,
      symbol: info?.data?.ticker
      },
      pancakePair ?? { hasLiquidity: false }
    )
  };
}

async function fetchDefaultRoute(publicClient: any, tokenAddress: Address): Promise<RouteFetchResult> {
  const pancakePair = await checkPancakePair(publicClient, tokenAddress);
  const readyForPancake = pancakePair.hasLiquidity;
  return {
    platform: 'unknown',
    preferredChannel: 'pancake',
    readyForPancake,
    progress: readyForPancake ? 1 : 0,
    migrating: false,
    metadata: mergePancakeMetadata(undefined, pancakePair)
  };
}

export async function fetchTokenRouteState(publicClient: any, tokenAddress: Address, platform: TokenPlatform): Promise<RouteFetchResult> {
  switch (platform) {
    case 'four':
    case 'xmode':
      return fetchFourRoute(publicClient, tokenAddress, platform);
    case 'flap':
      return fetchFlapRoute(publicClient, tokenAddress);
    case 'luna':
      return fetchLunaRoute(publicClient, tokenAddress);
    default:
      return fetchDefaultRoute(publicClient, tokenAddress);
  }
}

function shouldFallbackRoute(route: RouteFetchResult) {
  if (route.preferredChannel !== 'pancake') {
    return false;
  }
  return !route.readyForPancake;
}

function buildPlatformProbeOrder(initial: TokenPlatform) {
  const order: TokenPlatform[] = [];
  if (initial) {
    order.push(initial);
  }
  PLATFORM_FALLBACK_ORDER.forEach((platform) => {
    if (!order.includes(platform)) {
      order.push(platform);
    }
  });
  return order;
}

export async function fetchRouteWithFallback(
  publicClient: any,
  tokenAddress: Address,
  initialPlatform: TokenPlatform
): Promise<RouteFetchResult> {
  const tried = new Set<TokenPlatform>();
  const order = buildPlatformProbeOrder(initialPlatform);
  let lastValidRoute: RouteFetchResult | null = null;
  let lastError: unknown = null;

  for (const platform of order) {
    if (tried.has(platform)) {
      continue;
    }
    tried.add(platform);
    try {
      const route = await fetchTokenRouteState(publicClient, tokenAddress, platform);
      // 删除：不应该"智能检测"Pancake流动性并覆盖平台状态
      // 完全信任平台返回的 preferredChannel
      // if (route.preferredChannel !== 'pancake') {
      //   const pancakePair = await checkPancakePair(publicClient, tokenAddress, route.quoteToken as Address);
      //   if (pancakePair.hasLiquidity) {
      //     route = {
      //       ...route,
      //       preferredChannel: 'pancake',
      //       readyForPancake: true,
      //       progress: 1,
      //       migrating: false,
      //       metadata: mergePancakeMetadata(route.metadata, pancakePair),
      //       notes: '检测到 Pancake 流动性，已自动切换'
      //     };
      //   }
      // }
      lastValidRoute = route;
      if (!shouldFallbackRoute(route)) {
        return route;
      }
      // If Pancake has流动性才返回，否则尝试下一个平台
    } catch (error) {
      lastError = error;
    }
  }

  if (lastValidRoute) {
    return lastValidRoute;
  }

  if (lastError) {
    throw lastError;
  }

  return {
    platform: 'unknown',
    preferredChannel: 'pancake',
    readyForPancake: true,
    progress: 1,
    migrating: false
  };
}
