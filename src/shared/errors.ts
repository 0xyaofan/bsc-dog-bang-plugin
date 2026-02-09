/**
 * 自定义错误类型
 *
 * 提供统一的错误处理机制，包含错误代码和上下文信息
 */

import type { TokenPlatform } from './token-route.js';

/**
 * 基础路由错误类
 */
export class RouteError extends Error {
  public readonly code: string;
  public readonly context?: Record<string, any>;
  public readonly timestamp: number;

  constructor(
    message: string,
    code: string,
    context?: Record<string, any>
  ) {
    super(message);
    this.name = 'RouteError';
    this.code = code;
    this.context = context;
    this.timestamp = Date.now();

    // 保持正确的原型链
    Object.setPrototypeOf(this, RouteError.prototype);
  }

  /**
   * 转换为 JSON 格式
   */
  toJSON(): Record<string, any> {
    return {
      name: this.name,
      message: this.message,
      code: this.code,
      context: this.context,
      timestamp: this.timestamp,
      stack: this.stack
    };
  }

  /**
   * 格式化错误信息
   */
  toString(): string {
    const contextStr = this.context
      ? ` | ${JSON.stringify(this.context)}`
      : '';
    return `[${this.code}] ${this.message}${contextStr}`;
  }
}

/**
 * 平台特定错误
 *
 * 用于平台路由查询失败的情况
 */
export class PlatformError extends RouteError {
  public readonly platform: TokenPlatform;

  constructor(
    message: string,
    platform: TokenPlatform,
    context?: Record<string, any>
  ) {
    super(message, 'PLATFORM_ERROR', { ...context, platform });
    this.name = 'PlatformError';
    this.platform = platform;

    Object.setPrototypeOf(this, PlatformError.prototype);
  }
}

/**
 * Service Worker 错误
 *
 * 用于 Chrome Extension Service Worker 环境限制导致的错误
 */
export class ServiceWorkerError extends RouteError {
  public readonly operation: string;

  constructor(
    message: string,
    operation: string,
    context?: Record<string, any>
  ) {
    super(message, 'SERVICE_WORKER_ERROR', { ...context, operation });
    this.name = 'ServiceWorkerError';
    this.operation = operation;

    Object.setPrototypeOf(this, ServiceWorkerError.prototype);
  }
}

/**
 * 流动性错误
 *
 * 用于流动性检查失败的情况
 */
export class LiquidityError extends RouteError {
  public readonly pairAddress?: string;
  public readonly tokenAddress?: string;
  public readonly quoteToken?: string;

  constructor(
    message: string,
    context?: {
      pairAddress?: string;
      tokenAddress?: string;
      quoteToken?: string;
      [key: string]: any;
    }
  ) {
    super(message, 'LIQUIDITY_ERROR', context);
    this.name = 'LiquidityError';
    this.pairAddress = context?.pairAddress;
    this.tokenAddress = context?.tokenAddress;
    this.quoteToken = context?.quoteToken;

    Object.setPrototypeOf(this, LiquidityError.prototype);
  }
}

/**
 * 缓存错误
 *
 * 用于缓存操作失败的情况
 */
export class CacheError extends RouteError {
  public readonly operation: 'get' | 'set' | 'delete' | 'clear';
  public readonly key?: string;

  constructor(
    message: string,
    operation: 'get' | 'set' | 'delete' | 'clear',
    context?: {
      key?: string;
      [key: string]: any;
    }
  ) {
    super(message, 'CACHE_ERROR', { ...context, operation });
    this.name = 'CacheError';
    this.operation = operation;
    this.key = context?.key;

    Object.setPrototypeOf(this, CacheError.prototype);
  }
}

/**
 * 网络错误
 *
 * 用于网络请求失败的情况
 */
export class NetworkError extends RouteError {
  public readonly url?: string;
  public readonly statusCode?: number;
  public readonly retryable: boolean;

  constructor(
    message: string,
    context?: {
      url?: string;
      statusCode?: number;
      retryable?: boolean;
      [key: string]: any;
    }
  ) {
    super(message, 'NETWORK_ERROR', context);
    this.name = 'NetworkError';
    this.url = context?.url;
    this.statusCode = context?.statusCode;
    this.retryable = context?.retryable ?? true;

    Object.setPrototypeOf(this, NetworkError.prototype);
  }
}

/**
 * 验证错误
 *
 * 用于输入验证失败的情况
 */
export class ValidationError extends RouteError {
  public readonly paramName: string;
  public readonly paramValue: any;

  constructor(
    message: string,
    paramName: string,
    paramValue: any,
    context?: Record<string, any>
  ) {
    super(message, 'VALIDATION_ERROR', { ...context, paramName, paramValue });
    this.name = 'ValidationError';
    this.paramName = paramName;
    this.paramValue = paramValue;

    Object.setPrototypeOf(this, ValidationError.prototype);
  }
}

/**
 * 合约调用错误
 *
 * 用于智能合约调用失败的情况
 */
export class ContractError extends RouteError {
  public readonly contractAddress: string;
  public readonly functionName: string;
  public readonly args?: any[];

  constructor(
    message: string,
    contractAddress: string,
    functionName: string,
    context?: {
      args?: any[];
      [key: string]: any;
    }
  ) {
    super(message, 'CONTRACT_ERROR', { ...context, contractAddress, functionName });
    this.name = 'ContractError';
    this.contractAddress = contractAddress;
    this.functionName = functionName;
    this.args = context?.args;

    Object.setPrototypeOf(this, ContractError.prototype);
  }
}

/**
 * 超时错误
 *
 * 用于操作超时的情况
 */
export class TimeoutError extends RouteError {
  public readonly operation: string;
  public readonly timeoutMs: number;

  constructor(
    message: string,
    operation: string,
    timeoutMs: number,
    context?: Record<string, any>
  ) {
    super(message, 'TIMEOUT_ERROR', { ...context, operation, timeoutMs });
    this.name = 'TimeoutError';
    this.operation = operation;
    this.timeoutMs = timeoutMs;

    Object.setPrototypeOf(this, TimeoutError.prototype);
  }
}

/**
 * 检查错误是否可重试
 */
export function isRetryableError(error: Error): boolean {
  // NetworkError 有 retryable 属性
  if (error instanceof NetworkError) {
    return error.retryable;
  }

  // TimeoutError 可重试
  if (error instanceof TimeoutError) {
    return true;
  }

  // ContractError 可能可重试（取决于错误类型）
  if (error instanceof ContractError) {
    const message = error.message.toLowerCase();
    // 网络相关错误可重试
    if (message.includes('network') ||
        message.includes('timeout') ||
        message.includes('connection')) {
      return true;
    }
    // 合约执行错误不可重试
    return false;
  }

  // ServiceWorkerError 不可重试
  if (error instanceof ServiceWorkerError) {
    return false;
  }

  // ValidationError 不可重试
  if (error instanceof ValidationError) {
    return false;
  }

  // 其他错误默认不可重试
  return false;
}

/**
 * 从原始错误创建适当的自定义错误
 */
export function wrapError(error: unknown, context?: Record<string, any>): RouteError {
  // 如果已经是自定义错误，直接返回
  if (error instanceof RouteError) {
    return error;
  }

  // 转换为 Error 对象
  const err = error instanceof Error ? error : new Error(String(error));
  const message = err.message;

  // 根据错误信息判断错误类型
  if (message.includes('Service Worker') || message.includes('import()')) {
    return new ServiceWorkerError(
      message,
      'unknown',
      { ...context, originalError: err.name }
    );
  }

  if (message.includes('network') || message.includes('fetch')) {
    return new NetworkError(
      message,
      { ...context, originalError: err.name }
    );
  }

  if (message.includes('timeout')) {
    return new TimeoutError(
      message,
      'unknown',
      0,
      { ...context, originalError: err.name }
    );
  }

  if (message.includes('liquidity') || message.includes('reserve')) {
    return new LiquidityError(
      message,
      { ...context, originalError: err.name }
    );
  }

  if (message.includes('validation') || message.includes('invalid')) {
    return new ValidationError(
      message,
      'unknown',
      undefined,
      { ...context, originalError: err.name }
    );
  }

  // 默认返回基础 RouteError
  return new RouteError(
    message,
    'UNKNOWN_ERROR',
    { ...context, originalError: err.name }
  );
}

/**
 * 错误工具函数
 */
export const ErrorUtils = {
  /**
   * 检查是否为特定类型的错误
   */
  isPlatformError: (error: unknown): error is PlatformError =>
    error instanceof PlatformError,

  isServiceWorkerError: (error: unknown): error is ServiceWorkerError =>
    error instanceof ServiceWorkerError,

  isLiquidityError: (error: unknown): error is LiquidityError =>
    error instanceof LiquidityError,

  isCacheError: (error: unknown): error is CacheError =>
    error instanceof CacheError,

  isNetworkError: (error: unknown): error is NetworkError =>
    error instanceof NetworkError,

  isValidationError: (error: unknown): error is ValidationError =>
    error instanceof ValidationError,

  isContractError: (error: unknown): error is ContractError =>
    error instanceof ContractError,

  isTimeoutError: (error: unknown): error is TimeoutError =>
    error instanceof TimeoutError,

  /**
   * 检查是否为路由错误
   */
  isRouteError: (error: unknown): error is RouteError =>
    error instanceof RouteError,

  /**
   * 获取错误代码
   */
  getErrorCode: (error: unknown): string => {
    if (error instanceof RouteError) {
      return error.code;
    }
    return 'UNKNOWN_ERROR';
  },

  /**
   * 获取错误上下文
   */
  getErrorContext: (error: unknown): Record<string, any> | undefined => {
    if (error instanceof RouteError) {
      return error.context;
    }
    return undefined;
  },

  /**
   * 格式化错误信息
   */
  formatError: (error: unknown): string => {
    if (error instanceof RouteError) {
      return error.toString();
    }
    if (error instanceof Error) {
      return error.message;
    }
    return String(error);
  }
};
