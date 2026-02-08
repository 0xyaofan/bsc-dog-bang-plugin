# ADR-001: Service Worker 环境下的路由查询策略

## 状态
已接受 (Accepted)

## 日期
2026-02-08

## 背景
在 Chrome Extension 的 Service Worker 环境中，`import()` 动态导入被禁用，导致 viem 库的某些功能无法正常工作。这影响了我们查询 PancakeSwap pair 和代币信息的能力。

### 问题表现
- 错误信息：`import() is disallowed on ServiceWorkerGlobalScope`
- 影响范围：所有需要查询链上数据的路由函数
- 发生频率：每次在 Service Worker 中调用 `publicClient.readContract`

## 决策
采用**错误捕获 + 特殊配对映射**的混合策略：

1. **错误捕获策略**：在所有平台路由函数中捕获 Service Worker 错误
2. **特殊配对映射**：为已知的特殊代币对维护硬编码映射
3. **假设策略**：当无法查询时，根据平台特性做出合理假设

### 实现细节

#### 1. Four.meme 平台
```typescript
try {
  info = await publicClient.readContract({...});
} catch (error) {
  if (errorMsg.includes('import() is disallowed on ServiceWorkerGlobalScope')) {
    // 假设未迁移，返回 Four.meme 路由
    return {
      platform,
      preferredChannel: 'four',
      readyForPancake: false,
      notes: 'Service Worker 限制，假设未迁移'
    };
  }
}
```

#### 2. 特殊配对映射
```typescript
const SPECIAL_PAIR_MAPPINGS: Record<string, PairMapping> = {
  '0x3753dd32cbc376ce6efd85f334b7289ae6d004af': { // KDOG
    pairAddress: '0x14C90904dD8868c8E748e42D092250Ec17f748d1',
    quoteToken: '0x94be0bbA8E1E303fE998c9360B57b826F1A4f828', // KGST
    version: 'v2'
  }
};
```

## 理由

### 为什么选择这个方案？

1. **最小侵入性**：不需要重写整个路由系统
2. **向后兼容**：在非 Service Worker 环境中正常工作
3. **渐进式改进**：可以逐步添加特殊映射
4. **用户体验优先**：即使查询失败，也能提供可用的路由

### 考虑过的其他方案

#### 方案 A：使用 fetch 替代 viem
- **优点**：完全避免 Service Worker 限制
- **缺点**：需要重写所有合约调用代码，工作量大
- **为什么不选**：改动范围太大，风险高

#### 方案 B：将查询移到 Offscreen Document
- **优点**：Offscreen Document 没有 Service Worker 限制
- **缺点**：需要复杂的消息传递机制，增加延迟
- **为什么不选**：架构复杂度增加，性能下降

#### 方案 C：完全依赖缓存
- **优点**：避免实时查询
- **缺点**：无法检测代币状态变化（如迁移）
- **为什么不选**：用户体验差，信息不准确

## 后果

### 正面影响
- ✅ 快速解决了 Service Worker 限制问题
- ✅ 保持了代码的可维护性
- ✅ 用户可以正常交易
- ✅ 为已知代币提供了准确的路由

### 负面影响
- ⚠️ 需要手动维护特殊配对映射
- ⚠️ 对于新代币，可能需要等待映射更新
- ⚠️ 假设策略可能不总是准确

### 技术债务
- TODO: 考虑实现自动发现和更新特殊配对映射的机制
- TODO: 评估使用 Offscreen Document 的可行性
- TODO: 监控假设策略的准确率

## 相关决策
- ADR-002: 路由缓存策略
- ADR-003: 平台检测机制

## 参考资料
- [Chrome Extension Service Worker 限制](https://developer.chrome.com/docs/extensions/mv3/service_workers/)
- [Viem 文档](https://viem.sh/)
- Issue: "刚才的修改影响要的正常的功能，我交易非bnb筹集币种的fourmeme未迁移代币报错"
