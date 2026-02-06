/**
 * RPC 请求队列
 * 用于限制并发 RPC 请求，避免节点限流
 */

import { logger } from './logger.js';

type QueuedRequest<T> = {
  key: string;
  priority: 'high' | 'normal' | 'low';
  executor: () => Promise<T>;
  resolve: (value: T) => void;
  reject: (error: any) => void;
  timestamp: number;
};

class RPCQueue {
  private queue: QueuedRequest<any>[] = [];
  private processing = false;
  private lastRequestTime = 0;
  private requestCount = 0;
  private windowStart = Date.now();

  // 配置参数
  private readonly MIN_REQUEST_INTERVAL = 100; // 最小请求间隔（毫秒）
  private readonly MAX_REQUESTS_PER_SECOND = 8; // 每秒最大请求数
  private readonly DEDUP_WINDOW = 500; // 去重窗口（毫秒）

  // 去重缓存：key -> Promise
  private dedupCache = new Map<string, Promise<any>>();

  /**
   * 添加请求到队列
   * @param key 请求唯一标识（用于去重）
   * @param executor 请求执行函数
   * @param priority 优先级：high（关键请求）、normal（普通）、low（非关键）
   */
  async enqueue<T>(
    key: string,
    executor: () => Promise<T>,
    priority: 'high' | 'normal' | 'low' = 'normal'
  ): Promise<T> {
    // 去重：如果相同的请求正在执行，直接返回现有 Promise
    const cached = this.dedupCache.get(key);
    if (cached) {
      logger.debug(`[RPCQueue] 请求去重: ${key}`);
      return cached;
    }

    // 创建新的 Promise
    const promise = new Promise<T>((resolve, reject) => {
      this.queue.push({
        key,
        priority,
        executor,
        resolve,
        reject,
        timestamp: Date.now()
      });

      // 按优先级排序：high > normal > low，同优先级按时间排序
      this.queue.sort((a, b) => {
        const priorityOrder = { high: 0, normal: 1, low: 2 };
        const priorityDiff = priorityOrder[a.priority] - priorityOrder[b.priority];
        if (priorityDiff !== 0) return priorityDiff;
        return a.timestamp - b.timestamp;
      });
    });

    // 缓存 Promise
    this.dedupCache.set(key, promise);

    // 启动处理
    this.processQueue();

    return promise;
  }

  /**
   * 处理队列
   */
  private async processQueue() {
    if (this.processing || this.queue.length === 0) {
      return;
    }

    this.processing = true;

    while (this.queue.length > 0) {
      // 检查速率限制
      await this.checkRateLimit();

      // 取出队列头部请求
      const request = this.queue.shift();
      if (!request) break;

      try {
        logger.debug(`[RPCQueue] 执行请求: ${request.key} (优先级: ${request.priority})`);
        const result = await request.executor();
        request.resolve(result);
      } catch (error) {
        logger.debug(`[RPCQueue] 请求失败: ${request.key}`, error);
        request.reject(error);
      } finally {
        // 清除去重缓存
        setTimeout(() => {
          this.dedupCache.delete(request.key);
        }, this.DEDUP_WINDOW);

        // 更新请求计数
        this.lastRequestTime = Date.now();
        this.requestCount++;
      }
    }

    this.processing = false;
  }

  /**
   * 检查速率限制
   */
  private async checkRateLimit() {
    const now = Date.now();

    // 重置计数窗口（每秒）
    if (now - this.windowStart >= 1000) {
      this.windowStart = now;
      this.requestCount = 0;
    }

    // 如果达到每秒最大请求数，等待到下一秒
    if (this.requestCount >= this.MAX_REQUESTS_PER_SECOND) {
      const waitTime = 1000 - (now - this.windowStart);
      if (waitTime > 0) {
        logger.debug(`[RPCQueue] 达到速率限制，等待 ${waitTime}ms`);
        await this.sleep(waitTime);
        this.windowStart = Date.now();
        this.requestCount = 0;
      }
    }

    // 确保最小请求间隔
    const timeSinceLastRequest = now - this.lastRequestTime;
    if (timeSinceLastRequest < this.MIN_REQUEST_INTERVAL) {
      const waitTime = this.MIN_REQUEST_INTERVAL - timeSinceLastRequest;
      await this.sleep(waitTime);
    }
  }

  /**
   * 睡眠函数
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * 获取队列状态
   */
  getStatus() {
    return {
      queueLength: this.queue.length,
      processing: this.processing,
      requestCount: this.requestCount,
      cacheSize: this.dedupCache.size
    };
  }

  /**
   * 清空队列
   */
  clear() {
    this.queue.forEach(req => {
      req.reject(new Error('Queue cleared'));
    });
    this.queue = [];
    this.dedupCache.clear();
    this.processing = false;
  }
}

// 导出单例
export const rpcQueue = new RPCQueue();
