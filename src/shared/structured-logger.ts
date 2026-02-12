/**
 * Structured Logging System
 * 结构化日志系统，提供更丰富的上下文信息和更好的可读性
 */

import { DEBUG_CONFIG } from './config/index.js';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogContext {
  [key: string]: any;
}

export interface LogEntry {
  timestamp: number;
  level: LogLevel;
  message: string;
  context?: LogContext;
  error?: Error;
}

class StructuredLogger {
  private logs: LogEntry[] = [];
  private maxLogs: number = 1000;
  private enabled: boolean = true;

  /**
   * 记录 debug 级别日志
   */
  debug(message: string, context?: LogContext): void {
    if (DEBUG_CONFIG.ENABLED) {
      this.log('debug', message, context);
      console.log(this.formatLog('debug', message, context));
    }
  }

  /**
   * 记录 info 级别日志
   */
  info(message: string, context?: LogContext): void {
    if (DEBUG_CONFIG.ENABLED) {
      this.log('info', message, context);
      console.log(this.formatLog('info', message, context));
    }
  }

  /**
   * 记录 warn 级别日志
   */
  warn(message: string, context?: LogContext): void {
    this.log('warn', message, context);
    console.warn(this.formatLog('warn', message, context));
  }

  /**
   * 记录 error 级别日志
   */
  error(message: string, contextOrError?: LogContext | Error): void {
    const isError = contextOrError instanceof Error;
    const context = isError ? undefined : contextOrError;
    const error = isError ? contextOrError : undefined;

    this.log('error', message, context, error);
    console.error(this.formatLog('error', message, context), error);
  }

  /**
   * 记录性能日志
   */
  perf(message: string, duration: number, context?: LogContext): void {
    if (DEBUG_CONFIG.PERF_ENABLED) {
      const perfContext = { ...context, duration: `${duration}ms` };
      this.log('info', `[PERF] ${message}`, perfContext);
      console.log(this.formatLog('info', `[PERF] ${message}`, perfContext));
    }
  }

  /**
   * 记录路由相关日志
   */
  route(message: string, context: {
    tokenAddress?: string;
    platform?: string;
    channel?: string;
    [key: string]: any;
  }): void {
    // 路由日志总是记录，不受 DEBUG_CONFIG 限制
    this.log('debug', `[Route] ${message}`, context);
    if (DEBUG_CONFIG.ENABLED) {
      console.log(this.formatLog('debug', `[Route] ${message}`, context));
    }
  }

  /**
   * 记录交易相关日志
   */
  trade(message: string, context: {
    tokenAddress?: string;
    amount?: string;
    type?: 'buy' | 'sell';
    [key: string]: any;
  }): void {
    // 交易日志总是记录，不受 DEBUG_CONFIG 限制
    this.log('info', `[Trade] ${message}`, context);
    if (DEBUG_CONFIG.ENABLED) {
      console.log(this.formatLog('info', `[Trade] ${message}`, context));
    }
  }

  /**
   * 记录缓存相关日志
   */
  cache(message: string, context: {
    key?: string;
    hit?: boolean;
    [key: string]: any;
  }): void {
    // 缓存日志总是记录，不受 DEBUG_CONFIG 限制
    this.log('debug', `[Cache] ${message}`, context);
    if (DEBUG_CONFIG.ENABLED) {
      console.log(this.formatLog('debug', `[Cache] ${message}`, context));
    }
  }

  /**
   * 内部日志记录
   */
  private log(level: LogLevel, message: string, context?: LogContext, error?: Error): void {
    if (!this.enabled) return;

    const entry: LogEntry = {
      timestamp: Date.now(),
      level,
      message,
      context,
      error
    };

    this.logs.push(entry);

    // 限制日志数量
    if (this.logs.length > this.maxLogs) {
      this.logs.shift();
    }
  }

  /**
   * 格式化日志输出
   */
  private formatLog(level: LogLevel, message: string, context?: LogContext): string {
    const timestamp = new Date().toISOString();
    const levelStr = level.toUpperCase().padEnd(5);

    let formatted = `[${timestamp}] ${levelStr} ${message}`;

    if (context && Object.keys(context).length > 0) {
      const contextStr = Object.entries(context)
        .map(([key, value]) => `${key}=${this.formatValue(value)}`)
        .join(', ');
      formatted += ` | ${contextStr}`;
    }

    return formatted;
  }

  /**
   * 格式化值
   */
  private formatValue(value: any): string {
    if (value === null) return 'null';
    if (value === undefined) return 'undefined';
    if (typeof value === 'string') return `"${value}"`;
    if (typeof value === 'number' || typeof value === 'boolean') return String(value);
    if (typeof value === 'bigint') return `${value}n`;
    if (value instanceof Error) return value.message;
    if (typeof value === 'object') {
      try {
        return JSON.stringify(value);
      } catch {
        return '[Object]';
      }
    }
    return String(value);
  }

  /**
   * 获取所有日志
   */
  getLogs(filter?: { level?: LogLevel; since?: number }): LogEntry[] {
    let filtered = this.logs;

    if (filter?.level) {
      filtered = filtered.filter(log => log.level === filter.level);
    }

    if (filter?.since) {
      filtered = filtered.filter(log => log.timestamp >= filter.since);
    }

    return filtered;
  }

  /**
   * 清除日志
   */
  clearLogs(): void {
    this.logs = [];
  }

  /**
   * 导出日志为 JSON
   */
  exportLogs(): string {
    return JSON.stringify(this.logs, null, 2);
  }

  /**
   * 获取日志统计
   */
  getStats(): {
    total: number;
    byLevel: Record<LogLevel, number>;
    errorCount: number;
    recentErrors: LogEntry[];
  } {
    const byLevel: Record<LogLevel, number> = {
      debug: 0,
      info: 0,
      warn: 0,
      error: 0
    };

    this.logs.forEach(log => {
      byLevel[log.level]++;
    });

    const recentErrors = this.logs
      .filter(log => log.level === 'error')
      .slice(-10);

    return {
      total: this.logs.length,
      byLevel,
      errorCount: byLevel.error,
      recentErrors
    };
  }

  /**
   * 启用日志
   */
  enable(): void {
    this.enabled = true;
  }

  /**
   * 禁用日志
   */
  disable(): void {
    this.enabled = false;
  }

  /**
   * 检查是否启用
   */
  isEnabled(): boolean {
    return this.enabled;
  }
}

// 导出单例实例
export const structuredLogger = new StructuredLogger();

// 便捷函数
export function logDebug(message: string, context?: LogContext): void {
  structuredLogger.debug(message, context);
}

export function logInfo(message: string, context?: LogContext): void {
  structuredLogger.info(message, context);
}

export function logWarn(message: string, context?: LogContext): void {
  structuredLogger.warn(message, context);
}

export function logError(message: string, contextOrError?: LogContext | Error): void {
  structuredLogger.error(message, contextOrError);
}

export function logPerf(message: string, duration: number, context?: LogContext): void {
  structuredLogger.perf(message, duration, context);
}

export function logRoute(message: string, context: LogContext): void {
  structuredLogger.route(message, context);
}

export function logTrade(message: string, context: LogContext): void {
  structuredLogger.trade(message, context);
}

export function logCache(message: string, context: LogContext): void {
  structuredLogger.cache(message, context);
}
