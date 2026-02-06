/**
 * Performance Monitoring Module
 * 性能监控和分析工具
 */

import { DEBUG_CONFIG } from './trading-config.js';
import { logger } from './logger.js';

export interface PerformanceStep {
  name: string;
  duration: number;
}

export interface PerformanceReport {
  totalTime: number;
  steps: PerformanceStep[];
}

// ========== 性能分析代理 ==========
/**
 * 性能计时器（Debug 模式实现）
 */
export class DebugPerformanceTimer {
  private type: string;
  private startTime: number;
  private steps: PerformanceStep[];

  constructor(type: string) {
    this.type = type;
    this.startTime = performance.now();
    this.steps = [];
  }

  /**
   * 重置计时器状态（用于对象池复用）
   */
  reset(type: string) {
    this.type = type;
    this.startTime = performance.now();
    this.steps = [];
  }

  step(name: string) {
    const now = performance.now();
    const duration = now - this.startTime - this.steps.reduce((sum, s) => sum + s.duration, 0);
    this.steps.push({ name, duration });
  }

  finish(): PerformanceReport {
    const totalTime = performance.now() - this.startTime;
    this.printReport(totalTime);
    return { totalTime, steps: this.steps };
  }

  private printReport(totalTime: number) {
    const actionName = this.type === 'buy' ? '买入' : '卖出';
    logger.perf(`[Perf:${actionName}] 总耗时 ${totalTime.toFixed(2)}ms`, this.steps);
    console.group(`%c⏱️ ${actionName}交易性能报告`, 'font-weight: bold; font-size: 14px; color: #10b981;');
    console.log(`%c总耗时: ${totalTime.toFixed(2)}ms`, 'font-weight: bold; color: #3b82f6;');
    console.log('');
    console.log('%c执行步骤明细:', 'font-weight: bold; text-decoration: underline;');

    let cumulativeTime = 0;
    this.steps.forEach((step, index) => {
      cumulativeTime += step.duration;
      const percentage = ((step.duration / totalTime) * 100).toFixed(1);
      const barLength = Math.round((step.duration / totalTime) * 30);
      const bar = '█'.repeat(barLength) + '░'.repeat(30 - barLength);

      let color = '#10b981';
      if (step.duration > 500) {
        color = '#ef4444';
      } else if (step.duration > 200) {
        color = '#f59e0b';
      }

      console.log(
        `%c${index + 1}. ${step.name}\n` +
        `   ${bar} ${step.duration.toFixed(2)}ms (${percentage}%)\n` +
        `   累计: ${cumulativeTime.toFixed(2)}ms`,
        `color: ${color};`
      );
    });

    console.log('');
    console.log('%c性能建议:', 'font-weight: bold; text-decoration: underline;');

    const slowSteps = this.steps.filter(s => s.duration > 200);
    if (slowSteps.length > 0) {
      console.log('%c⚠️ 发现耗时较长的步骤:', 'color: #f59e0b;');
      slowSteps.forEach(step => {
        console.log(`   • ${step.name}: ${step.duration.toFixed(2)}ms`);
      });
    } else {
      console.log('%c✅ 所有步骤执行效率良好', 'color: #10b981;');
    }

    console.groupEnd();
  }
}

/**
 * 性能计时器（无操作实现 - 生产环境）
 */
export class NoOpPerformanceTimer {
  private type: string;
  private steps: PerformanceStep[];

  constructor(type: string) {
    this.type = type;
    this.steps = [];
  }

  /**
   * 重置计时器状态（用于对象池复用）
   */
  reset(type: string) {
    this.type = type;
    this.steps = [];
  }

  step(_name: string) {}
  finish(): PerformanceReport {
    return { totalTime: 0, steps: [] };
  }
}

/**
 * 性能计时器工厂
 * PERF_ENABLED 模式返回真实计时器，否则返回无操作计时器
 */
export class PerformanceTimer {
  private impl: DebugPerformanceTimer | NoOpPerformanceTimer;

  constructor(type: string) {
    if (DEBUG_CONFIG.PERF_ENABLED) {
      this.impl = new DebugPerformanceTimer(type);
    } else {
      this.impl = new NoOpPerformanceTimer(type);
    }
  }

  /**
   * 重置计时器状态（用于对象池复用）
   */
  reset(type: string) {
    this.impl.reset(type);
  }

  step(name: string) {
    this.impl.step(name);
  }

  finish(): PerformanceReport {
    return this.impl.finish();
  }
}

/**
 * 性能计时器对象池
 * 复用 PerformanceTimer 实例，避免频繁创建对象
 */
class PerformanceTimerPool {
  private pool: Map<string, PerformanceTimer[]> = new Map();
  private maxPoolSize = 5; // 每种类型最多缓存 5 个实例

  /**
   * 获取或创建计时器
   */
  acquire(type: string): PerformanceTimer {
    const typePool = this.pool.get(type);
    if (typePool && typePool.length > 0) {
      const timer = typePool.pop()!;
      // 重置状态，清除上次使用的记录
      timer.reset(type);
      return timer;
    }
    return new PerformanceTimer(type);
  }

  /**
   * 归还计时器到池中
   */
  release(type: string, timer: PerformanceTimer) {
    if (!this.pool.has(type)) {
      this.pool.set(type, []);
    }
    const typePool = this.pool.get(type)!;
    if (typePool.length < this.maxPoolSize) {
      // 归还前重置状态，确保池中对象干净
      timer.reset(type);
      typePool.push(timer);
    }
  }

  /**
   * 清空对象池
   */
  clear() {
    this.pool.clear();
  }
}

// 全局对象池实例
const timerPool = new PerformanceTimerPool();

/**
 * 获取性能计时器（从对象池）
 */
export function getPerformanceTimer(type: string): PerformanceTimer {
  return timerPool.acquire(type);
}

/**
 * 归还性能计时器到对象池
 */
export function releasePerformanceTimer(type: string, timer: PerformanceTimer) {
  timerPool.release(type, timer);
}

/**
 * 性能测量工具
 */
export const perf = {
  // 开始计时
  now: () => DEBUG_CONFIG.PERF_ENABLED ? performance.now() : 0,

  // 计算耗时
  measure: (start: number) => DEBUG_CONFIG.PERF_ENABLED ? performance.now() - start : 0,

  // 打印 Background 性能报告
  printBackgroundReport: (type: string, perfData: PerformanceReport) => {
    if (!DEBUG_CONFIG.PERF_ENABLED) return;

    const actionName = type === 'buy' ? '买入' : '卖出';
    const totalTime = perfData.totalTime;
    logger.perf(`[Perf:Background ${actionName}] 总耗时 ${totalTime.toFixed(2)}ms`, perfData.steps);

    console.group(`%c🔗 Background ${actionName}交易性能报告`, 'font-weight: bold; font-size: 14px; color: #8b5cf6;');
    console.log(`%c总耗时: ${totalTime.toFixed(2)}ms`, 'font-weight: bold; color: #3b82f6;');
    console.log('');
    console.log('%c执行步骤明细:', 'font-weight: bold; text-decoration: underline;');

    let cumulativeTime = 0;
    perfData.steps.forEach((step, index) => {
      cumulativeTime += step.duration;
      const percentage = ((step.duration / totalTime) * 100).toFixed(1);
      const barLength = Math.round((step.duration / totalTime) * 30);
      const bar = '█'.repeat(barLength) + '░'.repeat(30 - barLength);

      let color = '#10b981';
      if (step.duration > 1000) {
        color = '#ef4444';
      } else if (step.duration > 500) {
        color = '#f59e0b';
      }

      console.log(
        `%c${index + 1}. ${step.name}\n` +
        `   ${bar} ${step.duration.toFixed(2)}ms (${percentage}%)\n` +
        `   累计: ${cumulativeTime.toFixed(2)}ms`,
        `color: ${color};`
      );
    });

    console.log('');
    console.log('%c性能建议:', 'font-weight: bold; text-decoration: underline;');

    const slowSteps = perfData.steps.filter(s => s.duration > 500);
    if (slowSteps.length > 0) {
      console.log('%c⚠️ 发现耗时较长的步骤:', 'color: #f59e0b;');
      slowSteps.forEach(step => {
        console.log(`   • ${step.name}: ${step.duration.toFixed(2)}ms`);
      });
    } else {
      console.log('%c✅ 所有步骤执行效率良好', 'color: #10b981;');
    }

    console.groupEnd();
  }
};
