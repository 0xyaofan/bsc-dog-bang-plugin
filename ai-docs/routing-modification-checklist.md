# 路由系统修改检查清单

## 📋 修改前必须检查

在修改路由相关代码前，请完成以下检查：

### 1. 影响范围分析

- [ ] 这个修改会影响哪些平台？
  - [ ] Four.meme
  - [ ] Flap
  - [ ] Luna
  - [ ] Unknown (PancakeSwap)

- [ ] 是否修改了共享代码？
  - [ ] `checkPancakePair()`
  - [ ] `detectTokenPlatform()`
  - [ ] `fetchRouteWithFallback()`
  - [ ] 缓存相关代码
  - [ ] 错误处理代码

- [ ] 是否修改了缓存逻辑？
  - [ ] `routeCache`
  - [ ] `pancakePairCache`
  - [ ] `tokenTradeHints`

- [ ] 是否修改了错误处理？
  - [ ] Service Worker 错误处理
  - [ ] RPC 错误处理
  - [ ] 其他错误处理

### 2. 测试计划

- [ ] 为修改添加了单元测试
- [ ] 运行了所有平台的回归测试
- [ ] 测试了 Service Worker 错误场景
- [ ] 测试了缓存场景
- [ ] 测试了边界情况

### 3. 本地验证

在提交前，必须在本地测试以下场景：

#### Four.meme 代币
- [ ] 未迁移代币（BNB 筹集）
  - 代币地址：`0xd86eb37348f72ddff0c0b9873531dd0fe4d7ffff`
  - 预期：`platform=four`, `preferredChannel=four`, `readyForPancake=false`

- [ ] 未迁移代币（非 BNB 筹集，如 KGST）
  - 代币地址：`0x3e2a009d420512627a2791be63eeb04c94674444`
  - 预期：`platform=four`, `preferredChannel=four`, `readyForPancake=false`

- [ ] 已迁移代币
  - 预期：`platform=four`, `preferredChannel=pancake`, `readyForPancake=true`

#### Flap 代币
- [ ] Flap 代币正常工作
  - 预期：`platform=flap`

#### Unknown 平台代币
- [ ] PancakeSwap 代币（如 KDOG）
  - 代币地址：`0x3753dd32cbc376ce6efd85f334b7289ae6d004af`
  - 预期：`platform=unknown`, `preferredChannel=pancake`, `readyForPancake=true`

### 4. 测试命令

```bash
# 运行所有测试
npm test

# 运行测试（非 watch 模式）
npm run test:run

# 查看测试 UI
npm run test:ui

# 生成覆盖率报告
npm run coverage
```

### 5. 清除缓存测试

修改后必须清除缓存重新测试：

```javascript
// 在浏览器控制台运行
chrome.storage.local.clear(() => {
  console.log('✅ 缓存已清除');
});
```

然后：
1. 重新加载扩展
2. 访问代币页面
3. 查看 Background Service Worker 日志
4. 验证路由信息正确

### 6. 日志检查

在 Background Service Worker 控制台中，应该看到：

```
[fetchRouteWithFallback] 开始查询路由: token=0x..., platform=...
[fetchRouteWithFallback] 尝试平台: ...
[fetchRouteWithFallback] 平台 ... 返回: preferredChannel=..., readyForPancake=...
[fetchRouteWithFallback] 使用平台 ... 的路由
```

### 7. 文档更新

- [ ] 更新了相关文档
- [ ] 添加了代码注释（如果逻辑复杂）
- [ ] 更新了 CHANGELOG（如果是重要修改）
- [ ] 添加了 ADR（如果是架构变更）

### 8. Code Review 准备

- [ ] 提交信息清晰明确
- [ ] 代码符合项目规范
- [ ] 没有调试代码（console.log 等）
- [ ] 没有注释掉的代码
- [ ] 变量命名清晰

### 9. 部署准备

- [ ] 准备了回滚方案
- [ ] 记录了清除缓存的步骤
- [ ] 确定了监控指标
- [ ] 通知了相关人员（如果需要）

## ⚠️ 常见陷阱

### 陷阱 1：硬编码平台
❌ **错误**：
```typescript
const route = await fetchRouteWithFallback(client, token, 'unknown');
```

✅ **正确**：
```typescript
const platform = detectTokenPlatform(token);
const route = await fetchRouteWithFallback(client, token, platform);
```

### 陷阱 2：忘记处理 Service Worker 错误
❌ **错误**：
```typescript
const pair = await checkPancakePair(client, token);
// 如果遇到 Service Worker 错误，会抛出异常
```

✅ **正确**：
```typescript
try {
  const pair = await checkPancakePair(client, token);
} catch (error) {
  if (error.message.includes('import() is disallowed')) {
    // 处理 Service Worker 错误
  }
}
```

### 陷阱 3：修改共享代码不测试所有平台
❌ **错误**：只测试 Four.meme，不测试 Flap 和 Unknown

✅ **正确**：测试所有受影响的平台

### 陷阱 4：忘记清除缓存
❌ **错误**：修改后直接测试，使用了旧的缓存数据

✅ **正确**：清除缓存后重新测试

## 📊 测试覆盖率要求

- 新增代码的测试覆盖率必须 > 80%
- 不能降低整体测试覆盖率
- 关键路径必须有测试

## 🚨 如果测试失败

1. **不要提交**
2. 查看失败的测试
3. 在本地复现问题
4. 修复问题
5. 重新运行所有测试
6. 确认通过后再提交

## ✅ 提交前最后检查

- [ ] 所有测试通过 ✅
- [ ] 代码已格式化
- [ ] 没有 TypeScript 错误
- [ ] 没有 ESLint 警告
- [ ] Git Hook 测试通过
- [ ] 准备好回答 Code Review 问题

---

**使用方法**：
1. 复制这个清单到你的笔记中
2. 每次修改路由代码前，逐项检查
3. 确保所有项目都完成后再提交

**创建日期**：2026-02-08
**状态**：✅ 可用
