/**
 * Route Tracing System
 * 路由查询追踪系统，用于记录和分析路由查询过程
 */

export interface TraceStep {
  step: string;
  timestamp: number;
  duration?: number;
  data?: any;
  error?: string;
}

export interface RouteTrace {
  traceId: string;
  tokenAddress: string;
  platform: string;
  startTime: number;
  endTime?: number;
  totalDuration?: number;
  steps: TraceStep[];
  result?: any;
  error?: string;
}

class RouteTracer {
  private traces: Map<string, RouteTrace> = new Map();
  private enabled: boolean = false;
  private maxTraces: number = 100; // 最多保留 100 条追踪记录

  /**
   * 启用追踪
   */
  enable(): void {
    this.enabled = true;
  }

  /**
   * 禁用追踪
   */
  disable(): void {
    this.enabled = false;
  }

  /**
   * 检查追踪是否启用
   */
  isEnabled(): boolean {
    return this.enabled;
  }

  /**
   * 开始一个新的追踪
   */
  startTrace(tokenAddress: string, platform: string): string {
    if (!this.enabled) {
      return '';
    }

    const traceId = `${tokenAddress}-${platform}-${Date.now()}`;
    const trace: RouteTrace = {
      traceId,
      tokenAddress,
      platform,
      startTime: Date.now(),
      steps: []
    };

    this.traces.set(traceId, trace);

    // 限制追踪记录数量
    if (this.traces.size > this.maxTraces) {
      const firstKey = this.traces.keys().next().value;
      this.traces.delete(firstKey);
    }

    return traceId;
  }

  /**
   * 添加追踪步骤
   */
  addStep(traceId: string, step: string, data?: any): void {
    if (!this.enabled || !traceId) {
      return;
    }

    const trace = this.traces.get(traceId);
    if (!trace) {
      return;
    }

    const stepData: TraceStep = {
      step,
      timestamp: Date.now(),
      data
    };

    // 计算与上一步的时间差
    if (trace.steps.length > 0) {
      const lastStep = trace.steps[trace.steps.length - 1];
      stepData.duration = stepData.timestamp - lastStep.timestamp;
    } else {
      stepData.duration = stepData.timestamp - trace.startTime;
    }

    trace.steps.push(stepData);
  }

  /**
   * 记录错误
   */
  addError(traceId: string, step: string, error: Error | string): void {
    if (!this.enabled || !traceId) {
      return;
    }

    const trace = this.traces.get(traceId);
    if (!trace) {
      return;
    }

    const errorMessage = error instanceof Error ? error.message : error;
    const stepData: TraceStep = {
      step,
      timestamp: Date.now(),
      error: errorMessage
    };

    if (trace.steps.length > 0) {
      const lastStep = trace.steps[trace.steps.length - 1];
      stepData.duration = stepData.timestamp - lastStep.timestamp;
    } else {
      stepData.duration = stepData.timestamp - trace.startTime;
    }

    trace.steps.push(stepData);
    trace.error = errorMessage;
  }

  /**
   * 结束追踪
   */
  endTrace(traceId: string, result?: any): void {
    if (!this.enabled || !traceId) {
      return;
    }

    const trace = this.traces.get(traceId);
    if (!trace) {
      return;
    }

    trace.endTime = Date.now();
    trace.totalDuration = trace.endTime - trace.startTime;
    trace.result = result;
  }

  /**
   * 获取追踪记录
   */
  getTrace(traceId: string): RouteTrace | undefined {
    return this.traces.get(traceId);
  }

  /**
   * 获取所有追踪记录
   */
  getAllTraces(): RouteTrace[] {
    return Array.from(this.traces.values());
  }

  /**
   * 获取指定代币的追踪记录
   */
  getTracesByToken(tokenAddress: string): RouteTrace[] {
    return Array.from(this.traces.values()).filter(
      trace => trace.tokenAddress.toLowerCase() === tokenAddress.toLowerCase()
    );
  }

  /**
   * 清除所有追踪记录
   */
  clearTraces(): void {
    this.traces.clear();
  }

  /**
   * 清除指定代币的追踪记录
   */
  clearTracesByToken(tokenAddress: string): void {
    const normalizedAddress = tokenAddress.toLowerCase();
    for (const [traceId, trace] of this.traces.entries()) {
      if (trace.tokenAddress.toLowerCase() === normalizedAddress) {
        this.traces.delete(traceId);
      }
    }
  }

  /**
   * 获取追踪统计信息
   */
  getStats(): {
    totalTraces: number;
    averageDuration: number;
    successRate: number;
    errorCount: number;
  } {
    const traces = Array.from(this.traces.values());
    const totalTraces = traces.length;

    if (totalTraces === 0) {
      return {
        totalTraces: 0,
        averageDuration: 0,
        successRate: 0,
        errorCount: 0
      };
    }

    const completedTraces = traces.filter(t => t.totalDuration !== undefined);
    const totalDuration = completedTraces.reduce((sum, t) => sum + (t.totalDuration || 0), 0);
    const averageDuration = completedTraces.length > 0 ? totalDuration / completedTraces.length : 0;

    const errorCount = traces.filter(t => t.error).length;
    const successRate = totalTraces > 0 ? ((totalTraces - errorCount) / totalTraces) * 100 : 0;

    return {
      totalTraces,
      averageDuration,
      successRate,
      errorCount
    };
  }

  /**
   * 导出追踪记录为 JSON
   */
  exportTraces(): string {
    const traces = Array.from(this.traces.values());
    return JSON.stringify(traces, null, 2);
  }

  /**
   * 打印追踪摘要
   */
  printTraceSummary(traceId: string): void {
    const trace = this.traces.get(traceId);
    if (!trace) {
      console.log(`[RouteTracer] Trace not found: ${traceId}`);
      return;
    }

    console.group(`[RouteTracer] Trace Summary: ${traceId}`);
    console.log(`Token: ${trace.tokenAddress}`);
    console.log(`Platform: ${trace.platform}`);
    console.log(`Total Duration: ${trace.totalDuration || 'N/A'}ms`);
    console.log(`Steps: ${trace.steps.length}`);

    if (trace.error) {
      console.error(`Error: ${trace.error}`);
    }

    console.log('\nSteps:');
    trace.steps.forEach((step, index) => {
      const prefix = step.error ? '❌' : '✓';
      console.log(`  ${prefix} ${index + 1}. ${step.step} (${step.duration}ms)`);
      if (step.error) {
        console.log(`     Error: ${step.error}`);
      }
    });

    console.groupEnd();
  }
}

// 导出单例实例
export const routeTracer = new RouteTracer();

// 便捷函数
export function enableRouteTracing(): void {
  routeTracer.enable();
}

export function disableRouteTracing(): void {
  routeTracer.disable();
}

export function isRouteTracingEnabled(): boolean {
  return routeTracer.isEnabled();
}
