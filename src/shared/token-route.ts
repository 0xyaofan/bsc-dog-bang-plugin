import type { Address } from 'viem';
import { calculateRatio as calculateRatioSDK } from './pancake-sdk-utils.js';
import { CONTRACTS, PANCAKE_FACTORY_ABI, PANCAKE_V3_FACTORY_ABI } from './trading-config.js';
import { getFourQuoteTokenList } from './channel-config.js';
import { logger } from './logger.js';
import tokenManagerHelperAbi from '../../abis/fourmeme/TokenManagerHelper3.abi.json';
import flapPortalAbi from '../../abis/flap-portal.json';
import lunaLaunchpadAbi from '../../abis/luna-fun-launchpad.json';

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

// Pair ABI - 用于查询储备量
const PAIR_ABI = [
  {
    inputs: [],
    name: 'getReserves',
    outputs: [
      { internalType: 'uint112', name: 'reserve0', type: 'uint112' },
      { internalType: 'uint112', name: 'reserve1', type: 'uint112' },
      { internalType: 'uint32', name: 'blockTimestampLast', type: 'uint32' }
    ],
    stateMutability: 'view',
    type: 'function'
  },
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

// 最小流动性要求（以报价代币计）
// 对于稳定币（USDT/BUSD/USDC/USD1）：至少 $100
// 对于 WBNB：至少 0.2 BNB（约 $100）
// 对于其他代币：至少 100 个代币
const MIN_LIQUIDITY_THRESHOLDS = {
  // 稳定币（18 decimals）
  [CONTRACTS.USDT?.toLowerCase() ?? '']: BigInt(100 * 1e18),
  [CONTRACTS.BUSD?.toLowerCase() ?? '']: BigInt(100 * 1e18),
  [CONTRACTS.USDC?.toLowerCase() ?? '']: BigInt(100 * 1e18),
  [CONTRACTS.USD1?.toLowerCase() ?? '']: BigInt(100 * 1e18),
  // WBNB（18 decimals）
  [CONTRACTS.WBNB?.toLowerCase() ?? '']: BigInt(0.2 * 1e18),
  // 默认阈值
  default: BigInt(100 * 1e18)
};

/**
 * 检查配对的流动性是否足够
 * @param publicClient Viem public client
 * @param pairAddress 配对地址
 * @param tokenAddress 目标代币地址
 * @param quoteToken 报价代币地址
 * @returns true 表示流动性足够，false 表示流动性不足
 */
async function checkPairLiquidity(
  publicClient: any,
  pairAddress: string,
  tokenAddress: string,
  quoteToken: string
): Promise<boolean> {
  try {
    // 查询储备量
    const reserves = await publicClient.readContract({
      address: pairAddress as Address,
      abi: PAIR_ABI,
      functionName: 'getReserves'
    });

    // 查询 token0 和 token1
    const [token0, token1] = await Promise.all([
      publicClient.readContract({
        address: pairAddress as Address,
        abi: PAIR_ABI,
        functionName: 'token0'
      }),
      publicClient.readContract({
        address: pairAddress as Address,
        abi: PAIR_ABI,
        functionName: 'token1'
      })
    ]);

    // 确定哪个是报价代币的储备量
    const normalizedToken0 = (token0 as string).toLowerCase();
    const normalizedToken1 = (token1 as string).toLowerCase();
    const normalizedQuote = quoteToken.toLowerCase();
    const normalizedTarget = tokenAddress.toLowerCase();

    let quoteReserve: bigint;
    if (normalizedToken0 === normalizedQuote) {
      quoteReserve = reserves[0] as bigint;
    } else if (normalizedToken1 === normalizedQuote) {
      quoteReserve = reserves[1] as bigint;
    } else {
      logger.error('[checkPairLiquidity] 报价代币不匹配:', {
        pairAddress,
        token0,
        token1,
        quoteToken
      });
      return false;
    }

    // 获取最小流动性阈值
    const threshold = MIN_LIQUIDITY_THRESHOLDS[normalizedQuote] || MIN_LIQUIDITY_THRESHOLDS.default;

    // 检查流动性是否足够
    const hasEnoughLiquidity = quoteReserve >= threshold;

    if (!hasEnoughLiquidity) {
      logger.warn('[checkPairLiquidity] 流动性不足:', {
        pairAddress,
        quoteToken,
        quoteReserve: quoteReserve.toString(),
        threshold: threshold.toString(),
        ratio: Number(quoteReserve) / Number(threshold)
      });
    } else {
      logger.debug('[checkPairLiquidity] 流动性充足:', {
        pairAddress,
        quoteToken,
        quoteReserve: quoteReserve.toString()
      });
    }

    return hasEnoughLiquidity;
  } catch (error) {
    logger.error('[checkPairLiquidity] 查询流动性失败:', error);
    return false;
  }
}

// V3 Pool ABI - 用于查询流动性
const V3_POOL_ABI = [
  {
    inputs: [],
    name: 'liquidity',
    outputs: [{ internalType: 'uint128', name: '', type: 'uint128' }],
    stateMutability: 'view',
    type: 'function'
  },
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

// V3 池子最小流动性阈值（liquidity 值）
// V3 的 liquidity 是 sqrt(amount0 * amount1)，所以阈值需要相应调整
const MIN_V3_LIQUIDITY = BigInt(1e10); // 约等于 sqrt(100 * 1e18 * 100 * 1e18) 的数量级

/**
 * 检查 V3 池子的流动性是否足够
 * @param publicClient Viem public client
 * @param poolAddress 池子地址
 * @returns true 表示流动性足够，false 表示流动性不足
 */
async function checkV3PoolLiquidity(
  publicClient: any,
  poolAddress: string
): Promise<boolean> {
  try {
    // 查询 V3 池子的流动性
    const liquidity = await publicClient.readContract({
      address: poolAddress as Address,
      abi: V3_POOL_ABI,
      functionName: 'liquidity'
    }) as bigint;

    const hasEnoughLiquidity = liquidity >= MIN_V3_LIQUIDITY;

    if (!hasEnoughLiquidity) {
      logger.warn('[checkV3PoolLiquidity] V3 池子流动性不足:', {
        poolAddress,
        liquidity: liquidity.toString(),
        threshold: MIN_V3_LIQUIDITY.toString(),
        ratio: Number(liquidity) / Number(MIN_V3_LIQUIDITY)
      });
    } else {
      logger.debug('[checkV3PoolLiquidity] V3 池子流动性充足:', {
        poolAddress,
        liquidity: liquidity.toString()
      });
    }

    return hasEnoughLiquidity;
  } catch (error) {
    logger.error('[checkV3PoolLiquidity] 查询 V3 流动性失败:', error);
    return false;
  }
}

// 路由信息缓存 - 支持多代币永久缓存
// key: tokenAddress (lowercase)
// value: { route, timestamp, migrationStatus }
type RouteCache = {
  route: RouteFetchResult;
  timestamp: number;
  migrationStatus: 'not_migrated' | 'migrated';
};

const routeCache = new Map<string, RouteCache>();

// 缓存管理函数
function getRouteCache(tokenAddress: string): RouteCache | undefined {
  const normalized = tokenAddress.toLowerCase();
  return routeCache.get(normalized);
}

function setRouteCache(tokenAddress: string, route: RouteFetchResult): void {
  const normalized = tokenAddress.toLowerCase();
  routeCache.set(normalized, {
    route,
    timestamp: Date.now(),
    migrationStatus: route.readyForPancake ? 'migrated' : 'not_migrated'
  });
}

function shouldUpdateRouteCache(
  tokenAddress: string,
  cachedRoute: RouteCache | undefined,
  currentRoute: RouteFetchResult
): boolean {
  // 1. 无缓存 → 更新
  if (!cachedRoute) return true;

  // 2. 迁移状态变化 → 更新
  const cachedMigrated = cachedRoute.migrationStatus === 'migrated';
  const currentMigrated = currentRoute.readyForPancake;
  if (cachedMigrated !== currentMigrated) return true;

  // 3. 迁移状态未变化 → 不更新（永久缓存）
  // 注意：未迁移和已迁移都使用永久缓存
  return false;
}

// 手动清除缓存（用于调试或强制刷新）
export function clearRouteCache(tokenAddress?: string): void {
  if (tokenAddress) {
    const normalized = tokenAddress.toLowerCase();
    routeCache.delete(normalized);
  } else {
    routeCache.clear();
  }
}

// 缓存清理策略 - 避免内存泄漏
const MAX_ROUTE_CACHE_SIZE = 50;

function cleanupRouteCache(): void {
  if (routeCache.size > MAX_ROUTE_CACHE_SIZE) {
    // 删除最旧的缓存项
    const entries = Array.from(routeCache.entries());
    entries.sort((a, b) => a[1].timestamp - b[1].timestamp);

    // 删除最旧的 10 个
    for (let i = 0; i < 10 && i < entries.length; i++) {
      routeCache.delete(entries[i][0]);
    }
  }
}

// Pair 地址缓存 - 避免重复查询同一个代币的 Pancake pair
// key: tokenAddress (lowercase)
// value: { pairAddress, quoteToken, version, timestamp }
// 永久缓存：Pancake pair 一旦创建就不会改变
const pancakePairCache = new Map<string, { pairAddress: string; quoteToken: string; version: 'v2' | 'v3'; timestamp: number }>();

// 特殊代币的配对映射 - 用于绕过 Service Worker 限制
// 当 RPC 查询因为 Service Worker 限制失败时，使用这些预定义的配对
const SPECIAL_PAIR_MAPPINGS: Record<string, { pairAddress: string; quoteToken: string; version: 'v2' | 'v3' }> = {
  // KDOG/KGST 配对
  '0x3753dd32cbc376ce6efd85f334b7289ae6d004af': {
    pairAddress: '0x14C90904dD8868c8E748e42D092250Ec17f748d1',
    quoteToken: '0x94be0bbA8E1E303fE998c9360B57b826F1A4f828', // KGST
    version: 'v2'
  }
};

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
  version?: 'v2' | 'v3'; // 🐛 修复：记录 pair 的协议版本
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
    pancakeVersion?: 'v2' | 'v3'; // 🐛 修复：记录 PancakeSwap 版本
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
  // TaxToken: 地址以 ffff 结尾，使用相同的 TokenManager2 合约
  if (normalized.endsWith('ffff')) {
    return 'four';
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
  // 优化：如果不匹配任何发射台模式，直接返回 'unknown'
  // 避免尝试所有发射台平台，节省 RPC 请求和时间
  return 'unknown';
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
  // 🐛 修复：记录 PancakeSwap 版本
  if (pairInfo.version) {
    next.pancakeVersion = pairInfo.version;
  }
  return next;
}

async function checkPancakePair(
  publicClient: any,
  tokenAddress: Address,
  quoteToken?: Address | string | null
): Promise<PancakePairCheckResult> {
  const normalizedToken = tokenAddress.toLowerCase();
  const now = Date.now(); // 用于记录缓存时间戳（用于清理策略，非TTL）

  // 检查特殊配对映射（用于绕过 Service Worker 限制）
  const specialPair = SPECIAL_PAIR_MAPPINGS[normalizedToken];
  if (specialPair) {
    logger.info('[checkPancakePair] 使用预定义的特殊配对:', {
      tokenAddress: normalizedToken,
      pairAddress: specialPair.pairAddress,
      quoteToken: specialPair.quoteToken,
      version: specialPair.version
    });

    // 缓存特殊配对
    pancakePairCache.set(normalizedToken, {
      pairAddress: specialPair.pairAddress,
      quoteToken: specialPair.quoteToken,
      version: specialPair.version,
      timestamp: now
    });

    return {
      hasLiquidity: true,
      quoteToken: specialPair.quoteToken,
      pairAddress: specialPair.pairAddress,
      version: specialPair.version
    };
  }

  // 检查缓存：如果之前查询过该代币，直接返回缓存结果（永久缓存）
  const cacheKey = `${normalizedToken}`;
  const cached = pancakePairCache.get(cacheKey);
  if (cached) {
    return {
      hasLiquidity: true,
      quoteToken: cached.quoteToken,
      pairAddress: cached.pairAddress,
      version: cached.version
    };
  }

  // 核心优化：如果明确传入了quoteToken，只查询这一个，不遍历其他候选
  // 因为Four.meme迁移到Pancake时会使用同一个quoteToken创建pair
  if (quoteToken && typeof quoteToken === 'string') {
    const normalizedQuote = quoteToken.toLowerCase();
    if (normalizedQuote && normalizedQuote !== ZERO_ADDRESS) {
      // 先尝试 V2 pair
      try {
        const pair = (await publicClient.readContract({
          address: CONTRACTS.PANCAKE_FACTORY,
          abi: PANCAKE_FACTORY_ABI,
          functionName: 'getPair',
          args: [tokenAddress, normalizedQuote as Address]
        })) as string;

        if (typeof pair === 'string' && pair !== ZERO_ADDRESS) {
          // 检查流动性
          const hasEnoughLiquidity = await checkPairLiquidity(
            publicClient,
            pair,
            tokenAddress,
            normalizedQuote
          );

          if (!hasEnoughLiquidity) {
            logger.warn('[checkPancakePair] V2 配对流动性不足，跳过:', pair);
            // 流动性不足，不缓存，继续尝试 V3
          } else {
            const result = {
              hasLiquidity: true,
              quoteToken: normalizedQuote,
              pairAddress: pair,
              version: 'v2' as const
            };
            // 缓存查询结果
            pancakePairCache.set(cacheKey, {
              pairAddress: pair,
              quoteToken: normalizedQuote,
              version: 'v2',
              timestamp: now
            });
            return result;
          }
        }
      } catch (error) {
        // V2 查询失败，继续尝试 V3
      }

      // 🐛 修复：V2 没有找到 pair，尝试查找 V3 pool
      // V3 使用 PoolFactory.getPool(tokenA, tokenB, fee) 查询
      // 常见的 fee 级别：100 (0.01%), 500 (0.05%), 2500 (0.25%), 10000 (1%)
      const v3Fees = [500, 2500, 10000, 100]; // 按常用程度排序
      for (const fee of v3Fees) {
        try {
          const pool = (await publicClient.readContract({
            address: CONTRACTS.PANCAKE_V3_FACTORY,
            abi: PANCAKE_V3_FACTORY_ABI,
            functionName: 'getPool',
            args: [tokenAddress, normalizedQuote as Address, fee]
          })) as string;

          if (typeof pool === 'string' && pool !== ZERO_ADDRESS) {
            // 检查 V3 池子流动性
            const hasEnoughLiquidity = await checkV3PoolLiquidity(publicClient, pool);

            if (!hasEnoughLiquidity) {
              logger.warn(`[checkPancakePair] V3 池子流动性不足 (fee=${fee})，跳过:`, pool);
              continue; // 尝试下一个 fee 级别
            }

            const result = {
              hasLiquidity: true,
              quoteToken: normalizedQuote,
              pairAddress: pool,
              version: 'v3' as const
            };
            // 缓存查询结果
            pancakePairCache.set(cacheKey, {
              pairAddress: pool,
              quoteToken: normalizedQuote,
              version: 'v3',
              timestamp: now
            });
            logger.debug(`[Route] 找到 V3 pool (fee=${fee}):`, pool);
            return result;
          }
        } catch (error) {
          // 继续尝试下一个 fee 级别
        }
      }

      // 如果明确的quoteToken在 V2 和 V3 都没有找到pair，直接返回失败
      // 不再尝试其他候选（因为Four.meme不会换quote token）
      return { hasLiquidity: false };
    }
  }

  // 兜底逻辑：只在quoteToken未知时才遍历所有候选
  // 适用场景：Four.meme未返回quoteToken，或返回空值
  const candidates: string[] = [];

  // 优先添加 Four.meme 的报价代币（包括 KGST, lisUSD 等）
  getFourQuoteTokenList().forEach((token) => {
    const normalized = token.toLowerCase();
    if (!candidates.includes(normalized)) {
      candidates.push(normalized);
    }
  });

  // 然后添加标准报价代币
  [CONTRACTS.WBNB, CONTRACTS.BUSD, CONTRACTS.USDT, CONTRACTS.ASTER, CONTRACTS.USD1, CONTRACTS.UNITED_STABLES_U].forEach((token) => {
    if (token) {
      const normalized = token.toLowerCase();
      if (!candidates.includes(normalized)) {
        candidates.push(normalized);
      }
    }
  });

  // 并发查询所有候选token
  logger.debug('[checkPancakePair] 开始查询候选配对:', {
    tokenAddress,
    candidatesCount: candidates.length,
    candidates: candidates.slice(0, 10) // 记录前10个候选
  });

  const pairPromises = candidates.map(async (candidate) => {
    try {
      const pair = (await publicClient.readContract({
        address: CONTRACTS.PANCAKE_FACTORY,
        abi: PANCAKE_FACTORY_ABI,
        functionName: 'getPair',
        args: [tokenAddress, candidate as Address]
      })) as string;

      if (typeof pair === 'string' && pair !== ZERO_ADDRESS) {
        logger.debug('[checkPancakePair] 找到配对:', { candidate, pair });

        // 查询储备量以获取流动性信息
        try {
          const reserves = await publicClient.readContract({
            address: pair as Address,
            abi: PAIR_ABI,
            functionName: 'getReserves'
          });

          const [token0, token1] = await Promise.all([
            publicClient.readContract({
              address: pair as Address,
              abi: PAIR_ABI,
              functionName: 'token0'
            }),
            publicClient.readContract({
              address: pair as Address,
              abi: PAIR_ABI,
              functionName: 'token1'
            })
          ]);

          // 确定报价代币的储备量
          const normalizedToken0 = (token0 as string).toLowerCase();
          const normalizedToken1 = (token1 as string).toLowerCase();
          const normalizedCandidate = candidate.toLowerCase();

          let quoteReserve: bigint;
          if (normalizedToken0 === normalizedCandidate) {
            quoteReserve = reserves[0] as bigint;
          } else if (normalizedToken1 === normalizedCandidate) {
            quoteReserve = reserves[1] as bigint;
          } else {
            logger.warn('[checkPancakePair] 报价代币不匹配，跳过:', { pair, candidate });
            return null;
          }

          // 获取最小流动性阈值
          const threshold = MIN_LIQUIDITY_THRESHOLDS[normalizedCandidate] || MIN_LIQUIDITY_THRESHOLDS.default;

          if (quoteReserve < threshold) {
            logger.warn('[checkPancakePair] 候选配对流动性不足，跳过:', {
              pair,
              quoteToken: candidate,
              quoteReserve: quoteReserve.toString(),
              threshold: threshold.toString()
            });
            return null;
          }

          logger.info('[checkPancakePair] 找到流动性充足的配对:', {
            pair,
            quoteToken: candidate,
            quoteReserve: quoteReserve.toString()
          });

          return {
            hasLiquidity: true,
            quoteToken: candidate,
            pairAddress: pair,
            liquidityAmount: quoteReserve // 保存流动性用于比较
          };
        } catch (error) {
          logger.error('[checkPancakePair] 查询储备量失败:', {
            candidate,
            pair,
            error: error instanceof Error ? error.message : String(error),
            stack: error instanceof Error ? error.stack : undefined
          });
          return null;
        }
      } else {
        logger.debug('[checkPancakePair] 配对不存在:', { candidate });
      }
      return null;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);

      // 检查是否是 Service Worker import 错误
      if (errorMsg.includes('import() is disallowed on ServiceWorkerGlobalScope')) {
        logger.warn('[checkPancakePair] Service Worker 限制，跳过流动性检查，假设配对存在');
        // 对于 Service Worker 限制，我们假设配对可能存在
        // 返回一个标记，表示需要跳过流动性检查
        return {
          hasLiquidity: true,
          quoteToken: candidate,
          pairAddress: 'unknown', // 标记为未知
          liquidityAmount: BigInt(1e20) // 给一个高流动性值，确保不会被过滤
        };
      }

      logger.error('[checkPancakePair] 查询配对失败:', {
        candidate,
        error: errorMsg,
        stack: error instanceof Error ? error.stack : undefined
      });
      return null;
    }
  });

  // 等待所有查询完成，选择流动性最大的配对
  const results = await Promise.all(pairPromises);
  const validResults = results.filter((r): r is NonNullable<typeof r> => r !== null && r.hasLiquidity);

  if (validResults.length === 0) {
    logger.warn('[checkPancakePair] 没有找到流动性充足的配对:', {
      tokenAddress,
      totalCandidates: candidates.length,
      candidates: candidates.slice(0, 5) // 只记录前5个候选
    });
    return { hasLiquidity: false };
  }

  // 过滤掉 pairAddress 为 'unknown' 的结果（Service Worker 限制导致的）
  const validPairsWithAddress = validResults.filter(r => r.pairAddress !== 'unknown');

  // 如果所有结果都是 'unknown'，说明遇到了 Service Worker 限制
  // 在这种情况下，我们返回 hasLiquidity: true，但不指定具体的配对
  // 让交易系统使用其他机制（如路径缓存）来处理
  if (validPairsWithAddress.length === 0) {
    logger.warn('[checkPancakePair] Service Worker 限制，无法查询配对，返回通用结果');
    return {
      hasLiquidity: true,
      quoteToken: undefined,
      pairAddress: undefined,
      version: 'v2' as const
    };
  }

  // 选择流动性最大的配对
  const bestResult = validPairsWithAddress.reduce((best, current) => {
    return current.liquidityAmount > best.liquidityAmount ? current : best;
  });

  logger.info('[checkPancakePair] 选择流动性最大的配对:', {
    pairAddress: bestResult.pairAddress,
    quoteToken: bestResult.quoteToken,
    liquidity: bestResult.liquidityAmount.toString(),
    totalCandidates: validPairsWithAddress.length
  });

  // 缓存查询结果（兜底逻辑只查询 V2）
  pancakePairCache.set(cacheKey, {
    pairAddress: bestResult.pairAddress,
    quoteToken: bestResult.quoteToken,
    version: 'v2',
    timestamp: now
  });

  return {
    hasLiquidity: true,
    quoteToken: bestResult.quoteToken,
    pairAddress: bestResult.pairAddress,
    version: 'v2' as const
  };
}

function calculateRatio(current: bigint, target: bigint): number {
  if (target === 0n) {
    return 0;
  }
  // 使用 PancakeSwap SDK 的 Fraction 进行精确计算，避免浮点数误差
  const fraction = calculateRatioSDK(current, target);
  return parseFloat(fraction.toSignificant(6));
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

  // 🐛 修复：只有在确认代币已迁移时才切换到 Pancake
  // 问题：当 Four.meme helper 返回的数据被判定为"空"时，会自动切换到 Pancake
  // 但对于未迁移代币，这是错误的！未迁移代币应该使用 Four.meme 合约
  //
  // 修复方案：
  // 1. 检查 liquidityAdded 状态（从 infoArray[11] 获取）
  // 2. 只有在 liquidityAdded = true 时才检查 Pancake
  // 3. 如果 liquidityAdded = false，直接抛出错误，让上层使用 fallback
  if ((rawLaunchTime === 0n && isStructEffectivelyEmpty(info)) || (!quoteCandidate && isStructEffectivelyEmpty(info))) {
    // 先检查 liquidityAdded 状态
    const liquidityAddedFromArray = Boolean(infoArray[11]);

    // 降低日志级别，避免噪音（只在第一次打印）
    const cacheKey = tokenAddress.toLowerCase();
    const existingCache = getRouteCache(cacheKey);
    if (!existingCache) {
      logger.warn(`[Route] Four.meme helper 返回空数据，liquidityAdded=${liquidityAddedFromArray}, token=${tokenAddress.slice(0, 10)}`);
    }

    // 只有在已迁移时才检查 Pancake
    if (liquidityAddedFromArray) {
      const pancakePair = await checkPancakePair(publicClient, tokenAddress, quoteCandidate as Address);
      if (pancakePair.hasLiquidity) {
        logger.info(`[Route] 代币已迁移，切换到 Pancake`);
        return {
          platform,
          preferredChannel: 'pancake',
          readyForPancake: true,
          progress: 1,
          migrating: false,
          metadata: mergePancakeMetadata(undefined, pancakePair),
          notes: 'Four.meme helper 返回空数据但代币已迁移，切换 Pancake'
        };
      }
    }

    // 未迁移或 Pancake 无流动性
    // 抛出特殊错误，让上层直接跳到 unknown 平台（Pancake）
    const error = new Error('Four.meme helper 未返回有效数据');
    (error as any).skipToUnknown = true; // 标记：跳过其他发射台，直接使用 Pancake
    throw error;
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
          pairAddress: pairAddress,
          version: 'v2' // Four.meme helper 返回的是 V2 pair
        };
      } else {
        // 🐛 修复：getPancakePair 返回零地址，通过 Factory 查找 V2/V3 pair
        logger.debug(`[Route] getPancakePair 返回零地址，尝试通过 Factory 查找 pair`);
        pancakePair = await checkPancakePair(publicClient, tokenAddress, normalizedQuote as Address);
      }
    } catch (error) {
      // getPancakePair 调用失败，回退到通过 Factory 查找
      logger.debug(`[Route] getPancakePair 调用失败，尝试通过 Factory 查找 pair:`, error);
      if (normalizedQuote) {
        pancakePair = await checkPancakePair(publicClient, tokenAddress, normalizedQuote as Address);
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

// 优化：根据检测到的平台，智能构建探测顺序
function buildPlatformProbeOrder(initial: TokenPlatform): TokenPlatform[] {
  const order: TokenPlatform[] = [];

  // 如果检测到 'unknown'，说明不匹配任何发射台模式
  // 直接返回 ['unknown']，跳过所有发射台查询
  if (initial === 'unknown') {
    return ['unknown'];
  }

  // 如果检测到具体平台，按原有逻辑探测
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
  // 1. 检查缓存
  const cached = getRouteCache(tokenAddress);
  if (cached) {
    // 如果已迁移，使用永久缓存
    if (cached.migrationStatus === 'migrated') {
      return cached.route;
    }

    // 如果未迁移，需要重新查询以检测是否已迁移
    // 这样可以及时发现代币的迁移状态变化
  }

  // 2. 执行查询（无缓存或未迁移需要重新检查）
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
      // 完全信任平台返回的 preferredChannel
      lastValidRoute = route;
      if (!shouldFallbackRoute(route)) {
        // 3. 检查是否需要更新缓存
        if (shouldUpdateRouteCache(tokenAddress, cached, route)) {
          setRouteCache(tokenAddress, route);
          cleanupRouteCache();
        }
        return route;
      }
      // If Pancake has流动性才返回，否则尝试下一个平台
    } catch (error) {
      lastError = error;
      // 检查是否需要跳过其他发射台，直接使用 unknown（Pancake）
      if ((error as any)?.skipToUnknown) {
        logger.info(`[Route] 模式匹配但获取信息失败，直接使用 Pancake`);
        // 直接跳到 unknown 平台
        try {
          const unknownRoute = await fetchTokenRouteState(publicClient, tokenAddress, 'unknown');
          if (shouldUpdateRouteCache(tokenAddress, cached, unknownRoute)) {
            setRouteCache(tokenAddress, unknownRoute);
            cleanupRouteCache();
          }
          return unknownRoute;
        } catch (unknownError) {
          // unknown 平台也失败了，继续抛出原始错误
          logger.warn(`[Route] Pancake 查询也失败: ${unknownError?.message || unknownError}`);
        }
      }
    }
  }

  if (lastValidRoute) {
    // 缓存最后一个有效路由
    if (shouldUpdateRouteCache(tokenAddress, cached, lastValidRoute)) {
      setRouteCache(tokenAddress, lastValidRoute);
      cleanupRouteCache();
    }
    return lastValidRoute;
  }

  if (lastError) {
    throw lastError;
  }

  // 默认返回
  const defaultRoute: RouteFetchResult = {
    platform: 'unknown',
    preferredChannel: 'pancake',
    readyForPancake: true,
    progress: 1,
    migrating: false
  };
  setRouteCache(tokenAddress, defaultRoute);
  cleanupRouteCache();
  return defaultRoute;
}
