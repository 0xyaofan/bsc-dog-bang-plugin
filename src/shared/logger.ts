/**
 * Logger Module
 * 统一的日志管理工具
 */

import { DEBUG_CONFIG } from './trading-config.js';

// 日志工具函数
export const logger = {
  error: (...args: any[]) => console.error(...args),
  warn: (...args: any[]) => console.warn(...args),
  info: (...args: any[]) => {
    if (DEBUG_CONFIG.ENABLED) {
      console.log(...args);
    }
  },
  debug: (...args: any[]) => {
    if (DEBUG_CONFIG.ENABLED) {
      console.log(...args);
    }
  },
  // 性能日志（独立开关控制）
  perf: (...args: any[]) => {
    if (DEBUG_CONFIG.PERF_ENABLED) {
      console.log(...args);
    }
  },
  // 分组日志
  group: (label: string, ...args: any[]) => {
    if (DEBUG_CONFIG.ENABLED) {
      console.group(label, ...args);
    }
  },
  groupEnd: () => {
    if (DEBUG_CONFIG.ENABLED) {
      console.groupEnd();
    }
  }
};

// 导出 DEBUG_CONFIG 以保持向后兼容
export { DEBUG_CONFIG };
