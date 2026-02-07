/**
 * Retry Helper
 *
 * 提供通用的重试逻辑，支持：
 * - 自定义重试次数
 * - 自定义重试条件（哪些错误需要重试）
 * - 自定义延迟策略（固定延迟、指数退避）
 * - 重试回调（用于切换 RPC 节点等）
 *
 * @example
 * ```typescript
 * // 基本用法
 * const result = await retry(() => fetchData(), { maxRetries: 3 });
 *
 * // 自定义重试条件
 * const result = await retry(() => fetchData(), {
 *   maxRetries: 3,
 *   shouldRetry: (error) => error.message.includes('timeout')
 * });
 *
 * // 指数退避
 * const result = await retry(() => fetchData(), {
 *   maxRetries: 3,
 *   delayMs: 1000,
 *   backoff: 'exponential'
 * });
 *
 * // 重试回调（切换节点）
 * const result = await retry(() => rpcCall(), {
 *   maxRetries: 3,
 *   onRetry: async (attempt, error) => {
 *     console.log(`Retry ${attempt}, switching node...`);
 *     await switchRpcNode();
 *   }
 * });
 * ```
 */

import { logger } from './logger.js';

/**
 * 重试配置选项
 */
export interface RetryOptions {
  /**
   * 最大重试次数（不包括首次尝试）
   * @default 2
   */
  maxRetries?: number;

  /**
   * 延迟时间（毫秒）
   * @default 0
   */
  delayMs?: number;

  /**
   * 退避策略
   * - 'fixed': 固定延迟
   * - 'exponential': 指数退避（delayMs * 2^attempt）
   * @default 'fixed'
   */
  backoff?: 'fixed' | 'exponential';

  /**
   * 判断是否应该重试
   * @param error 捕获的错误
   * @param attempt 当前尝试次数（从 1 开始）
   * @returns true 表示应该重试，false 表示直接抛出错误
   */
  shouldRetry?: (error: any, attempt: number) => boolean;

  /**
   * 重试前的回调
   * @param attempt 当前尝试次数（从 1 开始）
   * @param error 上一次的错误
   */
  onRetry?: (attempt: number, error: any) => void | Promise<void>;

  /**
   * 日志标签（用于调试）
   */
  logTag?: string;
}

/**
 * 默认的重试条件：RPC 节点错误
 */
export function isRpcError(error: any): boolean {
  const errorMsg = error?.message || error?.toString() || '';
  return (
    errorMsg.includes('401') ||
    errorMsg.includes('429') ||
    errorMsg.includes('503') ||
    errorMsg.includes('SERVER_ERROR') ||
    errorMsg.includes('timeout') ||
    errorMsg.includes('ETIMEDOUT') ||
    errorMsg.includes('ECONNREFUSED')
  );
}

/**
 * 延迟函数
 */
function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * 计算延迟时间
 */
function calculateDelay(
  baseDelay: number,
  attempt: number,
  backoff: 'fixed' | 'exponential'
): number {
  if (backoff === 'exponential') {
    return baseDelay * Math.pow(2, attempt - 1);
  }
  return baseDelay;
}

/**
 * 通用重试函数
 *
 * @param asyncFunc 要执行的异步函数
 * @param options 重试配置选项
 * @returns 函数执行结果
 * @throws 如果所有重试都失败，抛出最后一次的错误
 */
export async function retry<T>(
  asyncFunc: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const {
    maxRetries = 2,
    delayMs = 0,
    backoff = 'fixed',
    shouldRetry = isRpcError,
    onRetry,
    logTag = 'Retry'
  } = options;

  let lastError: any;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await asyncFunc();
    } catch (error) {
      lastError = error;

      // 检查是否应该重试
      const shouldRetryThis = shouldRetry(error, attempt + 1);
      const hasMoreRetries = attempt < maxRetries;

      if (!shouldRetryThis || !hasMoreRetries) {
        // 不应该重试，或者没有更多重试次数，直接抛出错误
        throw error;
      }

      // 记录重试日志
      const errorMsg = error?.message || error?.toString() || 'Unknown error';
      logger.warn(`[${logTag}] 错误 (尝试 ${attempt + 1}/${maxRetries + 1}): ${errorMsg}`);

      // 执行重试回调
      if (onRetry) {
        try {
          await onRetry(attempt + 1, error);
        } catch (callbackError) {
          logger.error(`[${logTag}] 重试回调失败:`, callbackError);
        }
      }

      // 延迟后重试
      if (delayMs > 0) {
        const actualDelay = calculateDelay(delayMs, attempt + 1, backoff);
        logger.debug(`[${logTag}] 延迟 ${actualDelay}ms 后重试...`);
        await delay(actualDelay);
      }
    }
  }

  // 所有重试都失败，抛出最后一次的错误
  throw lastError;
}

/**
 * 创建带有默认配置的重试函数
 *
 * @example
 * ```typescript
 * const retryRpc = createRetry({
 *   maxRetries: 3,
 *   shouldRetry: isRpcError,
 *   onRetry: async () => await switchNode()
 * });
 *
 * const result = await retryRpc(() => rpcCall());
 * ```
 */
export function createRetry(defaultOptions: RetryOptions) {
  return async function<T>(
    asyncFunc: () => Promise<T>,
    overrideOptions?: RetryOptions
  ): Promise<T> {
    return retry(asyncFunc, { ...defaultOptions, ...overrideOptions });
  };
}
