import { describe, it, expect, beforeEach, vi } from 'vitest';
import { clearRouteCache, detectTokenPlatform } from '../../src/shared/token-route';

describe('缓存机制测试', () => {
  beforeEach(() => {
    // 每个测试前清除缓存
    clearRouteCache();
  });

  describe('clearRouteCache', () => {
    it('应该能够清除所有缓存', () => {
      // 清除所有缓存不应该抛出错误
      expect(() => clearRouteCache()).not.toThrow();
    });

    it('应该能够清除特定代币的缓存', () => {
      const tokenAddress = '0x3753dd32cbc376ce6efd85f334b7289ae6d004af';
      expect(() => clearRouteCache(tokenAddress)).not.toThrow();
    });

    it('应该能够处理无效的代币地址', () => {
      expect(() => clearRouteCache('invalid')).not.toThrow();
      expect(() => clearRouteCache('')).not.toThrow();
    });
  });
});

describe('平台检测辅助函数测试', () => {
  describe('detectTokenPlatform - 更多边界情况', () => {
    it('应该处理混合大小写的地址', () => {
      const mixedCase = '0xD86eB37348f72DdfF0C0b9873531Dd0fe4D7FfFf';
      expect(detectTokenPlatform(mixedCase)).toBe('four');
    });

    it('应该处理带有前导零的地址', () => {
      const withLeadingZeros = '0x0000000000000000000000000000000000004444';
      expect(detectTokenPlatform(withLeadingZeros)).toBe('four');
    });

    it('应该处理 XMode 平台的各种格式', () => {
      expect(detectTokenPlatform('0x4444000000000000000000000000000000000000')).toBe('xmode');
      expect(detectTokenPlatform('0x4444567890123456789012345678901234567890')).toBe('xmode');
    });

    it('应该处理 Flap 平台的 7777 和 8888 结尾', () => {
      expect(detectTokenPlatform('0x1111111111111111111111111111111111117777')).toBe('flap');
      expect(detectTokenPlatform('0x2222222222222222222222222222222222228888')).toBe('flap');
    });

    it('Luna 平台没有特定地址模式，9999 结尾应该返回 unknown', () => {
      expect(detectTokenPlatform('0x3333333333333333333333333333333333339999')).toBe('unknown');
    });

    it('应该正确识别 unknown 平台', () => {
      // KDOG
      expect(detectTokenPlatform('0x3753dd32cbc376ce6efd85f334b7289ae6d004af')).toBe('unknown');
      // WBNB
      expect(detectTokenPlatform('0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c')).toBe('unknown');
      // USDT
      expect(detectTokenPlatform('0x55d398326f99059ff775485246999027b3197955')).toBe('unknown');
    });

    it('应该处理特殊字符和空格', () => {
      expect(detectTokenPlatform('  0xd86eb37348f72ddff0c0b9873531dd0fe4d7ffff  ')).toBe('unknown');
      expect(detectTokenPlatform('0x\n1234567890123456789012345678901234567fff')).toBe('unknown');
    });

    it('应该处理非常短的地址', () => {
      expect(detectTokenPlatform('0x')).toBe('unknown');
      expect(detectTokenPlatform('0x1')).toBe('unknown');
      expect(detectTokenPlatform('0x12')).toBe('unknown');
    });

    it('应该处理没有 0x 前缀的地址', () => {
      expect(detectTokenPlatform('d86eb37348f72ddff0c0b9873531dd0fe4d7ffff')).toBe('unknown');
      expect(detectTokenPlatform('4444567890123456789012345678901234567890')).toBe('unknown');
    });

    it('应该处理包含非十六进制字符的地址', () => {
      expect(detectTokenPlatform('0xGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGG')).toBe('unknown');
      expect(detectTokenPlatform('0xZZZZ567890123456789012345678901234567890')).toBe('unknown');
    });
  });
});

describe('地址规范化测试', () => {
  it('应该正确处理各种地址格式', () => {
    // 测试通过 detectTokenPlatform 间接测试地址规范化
    const addresses = [
      '0xD86EB37348F72DDFF0C0B9873531DD0FE4D7FFFF', // 大写
      '0xd86eb37348f72ddff0c0b9873531dd0fe4d7ffff', // 小写
      '0xD86eB37348f72DdfF0C0b9873531Dd0fe4D7FfFf', // 混合
    ];

    addresses.forEach(addr => {
      expect(detectTokenPlatform(addr)).toBe('four');
    });
  });
});

describe('错误处理测试', () => {
  it('应该安全处理各种异常输入', () => {
    const invalidInputs = [
      '',
      '   ',
      'not-an-address',
      '0x',
      '0xTOO_SHORT',
      '0x' + 'z'.repeat(40),
    ];

    invalidInputs.forEach(input => {
      expect(() => detectTokenPlatform(input as any)).not.toThrow();
      expect(detectTokenPlatform(input as any)).toBe('unknown');
    });
  });

  it('应该处理 null 和 undefined', () => {
    // normalizeAddress 会处理 null 和 undefined，返回 unknown
    expect(detectTokenPlatform(null as any)).toBe('unknown');
    expect(detectTokenPlatform(undefined as any)).toBe('unknown');
  });

  it('应该处理非字符串类型', () => {
    // 数字、对象、数组等非字符串类型会导致错误
    expect(() => detectTokenPlatform(123 as any)).toThrow();
    expect(() => detectTokenPlatform({} as any)).toThrow();
    expect(() => detectTokenPlatform([] as any)).toThrow();
  });
});

describe('平台优先级测试', () => {
  it('Four.meme 平台应该优先匹配 ffff 结尾', () => {
    const fourToken = '0x123456789012345678901234567890123456ffff';
    expect(detectTokenPlatform(fourToken)).toBe('four');
  });

  it('Four.meme 平台应该匹配 4444 结尾', () => {
    const fourToken = '0x1234567890123456789012345678901234564444';
    expect(detectTokenPlatform(fourToken)).toBe('four');
  });

  it('XMode 平台应该优先匹配 0x4444 开头', () => {
    const xmodeToken = '0x4444567890123456789012345678901234567890';
    expect(detectTokenPlatform(xmodeToken)).toBe('xmode');
  });

  it('Flap 平台应该匹配 7777 结尾', () => {
    const flapToken = '0x1234567890123456789012345678901234567777';
    expect(detectTokenPlatform(flapToken)).toBe('flap');
  });

  it('Flap 平台应该匹配 8888 结尾', () => {
    const flapToken = '0x1234567890123456789012345678901234568888';
    expect(detectTokenPlatform(flapToken)).toBe('flap');
  });

  it('Luna 平台没有特定地址模式', () => {
    const lunaToken = '0x1234567890123456789012345678901234569999';
    expect(detectTokenPlatform(lunaToken)).toBe('unknown');
  });

  it('不匹配任何模式的应该返回 unknown', () => {
    const unknownToken = '0x1234567890123456789012345678901234560000';
    expect(detectTokenPlatform(unknownToken)).toBe('unknown');
  });
});

describe('真实代币地址测试', () => {
  it('应该正确识别真实的 Four.meme 代币', () => {
    // 真实的 Four.meme 未迁移代币地址
    expect(detectTokenPlatform('0xd86eb37348f72ddff0c0b9873531dd0fe4d7ffff')).toBe('four');
    expect(detectTokenPlatform('0x3e2a009d420512627a2791be63eeb04c94674444')).toBe('four');
  });

  it('应该正确识别真实的 PancakeSwap 代币', () => {
    // KDOG
    expect(detectTokenPlatform('0x3753dd32cbc376ce6efd85f334b7289ae6d004af')).toBe('unknown');
    // WBNB
    expect(detectTokenPlatform('0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c')).toBe('unknown');
    // USDT
    expect(detectTokenPlatform('0x55d398326f99059ff775485246999027b3197955')).toBe('unknown');
  });
});

describe('性能测试', () => {
  it('应该能够快速处理大量地址检测', () => {
    const addresses = Array.from({ length: 1000 }, (_, i) =>
      `0x${i.toString(16).padStart(40, '0')}`
    );

    const startTime = Date.now();
    addresses.forEach(addr => detectTokenPlatform(addr));
    const endTime = Date.now();

    // 1000 次检测应该在 100ms 内完成
    expect(endTime - startTime).toBeLessThan(100);
  });
});
