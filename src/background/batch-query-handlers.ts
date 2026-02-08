/**
 * Backend Batch Query Handlers
 *
 * 处理前端对接层发来的批量查询请求
 * 使用 MultiCall 优化 RPC 调用
 */

import { logger } from '../shared/logger.js';
import { perf } from '../shared/performance.js';

/**
 * 批量查询处理器的依赖注入接口
 */
export interface BatchQueryDependencies {
  publicClient: any;
  walletAccount: any;
  ERC20_ABI: any;
  CONTRACTS: any;
  TOKEN_INFO_CACHE_TTL: number;
  tokenInfoCache: Map<string, any>;
  getCacheScope: () => string;
  normalizeAddressValue: (address: string) => string;
  ensureTokenMetadata: (tokenAddress: string, options: any) => Promise<any>;
  detectTokenPlatform: (tokenAddress: string) => string;
  fetchRouteWithFallback: (publicClient: any, tokenAddress: string, initialPlatform: string) => Promise<any>;
  readCachedTokenInfo: (tokenAddress: string, walletAddress: string, needAllowances: boolean) => any;
  writeCachedTokenInfo: (tokenAddress: string, walletAddress: string, data: any) => void;
  fetchTokenInfoData: (tokenAddress: string, walletAddress: string, needApproval: boolean) => Promise<any>;
}

/**
 * 创建批量查询处理器
 */
export function createBatchQueryHandlers(deps: BatchQueryDependencies) {
  const {
    publicClient,
    walletAccount,
    ERC20_ABI,
    CONTRACTS,
    TOKEN_INFO_CACHE_TTL,
    tokenInfoCache,
    getCacheScope,
    normalizeAddressValue,
    ensureTokenMetadata,
    detectTokenPlatform,
    fetchRouteWithFallback,
    readCachedTokenInfo,
    writeCachedTokenInfo,
    fetchTokenInfoData
  } = deps;

  /**
   * 批量查询余额
   * 优化：使用缓存机制，避免重复查询
   */
  async function handleBatchQueryBalance({ queries }: { queries: any[] }) {
    const fnStart = perf.now();
    logger.debug(`[BatchQuery] 批量查询余额: ${queries.length} 个请求`);

    try {
      if (!publicClient || !walletAccount) {
        throw new Error('Client not initialized');
      }

      const cacheScope = getCacheScope();

      // 分离缓存命中和未命中的查询
      const results: any[] = [];
      const uncachedQueries: { index: number; query: any }[] = [];

      for (let i = 0; i < queries.length; i++) {
        const query = queries[i];
        const effectiveWallet = query.walletAddress || walletAccount.address;
        const normalizedToken = normalizeAddressValue(query.tokenAddress);
        const normalizedWallet = normalizeAddressValue(effectiveWallet);

        // 尝试从缓存读取
        const cacheKey = `token-info-balance:${cacheScope}:${normalizedToken}:${normalizedWallet}`;
        const cached = tokenInfoCache.get(cacheKey);

        if (cached && Date.now() - cached.updatedAt < TOKEN_INFO_CACHE_TTL) {
          results[i] = { success: true, balance: cached.data.balance };
          logger.debug(`[BatchQuery] 余额缓存命中 [${i}]`);
        } else {
          results[i] = null; // 占位
          uncachedQueries.push({ index: i, query });
        }
      }

      // 批量查询未缓存的数据
      if (uncachedQueries.length > 0) {
        logger.debug(`[BatchQuery] 需要查询 ${uncachedQueries.length} 个未缓存的余额`);

        const contracts = uncachedQueries.map(({ query }) => ({
          address: query.tokenAddress,
          abi: ERC20_ABI,
          functionName: 'balanceOf',
          args: [query.walletAddress || walletAccount.address]
        }));

        const multicallResults = await publicClient.multicall({ contracts });

        // 处理结果并写入缓存
        uncachedQueries.forEach(({ index, query }, i) => {
          const result = multicallResults[i];
          const effectiveWallet = query.walletAddress || walletAccount.address;
          const normalizedToken = normalizeAddressValue(query.tokenAddress);
          const normalizedWallet = normalizeAddressValue(effectiveWallet);

          if (result.status === 'failure') {
            logger.warn(`[BatchQuery] 余额查询失败 [${index}]:`, result.error);
            results[index] = { success: false, error: result.error, balance: '0' };
          } else {
            const balance = result.result.toString();
            results[index] = { success: true, balance };

            // 写入缓存
            const cacheKey = `token-info-balance:${cacheScope}:${normalizedToken}:${normalizedWallet}`;
            tokenInfoCache.set(cacheKey, {
              data: { symbol: '', decimals: 18, totalSupply: '0', balance },
              updatedAt: Date.now(),
              hasAllowances: false
            });
          }
        });
      }

      logger.debug(`[BatchQuery] ✅ 批量查询余额完成 (${perf.measure(fnStart).toFixed(2)}ms, 缓存命中: ${queries.length - uncachedQueries.length}/${queries.length})`);

      return { success: true, data: results };
    } catch (error: any) {
      logger.error('[BatchQuery] 批量查询余额失败:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * 批量查询授权
   * 优化：使用缓存机制，避免重复查询
   */
  async function handleBatchQueryAllowance({ queries }: { queries: any[] }) {
    const fnStart = perf.now();
    logger.debug(`[BatchQuery] 批量查询授权: ${queries.length} 个请求`);

    try {
      if (!publicClient || !walletAccount) {
        throw new Error('Client not initialized');
      }

      const cacheScope = getCacheScope();

      // 分离缓存命中和未命中的查询
      const results: any[] = [];
      const uncachedQueries: { index: number; query: any }[] = [];

      for (let i = 0; i < queries.length; i++) {
        const query = queries[i];
        const effectiveWallet = query.walletAddress || walletAccount.address;
        const normalizedToken = normalizeAddressValue(query.tokenAddress);
        const normalizedWallet = normalizeAddressValue(effectiveWallet);

        // 尝试从缓存读取
        const cacheKey = `token-allowance:${cacheScope}:${normalizedToken}:${normalizedWallet}:${query.spenderAddress}`;
        const cached = tokenInfoCache.get(cacheKey);

        if (cached && Date.now() - cached.updatedAt < TOKEN_INFO_CACHE_TTL && cached.data.allowances) {
          // 从 allowances 对象中提取对应的授权值
          const allowanceKey = Object.keys(cached.data.allowances).find(key =>
            cached.data.allowances[key] !== undefined
          );
          const allowance = allowanceKey ? cached.data.allowances[allowanceKey] : '0';
          results[i] = { success: true, allowance };
          logger.debug(`[BatchQuery] 授权缓存命中 [${i}]`);
        } else {
          results[i] = null; // 占位
          uncachedQueries.push({ index: i, query });
        }
      }

      // 批量查询未缓存的数据
      if (uncachedQueries.length > 0) {
        logger.debug(`[BatchQuery] 需要查询 ${uncachedQueries.length} 个未缓存的授权`);

        const contracts = uncachedQueries.map(({ query }) => ({
          address: query.tokenAddress,
          abi: ERC20_ABI,
          functionName: 'allowance',
          args: [query.walletAddress || walletAccount.address, query.spenderAddress]
        }));

        const multicallResults = await publicClient.multicall({ contracts });

        // 处理结果并写入缓存
        uncachedQueries.forEach(({ index, query }, i) => {
          const result = multicallResults[i];
          const effectiveWallet = query.walletAddress || walletAccount.address;
          const normalizedToken = normalizeAddressValue(query.tokenAddress);
          const normalizedWallet = normalizeAddressValue(effectiveWallet);

          if (result.status === 'failure') {
            logger.warn(`[BatchQuery] 授权查询失败 [${index}]:`, result.error);
            results[index] = { success: false, error: result.error, allowance: '0' };
          } else {
            const allowance = result.result.toString();
            results[index] = { success: true, allowance };

            // 写入缓存
            const cacheKey = `token-allowance:${cacheScope}:${normalizedToken}:${normalizedWallet}:${query.spenderAddress}`;

            // 根据 spenderAddress 确定 allowance key
            let allowanceKey = 'pancake';
            if (query.spenderAddress === CONTRACTS.FOUR_TOKEN_MANAGER_V2) {
              allowanceKey = 'four';
            } else if (query.spenderAddress === CONTRACTS.FLAP_PORTAL) {
              allowanceKey = 'flap';
            }

            tokenInfoCache.set(cacheKey, {
              data: {
                symbol: '',
                decimals: 18,
                totalSupply: '0',
                balance: '0',
                allowances: {
                  pancake: allowanceKey === 'pancake' ? allowance : '0',
                  four: allowanceKey === 'four' ? allowance : '0',
                  flap: allowanceKey === 'flap' ? allowance : '0',
                  xmode: allowanceKey === 'four' ? allowance : '0'
                }
              },
              updatedAt: Date.now(),
              hasAllowances: true
            });
          }
        });
      }

      logger.debug(`[BatchQuery] ✅ 批量查询授权完成 (${perf.measure(fnStart).toFixed(2)}ms, 缓存命中: ${queries.length - uncachedQueries.length}/${queries.length})`);

      return { success: true, data: results };
    } catch (error: any) {
      logger.error('[BatchQuery] 批量查询授权失败:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * 批量查询元数据
   * 优化：使用现有的 ensureTokenMetadata 函数（包含缓存逻辑）
   */
  async function handleBatchQueryMetadata({ queries }: { queries: any[] }) {
    const fnStart = perf.now();
    logger.debug(`[BatchQuery] 批量查询元数据: ${queries.length} 个请求`);

    try {
      if (!publicClient) {
        throw new Error('Client not initialized');
      }

      // 使用现有的 ensureTokenMetadata 函数，它已经包含了缓存逻辑
      const results = await Promise.all(
        queries.map(async (query) => {
          try {
            const fields = query.fields || ['symbol', 'decimals', 'totalSupply'];
            const needSymbol = fields.includes('symbol');
            const needTotalSupply = fields.includes('totalSupply');

            // 复用现有的缓存逻辑
            const metadata = await ensureTokenMetadata(query.tokenAddress, {
              needSymbol,
              needTotalSupply
            });

            const data: any = {};
            if (fields.includes('symbol')) data.symbol = metadata.symbol;
            if (fields.includes('decimals')) data.decimals = metadata.decimals;
            if (fields.includes('totalSupply')) data.totalSupply = metadata.totalSupply?.toString();

            return { success: true, data };
          } catch (error: any) {
            logger.warn(`[BatchQuery] 元数据查询失败:`, error);
            return { success: false, error: error.message, data: {} };
          }
        })
      );

      logger.debug(`[BatchQuery] ✅ 批量查询元数据完成 (${perf.measure(fnStart).toFixed(2)}ms)`);

      return { success: true, data: results };
    } catch (error: any) {
      logger.error('[BatchQuery] 批量查询元数据失败:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * 批量检查授权状态
   * 优化：使用缓存机制，避免重复查询
   */
  async function handleBatchCheckApproval({ queries }: { queries: any[] }) {
    const fnStart = perf.now();
    logger.debug(`[BatchQuery] 批量检查授权状态: ${queries.length} 个请求`);

    try {
      if (!publicClient || !walletAccount) {
        throw new Error('Client not initialized');
      }

      const cacheScope = getCacheScope();

      // 分离缓存命中和未命中的查询
      const results: any[] = [];
      const uncachedQueries: { index: number; query: any }[] = [];

      for (let i = 0; i < queries.length; i++) {
        const query = queries[i];
        const effectiveWallet = query.walletAddress || walletAccount.address;
        const normalizedToken = normalizeAddressValue(query.tokenAddress);
        const normalizedWallet = normalizeAddressValue(effectiveWallet);

        // 尝试从缓存读取余额和授权
        const balanceCacheKey = `token-info-balance:${cacheScope}:${normalizedToken}:${normalizedWallet}`;
        const allowanceCacheKey = `token-allowance:${cacheScope}:${normalizedToken}:${normalizedWallet}:${query.spenderAddress}`;

        const balanceCached = tokenInfoCache.get(balanceCacheKey);
        const allowanceCached = tokenInfoCache.get(allowanceCacheKey);

        const balanceValid = balanceCached && Date.now() - balanceCached.updatedAt < TOKEN_INFO_CACHE_TTL;
        const allowanceValid = allowanceCached && Date.now() - allowanceCached.updatedAt < TOKEN_INFO_CACHE_TTL;

        if (balanceValid && allowanceValid) {
          const balance = BigInt(balanceCached.data.balance);
          const allowanceKey = Object.keys(allowanceCached.data.allowances || {}).find(key =>
            allowanceCached.data.allowances[key] !== undefined
          );
          const allowance = allowanceKey ? BigInt(allowanceCached.data.allowances[allowanceKey]) : 0n;
          const needApproval = allowance < balance;

          results[i] = {
            success: true,
            allowance: allowance.toString(),
            balance: balance.toString(),
            needApproval
          };
          logger.debug(`[BatchQuery] 授权状态缓存命中 [${i}]`);
        } else {
          results[i] = null; // 占位
          uncachedQueries.push({ index: i, query });
        }
      }

      // 批量查询未缓存的数据
      if (uncachedQueries.length > 0) {
        logger.debug(`[BatchQuery] 需要查询 ${uncachedQueries.length} 个未缓存的授权状态`);

        const contracts: any[] = [];
        uncachedQueries.forEach(({ query }) => {
          const effectiveWallet = query.walletAddress || walletAccount.address;
          // 查询授权
          contracts.push({
            address: query.tokenAddress,
            abi: ERC20_ABI,
            functionName: 'allowance',
            args: [effectiveWallet, query.spenderAddress]
          });
          // 查询余额
          contracts.push({
            address: query.tokenAddress,
            abi: ERC20_ABI,
            functionName: 'balanceOf',
            args: [effectiveWallet]
          });
        });

        const multicallResults = await publicClient.multicall({ contracts });

        // 处理结果并写入缓存
        uncachedQueries.forEach(({ index, query }, i) => {
          const allowanceResult = multicallResults[i * 2];
          const balanceResult = multicallResults[i * 2 + 1];
          const effectiveWallet = query.walletAddress || walletAccount.address;
          const normalizedToken = normalizeAddressValue(query.tokenAddress);
          const normalizedWallet = normalizeAddressValue(effectiveWallet);

          if (allowanceResult.status === 'failure' || balanceResult.status === 'failure') {
            results[index] = {
              success: false,
              error: 'Query failed',
              needApproval: true
            };
          } else {
            const allowance = allowanceResult.result as bigint;
            const balance = balanceResult.result as bigint;
            const needApproval = allowance < balance;

            results[index] = {
              success: true,
              allowance: allowance.toString(),
              balance: balance.toString(),
              needApproval
            };

            // 写入缓存
            const balanceCacheKey = `token-info-balance:${cacheScope}:${normalizedToken}:${normalizedWallet}`;
            const allowanceCacheKey = `token-allowance:${cacheScope}:${normalizedToken}:${normalizedWallet}:${query.spenderAddress}`;

            // 根据 spenderAddress 确定 allowance key
            let allowanceKey = 'pancake';
            if (query.spenderAddress === CONTRACTS.FOUR_TOKEN_MANAGER_V2) {
              allowanceKey = 'four';
            } else if (query.spenderAddress === CONTRACTS.FLAP_PORTAL) {
              allowanceKey = 'flap';
            }

            tokenInfoCache.set(balanceCacheKey, {
              data: { symbol: '', decimals: 18, totalSupply: '0', balance: balance.toString() },
              updatedAt: Date.now(),
              hasAllowances: false
            });
            tokenInfoCache.set(allowanceCacheKey, {
              data: {
                symbol: '',
                decimals: 18,
                totalSupply: '0',
                balance: '0',
                allowances: {
                  pancake: allowanceKey === 'pancake' ? allowance.toString() : '0',
                  four: allowanceKey === 'four' ? allowance.toString() : '0',
                  flap: allowanceKey === 'flap' ? allowance.toString() : '0',
                  xmode: allowanceKey === 'four' ? allowance.toString() : '0'
                }
              },
              updatedAt: Date.now(),
              hasAllowances: true
            });
          }
        });
      }

      logger.debug(`[BatchQuery] ✅ 批量检查授权状态完成 (${perf.measure(fnStart).toFixed(2)}ms, 缓存命中: ${queries.length - uncachedQueries.length}/${queries.length})`);

      return { success: true, data: results };
    } catch (error: any) {
      logger.error('[BatchQuery] 批量检查授权状态失败:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * 获取代币完整信息（聚合接口）
   * 一次性返回：余额、授权（3个合约）、元数据、路由等
   *
   * 优化：复用现有的缓存机制，避免重复查询
   */
  async function handleGetTokenFullInfo({ queries }: { queries: any[] }) {
    const fnStart = perf.now();
    logger.debug(`[TokenFullInfo] 批量查询代币完整信息: ${queries.length} 个请求`);

    try {
      if (!walletAccount) {
        throw new Error('Wallet not loaded');
      }

      const results = await Promise.all(
        queries.map(async (query) => {
          const { tokenAddress, walletAddress } = query;
          const effectiveWallet = walletAddress || walletAccount.address;

          try {
            // 复用现有的 fetchTokenInfoData 函数（包含缓存逻辑）
            const tokenInfoStart = perf.now();

            // 先检查缓存
            const cached = readCachedTokenInfo(tokenAddress, effectiveWallet, true);
            const tokenInfo = cached || await fetchTokenInfoData(tokenAddress, effectiveWallet, true);

            // 如果不是缓存结果，写入缓存
            if (!cached) {
              writeCachedTokenInfo(tokenAddress, effectiveWallet, tokenInfo);
            }

            logger.debug(`[TokenFullInfo] 代币信息查询完成 (${perf.measure(tokenInfoStart).toFixed(2)}ms, 缓存: ${!!cached})`);

            // 查询路由信息（使用缓存）
            const routeStart = perf.now();
            const platform = detectTokenPlatform(tokenAddress);
            const route = await fetchRouteWithFallback(publicClient, tokenAddress, platform);
            logger.debug(`[TokenFullInfo] 路由查询完成 (${perf.measure(routeStart).toFixed(2)}ms)`);

            return {
              success: true,
              tokenAddress,
              walletAddress: effectiveWallet,
              balance: tokenInfo.balance,
              allowances: tokenInfo.allowances || {
                pancake: '0',
                four: '0',
                flap: '0'
              },
              metadata: {
                symbol: tokenInfo.symbol,
                decimals: tokenInfo.decimals,
                totalSupply: tokenInfo.totalSupply
              },
              route: {
                platform: route.platform,
                readyForPancake: route.readyForPancake,
                channelId: route.preferredChannel,
                quoteToken: route.quoteToken,  // 🐛 修复：添加 quoteToken
                metadata: route.metadata  // 🐛 修复：添加 metadata（包含 pancakeVersion）
              }
            };
          } catch (error: any) {
            logger.error(`[TokenFullInfo] 查询失败 [${tokenAddress}]:`, error);
            return {
              success: false,
              tokenAddress,
              error: error.message
            };
          }
        })
      );

      logger.debug(`[TokenFullInfo] ✅ 批量查询完成 (${perf.measure(fnStart).toFixed(2)}ms)`);

      return { success: true, data: results };
    } catch (error: any) {
      logger.error('[TokenFullInfo] 批量查询失败:', error);
      return { success: false, error: error.message };
    }
  }

  return {
    handleBatchQueryBalance,
    handleBatchQueryAllowance,
    handleBatchQueryMetadata,
    handleBatchCheckApproval,
    handleGetTokenFullInfo
  };
}
