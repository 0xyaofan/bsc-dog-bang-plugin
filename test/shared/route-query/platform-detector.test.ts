/**
 * 平台检测器测试
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  PlatformDetector,
  createPlatformDetector,
  platformDetector,
  detectTokenPlatform
} from '../../../src/shared/route-query/platform-detector';

describe('平台检测器测试', () => {
  describe('PlatformDetector', () => {
    let detector: PlatformDetector;

    beforeEach(() => {
      detector = new PlatformDetector();
    });

    it('应该创建平台检测器', () => {
      expect(detector).toBeDefined();
    });

    it('应该检测 Four.meme 代币（以 4444 结尾）', () => {
      const platform = detector.detect('0xd86eb37348f72ddff0c0b9873531dd0fe4d74444');
      expect(platform).toBe('four');
    });

    it('应该检测 Four.meme 代币（以 ffff 结尾）', () => {
      const platform = detector.detect('0xd86eb37348f72ddff0c0b9873531dd0fe4d7ffff');
      expect(platform).toBe('four');
    });

    it('应该检测 XMode 代币（以 0x4444 开头）', () => {
      const platform = detector.detect('0x4444eb37348f72ddff0c0b9873531dd0fe4d7abc');
      expect(platform).toBe('xmode');
    });

    it('应该检测 Flap 代币（以 7777 结尾）', () => {
      const platform = detector.detect('0xd86eb37348f72ddff0c0b9873531dd0fe4d77777');
      expect(platform).toBe('flap');
    });

    it('应该检测 Flap 代币（以 8888 结尾）', () => {
      const platform = detector.detect('0xd86eb37348f72ddff0c0b9873531dd0fe4d78888');
      expect(platform).toBe('flap');
    });

    it('应该检测 unknown 代币', () => {
      const platform = detector.detect('0x55d398326f99059ff775485246999027b3197955');
      expect(platform).toBe('unknown');
    });

    it('应该处理无效地址', () => {
      const platform = detector.detect('invalid');
      expect(platform).toBe('unknown');
    });

    it('应该处理空地址', () => {
      const platform = detector.detect('');
      expect(platform).toBe('unknown');
    });

    it('应该处理大小写混合的地址', () => {
      const platform = detector.detect('0xD86EB37348F72DDFF0C0B9873531DD0FE4D74444');
      expect(platform).toBe('four');
    });

    it('应该批量检测代币', () => {
      const tokens = [
        '0xd86eb37348f72ddff0c0b9873531dd0fe4d74444', // four
        '0xd86eb37348f72ddff0c0b9873531dd0fe4d77777', // flap
        '0x55d398326f99059ff775485246999027b3197955'  // unknown
      ];

      const results = detector.detectBatch(tokens);

      expect(results.size).toBe(3);
      expect(results.get(tokens[0].toLowerCase())).toBe('four');
      expect(results.get(tokens[1].toLowerCase())).toBe('flap');
      expect(results.get(tokens[2].toLowerCase())).toBe('unknown');
    });

    it('应该检测是否是发射台代币', () => {
      expect(detector.isLaunchpadToken('0xd86eb37348f72ddff0c0b9873531dd0fe4d74444')).toBe(true);
      expect(detector.isLaunchpadToken('0xd86eb37348f72ddff0c0b9873531dd0fe4d77777')).toBe(true);
      expect(detector.isLaunchpadToken('0x55d398326f99059ff775485246999027b3197955')).toBe(false);
    });

    it('应该获取平台名称', () => {
      expect(detector.getPlatformName('four')).toBe('Four.meme');
      expect(detector.getPlatformName('xmode')).toBe('XMode');
      expect(detector.getPlatformName('flap')).toBe('Flap');
      expect(detector.getPlatformName('luna')).toBe('Luna.fun');
      expect(detector.getPlatformName('unknown')).toBe('Unknown/PancakeSwap');
    });
  });

  describe('便捷函数', () => {
    it('createPlatformDetector 应该创建检测器', () => {
      const detector = createPlatformDetector();
      expect(detector).toBeInstanceOf(PlatformDetector);
    });

    it('detectTokenPlatform 应该检测平台', () => {
      const platform = detectTokenPlatform('0xd86eb37348f72ddff0c0b9873531dd0fe4d74444');
      expect(platform).toBe('four');
    });
  });

  describe('全局实例', () => {
    it('应该提供全局实例', () => {
      expect(platformDetector).toBeDefined();
      expect(platformDetector).toBeInstanceOf(PlatformDetector);
    });
  });

  describe('边界情况', () => {
    it('应该处理 0x 前缀缺失', () => {
      const detector = new PlatformDetector();
      const platform = detector.detect('d86eb37348f72ddff0c0b9873531dd0fe4d74444');
      expect(platform).toBe('unknown');
    });

    it('应该处理地址长度不正确', () => {
      const detector = new PlatformDetector();
      const platform = detector.detect('0x1234');
      expect(platform).toBe('unknown');
    });

    it('应该处理包含非十六进制字符的地址', () => {
      const detector = new PlatformDetector();
      const platform = detector.detect('0xg86eb37348f72ddff0c0b9873531dd0fe4d74444');
      expect(platform).toBe('unknown');
    });
  });
});
