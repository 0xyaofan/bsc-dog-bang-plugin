import { describe, it, expect } from 'vitest';
import {
  validateAddress,
  validatePlatform,
  validateBigInt,
  validateNumber,
  validateNotNull,
  validateArray,
  invariant,
  invariantNotZeroAddress,
  invariantProgress,
  invariantValidRoute,
  safeBigInt,
  safeNumber,
  safeNormalizeAddress,
  isZeroAddress,
  isValidAddress
} from '../../src/shared/validation';

describe('Validation 测试', () => {
  describe('validateAddress', () => {
    it('应该接受有效的地址', () => {
      const address = '0x1234567890123456789012345678901234567890';
      expect(validateAddress(address)).toBe(address.toLowerCase());
    });

    it('应该接受大写地址', () => {
      const address = '0xABCDEF1234567890123456789012345678901234';
      expect(validateAddress(address)).toBe(address.toLowerCase());
    });

    it('应该拒绝非字符串', () => {
      expect(() => validateAddress(123)).toThrow('must be a string');
    });

    it('应该拒绝无效格式', () => {
      expect(() => validateAddress('invalid')).toThrow('not a valid Ethereum address');
      expect(() => validateAddress('0x123')).toThrow('not a valid Ethereum address');
    });

    it('应该处理带空格的地址', () => {
      const address = '  0x1234567890123456789012345678901234567890  ';
      expect(validateAddress(address)).toBe(address.trim().toLowerCase());
    });
  });

  describe('validatePlatform', () => {
    it('应该接受有效的平台', () => {
      expect(validatePlatform('four')).toBe('four');
      expect(validatePlatform('flap')).toBe('flap');
      expect(validatePlatform('luna')).toBe('luna');
      expect(validatePlatform('xmode')).toBe('xmode');
      expect(validatePlatform('unknown')).toBe('unknown');
    });

    it('应该拒绝无效的平台', () => {
      expect(() => validatePlatform('invalid')).toThrow('must be one of');
    });

    it('应该拒绝非字符串', () => {
      expect(() => validatePlatform(123)).toThrow('must be a string');
    });
  });

  describe('validateBigInt', () => {
    it('应该接受有效的 BigInt', () => {
      expect(validateBigInt(100n)).toBe(100n);
    });

    it('应该拒绝非 BigInt', () => {
      expect(() => validateBigInt(100)).toThrow('must be a BigInt');
    });

    it('应该检查最小值', () => {
      expect(() => validateBigInt(5n, 'value', { min: 10n })).toThrow('must be >= 10');
    });

    it('应该检查最大值', () => {
      expect(() => validateBigInt(100n, 'value', { max: 50n })).toThrow('must be <= 50');
    });

    it('应该检查零值', () => {
      expect(() => validateBigInt(0n, 'value', { allowZero: false })).toThrow('cannot be zero');
    });

    it('应该允许零值', () => {
      expect(validateBigInt(0n, 'value', { allowZero: true })).toBe(0n);
    });
  });

  describe('validateNumber', () => {
    it('应该接受有效的数字', () => {
      expect(validateNumber(42)).toBe(42);
      expect(validateNumber(3.14)).toBe(3.14);
    });

    it('应该拒绝非数字', () => {
      expect(() => validateNumber('42')).toThrow('must be a number');
    });

    it('应该拒绝 NaN', () => {
      expect(() => validateNumber(NaN)).toThrow('cannot be NaN');
    });

    it('应该拒绝 Infinity', () => {
      expect(() => validateNumber(Infinity)).toThrow('must be finite');
    });

    it('应该检查整数', () => {
      expect(() => validateNumber(3.14, 'value', { integer: true })).toThrow('must be an integer');
      expect(validateNumber(42, 'value', { integer: true })).toBe(42);
    });

    it('应该检查范围', () => {
      expect(() => validateNumber(5, 'value', { min: 10 })).toThrow('must be >= 10');
      expect(() => validateNumber(100, 'value', { max: 50 })).toThrow('must be <= 50');
    });
  });

  describe('validateNotNull', () => {
    it('应该接受非空值', () => {
      expect(validateNotNull(42)).toBe(42);
      expect(validateNotNull('test')).toBe('test');
      expect(validateNotNull({})).toEqual({});
    });

    it('应该拒绝 null', () => {
      expect(() => validateNotNull(null)).toThrow('cannot be null or undefined');
    });

    it('应该拒绝 undefined', () => {
      expect(() => validateNotNull(undefined)).toThrow('cannot be null or undefined');
    });
  });

  describe('validateArray', () => {
    it('应该接受有效的数组', () => {
      expect(validateArray([1, 2, 3])).toEqual([1, 2, 3]);
    });

    it('应该拒绝非数组', () => {
      expect(() => validateArray('not array')).toThrow('must be an array');
    });

    it('应该检查最小长度', () => {
      expect(() => validateArray([1], 'value', { minLength: 2 })).toThrow('must have at least 2 items');
    });

    it('应该检查最大长度', () => {
      expect(() => validateArray([1, 2, 3], 'value', { maxLength: 2 })).toThrow('must have at most 2 items');
    });

    it('应该验证数组项', () => {
      const validator = (item: any) => {
        if (typeof item !== 'number') throw new Error('must be number');
        return item;
      };

      expect(() => validateArray([1, 'two', 3], 'value', { itemValidator: validator })).toThrow();
      expect(validateArray([1, 2, 3], 'value', { itemValidator: validator })).toEqual([1, 2, 3]);
    });
  });

  describe('invariant', () => {
    it('应该在条件为真时不抛出错误', () => {
      expect(() => invariant(true, 'test')).not.toThrow();
    });

    it('应该在条件为假时抛出错误', () => {
      expect(() => invariant(false, 'test message')).toThrow('[Invariant] test message');
    });
  });

  describe('invariantNotZeroAddress', () => {
    it('应该接受非零地址', () => {
      expect(() => invariantNotZeroAddress('0x1234567890123456789012345678901234567890')).not.toThrow();
    });

    it('应该拒绝零地址', () => {
      expect(() => invariantNotZeroAddress('0x0000000000000000000000000000000000000000')).toThrow('cannot be zero address');
    });

    it('应该不区分大小写', () => {
      expect(() => invariantNotZeroAddress('0x0000000000000000000000000000000000000000')).toThrow();
      expect(() => invariantNotZeroAddress('0X0000000000000000000000000000000000000000')).toThrow();
    });
  });

  describe('invariantProgress', () => {
    it('应该接受 0-1 之间的值', () => {
      expect(() => invariantProgress(0)).not.toThrow();
      expect(() => invariantProgress(0.5)).not.toThrow();
      expect(() => invariantProgress(1)).not.toThrow();
    });

    it('应该拒绝小于 0 的值', () => {
      expect(() => invariantProgress(-0.1)).toThrow('must be between 0 and 1');
    });

    it('应该拒绝大于 1 的值', () => {
      expect(() => invariantProgress(1.1)).toThrow('must be between 0 and 1');
    });
  });

  describe('invariantValidRoute', () => {
    it('应该接受有效的路由', () => {
      const route = {
        platform: 'four',
        preferredChannel: 'four',
        readyForPancake: false
      };
      expect(() => invariantValidRoute(route)).not.toThrow();
    });

    it('应该拒绝 null', () => {
      expect(() => invariantValidRoute(null)).toThrow('cannot be null or undefined');
    });

    it('应该拒绝缺少字段的路由', () => {
      expect(() => invariantValidRoute({})).toThrow();
      expect(() => invariantValidRoute({ platform: 'four' })).toThrow();
    });

    it('应该拒绝字段类型错误的路由', () => {
      expect(() => invariantValidRoute({
        platform: 123,
        preferredChannel: 'four',
        readyForPancake: false
      })).toThrow('platform must be a string');
    });
  });

  describe('safeBigInt', () => {
    it('应该转换有效的值', () => {
      expect(safeBigInt(100n)).toBe(100n);
      expect(safeBigInt(42)).toBe(42n);
      expect(safeBigInt('100')).toBe(100n);
    });

    it('应该返回默认值对于无效输入', () => {
      expect(safeBigInt('invalid')).toBe(0n);
      expect(safeBigInt(null)).toBe(0n);
      expect(safeBigInt(undefined)).toBe(0n);
      expect(safeBigInt(3.14)).toBe(0n);
    });

    it('应该使用自定义默认值', () => {
      expect(safeBigInt('invalid', 100n)).toBe(100n);
    });
  });

  describe('safeNumber', () => {
    it('应该转换有效的值', () => {
      expect(safeNumber(42)).toBe(42);
      expect(safeNumber('42')).toBe(42);
      expect(safeNumber('3.14')).toBe(3.14);
    });

    it('应该返回默认值对于无效输入', () => {
      expect(safeNumber('invalid')).toBe(0);
      expect(safeNumber(NaN)).toBe(0);
      expect(safeNumber(Infinity)).toBe(0);
      expect(safeNumber(null)).toBe(0);
    });

    it('应该使用自定义默认值', () => {
      expect(safeNumber('invalid', 100)).toBe(100);
    });
  });

  describe('safeNormalizeAddress', () => {
    it('应该规范化有效地址', () => {
      const address = '0xABCDEF1234567890123456789012345678901234';
      expect(safeNormalizeAddress(address)).toBe(address.toLowerCase());
    });

    it('应该返回 null 对于无效输入', () => {
      expect(safeNormalizeAddress('invalid')).toBeNull();
      expect(safeNormalizeAddress(123)).toBeNull();
      expect(safeNormalizeAddress(null)).toBeNull();
      expect(safeNormalizeAddress('0x123')).toBeNull();
    });

    it('应该处理带空格的地址', () => {
      const address = '  0x1234567890123456789012345678901234567890  ';
      expect(safeNormalizeAddress(address)).toBe(address.trim().toLowerCase());
    });
  });

  describe('isZeroAddress', () => {
    it('应该识别零地址', () => {
      expect(isZeroAddress('0x0000000000000000000000000000000000000000')).toBe(true);
      expect(isZeroAddress('0X0000000000000000000000000000000000000000')).toBe(true);
    });

    it('应该识别非零地址', () => {
      expect(isZeroAddress('0x1234567890123456789012345678901234567890')).toBe(false);
    });
  });

  describe('isValidAddress', () => {
    it('应该识别有效地址', () => {
      expect(isValidAddress('0x1234567890123456789012345678901234567890')).toBe(true);
      expect(isValidAddress('0xABCDEF1234567890123456789012345678901234')).toBe(true);
    });

    it('应该识别无效地址', () => {
      expect(isValidAddress('invalid')).toBe(false);
      expect(isValidAddress('0x123')).toBe(false);
      expect(isValidAddress(123)).toBe(false);
      expect(isValidAddress(null)).toBe(false);
    });

    it('应该处理带空格的地址', () => {
      expect(isValidAddress('  0x1234567890123456789012345678901234567890  ')).toBe(true);
    });
  });
});
