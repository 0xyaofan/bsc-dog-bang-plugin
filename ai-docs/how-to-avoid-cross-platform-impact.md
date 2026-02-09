# 如何避免跨平台影响 - 完整方案

## 问题总结

### 为什么总是影响其他通道？

1. **共享代码路径过多**
   - 所有平台都调用 `checkPancakePair()`
   - 所有平台都使用相同的错误处理
   - 修改一处影响所有平台

2. **缓存机制混乱**
   - 3种不同的缓存（routeCache, pancakePairCache, tokenTradeHints）
   - 缓存之间没有同步
   - 错误的缓存影响所有代币

3. **错误处理不当**
   - Service Worker 错误被吞掉
   - 返回假设的状态可能不正确
   - 错误传播到其他平台

4. **缺乏测试**
   - 没有自动化测试
   - 修改后无法快速验证
   - 只能通过手动测试发现问题

5. **硬编码和全局状态**
   - `SPECIAL_PAIR_MAPPINGS` 硬编码
   - `batch-query-handlers.ts` 硬编码 `platform='unknown'`
   - 全局状态修改影响所有代币

## 解决方案

### 方案对比

| 方案 | 优点 | 缺点 | 工期 | 优先级 |
|------|------|------|------|--------|
| **方案1：架构重构** | 彻底解决问题，长期收益大 | 工作量大，风险高 | 1-2周 | 中期 |
| **方案2：短期改进** | 立即可用，风险低 | 治标不治本 | 4周 | 立即 |
| **组合方案** | 兼顾短期和长期 | 需要持续投入 | 持续 | **推荐** |

### 推荐：组合方案

#### 第一阶段：立即行动（本周）

1. **添加关键路径测试**
   ```bash
   npm install --save-dev vitest @vitest/ui
   ```

2. **创建测试文件**
   ```typescript
   // tests/routing/critical-paths.test.ts
   // 测试所有平台的关键场景
   ```

3. **设置 CI/CD**
   ```yaml
   # .github/workflows/test.yml
   # 每次提交自动运行测试
   ```

4. **创建修改检查清单**
   ```markdown
   # 修改前必须检查的事项
   - [ ] 影响范围分析
   - [ ] 添加测试
   - [ ] 运行回归测试
   - [ ] 清除缓存测试
   ```

#### 第二阶段：持续改进（1-2周）

1. **改进日志**
   - 添加结构化日志
   - 添加路由追踪
   - 添加监控指标

2. **添加防御性检查**
   - 输入验证
   - 不变量检查
   - 错误边界

3. **文档化**
   - 编写 ADR
   - 更新架构文档
   - 培训团队

#### 第三阶段：架构重构（1-2个月）

1. **设计新架构**
   - 平台路由器
   - 统一缓存管理
   - 错误处理策略

2. **渐进式迁移**
   - 保留旧代码
   - A/B 测试
   - 逐步放量

3. **清理旧代码**
   - 删除冗余代码
   - 更新文档
   - 性能优化

## 如何尽早发现影响？

### 1. 自动化测试（最重要）

```typescript
// 每次修改后自动运行
describe('跨平台影响检测', () => {
  it('Four.meme 修改不应该影响 Flap', async () => {
    // 测试 Four.meme
    const fourRoute = await testFourMeme();
    expect(fourRoute.platform).toBe('four');

    // 测试 Flap（不应该受影响）
    const flapRoute = await testFlap();
    expect(flapRoute.platform).toBe('flap');
  });
});
```

### 2. CI/CD 集成

```yaml
# 每次提交自动运行测试
on:
  push:
    branches: [ main ]
  pull_request:
    branches: [ main ]

jobs:
  test:
    - name: Run tests
      run: npm test

    - name: Check coverage
      run: npm run coverage
      # 如果覆盖率下降，构建失败
```

### 3. 监控和告警

```typescript
// 生产环境监控
class RouteMonitor {
  trackRouteQuery(tokenAddress: string, platform: string, result: RouteFetchResult) {
    // 记录指标
    metrics.increment('route.query', { platform, success: true });

    // 检查异常
    if (platform === 'four' && result.platform === 'unknown') {
      // 告警：平台检测错误
      alert('Platform detection error', { tokenAddress, expected: 'four', actual: 'unknown' });
    }

    if (result.readyForPancake && !result.metadata?.pancakePairAddress) {
      // 告警：缺少 Pancake metadata
      alert('Missing pancake metadata', { tokenAddress, route: result });
    }
  }
}
```

### 4. 修改前检查清单

每次修改路由代码前，必须回答：

1. **影响范围**
   - 这个修改会影响哪些平台？
   - 是否修改了共享代码？
   - 是否修改了缓存逻辑？

2. **测试计划**
   - 需要添加哪些测试？
   - 需要运行哪些回归测试？
   - 如何验证不影响其他平台？

3. **回滚方案**
   - 如果出问题如何快速回滚？
   - 是否需要清除缓存？
   - 是否需要通知用户？

### 5. Code Review 检查点

```markdown
# Code Review Checklist

## 测试
- [ ] 添加了单元测试
- [ ] 添加了集成测试
- [ ] 运行了回归测试
- [ ] 测试覆盖率没有下降

## 影响范围
- [ ] 明确标注了影响的平台
- [ ] 测试了所有受影响的平台
- [ ] 测试了不应该受影响的平台

## 文档
- [ ] 更新了相关文档
- [ ] 添加了代码注释
- [ ] 更新了 CHANGELOG

## 部署
- [ ] 准备了回滚方案
- [ ] 清除缓存的步骤
- [ ] 监控指标
```

## 立即可以做的事情

### 今天就可以开始：

1. **创建测试文件**
   ```bash
   mkdir -p tests/routing
   touch tests/routing/critical-paths.test.ts
   touch tests/routing/regression.test.ts
   ```

2. **安装测试框架**
   ```bash
   npm install --save-dev vitest @vitest/ui
   ```

3. **编写第一个测试**
   ```typescript
   // tests/routing/critical-paths.test.ts
   import { describe, it, expect } from 'vitest';
   import { detectTokenPlatform } from '../../src/shared/token-route';

   describe('平台检测', () => {
     it('Four.meme 代币应该被正确识别', () => {
       expect(detectTokenPlatform('0x...ffff')).toBe('four');
       expect(detectTokenPlatform('0x...4444')).toBe('four');
     });

     it('Flap 代币应该被正确识别', () => {
       expect(detectTokenPlatform('0x...7777')).toBe('flap');
       expect(detectTokenPlatform('0x...8888')).toBe('flap');
     });
   });
   ```

4. **运行测试**
   ```bash
   npm test
   ```

5. **创建修改检查清单**
   ```bash
   touch docs/routing-modification-checklist.md
   ```

### 本周可以完成：

1. **完善测试用例**
   - 所有平台的关键场景
   - Service Worker 错误场景
   - 缓存场景

2. **设置 CI/CD**
   - GitHub Actions 配置
   - 自动运行测试
   - 覆盖率报告

3. **添加日志**
   - 关键路径日志
   - 错误日志
   - 性能日志

4. **文档化**
   - 架构文档
   - 修改指南
   - 故障排查指南

## 成功案例

### 案例 1：添加 KGST 支持

**问题**：添加 KGST 支持时影响了 Four.meme 未迁移代币

**如果有测试**：
```typescript
it('添加新 quote token 不应该影响 Four.meme 未迁移代币', async () => {
  // 这个测试会在修改后立即失败
  // 提前发现问题
});
```

**结果**：可以在提交前发现问题，避免影响生产环境

### 案例 2：Service Worker 错误处理

**问题**：Service Worker 错误处理导致平台降级

**如果有测试**：
```typescript
it('Service Worker 错误不应该导致平台降级', async () => {
  // 模拟 Service Worker 错误
  mockPublicClient.readContract.mockRejectedValue(
    new Error('import() is disallowed')
  );

  const route = await fetchRouteWithFallback(client, token, 'four');

  // 应该返回 Four.meme 路由，而不是 unknown
  expect(route.platform).toBe('four');
});
```

**结果**：可以在修改后立即发现问题

## 总结

### 核心原则

1. **测试先行**：修改前先写测试
2. **小步快跑**：每次只改一个地方
3. **持续验证**：每次修改后运行所有测试
4. **文档化**：记录所有决策和注意事项
5. **监控告警**：生产环境实时监控

### 优先级

1. **P0（立即）**：添加关键路径测试
2. **P1（本周）**：设置 CI/CD，添加日志
3. **P2（本月）**：完善测试，添加监控
4. **P3（长期）**：架构重构

### 预期收益

- ✅ 修改前：通过测试提前发现问题
- ✅ 修改后：自动化测试验证
- ✅ 部署后：监控告警及时发现
- ✅ 长期：架构清晰，易于维护

---

**创建日期**：2026-02-08
**作者**：Claude Code
**状态**：✅ 可执行
**优先级**：最高
