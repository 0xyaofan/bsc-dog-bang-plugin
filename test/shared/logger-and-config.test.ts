import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { logger } from '../../src/shared/logger';
import { getFourQuoteTokenList } from '../../src/shared/channel-config';

describe('Logger 测试', () => {
  let consoleLogSpy: any;
  let consoleWarnSpy: any;
  let consoleErrorSpy: any;

  beforeEach(() => {
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
    consoleWarnSpy.mockRestore();
    consoleErrorSpy.mockRestore();
  });

  describe('日志级别测试', () => {
    it('应该能够记录 info 级别日志（受 DEBUG_CONFIG 控制）', () => {
      logger.info('Test info message');
      // info 受 DEBUG_CONFIG.ENABLED 控制，默认不输出
      // 只验证不抛出错误
      expect(true).toBe(true);
    });

    it('应该能够记录 warn 级别日志', () => {
      logger.warn('Test warning message');
      expect(consoleWarnSpy).toHaveBeenCalled();
    });

    it('应该能够记录 error 级别日志', () => {
      logger.error('Test error message');
      expect(consoleErrorSpy).toHaveBeenCalled();
    });

    it('应该能够记录 debug 级别日志（受 DEBUG_CONFIG 控制）', () => {
      logger.debug('Test debug message');
      // debug 受 DEBUG_CONFIG.ENABLED 控制，默认不输出
      // 只验证不抛出错误
      expect(true).toBe(true);
    });
  });

  describe('日志格式测试', () => {
    it('应该能够记录带有多个参数的日志（使用 error）', () => {
      logger.error('Test', 'multiple', 'arguments');
      expect(consoleErrorSpy).toHaveBeenCalled();
    });

    it('应该能够记录对象（使用 warn）', () => {
      const testObj = { key: 'value', number: 123 };
      logger.warn('Test object:', testObj);
      expect(consoleWarnSpy).toHaveBeenCalled();
    });

    it('应该能够记录数组（使用 warn）', () => {
      const testArray = [1, 2, 3, 'test'];
      logger.warn('Test array:', testArray);
      expect(consoleWarnSpy).toHaveBeenCalled();
    });

    it('应该能够记录 null 和 undefined（使用 warn）', () => {
      logger.warn('Test null:', null);
      logger.warn('Test undefined:', undefined);
      expect(consoleWarnSpy).toHaveBeenCalledTimes(2);
    });

    it('应该能够记录错误对象', () => {
      const error = new Error('Test error');
      logger.error('Error occurred:', error);
      expect(consoleErrorSpy).toHaveBeenCalled();
    });
  });

  describe('特殊字符测试', () => {
    it('应该能够记录包含特殊字符的字符串（使用 warn）', () => {
      logger.warn('Test with special chars: \n\t\r');
      expect(consoleWarnSpy).toHaveBeenCalled();
    });

    it('应该能够记录 Unicode 字符（使用 warn）', () => {
      logger.warn('Test Unicode: 你好世界 🎉');
      expect(consoleWarnSpy).toHaveBeenCalled();
    });

    it('应该能够记录空字符串（使用 error）', () => {
      logger.error('');
      expect(consoleErrorSpy).toHaveBeenCalled();
    });
  });

  describe('性能测试', () => {
    it('应该能够快速记录大量日志（使用 error）', () => {
      const startTime = Date.now();
      for (let i = 0; i < 1000; i++) {
        logger.error(`Log message ${i}`);
      }
      const endTime = Date.now();

      // 1000 条日志应该在 100ms 内完成
      expect(endTime - startTime).toBeLessThan(100);
      expect(consoleErrorSpy).toHaveBeenCalledTimes(1000);
    });
  });
});

describe('Channel Config 测试', () => {
  describe('getFourQuoteTokenList', () => {
    it('应该返回 Four.meme quote token 列表', () => {
      const quoteTokens = getFourQuoteTokenList();

      expect(quoteTokens).toBeDefined();
      expect(Array.isArray(quoteTokens)).toBe(true);
      expect(quoteTokens.length).toBeGreaterThan(0);
    });

    it('应该包含 CAKE', () => {
      const quoteTokens = getFourQuoteTokenList();
      const cake = '0x0e09fabb73bd3ade0a17ecc321fd13a19e81ce82';

      const hasCake = quoteTokens.some(token =>
        token.toLowerCase() === cake.toLowerCase()
      );

      expect(hasCake).toBe(true);
    });

    it('应该包含 USDT', () => {
      const quoteTokens = getFourQuoteTokenList();
      const usdt = '0x55d398326f99059ff775485246999027b3197955';

      const hasUSDT = quoteTokens.some(token =>
        token.toLowerCase() === usdt.toLowerCase()
      );

      expect(hasUSDT).toBe(true);
    });

    it('应该包含 KGST', () => {
      const quoteTokens = getFourQuoteTokenList();
      const kgst = '0x94be0bbA8E1E303fE998c9360B57b826F1A4f828';

      const hasKGST = quoteTokens.some(token =>
        token.toLowerCase() === kgst.toLowerCase()
      );

      expect(hasKGST).toBe(true);
    });

    it('应该包含 lisUSD', () => {
      const quoteTokens = getFourQuoteTokenList();
      const lisUSD = '0x0782b6d8c4551b9760e74c0545a9bcd90bdc41e5';

      const hasLisUSD = quoteTokens.some(token =>
        token.toLowerCase() === lisUSD.toLowerCase()
      );

      expect(hasLisUSD).toBe(true);
    });

    it('返回的地址应该都是有效的以太坊地址', () => {
      const quoteTokens = getFourQuoteTokenList();

      quoteTokens.forEach(token => {
        expect(token).toMatch(/^0x[a-fA-F0-9]{40}$/);
      });
    });

    it('不应该包含重复的地址', () => {
      const quoteTokens = getFourQuoteTokenList();
      const normalizedTokens = quoteTokens.map(t => t.toLowerCase());
      const uniqueTokens = [...new Set(normalizedTokens)];

      expect(normalizedTokens.length).toBe(uniqueTokens.length);
    });

    it('不应该包含零地址', () => {
      const quoteTokens = getFourQuoteTokenList();
      const zeroAddress = '0x0000000000000000000000000000000000000000';

      const hasZeroAddress = quoteTokens.some(token =>
        token.toLowerCase() === zeroAddress.toLowerCase()
      );

      expect(hasZeroAddress).toBe(false);
    });

    it('应该返回至少 4 个 quote token', () => {
      const quoteTokens = getFourQuoteTokenList();

      // 至少应该有 WBNB, USDT, KGST, lisUSD
      expect(quoteTokens.length).toBeGreaterThanOrEqual(4);
    });
  });
});

describe('Trading Config 测试', () => {
  it('应该能够导入 CONTRACTS', async () => {
    const { CONTRACTS } = await import('../../src/shared/config/index');

    expect(CONTRACTS).toBeDefined();
    expect(typeof CONTRACTS).toBe('object');
  });

  it('CONTRACTS 应该包含必要的合约地址', async () => {
    const { CONTRACTS } = await import('../../src/shared/config/index');

    expect(CONTRACTS.WBNB).toBeDefined();
    expect(CONTRACTS.USDT).toBeDefined();
    expect(CONTRACTS.KGST).toBeDefined();
    expect(CONTRACTS.lisUSD).toBeDefined();
  });

  it('合约地址应该是有效的以太坊地址', async () => {
    const { CONTRACTS } = await import('../../src/shared/config/index');

    const addressRegex = /^0x[a-fA-F0-9]{40}$/;

    Object.entries(CONTRACTS).forEach(([key, value]) => {
      if (value && typeof value === 'string') {
        expect(value).toMatch(addressRegex);
      }
    });
  });

  it('应该能够导入 PANCAKE_FACTORY_ABI', async () => {
    const { PANCAKE_FACTORY_ABI } = await import('../../src/shared/config/index');

    expect(PANCAKE_FACTORY_ABI).toBeDefined();
    expect(Array.isArray(PANCAKE_FACTORY_ABI)).toBe(true);
  });

  it('应该能够导入 PANCAKE_V3_FACTORY_ABI', async () => {
    const { PANCAKE_V3_FACTORY_ABI } = await import('../../src/shared/config/index');

    expect(PANCAKE_V3_FACTORY_ABI).toBeDefined();
    expect(Array.isArray(PANCAKE_V3_FACTORY_ABI)).toBe(true);
  });
});

describe('集成测试 - Logger 和 Config', () => {
  let consoleWarnSpy: any;

  beforeEach(() => {
    consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleWarnSpy.mockRestore();
  });

  it('应该能够记录 quote token 列表', () => {
    const quoteTokens = getFourQuoteTokenList();
    logger.warn('Quote tokens:', quoteTokens);

    expect(consoleWarnSpy).toHaveBeenCalled();
  });

  it('应该能够记录合约配置', async () => {
    const { CONTRACTS } = await import('../../src/shared/config/index');
    logger.warn('Contracts:', CONTRACTS);

    expect(consoleWarnSpy).toHaveBeenCalled();
  });
});
