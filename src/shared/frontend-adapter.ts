/**
 * Frontend Adapter Layer
 *
 * 职责：
 * 1. 统一处理前端请求，避免后端核心代码被前端需求污染
 * 2. 自动合并短时间内的多个查询请求，使用 MultiCall 批量执行
 * 3. 提供标准化的接口，减少冗余和混乱
 * 4. 缓存管理和请求去重
 */

import { logger } from './logger.js';
import { perf } from './performance.js';

// ========== 类型定义 ==========

type QueryType = 'balance' | 'allowance' | 'metadata' | 'route' | 'approval_status';

type QueryRequest = {
  id: string;
  type: QueryType;
  params: any;
  priority: 'high' | 'normal' | 'low';
  timestamp: number;
  resolve: (value: any) => void;
  reject: (error: any) => void;
};

type BatchConfig = {
  maxWaitTime: number; // 最大等待时间（毫秒）
  maxBatchSize: number; // 最大批次大小
};

// ========== 前端对接层 ==========

class FrontendAdapter {
  private pendingQueries: Map<QueryType, QueryRequest[]> = new Map();
  private batchTimers: Map<QueryType, number> = new Map();
  private queryHandlers: Map<QueryType, (requests: QueryRequest[]) => Promise<any[]>> = new Map();

  // 批次配置
  private batchConfigs: Map<QueryType, BatchConfig> = new Map([
    ['balance', { maxWaitTime: 50, maxBatchSize: 10 }],
    ['allowance', { maxWaitTime: 50, maxBatchSize: 10 }],
    ['metadata', { maxWaitTime: 50, maxBatchSize: 10 }],
    ['route', { maxWaitTime: 100, maxBatchSize: 5 }],
    ['approval_status', { maxWaitTime: 50, maxBatchSize: 10 }]
  ]);

  constructor() {
    this.initializeHandlers();
  }

  /**
   * 初始化查询处理器
   */
  private initializeHandlers() {
    // 余额查询处理器
    this.queryHandlers.set('balance', async (requests) => {
      return this.handleBalanceQueries(requests);
    });

    // 授权查询处理器
    this.queryHandlers.set('allowance', async (requests) => {
      return this.handleAllowanceQueries(requests);
    });

    // 元数据查询处理器
    this.queryHandlers.set('metadata', async (requests) => {
      return this.handleMetadataQueries(requests);
    });

    // 路由查询处理器
    this.queryHandlers.set('route', async (requests) => {
      return this.handleRouteQueries(requests);
    });

    // 授权状态查询处理器
    this.queryHandlers.set('approval_status', async (requests) => {
      return this.handleApprovalStatusQueries(requests);
    });
  }

  /**
   * 查询接口 - 统一入口
   */
  async query<T>(
    type: QueryType,
    params: any,
    options: { priority?: 'high' | 'normal' | 'low'; immediate?: boolean } = {}
  ): Promise<T> {
    const { priority = 'normal', immediate = false } = options;

    // 生成查询 ID（用于去重）
    const queryId = this.generateQueryId(type, params);

    // 检查是否有相同的查询正在等待
    const existingQuery = this.findExistingQuery(type, queryId);
    if (existingQuery) {
      logger.debug(`[FrontendAdapter] 查询去重: ${type} ${queryId}`);
      return new Promise((resolve, reject) => {
        existingQuery.resolve = resolve;
        existingQuery.reject = reject;
      });
    }

    // 创建新的查询请求
    return new Promise((resolve, reject) => {
      const request: QueryRequest = {
        id: queryId,
        type,
        params,
        priority,
        timestamp: Date.now(),
        resolve,
        reject
      };

      // 高优先级或立即执行的请求直接处理
      if (priority === 'high' || immediate) {
        this.executeImmediately(request);
        return;
      }

      // 添加到待处理队列
      this.addToPendingQueue(request);

      // 启动批处理定时器
      this.scheduleBatch(type);
    });
  }

  /**
   * 生成查询 ID
   */
  private generateQueryId(type: QueryType, params: any): string {
    return `${type}:${JSON.stringify(params)}`;
  }

  /**
   * 查找已存在的查询
   */
  private findExistingQuery(type: QueryType, queryId: string): QueryRequest | null {
    const queue = this.pendingQueries.get(type);
    if (!queue) return null;
    return queue.find(q => q.id === queryId) || null;
  }

  /**
   * 添加到待处理队列
   */
  private addToPendingQueue(request: QueryRequest) {
    const queue = this.pendingQueries.get(request.type) || [];
    queue.push(request);
    this.pendingQueries.set(request.type, queue);

    logger.debug(`[FrontendAdapter] 添加到队列: ${request.type} (队列长度: ${queue.length})`);
  }

  /**
   * 调度批处理
   */
  private scheduleBatch(type: QueryType) {
    // 如果已经有定时器在运行，不重复创建
    if (this.batchTimers.has(type)) {
      return;
    }

    const config = this.batchConfigs.get(type)!;
    const timer = setTimeout(() => {
      this.executeBatch(type);
    }, config.maxWaitTime) as unknown as number;

    this.batchTimers.set(type, timer);
  }

  /**
   * 立即执行单个请求
   */
  private async executeImmediately(request: QueryRequest) {
    try {
      logger.debug(`[FrontendAdapter] 立即执行: ${request.type} ${request.id}`);
      const handler = this.queryHandlers.get(request.type);
      if (!handler) {
        throw new Error(`No handler for query type: ${request.type}`);
      }

      const results = await handler([request]);
      request.resolve(results[0]);
    } catch (error) {
      logger.error(`[FrontendAdapter] 立即执行失败: ${request.type}`, error);
      request.reject(error);
    }
  }

  /**
   * 执行批处理
   */
  private async executeBatch(type: QueryType) {
    const fnStart = perf.now();

    // 清除定时器
    const timer = this.batchTimers.get(type);
    if (timer) {
      clearTimeout(timer);
      this.batchTimers.delete(type);
    }

    // 获取待处理的请求
    const queue = this.pendingQueries.get(type) || [];
    if (queue.length === 0) {
      return;
    }

    // 清空队列
    this.pendingQueries.set(type, []);

    logger.debug(`[FrontendAdapter] 执行批处理: ${type} (${queue.length} 个请求)`);

    try {
      // 获取处理器
      const handler = this.queryHandlers.get(type);
      if (!handler) {
        throw new Error(`No handler for query type: ${type}`);
      }

      // 批量执行
      const results = await handler(queue);

      // 分发结果
      queue.forEach((request, index) => {
        request.resolve(results[index]);
      });

      logger.debug(`[FrontendAdapter] ✅ 批处理完成: ${type} (${perf.measure(fnStart).toFixed(2)}ms)`);
    } catch (error) {
      logger.error(`[FrontendAdapter] ❌ 批处理失败: ${type}`, error);

      // 所有请求都失败
      queue.forEach(request => {
        request.reject(error);
      });
    }
  }

  /**
   * 处理余额查询（使用 MultiCall）
   */
  private async handleBalanceQueries(requests: QueryRequest[]): Promise<any[]> {
    // 发送到 background 处理
    const response = await chrome.runtime.sendMessage({
      action: 'batch_query_balance',
      data: {
        queries: requests.map(r => r.params)
      }
    });

    if (!response.success) {
      throw new Error(response.error || 'Batch balance query failed');
    }

    return response.data;
  }

  /**
   * 处理授权查询（使用 MultiCall）
   */
  private async handleAllowanceQueries(requests: QueryRequest[]): Promise<any[]> {
    const response = await chrome.runtime.sendMessage({
      action: 'batch_query_allowance',
      data: {
        queries: requests.map(r => r.params)
      }
    });

    if (!response.success) {
      throw new Error(response.error || 'Batch allowance query failed');
    }

    return response.data;
  }

  /**
   * 处理元数据查询（使用 MultiCall）
   */
  private async handleMetadataQueries(requests: QueryRequest[]): Promise<any[]> {
    const response = await chrome.runtime.sendMessage({
      action: 'batch_query_metadata',
      data: {
        queries: requests.map(r => r.params)
      }
    });

    if (!response.success) {
      throw new Error(response.error || 'Batch metadata query failed');
    }

    return response.data;
  }

  /**
   * 处理路由查询
   */
  private async handleRouteQueries(requests: QueryRequest[]): Promise<any[]> {
    // 路由查询通常不能批量处理，逐个执行
    const results = await Promise.all(
      requests.map(async (request) => {
        const response = await chrome.runtime.sendMessage({
          action: 'get_token_route',
          data: request.params
        });

        if (!response.success) {
          throw new Error(response.error || 'Route query failed');
        }

        return response.data;
      })
    );

    return results;
  }

  /**
   * 处理授权状态查询
   */
  private async handleApprovalStatusQueries(requests: QueryRequest[]): Promise<any[]> {
    const response = await chrome.runtime.sendMessage({
      action: 'batch_check_approval',
      data: {
        queries: requests.map(r => r.params)
      }
    });

    if (!response.success) {
      throw new Error(response.error || 'Batch approval status query failed');
    }

    return response.data;
  }

  /**
   * 清空所有待处理的请求
   */
  clear() {
    // 清除所有定时器
    this.batchTimers.forEach(timer => clearTimeout(timer));
    this.batchTimers.clear();

    // 拒绝所有待处理的请求
    this.pendingQueries.forEach((queue, type) => {
      queue.forEach(request => {
        request.reject(new Error('Adapter cleared'));
      });
    });

    this.pendingQueries.clear();
  }

  /**
   * 获取统计信息
   */
  getStats() {
    const stats: any = {};
    this.pendingQueries.forEach((queue, type) => {
      stats[type] = {
        pending: queue.length,
        hasTimer: this.batchTimers.has(type)
      };
    });
    return stats;
  }
}

// 导出单例
export const frontendAdapter = new FrontendAdapter();

// ========== 便捷方法 ==========

/**
 * 查询代币余额
 */
export async function queryBalance(tokenAddress: string, walletAddress: string, options?: any) {
  return frontendAdapter.query('balance', { tokenAddress, walletAddress }, options);
}

/**
 * 查询代币授权
 */
export async function queryAllowance(
  tokenAddress: string,
  walletAddress: string,
  spenderAddress: string,
  options?: any
) {
  return frontendAdapter.query('allowance', { tokenAddress, walletAddress, spenderAddress }, options);
}

/**
 * 查询代币元数据
 */
export async function queryMetadata(tokenAddress: string, fields: string[], options?: any) {
  return frontendAdapter.query('metadata', { tokenAddress, fields }, options);
}

/**
 * 查询代币路由
 */
export async function queryRoute(tokenAddress: string, force?: boolean, options?: any) {
  return frontendAdapter.query('route', { tokenAddress, force }, options);
}

/**
 * 查询授权状态
 */
export async function queryApprovalStatus(
  tokenAddress: string,
  walletAddress: string,
  spenderAddress: string,
  options?: any
) {
  return frontendAdapter.query('approval_status', { tokenAddress, walletAddress, spenderAddress }, options);
}
