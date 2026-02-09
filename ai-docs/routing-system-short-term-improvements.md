# 路由系统短期改进方案

## 目标

在不进行大规模重构的情况下，通过以下措施减少跨平台影响：

1. **添加自动化测试**
2. **改进日志和监控**
3. **添加防御性检查**
4. **文档化关键路径**

## 1. 自动化测试（最重要）

### 1.1 创建测试框架

```bash
# 安装测试依赖
npm install --save-dev vitest @vitest/ui
```

```typescript
// vitest.config.ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: ['node_modules/', 'tests/']
    }
  }
});
```

### 1.2 关键路径测试

```typescript
// tests/routing/critical-paths.test.ts

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { detectTokenPlatform, fetchRouteWithFallback } from '../../src/shared/token-route';

describe('关键路径测试 - 防止跨平台影响', () => {
  let mockPublicClient: any;

  beforeEach(() => {
    mockPublicClient = {
      readContract: vi.fn()
    };
  });

  describe('Four.meme 代币路由', () => {
    it('未迁移的 BNB 筹集代币应该使用 Four.meme 合约', async () => {
      const tokenAddress = '0xd86eb37348f72ddff0c0b9873531dd0fe4d7ffff';

      mockPublicClient.readContract.mockResolvedValue({
        liquidityAdded: false,
        quote: '0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c', // WBNB
        // ... 其他字段
      });

      const platform = detectTokenPlatform(tokenAddress);
      expect(platform).toBe('four');

      const route = await fetchRouteWithFallback(mockPublicClient, tokenAddress, platform);

      expect(route.platform).toBe('four');
      expect(route.preferredChannel).toBe('four');
      expect(route.readyForPancake).toBe(false);
    });

    it('未迁移的非 BNB 筹集代币应该使用 Four.meme 合约', async () => {
      const tokenAddress = '0x3e2a009d420512627a2791be63eeb04c94674444';

      mockPublicClient.readContract.mockResolvedValue({
        liquidityAdded: false,
        quote: '0x94be0bbA8E1E303fE998c9360B57b826F1A4f828', // KGST
        // ... 其他字段
      });

      const platform = detectTokenPlatform(tokenAddress);
      expect(platform).toBe('four');

      const route = await fetchRouteWithFallback(mockPublicClient, tokenAddress, platform);

      expect(route.platform).toBe('four');
      expect(route.preferredChannel).toBe('four');
      expect(route.readyForPancake).toBe(false);
      expect(route.quoteToken).toBe('0x94be0bbA8E1E303fE998c9360B57b826F1A4f828');
    });

    it('已迁移代币应该使用 PancakeSwap', async () => {
      const tokenAddress = '0x1234567890123456789012345678901234567fff';

      mockPublicClient.readContract
        .mockResolvedValueOnce({
          liquidityAdded: true,
          quote: '0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c',
          // ... 其他字段
        })
        .mockResolvedValueOnce('0xPairAddress'); // getPancakePair

      const platform = detectTokenPlatform(tokenAddress);
      const route = await fetchRouteWithFallback(mockPublicClient, tokenAddress, platform);

      expect(route.platform).toBe('four');
      expect(route.preferredChannel).toBe('pancake');
      expect(route.readyForPancake).toBe(true);
    });
  });

  describe('Flap 代币路由', () => {
    it('Flap 代币不应该受 Four.meme 修改影响', async () => {
      const tokenAddress = '0x1234567890123456789012345678901234567777';

      mockPublicClient.readContract.mockResolvedValue({
        state: {
          // Flap state
        }
      });

      const platform = detectTokenPlatform(tokenAddress);
      expect(platform).toBe('flap');

      const route = await fetchRouteWithFallback(mockPublicClient, tokenAddress, platform);

      expect(route.platform).toBe('flap');
      // Flap 的逻辑不应该被 Four.meme 的修改影响
    });
  });

  describe('Unknown 平台代币', () => {
    it('KDOG 等 PancakeSwap 代币应该正常工作', async () => {
      const tokenAddress = '0x3753dd32cbc376ce6efd85f334b7289ae6d004af';

      // 使用 SPECIAL_PAIR_MAPPINGS
      const platform = detectTokenPlatform(tokenAddress);
      expect(platform).toBe('unknown');

      const route = await fetchRouteWithFallback(mockPublicClient, tokenAddress, platform);

      expect(route.platform).toBe('unknown');
      expect(route.preferredChannel).toBe('pancake');
      expect(route.readyForPancake).toBe(true);
    });
  });

  describe('Service Worker 错误处理', () => {
    it('Service Worker 错误不应该导致平台降级', async () => {
      const tokenAddress = '0xd86eb37348f72ddff0c0b9873531dd0fe4d7ffff';

      mockPublicClient.readContract.mockRejectedValue(
        new Error('import() is disallowed on ServiceWorkerGlobalScope')
      );

      const platform = detectTokenPlatform(tokenAddress);
      expect(platform).toBe('four');

      const route = await fetchRouteWithFallback(mockPublicClient, tokenAddress, platform);

      // 应该返回 Four.meme 路由，而不是降级到 unknown
      expect(route.platform).toBe('four');
      expect(route.preferredChannel).toBe('four');
      expect(route.readyForPancake).toBe(false);
    });
  });
});
```

### 1.3 回归测试套件

```typescript
// tests/routing/regression.test.ts

describe('回归测试 - 历史 Bug', () => {
  it('Bug #1: KDOG 应该使用 KDOG/KGST 而不是 KDOG/WBNB', async () => {
    // 测试用例
  });

  it('Bug #2: Four.meme 非 BNB 筹集代币应该正常工作', async () => {
    // 测试用例
  });

  it('Bug #3: batch-query-handlers 不应该硬编码 platform=unknown', async () => {
    // 测试用例
  });
});
```

### 1.4 CI/CD 集成

```yaml
# .github/workflows/test.yml
name: Tests

on:
  push:
    branches: [ main ]
  pull_request:
    branches: [ main ]

jobs:
  test:
    runs-on: ubuntu-latest

    steps:
    - uses: actions/checkout@v3

    - name: Setup Node.js
      uses: actions/setup-node@v3
      with:
        node-version: '18'

    - name: Install dependencies
      run: npm ci

    - name: Run tests
      run: npm test

    - name: Upload coverage
      uses: codecov/codecov-action@v3
      with:
        files: ./coverage/coverage-final.json
```

## 2. 改进日志和监控

### 2.1 结构化日志

```typescript
// src/shared/logger.ts

interface LogContext {
  platform?: string;
  tokenAddress?: string;
  function?: string;
  [key: string]: any;
}

class StructuredLogger {
  private context: LogContext = {};

  withContext(context: LogContext): StructuredLogger {
    const newLogger = new StructuredLogger();
    newLogger.context = { ...this.context, ...context };
    return newLogger;
  }

  debug(message: string, data?: any): void {
    console.log(JSON.stringify({
      level: 'debug',
      message,
      context: this.context,
      data,
      timestamp: new Date().toISOString()
    }));
  }

  // ... 其他方法
}

export const logger = new StructuredLogger();

// 使用示例
const fourLogger = logger.withContext({ platform: 'four' });
fourLogger.debug('查询代币信息', { tokenAddress });
```

### 2.2 关键路径追踪

```typescript
// src/shared/tracing.ts

class RouteTracer {
  private traces = new Map<string, RouteTrace>();

  startTrace(tokenAddress: string): string {
    const traceId = `${tokenAddress}-${Date.now()}`;
    this.traces.set(traceId, {
      tokenAddress,
      startTime: Date.now(),
      steps: []
    });
    return traceId;
  }

  addStep(traceId: string, step: string, data?: any): void {
    const trace = this.traces.get(traceId);
    if (trace) {
      trace.steps.push({
        step,
        timestamp: Date.now(),
        data
      });
    }
  }

  endTrace(traceId: string, result: any): void {
    const trace = this.traces.get(traceId);
    if (trace) {
      trace.endTime = Date.now();
      trace.duration = trace.endTime - trace.startTime;
      trace.result = result;

      // 记录完整追踪
      logger.info('[RouteTrace]', trace);

      // 清理
      this.traces.delete(traceId);
    }
  }
}

export const routeTracer = new RouteTracer();

// 使用示例
const traceId = routeTracer.startTrace(tokenAddress);
routeTracer.addStep(traceId, 'detectPlatform', { platform });
routeTracer.addStep(traceId, 'fetchRoute', { route });
routeTracer.endTrace(traceId, finalRoute);
```

## 3. 防御性检查

### 3.1 输入验证

```typescript
// src/shared/routing/validators.ts

function validateTokenAddress(address: string): void {
  if (!address || typeof address !== 'string') {
    throw new Error('Invalid token address: must be a string');
  }

  const normalized = address.toLowerCase();
  if (!/^0x[a-f0-9]{40}$/.test(normalized)) {
    throw new Error(`Invalid token address format: ${address}`);
  }
}

function validatePlatform(platform: string): void {
  const validPlatforms = ['four', 'xmode', 'flap', 'luna', 'unknown'];
  if (!validPlatforms.includes(platform)) {
    throw new Error(`Invalid platform: ${platform}`);
  }
}

// 在关键函数入口处使用
export async function fetchRouteWithFallback(
  publicClient: any,
  tokenAddress: Address,
  initialPlatform: TokenPlatform
): Promise<RouteFetchResult> {
  validateTokenAddress(tokenAddress);
  validatePlatform(initialPlatform);

  // ... 继续执行
}
```

### 3.2 不变量检查

```typescript
// src/shared/routing/invariants.ts

function checkRouteInvariants(route: RouteFetchResult): void {
  // 不变量 1：platform 和 preferredChannel 必须一致
  if (route.platform === 'four' && route.preferredChannel === 'pancake') {
    if (!route.readyForPancake) {
      throw new Error('Invariant violation: Four.meme token with pancake channel must be ready for pancake');
    }
  }

  // 不变量 2：readyForPancake 必须有对应的 metadata
  if (route.readyForPancake) {
    if (!route.metadata?.pancakePairAddress && !route.metadata?.pancakeQuoteToken) {
      logger.warn('[Invariant] readyForPancake=true but no pancake metadata', route);
    }
  }

  // 不变量 3：未迁移代币不应该有 pancake metadata
  if (!route.readyForPancake && route.preferredChannel !== 'pancake') {
    if (route.metadata?.pancakePairAddress) {
      logger.warn('[Invariant] Unmigrated token has pancake metadata', route);
    }
  }
}

// 在返回路由前检查
const route = await fetchFourRoute(publicClient, tokenAddress, platform);
checkRouteInvariants(route);
return route;
```

## 4. 文档化关键路径

### 4.1 架构决策记录（ADR）

```markdown
# ADR-001: 路由查询流程

## 状态
已接受

## 上下文
路由查询需要支持多个平台，每个平台有不同的逻辑。

## 决策
1. 使用 detectTokenPlatform() 检测平台
2. 使用 fetchRouteWithFallback() 查询路由
3. 每个平台有独立的 fetch 函数

## 后果
- 优点：逻辑清晰，易于维护
- 缺点：平台间有共享代码，可能相互影响

## 注意事项
- 修改共享代码时必须测试所有平台
- Service Worker 错误处理必须在每个平台中实现
```

### 4.2 修改检查清单

```markdown
# 路由系统修改检查清单

在修改路由相关代码前，请确认：

## 影响范围分析
- [ ] 这个修改会影响哪些平台？（four/flap/luna/unknown）
- [ ] 是否修改了共享代码？（checkPancakePair, detectTokenPlatform 等）
- [ ] 是否修改了缓存逻辑？
- [ ] 是否修改了错误处理？

## 测试
- [ ] 为修改添加了单元测试
- [ ] 运行了所有平台的回归测试
- [ ] 测试了 Service Worker 错误场景
- [ ] 测试了缓存场景

## 验证
- [ ] 在本地测试了 Four.meme 未迁移代币（BNB 筹集）
- [ ] 在本地测试了 Four.meme 未迁移代币（非 BNB 筹集）
- [ ] 在本地测试了 Four.meme 已迁移代币
- [ ] 在本地测试了 Flap 代币
- [ ] 在本地测试了 Unknown 平台代币（如 KDOG）

## 文档
- [ ] 更新了相关文档
- [ ] 添加了 ADR（如果是架构变更）
- [ ] 更新了检查清单（如果有新的注意事项）

## 部署
- [ ] 清除了测试环境的缓存
- [ ] 通知了相关人员
- [ ] 准备了回滚方案
```

## 5. 实施计划

### 第 1 周：测试基础设施
- [ ] 安装测试框架
- [ ] 编写关键路径测试
- [ ] 编写回归测试
- [ ] 设置 CI/CD

### 第 2 周：日志和监控
- [ ] 实现结构化日志
- [ ] 实现路由追踪
- [ ] 添加监控指标

### 第 3 周：防御性检查
- [ ] 添加输入验证
- [ ] 添加不变量检查
- [ ] 添加错误边界

### 第 4 周：文档和流程
- [ ] 编写 ADR
- [ ] 创建修改检查清单
- [ ] 培训团队成员

## 6. 成功指标

### 短期（1个月）
- ✅ 测试覆盖率 > 70%
- ✅ 所有关键路径有测试
- ✅ CI/CD 自动运行测试

### 中期（3个月）
- ✅ 零跨平台影响事故
- ✅ 平均修复时间 < 1小时
- ✅ 测试覆盖率 > 85%

### 长期（6个月）
- ✅ 完成架构重构
- ✅ 测试覆盖率 > 90%
- ✅ 自动化监控和告警

---

**创建日期**：2026-02-08
**状态**：📋 待实施
**优先级**：高
**预计工期**：4周
