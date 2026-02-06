/**
 * Backend Batch Query Handlers
 *
 * 处理前端对接层发来的批量查询请求
 * 使用 MultiCall 优化 RPC 调用
 */

import { logger } from '../shared/logger.js';
import { perf } from '../shared/performance.js';

/**
 * 批量查询余额
 */
export async function handleBatchQueryBalance({ queries }: { queries: any[] }) {
  const fnStart = perf.now();
  logger.debug(`[BatchQuery] 批量查询余额: ${queries.length} 个请求`);

  try {
    if (!publicClient || !walletAccount) {
      throw new Error('Client not initialized');
    }

    // 使用 MultiCall 批量查询
    const contracts = queries.map(q => ({
      address: q.tokenAddress,
      abi: ERC20_ABI,
      functionName: 'balanceOf',
      args: [q.walletAddress || walletAccount.address]
    }));

    const results = await publicClient.multicall({ contracts });

    // 处理结果
    const balances = results.map((result, index) => {
      if (result.status === 'failure') {
        logger.warn(`[BatchQuery] 余额查询失败 [${index}]:`, result.error);
        return { success: false, error: result.error, balance: '0' };
      }
      return { success: true, balance: result.result.toString() };
    });

    logger.debug(`[BatchQuery] ✅ 批量查询余额完成 (${perf.measure(fnStart).toFixed(2)}ms)`);

    return { success: true, data: balances };
  } catch (error) {
    logger.error('[BatchQuery] 批量查询余额失败:', error);
    return { success: false, error: error.message };
  }
}

/**
 * 批量查询授权
 */
export async function handleBatchQueryAllowance({ queries }: { queries: any[] }) {
  const fnStart = perf.now();
  logger.debug(`[BatchQuery] 批量查询授权: ${queries.length} 个请求`);

  try {
    if (!publicClient || !walletAccount) {
      throw new Error('Client not initialized');
    }

    // 使用 MultiCall 批量查询
    const contracts = queries.map(q => ({
      address: q.tokenAddress,
      abi: ERC20_ABI,
      functionName: 'allowance',
      args: [q.walletAddress || walletAccount.address, q.spenderAddress]
    }));

    const results = await publicClient.multicall({ contracts });

    // 处理结果
    const allowances = results.map((result, index) => {
      if (result.status === 'failure') {
        logger.warn(`[BatchQuery] 授权查询失败 [${index}]:`, result.error);
        return { success: false, error: result.error, allowance: '0' };
      }
      return { success: true, allowance: result.result.toString() };
    });

    logger.debug(`[BatchQuery] ✅ 批量查询授权完成 (${perf.measure(fnStart).toFixed(2)}ms)`);

    return { success: true, data: allowances };
  } catch (error) {
    logger.error('[BatchQuery] 批量查询授权失败:', error);
    return { success: false, error: error.message };
  }
}

/**
 * 批量查询元数据
 */
export async function handleBatchQueryMetadata({ queries }: { queries: any[] }) {
  const fnStart = perf.now();
  logger.debug(`[BatchQuery] 批量查询元数据: ${queries.length} 个请求`);

  try {
    if (!publicClient) {
      throw new Error('Client not initialized');
    }

    // 构建所有需要查询的合约调用
    const contracts: any[] = [];
    const queryMap: { queryIndex: number; field: string }[] = [];

    queries.forEach((query, queryIndex) => {
      const fields = query.fields || ['symbol', 'decimals', 'totalSupply'];
      fields.forEach((field: string) => {
        contracts.push({
          address: query.tokenAddress,
          abi: ERC20_ABI,
          functionName: field
        });
        queryMap.push({ queryIndex, field });
      });
    });

    // 使用 MultiCall 批量查询
    const results = await publicClient.multicall({ contracts });

    // 组装结果
    const metadata: any[] = queries.map(() => ({ success: true, data: {} }));

    results.forEach((result, index) => {
      const { queryIndex, field } = queryMap[index];
      if (result.status === 'failure') {
        logger.warn(`[BatchQuery] 元数据查询失败 [${queryIndex}.${field}]:`, result.error);
        metadata[queryIndex].data[field] = null;
      } else {
        metadata[queryIndex].data[field] = result.result;
      }
    });

    logger.debug(`[BatchQuery] ✅ 批量查询元数据完成 (${perf.measure(fnStart).toFixed(2)}ms)`);

    return { success: true, data: metadata };
  } catch (error) {
    logger.error('[BatchQuery] 批量查询元数据失败:', error);
    return { success: false, error: error.message };
  }
}

/**
 * 批量检查授权状态
 */
export async function handleBatchCheckApproval({ queries }: { queries: any[] }) {
  const fnStart = perf.now();
  logger.debug(`[BatchQuery] 批量检查授权状态: ${queries.length} 个请求`);

  try {
    if (!publicClient || !walletAccount) {
      throw new Error('Client not initialized');
    }

    // 使用 MultiCall 批量查询授权和余额
    const contracts: any[] = [];
    queries.forEach(q => {
      // 查询授权
      contracts.push({
        address: q.tokenAddress,
        abi: ERC20_ABI,
        functionName: 'allowance',
        args: [q.walletAddress || walletAccount.address, q.spenderAddress]
      });
      // 查询余额
      contracts.push({
        address: q.tokenAddress,
        abi: ERC20_ABI,
        functionName: 'balanceOf',
        args: [q.walletAddress || walletAccount.address]
      });
    });

    const results = await publicClient.multicall({ contracts });

    // 处理结果
    const approvalStatus = queries.map((query, index) => {
      const allowanceResult = results[index * 2];
      const balanceResult = results[index * 2 + 1];

      if (allowanceResult.status === 'failure' || balanceResult.status === 'failure') {
        return {
          success: false,
          error: 'Query failed',
          needApproval: true
        };
      }

      const allowance = allowanceResult.result as bigint;
      const balance = balanceResult.result as bigint;
      const needApproval = allowance < balance;

      return {
        success: true,
        allowance: allowance.toString(),
        balance: balance.toString(),
        needApproval
      };
    });

    logger.debug(`[BatchQuery] ✅ 批量检查授权状态完成 (${perf.measure(fnStart).toFixed(2)}ms)`);

    return { success: true, data: approvalStatus };
  } catch (error) {
    logger.error('[BatchQuery] 批量检查授权状态失败:', error);
    return { success: false, error: error.message };
  }
}
