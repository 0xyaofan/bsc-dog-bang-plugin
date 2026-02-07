# KDOG 配对选择问题 - 最终分析

## 问题总结

1. **KGST 已添加到候选列表** ✅
2. **流动性比较逻辑已实现** ✅
3. **但遇到 Service Worker 限制** ❌

## Service Worker Import 问题

在 Service Worker 环境中，Viem 的 `readContract` 会触发动态 `import()`，导致所有配对查询失败：

```
import() is disallowed on ServiceWorkerGlobalScope
```

## 当前状态

- ❌ `checkPancakePair` 无法查询配对（Service Worker 限制）
- ✅ 交易仍然可以进行（使用路径缓存）
- ❌ 但使用的是旧缓存（KDOG/WBNB），不是 KDOG/KGST

## 根本原因

**两个独立的缓存系统**：
1. **路由缓存**（`token-route.ts`）- 用于判断 `readyForPancake`
2. **路径缓存**（`trading-channels.ts`）- 用于实际交易

路径缓存中已经有了 KDOG/WBNB 的路径，所以交易使用的是这个旧路径。

## 解决方案

### 方案 A：清除路径缓存（临时）

在控制台运行：
```javascript
chrome.storage.local.clear()
```

**问题**：清除后无法重新建立缓存（Service Worker 限制）

### 方案 B：修复 Viem Service Worker 兼容性（根本）

可能的方法：
1. 升级 Viem 到支持 Service Worker 的版本
2. 使用不同的 RPC 调用方式（避免触发动态 import）
3. 使用串行查询而不是并发查询
4. 降级到不使用动态 import 的 Viem 版本

### 方案 C：手动指定配对（快速）

在代码中为 KDOG 硬编码配对信息：

```typescript
// 特殊代币的配对映射
const SPECIAL_PAIRS = {
  '0x3753dd32cbc376ce6efd85f334b7289ae6d004af': {
    quoteToken: '0x94be0bbA8E1E303fE998c9360B57b826F1A4f828', // KGST
    pairAddress: '0x14C90904dD8868c8E748e42D092250Ec17f748d1'
  }
};
```

### 方案 D：使用 fetch 直接调用 RPC（绕过 Viem）

```typescript
async function getPairDirect(tokenA: string, tokenB: string): Promise<string> {
  const response = await fetch(RPC_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'eth_call',
      params: [{
        to: PANCAKE_FACTORY,
        data: encodeFunctionData({
          abi: PANCAKE_FACTORY_ABI,
          functionName: 'getPair',
          args: [tokenA, tokenB]
        })
      }, 'latest']
    })
  });
  const result = await response.json();
  return decodeFunctionResult({
    abi: PANCAKE_FACTORY_ABI,
    functionName: 'getPair',
    data: result.result
  });
}
```

## 推荐方案

**短期**：方案 C（硬编码 KDOG 配对）
**中期**：方案 D（使用 fetch 绕过 Viem）
**长期**：方案 B（修复 Viem 兼容性）

## 下一步行动

1. 实施方案 C，为 KDOG 硬编码正确的配对
2. 测试验证
3. 如果成功，考虑实施方案 D 作为通用解决方案

---

创建日期：2026-02-08
状态：待实施
