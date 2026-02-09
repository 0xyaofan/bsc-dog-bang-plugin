import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  withRetry,
  createRetryWrapper,
  RetryStatsCollector,
  retryStatsCollector,
  withRetryAndStats,
  RetryStrategies,
  withFastRetry,
  withStandardRetry,
  withAggressiveRetry,
  withNetworkRetry,
  withOnchainRetry
} from '../../src/shared/retry';
import { NetworkError, TimeoutError, ValidationError } from '../../src/shared/errors';

describe('重试机制测试', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    retryStatsCollector.clear();
  });

  describe('withRetry', () => {
    it('应该在第一次尝试成功时返回结果', async () => {
      const fn = vi.fn().mockResolvedValue('success');

      const result = await withRetry(fn, {
        maxAttempts: 3,
        delayMs: 100,
        backoff: 'fixed'
      });

      expect(result).toBe('success');
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it('应该在第二次尝试成功时返回结果', async () => {
      const fn = vi.fn()
        .mockRejectedValueOnce(new NetworkError('网络错误'))
        .mockResolvedValueOnce('success');

      const result = await withRetry(fn, {
        maxAttempts: 3,
        delayMs: 10,
        backoff: 'fixed'
      });

      expect(result).toBe('success');
      expect(fn).toHaveBeenCalledTimes(2);
    });

    it('应该在所有尝试失败后抛出错误', async () => {
      const error = new NetworkError('网络错误');
      const fn = vi.fn().mockRejectedValue(error);

      await expect(
        withRetry(fn, {
          maxAttempts: 3,
          delayMs: 10,
          backoff: 'fixed'
        })
      ).rejects.toThrow('网络错误');

      expect(fn).toHaveBeenCalledTimes(3);
    });

    it('应该在不可重试错误时立即抛出', async () => {
      const error = new ValidationError('验证失败', 'param', 'value');
      const fn = vi.fn().mockRejectedValue(error);

      await expect(
        withRetry(fn, {
          maxAttempts: 3,
          delayMs: 10,
          backoff: 'fixed'
        })
      ).rejects.toThrow('验证失败');

      expect(fn).toHaveBeenCalledTimes(1);
    });

    it('应该使用自定义重试条件', async () => {
      const error = new Error('custom error');
      const fn = vi.fn().mockRejectedValue(error);
      const shouldRetry = vi.fn().mockReturnValue(false);

      await expect(
        withRetry(fn, {
          maxAttempts: 3,
          delayMs: 10,
          backoff: 'fixed',
          shouldRetry
        })
      ).rejects.toThrow('custom error');

      expect(fn).toHaveBeenCalledTimes(1);
      expect(shouldRetry).toHaveBeenCalledWith(error, 1);
    });

    it('应该调用 onRetry 回调', async () => {
      const error = new NetworkError('网络错误');
      const fn = vi.fn()
        .mockRejectedValueOnce(error)
        .mockResolvedValueOnce('success');
      const onRetry = vi.fn();

      await withRetry(fn, {
        maxAttempts: 3,
        delayMs: 10,
        backoff: 'fixed',
        onRetry
      });

      expect(onRetry).toHaveBeenCalledTimes(1);
      expect(onRetry).toHaveBeenCalledWith(error, 1, 10);
    });

    it('应该使用固定延迟', async () => {
      const fn = vi.fn()
        .mockRejectedValueOnce(new NetworkError('错误'))
        .mockRejectedValueOnce(new NetworkError('错误'))
        .mockResolvedValueOnce('success');

      const start = Date.now();
      await withRetry(fn, {
        maxAttempts: 3,
        delayMs: 50,
        backoff: 'fixed'
      });
      const duration = Date.now() - start;

      // 应该有 2 次延迟，每次 50ms
      expect(duration).toBeGreaterThanOrEqual(100);
      expect(duration).toBeLessThan(200);
    });

    it('应该使用线性延迟', async () => {
      const fn = vi.fn()
        .mockRejectedValueOnce(new NetworkError('错误'))
        .mockRejectedValueOnce(new NetworkError('错误'))
        .mockResolvedValueOnce('success');

      const start = Date.now();
      await withRetry(fn, {
        maxAttempts: 3,
        delayMs: 50,
        backoff: 'linear'
      });
      const duration = Date.now() - start;

      // 第一次延迟 50ms，第二次延迟 100ms，总共 150ms
      expect(duration).toBeGreaterThanOrEqual(150);
      expect(duration).toBeLessThan(250);
    });

    it('应该使用指数延迟', async () => {
      const fn = vi.fn()
        .mockRejectedValueOnce(new NetworkError('错误'))
        .mockRejectedValueOnce(new NetworkError('错误'))
        .mockResolvedValueOnce('success');

      const start = Date.now();
      await withRetry(fn, {
        maxAttempts: 3,
        delayMs: 50,
        backoff: 'exponential'
      });
      const duration = Date.now() - start;

      // 第一次延迟 50ms，第二次延迟 100ms，总共 150ms
      expect(duration).toBeGreaterThanOrEqual(150);
      expect(duration).toBeLessThan(250);
    });

    it('应该限制最大延迟', async () => {
      const fn = vi.fn()
        .mockRejectedValueOnce(new NetworkError('错误'))
        .mockRejectedValueOnce(new NetworkError('错误'))
        .mockResolvedValueOnce('success');

      const start = Date.now();
      await withRetry(fn, {
        maxAttempts: 3,
        delayMs: 1000,
        backoff: 'exponential',
        maxDelayMs: 100
      });
      const duration = Date.now() - start;

      // 延迟应该被限制在 100ms
      expect(duration).toBeGreaterThanOrEqual(200);
      expect(duration).toBeLessThan(400);
    });
  });

  describe('createRetryWrapper', () => {
    it('应该创建带重试的函数包装器', async () => {
      const fn = vi.fn()
        .mockRejectedValueOnce(new NetworkError('错误'))
        .mockResolvedValueOnce('success');

      const wrappedFn = createRetryWrapper(fn, {
        maxAttempts: 3,
        delayMs: 10,
        backoff: 'fixed'
      });

      const result = await wrappedFn();

      expect(result).toBe('success');
      expect(fn).toHaveBeenCalledTimes(2);
    });

    it('应该传递参数', async () => {
      const fn = vi.fn().mockResolvedValue('success');
      const wrappedFn = createRetryWrapper(fn, {
        maxAttempts: 3,
        delayMs: 10,
        backoff: 'fixed'
      });

      await wrappedFn('arg1', 'arg2');

      expect(fn).toHaveBeenCalledWith('arg1', 'arg2');
    });
  });

  describe('RetryStatsCollector', () => {
    it('应该记录成功操作', () => {
      const collector = new RetryStatsCollector();

      collector.record('operation1', true, 1);
      collector.record('operation1', true, 1);

      const stats = collector.getStats('operation1');

      expect(stats).toBeDefined();
      expect(stats!.totalAttempts).toBe(2);
      expect(stats!.successCount).toBe(2);
      expect(stats!.failureCount).toBe(0);
      expect(stats!.retryCount).toBe(0);
    });

    it('应该记录失败操作', () => {
      const collector = new RetryStatsCollector();

      collector.record('operation1', false, 3);

      const stats = collector.getStats('operation1');

      expect(stats).toBeDefined();
      expect(stats!.totalAttempts).toBe(1);
      expect(stats!.successCount).toBe(0);
      expect(stats!.failureCount).toBe(1);
      expect(stats!.retryCount).toBe(1);
      expect(stats!.maxRetries).toBe(2);
    });

    it('应该计算平均重试次数', () => {
      const collector = new RetryStatsCollector();

      collector.record('operation1', true, 2); // 1 次重试
      collector.record('operation1', true, 3); // 2 次重试
      collector.record('operation1', true, 1); // 0 次重试

      const stats = collector.getStats('operation1');

      expect(stats!.retryCount).toBe(2);
      expect(stats!.averageRetries).toBe(1.5);
      expect(stats!.maxRetries).toBe(2);
    });

    it('应该获取所有统计信息', () => {
      const collector = new RetryStatsCollector();

      collector.record('op1', true, 1);
      collector.record('op2', true, 2);

      const allStats = collector.getAllStats();

      expect(allStats.size).toBe(2);
      expect(allStats.has('op1')).toBe(true);
      expect(allStats.has('op2')).toBe(true);
    });

    it('应该清除统计信息', () => {
      const collector = new RetryStatsCollector();

      collector.record('op1', true, 1);
      collector.record('op2', true, 1);

      collector.clear('op1');

      expect(collector.getStats('op1')).toBeNull();
      expect(collector.getStats('op2')).toBeDefined();

      collector.clear();

      expect(collector.getStats('op2')).toBeNull();
    });
  });

  describe('withRetryAndStats', () => {
    it('应该记录统计信息', async () => {
      const fn = vi.fn()
        .mockRejectedValueOnce(new NetworkError('错误'))
        .mockResolvedValueOnce('success');

      await withRetryAndStats(fn, {
        maxAttempts: 3,
        delayMs: 10,
        backoff: 'fixed',
        operationName: 'testOp'
      });

      const stats = retryStatsCollector.getStats('testOp');

      expect(stats).toBeDefined();
      expect(stats!.totalAttempts).toBe(1);
      expect(stats!.successCount).toBe(1);
      expect(stats!.retryCount).toBe(1);
    });
  });

  describe('预设重试策略', () => {
    it('fast 策略应该快速重试', () => {
      const strategy = RetryStrategies.fast;

      expect(strategy.maxAttempts).toBe(2);
      expect(strategy.delayMs).toBe(500);
      expect(strategy.backoff).toBe('fixed');
    });

    it('standard 策略应该使用标准配置', () => {
      const strategy = RetryStrategies.standard;

      expect(strategy.maxAttempts).toBe(3);
      expect(strategy.delayMs).toBe(1000);
      expect(strategy.backoff).toBe('exponential');
    });

    it('aggressive 策略应该多次重试', () => {
      const strategy = RetryStrategies.aggressive;

      expect(strategy.maxAttempts).toBe(5);
      expect(strategy.delayMs).toBe(1000);
      expect(strategy.backoff).toBe('exponential');
    });

    it('network 策略应该只重试网络错误', () => {
      const strategy = RetryStrategies.network;

      expect(strategy.shouldRetry!(new Error('network timeout'))).toBe(true);
      expect(strategy.shouldRetry!(new Error('fetch failed'))).toBe(true);
      expect(strategy.shouldRetry!(new Error('validation error'))).toBe(false);
    });

    it('onchain 策略应该重试网络错误但不重试执行错误', () => {
      const strategy = RetryStrategies.onchain;

      expect(strategy.shouldRetry!(new Error('network timeout'))).toBe(true);
      expect(strategy.shouldRetry!(new Error('execution reverted'))).toBe(false);
      expect(strategy.shouldRetry!(new Error('revert'))).toBe(false);
    });
  });

  describe('便捷函数', () => {
    it('withFastRetry 应该使用快速策略', async () => {
      const fn = vi.fn().mockResolvedValue('success');

      await withFastRetry(fn, 'testOp');

      expect(fn).toHaveBeenCalledTimes(1);
    });

    it('withStandardRetry 应该使用标准策略', async () => {
      const fn = vi.fn().mockResolvedValue('success');

      await withStandardRetry(fn, 'testOp');

      expect(fn).toHaveBeenCalledTimes(1);
    });

    it('withAggressiveRetry 应该使用激进策略', async () => {
      const fn = vi.fn().mockResolvedValue('success');

      await withAggressiveRetry(fn, 'testOp');

      expect(fn).toHaveBeenCalledTimes(1);
    });

    it('withNetworkRetry 应该使用网络策略', async () => {
      const fn = vi.fn()
        .mockRejectedValueOnce(new Error('network error'))
        .mockResolvedValueOnce('success');

      await withNetworkRetry(fn, 'testOp');

      expect(fn).toHaveBeenCalledTimes(2);
    });

    it('withOnchainRetry 应该使用链上策略', async () => {
      const fn = vi.fn()
        .mockRejectedValueOnce(new Error('network timeout'))
        .mockResolvedValueOnce('success');

      await withOnchainRetry(fn, 'testOp');

      expect(fn).toHaveBeenCalledTimes(2);
    });

    it('withOnchainRetry 不应该重试执行错误', async () => {
      const fn = vi.fn().mockRejectedValue(new Error('execution reverted'));

      await expect(
        withOnchainRetry(fn, 'testOp')
      ).rejects.toThrow('execution reverted');

      expect(fn).toHaveBeenCalledTimes(1);
    });
  });

  describe('边界情况', () => {
    it('应该处理 maxAttempts = 1', async () => {
      const fn = vi.fn().mockResolvedValue('success');

      const result = await withRetry(fn, {
        maxAttempts: 1,
        delayMs: 10,
        backoff: 'fixed'
      });

      expect(result).toBe('success');
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it('应该处理 delayMs = 0', async () => {
      const fn = vi.fn()
        .mockRejectedValueOnce(new NetworkError('错误'))
        .mockResolvedValueOnce('success');

      const start = Date.now();
      await withRetry(fn, {
        maxAttempts: 2,
        delayMs: 0,
        backoff: 'fixed'
      });
      const duration = Date.now() - start;

      expect(duration).toBeLessThan(100);
    });

    it('应该处理没有操作名称的情况', async () => {
      const fn = vi.fn().mockResolvedValue('success');

      await withRetry(fn, {
        maxAttempts: 1,
        delayMs: 10,
        backoff: 'fixed'
      });

      expect(fn).toHaveBeenCalledTimes(1);
    });
  });
});
