import { describe, it, expect, beforeEach } from 'vitest';
import { routeTracer, enableRouteTracing, disableRouteTracing, isRouteTracingEnabled } from '../../src/shared/route-tracer';

describe('Route Tracer 测试', () => {
  beforeEach(() => {
    routeTracer.clearTraces();
    disableRouteTracing();
  });

  describe('启用和禁用', () => {
    it('默认应该是禁用状态', () => {
      expect(isRouteTracingEnabled()).toBe(false);
    });

    it('应该能够启用追踪', () => {
      enableRouteTracing();
      expect(isRouteTracingEnabled()).toBe(true);
    });

    it('应该能够禁用追踪', () => {
      enableRouteTracing();
      disableRouteTracing();
      expect(isRouteTracingEnabled()).toBe(false);
    });
  });

  describe('追踪记录', () => {
    beforeEach(() => {
      enableRouteTracing();
    });

    it('应该能够开始追踪', () => {
      const traceId = routeTracer.startTrace('0x1234', 'four');
      expect(traceId).toBeTruthy();
      expect(traceId).toContain('0x1234');
      expect(traceId).toContain('four');
    });

    it('应该能够添加步骤', () => {
      const traceId = routeTracer.startTrace('0x1234', 'four');
      routeTracer.addStep(traceId, 'step1', { data: 'test' });

      const trace = routeTracer.getTrace(traceId);
      expect(trace).toBeDefined();
      expect(trace!.steps).toHaveLength(1);
      expect(trace!.steps[0].step).toBe('step1');
      expect(trace!.steps[0].data).toEqual({ data: 'test' });
    });

    it('应该能够记录错误', () => {
      const traceId = routeTracer.startTrace('0x1234', 'four');
      const error = new Error('Test error');
      routeTracer.addError(traceId, 'error-step', error);

      const trace = routeTracer.getTrace(traceId);
      expect(trace).toBeDefined();
      expect(trace!.steps).toHaveLength(1);
      expect(trace!.steps[0].error).toBe('Test error');
      expect(trace!.error).toBe('Test error');
    });

    it('应该能够结束追踪', () => {
      const traceId = routeTracer.startTrace('0x1234', 'four');
      const result = { platform: 'four' };
      routeTracer.endTrace(traceId, result);

      const trace = routeTracer.getTrace(traceId);
      expect(trace).toBeDefined();
      expect(trace!.endTime).toBeDefined();
      expect(trace!.totalDuration).toBeDefined();
      expect(trace!.result).toEqual(result);
    });

    it('步骤应该记录时间差', () => {
      const traceId = routeTracer.startTrace('0x1234', 'four');
      routeTracer.addStep(traceId, 'step1');
      routeTracer.addStep(traceId, 'step2');

      const trace = routeTracer.getTrace(traceId);
      expect(trace!.steps[0].duration).toBeDefined();
      expect(trace!.steps[1].duration).toBeDefined();
    });
  });

  describe('查询追踪记录', () => {
    beforeEach(() => {
      enableRouteTracing();
    });

    it('应该能够获取所有追踪记录', () => {
      routeTracer.startTrace('0x1234', 'four');
      routeTracer.startTrace('0x5678', 'flap');

      const traces = routeTracer.getAllTraces();
      expect(traces).toHaveLength(2);
    });

    it('应该能够按代币地址查询', () => {
      routeTracer.startTrace('0x1234', 'four');
      routeTracer.startTrace('0x1234', 'flap');
      routeTracer.startTrace('0x5678', 'four');

      const traces = routeTracer.getTracesByToken('0x1234');
      expect(traces).toHaveLength(2);
    });

    it('按代币地址查询应该不区分大小写', () => {
      routeTracer.startTrace('0xABCD', 'four');

      const traces1 = routeTracer.getTracesByToken('0xabcd');
      const traces2 = routeTracer.getTracesByToken('0xABCD');

      expect(traces1).toHaveLength(1);
      expect(traces2).toHaveLength(1);
    });
  });

  describe('清除追踪记录', () => {
    beforeEach(() => {
      enableRouteTracing();
    });

    it('应该能够清除所有追踪记录', () => {
      routeTracer.startTrace('0x1234', 'four');
      routeTracer.startTrace('0x5678', 'flap');

      routeTracer.clearTraces();

      const traces = routeTracer.getAllTraces();
      expect(traces).toHaveLength(0);
    });

    it('应该能够清除指定代币的追踪记录', () => {
      routeTracer.startTrace('0x1234', 'four');
      routeTracer.startTrace('0x5678', 'flap');

      routeTracer.clearTracesByToken('0x1234');

      const traces = routeTracer.getAllTraces();
      expect(traces).toHaveLength(1);
      expect(traces[0].tokenAddress).toBe('0x5678');
    });
  });

  describe('统计信息', () => {
    beforeEach(() => {
      enableRouteTracing();
    });

    it('应该能够获取统计信息', () => {
      const traceId1 = routeTracer.startTrace('0x1234', 'four');
      routeTracer.endTrace(traceId1);

      const traceId2 = routeTracer.startTrace('0x5678', 'flap');
      routeTracer.addError(traceId2, 'error', new Error('Test'));
      routeTracer.endTrace(traceId2);

      const stats = routeTracer.getStats();
      expect(stats.totalTraces).toBe(2);
      expect(stats.errorCount).toBe(1);
      expect(stats.successRate).toBe(50);
      expect(stats.averageDuration).toBeGreaterThanOrEqual(0);
    });

    it('空追踪应该返回零统计', () => {
      const stats = routeTracer.getStats();
      expect(stats.totalTraces).toBe(0);
      expect(stats.errorCount).toBe(0);
      expect(stats.successRate).toBe(0);
      expect(stats.averageDuration).toBe(0);
    });
  });

  describe('导出功能', () => {
    beforeEach(() => {
      enableRouteTracing();
    });

    it('应该能够导出为 JSON', () => {
      const traceId = routeTracer.startTrace('0x1234', 'four');
      routeTracer.addStep(traceId, 'step1');
      routeTracer.endTrace(traceId);

      const json = routeTracer.exportTraces();
      expect(json).toBeTruthy();

      const parsed = JSON.parse(json);
      expect(Array.isArray(parsed)).toBe(true);
      expect(parsed).toHaveLength(1);
    });
  });

  describe('禁用状态下的行为', () => {
    it('禁用时不应该创建追踪', () => {
      disableRouteTracing();

      const traceId = routeTracer.startTrace('0x1234', 'four');
      expect(traceId).toBe('');

      const traces = routeTracer.getAllTraces();
      expect(traces).toHaveLength(0);
    });

    it('禁用时添加步骤应该不报错', () => {
      disableRouteTracing();

      expect(() => {
        routeTracer.addStep('invalid-id', 'step1');
      }).not.toThrow();
    });

    it('禁用时记录错误应该不报错', () => {
      disableRouteTracing();

      expect(() => {
        routeTracer.addError('invalid-id', 'error', new Error('Test'));
      }).not.toThrow();
    });
  });

  describe('最大追踪数量限制', () => {
    beforeEach(() => {
      enableRouteTracing();
    });

    it('应该限制追踪记录数量', () => {
      // 创建超过最大数量的追踪
      for (let i = 0; i < 150; i++) {
        routeTracer.startTrace(`0x${i}`, 'four');
      }

      const traces = routeTracer.getAllTraces();
      expect(traces.length).toBeLessThanOrEqual(100);
    });
  });

  describe('边界情况', () => {
    beforeEach(() => {
      enableRouteTracing();
    });

    it('应该处理无效的 traceId', () => {
      expect(() => {
        routeTracer.addStep('invalid-id', 'step1');
      }).not.toThrow();

      expect(() => {
        routeTracer.endTrace('invalid-id');
      }).not.toThrow();
    });

    it('应该处理空字符串 traceId', () => {
      expect(() => {
        routeTracer.addStep('', 'step1');
      }).not.toThrow();
    });

    it('应该处理字符串错误', () => {
      const traceId = routeTracer.startTrace('0x1234', 'four');
      routeTracer.addError(traceId, 'error', 'String error');

      const trace = routeTracer.getTrace(traceId);
      expect(trace!.error).toBe('String error');
    });
  });
});
