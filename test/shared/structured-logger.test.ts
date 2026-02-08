import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { structuredLogger, logDebug, logInfo, logWarn, logError, logPerf, logRoute, logTrade, logCache } from '../../src/shared/structured-logger';

describe('Structured Logger 测试', () => {
  let consoleLogSpy: any;
  let consoleWarnSpy: any;
  let consoleErrorSpy: any;

  beforeEach(() => {
    structuredLogger.clearLogs();
    structuredLogger.enable();
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
    consoleWarnSpy.mockRestore();
    consoleErrorSpy.mockRestore();
  });

  describe('基本日志功能', () => {
    it('应该记录 warn 日志', () => {
      structuredLogger.warn('Test warning');
      expect(consoleWarnSpy).toHaveBeenCalled();

      const logs = structuredLogger.getLogs();
      expect(logs).toHaveLength(1);
      expect(logs[0].level).toBe('warn');
      expect(logs[0].message).toBe('Test warning');
    });

    it('应该记录 error 日志', () => {
      structuredLogger.error('Test error');
      expect(consoleErrorSpy).toHaveBeenCalled();

      const logs = structuredLogger.getLogs();
      expect(logs).toHaveLength(1);
      expect(logs[0].level).toBe('error');
      expect(logs[0].message).toBe('Test error');
    });

    it('应该记录带上下文的日志', () => {
      structuredLogger.warn('Test with context', { key: 'value', number: 42 });

      const logs = structuredLogger.getLogs();
      expect(logs[0].context).toEqual({ key: 'value', number: 42 });
    });

    it('应该记录带错误对象的日志', () => {
      const error = new Error('Test error');
      structuredLogger.error('Error occurred', error);

      const logs = structuredLogger.getLogs();
      expect(logs[0].error).toBe(error);
    });
  });

  describe('专用日志函数', () => {
    it('应该记录路由日志', () => {
      logRoute('Route found', {
        tokenAddress: '0x1234',
        platform: 'four',
        channel: 'pancake'
      });

      const logs = structuredLogger.getLogs();
      expect(logs[0].message).toContain('[Route]');
      expect(logs[0].context?.tokenAddress).toBe('0x1234');
    });

    it('应该记录交易日志', () => {
      logTrade('Trade executed', {
        tokenAddress: '0x1234',
        amount: '100',
        type: 'buy'
      });

      const logs = structuredLogger.getLogs();
      expect(logs[0].message).toContain('[Trade]');
      expect(logs[0].context?.type).toBe('buy');
    });

    it('应该记录缓存日志', () => {
      logCache('Cache hit', {
        key: 'route:0x1234',
        hit: true
      });

      const logs = structuredLogger.getLogs();
      expect(logs[0].message).toContain('[Cache]');
      expect(logs[0].context?.hit).toBe(true);
    });
  });

  describe('日志过滤', () => {
    beforeEach(() => {
      structuredLogger.warn('Warning 1');
      structuredLogger.error('Error 1');
      structuredLogger.warn('Warning 2');
    });

    it('应该按级别过滤日志', () => {
      const warnings = structuredLogger.getLogs({ level: 'warn' });
      expect(warnings).toHaveLength(2);
      expect(warnings.every(log => log.level === 'warn')).toBe(true);

      const errors = structuredLogger.getLogs({ level: 'error' });
      expect(errors).toHaveLength(1);
      expect(errors[0].level).toBe('error');
    });

    it('应该按时间过滤日志', () => {
      const now = Date.now();
      const recent = structuredLogger.getLogs({ since: now - 1000 });
      expect(recent.length).toBeGreaterThan(0);

      const future = structuredLogger.getLogs({ since: now + 10000 });
      expect(future).toHaveLength(0);
    });

    it('应该组合过滤条件', () => {
      const now = Date.now();
      const recentWarnings = structuredLogger.getLogs({
        level: 'warn',
        since: now - 1000
      });
      expect(recentWarnings.every(log => log.level === 'warn')).toBe(true);
    });
  });

  describe('日志统计', () => {
    beforeEach(() => {
      structuredLogger.warn('Warning 1');
      structuredLogger.warn('Warning 2');
      structuredLogger.error('Error 1');
      structuredLogger.error('Error 2');
      structuredLogger.error('Error 3');
    });

    it('应该统计日志数量', () => {
      const stats = structuredLogger.getStats();
      expect(stats.total).toBe(5);
      expect(stats.byLevel.warn).toBe(2);
      expect(stats.byLevel.error).toBe(3);
      expect(stats.errorCount).toBe(3);
    });

    it('应该获取最近的错误', () => {
      const stats = structuredLogger.getStats();
      expect(stats.recentErrors).toHaveLength(3);
      expect(stats.recentErrors.every(log => log.level === 'error')).toBe(true);
    });
  });

  describe('日志导出', () => {
    it('应该导出为 JSON', () => {
      structuredLogger.warn('Test warning');
      structuredLogger.error('Test error');

      const json = structuredLogger.exportLogs();
      expect(json).toBeTruthy();

      const parsed = JSON.parse(json);
      expect(Array.isArray(parsed)).toBe(true);
      expect(parsed).toHaveLength(2);
    });
  });

  describe('日志清除', () => {
    it('应该清除所有日志', () => {
      structuredLogger.warn('Warning');
      structuredLogger.error('Error');

      expect(structuredLogger.getLogs()).toHaveLength(2);

      structuredLogger.clearLogs();

      expect(structuredLogger.getLogs()).toHaveLength(0);
    });
  });

  describe('启用和禁用', () => {
    it('应该能够禁用日志', () => {
      structuredLogger.disable();
      expect(structuredLogger.isEnabled()).toBe(false);

      structuredLogger.warn('This should not be logged');
      expect(structuredLogger.getLogs()).toHaveLength(0);
    });

    it('应该能够重新启用日志', () => {
      structuredLogger.disable();
      structuredLogger.enable();
      expect(structuredLogger.isEnabled()).toBe(true);

      structuredLogger.warn('This should be logged');
      expect(structuredLogger.getLogs()).toHaveLength(1);
    });
  });

  describe('日志格式化', () => {
    it('应该格式化不同类型的值', () => {
      structuredLogger.warn('Test', {
        string: 'text',
        number: 42,
        boolean: true,
        null: null,
        undefined: undefined,
        bigint: 100n
      });

      expect(consoleWarnSpy).toHaveBeenCalled();
      const call = consoleWarnSpy.mock.calls[0][0];
      expect(call).toContain('string="text"');
      expect(call).toContain('number=42');
      expect(call).toContain('boolean=true');
      expect(call).toContain('null=null');
      expect(call).toContain('undefined=undefined');
      expect(call).toContain('bigint=100n');
    });

    it('应该格式化对象', () => {
      structuredLogger.warn('Test', {
        obj: { key: 'value' }
      });

      expect(consoleWarnSpy).toHaveBeenCalled();
      const call = consoleWarnSpy.mock.calls[0][0];
      expect(call).toContain('obj=');
    });

    it('应该包含时间戳', () => {
      structuredLogger.warn('Test');

      expect(consoleWarnSpy).toHaveBeenCalled();
      const call = consoleWarnSpy.mock.calls[0][0];
      expect(call).toMatch(/\[\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    });

    it('应该包含日志级别', () => {
      structuredLogger.warn('Test');

      expect(consoleWarnSpy).toHaveBeenCalled();
      const call = consoleWarnSpy.mock.calls[0][0];
      expect(call).toContain('WARN');
    });
  });

  describe('便捷函数', () => {
    it('logWarn 应该工作', () => {
      logWarn('Test warning');
      expect(consoleWarnSpy).toHaveBeenCalled();
    });

    it('logError 应该工作', () => {
      logError('Test error');
      expect(consoleErrorSpy).toHaveBeenCalled();
    });

    it('logError 应该接受错误对象', () => {
      const error = new Error('Test');
      logError('Error occurred', error);
      expect(consoleErrorSpy).toHaveBeenCalled();
    });
  });

  describe('日志数量限制', () => {
    it('应该限制日志数量', () => {
      // 创建超过最大数量的日志
      for (let i = 0; i < 1100; i++) {
        structuredLogger.warn(`Log ${i}`);
      }

      const logs = structuredLogger.getLogs();
      expect(logs.length).toBeLessThanOrEqual(1000);
    });
  });

  describe('边界情况', () => {
    it('应该处理空上下文', () => {
      structuredLogger.warn('Test', {});
      expect(consoleWarnSpy).toHaveBeenCalled();
    });

    it('应该处理 undefined 上下文', () => {
      structuredLogger.warn('Test', undefined);
      expect(consoleWarnSpy).toHaveBeenCalled();
    });

    it('应该处理循环引用的对象', () => {
      const obj: any = { key: 'value' };
      obj.self = obj;

      structuredLogger.warn('Test', { obj });
      expect(consoleWarnSpy).toHaveBeenCalled();
    });
  });
});
