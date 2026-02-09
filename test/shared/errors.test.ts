import { describe, it, expect } from 'vitest';
import {
  RouteError,
  PlatformError,
  ServiceWorkerError,
  LiquidityError,
  CacheError,
  NetworkError,
  ValidationError,
  ContractError,
  TimeoutError,
  isRetryableError,
  wrapError,
  ErrorUtils
} from '../../src/shared/errors';

describe('错误类型测试', () => {
  describe('RouteError', () => {
    it('应该创建基础路由错误', () => {
      const error = new RouteError('测试错误', 'TEST_ERROR', { key: 'value' });

      expect(error).toBeInstanceOf(Error);
      expect(error).toBeInstanceOf(RouteError);
      expect(error.name).toBe('RouteError');
      expect(error.message).toBe('测试错误');
      expect(error.code).toBe('TEST_ERROR');
      expect(error.context).toEqual({ key: 'value' });
      expect(error.timestamp).toBeGreaterThan(0);
    });

    it('应该转换为 JSON', () => {
      const error = new RouteError('测试错误', 'TEST_ERROR', { key: 'value' });
      const json = error.toJSON();

      expect(json.name).toBe('RouteError');
      expect(json.message).toBe('测试错误');
      expect(json.code).toBe('TEST_ERROR');
      expect(json.context).toEqual({ key: 'value' });
      expect(json.timestamp).toBeGreaterThan(0);
      expect(json.stack).toBeDefined();
    });

    it('应该格式化错误信息', () => {
      const error = new RouteError('测试错误', 'TEST_ERROR', { key: 'value' });
      const str = error.toString();

      expect(str).toContain('TEST_ERROR');
      expect(str).toContain('测试错误');
      expect(str).toContain('key');
      expect(str).toContain('value');
    });
  });

  describe('PlatformError', () => {
    it('应该创建平台错误', () => {
      const error = new PlatformError('平台查询失败', 'four', { tokenAddress: '0x123' });

      expect(error).toBeInstanceOf(PlatformError);
      expect(error).toBeInstanceOf(RouteError);
      expect(error.name).toBe('PlatformError');
      expect(error.code).toBe('PLATFORM_ERROR');
      expect(error.platform).toBe('four');
      expect(error.context?.tokenAddress).toBe('0x123');
    });
  });

  describe('ServiceWorkerError', () => {
    it('应该创建 Service Worker 错误', () => {
      const error = new ServiceWorkerError(
        'import() is disallowed',
        'dynamic-import',
        { module: 'viem' }
      );

      expect(error).toBeInstanceOf(ServiceWorkerError);
      expect(error.name).toBe('ServiceWorkerError');
      expect(error.code).toBe('SERVICE_WORKER_ERROR');
      expect(error.operation).toBe('dynamic-import');
      expect(error.context?.module).toBe('viem');
    });
  });

  describe('LiquidityError', () => {
    it('应该创建流动性错误', () => {
      const error = new LiquidityError('流动性不足', {
        pairAddress: '0xpair',
        tokenAddress: '0xtoken',
        quoteToken: '0xquote'
      });

      expect(error).toBeInstanceOf(LiquidityError);
      expect(error.name).toBe('LiquidityError');
      expect(error.code).toBe('LIQUIDITY_ERROR');
      expect(error.pairAddress).toBe('0xpair');
      expect(error.tokenAddress).toBe('0xtoken');
      expect(error.quoteToken).toBe('0xquote');
    });
  });

  describe('CacheError', () => {
    it('应该创建缓存错误', () => {
      const error = new CacheError('缓存读取失败', 'get', { key: 'route:0x123' });

      expect(error).toBeInstanceOf(CacheError);
      expect(error.name).toBe('CacheError');
      expect(error.code).toBe('CACHE_ERROR');
      expect(error.operation).toBe('get');
      expect(error.key).toBe('route:0x123');
    });
  });

  describe('NetworkError', () => {
    it('应该创建网络错误', () => {
      const error = new NetworkError('网络请求失败', {
        url: 'https://api.example.com',
        statusCode: 500,
        retryable: true
      });

      expect(error).toBeInstanceOf(NetworkError);
      expect(error.name).toBe('NetworkError');
      expect(error.code).toBe('NETWORK_ERROR');
      expect(error.url).toBe('https://api.example.com');
      expect(error.statusCode).toBe(500);
      expect(error.retryable).toBe(true);
    });

    it('应该默认可重试', () => {
      const error = new NetworkError('网络请求失败');

      expect(error.retryable).toBe(true);
    });
  });

  describe('ValidationError', () => {
    it('应该创建验证错误', () => {
      const error = new ValidationError(
        '地址无效',
        'tokenAddress',
        '0xinvalid'
      );

      expect(error).toBeInstanceOf(ValidationError);
      expect(error.name).toBe('ValidationError');
      expect(error.code).toBe('VALIDATION_ERROR');
      expect(error.paramName).toBe('tokenAddress');
      expect(error.paramValue).toBe('0xinvalid');
    });
  });

  describe('ContractError', () => {
    it('应该创建合约错误', () => {
      const error = new ContractError(
        '合约调用失败',
        '0xcontract',
        'getTokenInfo',
        { args: ['0xtoken'] }
      );

      expect(error).toBeInstanceOf(ContractError);
      expect(error.name).toBe('ContractError');
      expect(error.code).toBe('CONTRACT_ERROR');
      expect(error.contractAddress).toBe('0xcontract');
      expect(error.functionName).toBe('getTokenInfo');
      expect(error.args).toEqual(['0xtoken']);
    });
  });

  describe('TimeoutError', () => {
    it('应该创建超时错误', () => {
      const error = new TimeoutError(
        '操作超时',
        'fetchRoute',
        5000
      );

      expect(error).toBeInstanceOf(TimeoutError);
      expect(error.name).toBe('TimeoutError');
      expect(error.code).toBe('TIMEOUT_ERROR');
      expect(error.operation).toBe('fetchRoute');
      expect(error.timeoutMs).toBe(5000);
    });
  });

  describe('isRetryableError', () => {
    it('NetworkError 应该可重试', () => {
      const error = new NetworkError('网络错误', { retryable: true });
      expect(isRetryableError(error)).toBe(true);
    });

    it('NetworkError 设置为不可重试时应该不可重试', () => {
      const error = new NetworkError('网络错误', { retryable: false });
      expect(isRetryableError(error)).toBe(false);
    });

    it('TimeoutError 应该可重试', () => {
      const error = new TimeoutError('超时', 'operation', 5000);
      expect(isRetryableError(error)).toBe(true);
    });

    it('ServiceWorkerError 应该不可重试', () => {
      const error = new ServiceWorkerError('SW 错误', 'import');
      expect(isRetryableError(error)).toBe(false);
    });

    it('ValidationError 应该不可重试', () => {
      const error = new ValidationError('验证失败', 'param', 'value');
      expect(isRetryableError(error)).toBe(false);
    });

    it('ContractError 网络相关应该可重试', () => {
      const error = new ContractError('network timeout', '0x', 'func');
      expect(isRetryableError(error)).toBe(true);
    });

    it('ContractError 执行错误应该不可重试', () => {
      const error = new ContractError('execution reverted', '0x', 'func');
      expect(isRetryableError(error)).toBe(false);
    });
  });

  describe('wrapError', () => {
    it('应该保持自定义错误不变', () => {
      const original = new PlatformError('平台错误', 'four');
      const wrapped = wrapError(original);

      expect(wrapped).toBe(original);
    });

    it('应该将 Service Worker 错误包装为 ServiceWorkerError', () => {
      const error = new Error('import() is disallowed on ServiceWorkerGlobalScope');
      const wrapped = wrapError(error);

      expect(wrapped).toBeInstanceOf(ServiceWorkerError);
      expect(wrapped.code).toBe('SERVICE_WORKER_ERROR');
    });

    it('应该将网络错误包装为 NetworkError', () => {
      const error = new Error('network request failed');
      const wrapped = wrapError(error);

      expect(wrapped).toBeInstanceOf(NetworkError);
      expect(wrapped.code).toBe('NETWORK_ERROR');
    });

    it('应该将超时错误包装为 TimeoutError', () => {
      const error = new Error('operation timeout');
      const wrapped = wrapError(error);

      expect(wrapped).toBeInstanceOf(TimeoutError);
      expect(wrapped.code).toBe('TIMEOUT_ERROR');
    });

    it('应该将流动性错误包装为 LiquidityError', () => {
      const error = new Error('insufficient liquidity');
      const wrapped = wrapError(error);

      expect(wrapped).toBeInstanceOf(LiquidityError);
      expect(wrapped.code).toBe('LIQUIDITY_ERROR');
    });

    it('应该将验证错误包装为 ValidationError', () => {
      const error = new Error('invalid address');
      const wrapped = wrapError(error);

      expect(wrapped).toBeInstanceOf(ValidationError);
      expect(wrapped.code).toBe('VALIDATION_ERROR');
    });

    it('应该将未知错误包装为 RouteError', () => {
      const error = new Error('unknown error');
      const wrapped = wrapError(error);

      expect(wrapped).toBeInstanceOf(RouteError);
      expect(wrapped.code).toBe('UNKNOWN_ERROR');
    });

    it('应该处理非 Error 对象', () => {
      const wrapped = wrapError('string error');

      expect(wrapped).toBeInstanceOf(RouteError);
      expect(wrapped.message).toBe('string error');
    });
  });

  describe('ErrorUtils', () => {
    it('应该正确识别错误类型', () => {
      expect(ErrorUtils.isPlatformError(new PlatformError('', 'four'))).toBe(true);
      expect(ErrorUtils.isPlatformError(new RouteError('', 'CODE'))).toBe(false);

      expect(ErrorUtils.isServiceWorkerError(new ServiceWorkerError('', 'op'))).toBe(true);
      expect(ErrorUtils.isLiquidityError(new LiquidityError(''))).toBe(true);
      expect(ErrorUtils.isCacheError(new CacheError('', 'get'))).toBe(true);
      expect(ErrorUtils.isNetworkError(new NetworkError(''))).toBe(true);
      expect(ErrorUtils.isValidationError(new ValidationError('', 'p', 'v'))).toBe(true);
      expect(ErrorUtils.isContractError(new ContractError('', '0x', 'f'))).toBe(true);
      expect(ErrorUtils.isTimeoutError(new TimeoutError('', 'op', 1000))).toBe(true);
    });

    it('应该正确识别 RouteError', () => {
      expect(ErrorUtils.isRouteError(new RouteError('', 'CODE'))).toBe(true);
      expect(ErrorUtils.isRouteError(new PlatformError('', 'four'))).toBe(true);
      expect(ErrorUtils.isRouteError(new Error(''))).toBe(false);
    });

    it('应该获取错误代码', () => {
      const error = new RouteError('', 'TEST_CODE');
      expect(ErrorUtils.getErrorCode(error)).toBe('TEST_CODE');
      expect(ErrorUtils.getErrorCode(new Error(''))).toBe('UNKNOWN_ERROR');
    });

    it('应该获取错误上下文', () => {
      const context = { key: 'value' };
      const error = new RouteError('', 'CODE', context);
      expect(ErrorUtils.getErrorContext(error)).toEqual(context);
      expect(ErrorUtils.getErrorContext(new Error(''))).toBeUndefined();
    });

    it('应该格式化错误信息', () => {
      const error = new RouteError('测试', 'CODE', { key: 'value' });
      const formatted = ErrorUtils.formatError(error);

      expect(formatted).toContain('CODE');
      expect(formatted).toContain('测试');

      expect(ErrorUtils.formatError(new Error('普通错误'))).toBe('普通错误');
      expect(ErrorUtils.formatError('字符串错误')).toBe('字符串错误');
    });
  });
});
