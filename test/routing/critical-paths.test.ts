import { describe, it, expect } from 'vitest';
import { detectTokenPlatform } from '../../src/shared/token-route';

describe('关键路径测试 - 防止跨平台影响', () => {
  describe('平台检测', () => {
    it('应该正确识别 Four.meme 代币（ffff 结尾）', () => {
      const tokenAddress = '0xd86eb37348f72ddff0c0b9873531dd0fe4d7ffff';
      const platform = detectTokenPlatform(tokenAddress);
      expect(platform).toBe('four');
    });

    it('应该正确识别 Four.meme 代币（4444 结尾）', () => {
      const tokenAddress = '0x3e2a009d420512627a2791be63eeb04c94674444';
      const platform = detectTokenPlatform(tokenAddress);
      expect(platform).toBe('four');
    });

    it('应该正确识别 Flap 代币（7777 结尾）', () => {
      const tokenAddress = '0x1234567890123456789012345678901234567777';
      const platform = detectTokenPlatform(tokenAddress);
      expect(platform).toBe('flap');
    });

    it('应该正确识别 Flap 代币（8888 结尾）', () => {
      const tokenAddress = '0x1234567890123456789012345678901234568888';
      const platform = detectTokenPlatform(tokenAddress);
      expect(platform).toBe('flap');
    });

    it('应该正确识别 XMode 代币（0x4444 开头）', () => {
      const tokenAddress = '0x4444567890123456789012345678901234567890';
      const platform = detectTokenPlatform(tokenAddress);
      expect(platform).toBe('xmode');
    });

    it('应该将其他代币识别为 unknown', () => {
      const tokenAddress = '0x3753dd32cbc376ce6efd85f334b7289ae6d004af'; // KDOG
      const platform = detectTokenPlatform(tokenAddress);
      expect(platform).toBe('unknown');
    });

    it('应该处理大写地址', () => {
      const tokenAddress = '0xD86EB37348F72DDFF0C0B9873531DD0FE4D7FFFF';
      const platform = detectTokenPlatform(tokenAddress);
      expect(platform).toBe('four');
    });

    it('应该处理无效地址', () => {
      const tokenAddress = 'invalid';
      const platform = detectTokenPlatform(tokenAddress);
      expect(platform).toBe('unknown');
    });
  });

  describe('回归测试 - 历史 Bug', () => {
    it('Bug #1: KDOG 应该被识别为 unknown 平台', () => {
      const tokenAddress = '0x3753dd32cbc376ce6efd85f334b7289ae6d004af';
      const platform = detectTokenPlatform(tokenAddress);
      expect(platform).toBe('unknown');
    });

    it('Bug #2: Four.meme 未迁移代币（BNB 筹集）应该被识别为 four', () => {
      const tokenAddress = '0xd86eb37348f72ddff0c0b9873531dd0fe4d7ffff';
      const platform = detectTokenPlatform(tokenAddress);
      expect(platform).toBe('four');
    });

    it('Bug #3: Four.meme 未迁移代币（非 BNB 筹集）应该被识别为 four', () => {
      const tokenAddress = '0x3e2a009d420512627a2791be63eeb04c94674444';
      const platform = detectTokenPlatform(tokenAddress);
      expect(platform).toBe('four');
    });
  });

  describe('边界情况', () => {
    it('应该处理空字符串', () => {
      const platform = detectTokenPlatform('');
      expect(platform).toBe('unknown');
    });

    it('应该处理 null/undefined', () => {
      const platform1 = detectTokenPlatform(null as any);
      const platform2 = detectTokenPlatform(undefined as any);
      expect(platform1).toBe('unknown');
      expect(platform2).toBe('unknown');
    });

    it('应该处理短地址', () => {
      const platform = detectTokenPlatform('0x1234');
      expect(platform).toBe('unknown');
    });

    it('应该处理长地址', () => {
      const platform = detectTokenPlatform('0x' + '1'.repeat(100));
      expect(platform).toBe('unknown');
    });
  });
});
