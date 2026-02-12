# 授权系统完整优化方案

## 概述

本次优化解决了授权系统的三个关键问题：
1. **通道不匹配**：前端授权检查使用 DOM 值，后端使用 `preferredChannel`
2. **迁移监听缺失**：代币迁移完成后没有主动授权 PancakeSwap
3. **双重授权缺失**：非 BNB 筹集币种缺少 QuoteToken 的预授权

---

## 问题 1：授权通道不匹配

### 问题描述

用户在交易代币时，页面显示"已授权"，但卖出时系统判断 allowance 为 0，需要重新授权。

### 根本原因

前端授权检查使用 DOM 的 `channel-selector` 值（可能是 `'pancake'`），但后端根据 `routeInfo.preferredChannel` 自动选择通道（实际是 `'four'`），导致授权了错误的合约。

### 修复方案

**文件**：`src/content/index.ts`

#### 买入时（第 1573-1580 行）

```typescript
// 🐛 修复：使用路由信息中的 preferredChannel 而不是 DOM 的 channel-selector
if (userSettings?.trading?.autoApproveMode === 'buy') {
  const effectiveChannel = currentTokenRoute?.preferredChannel || channel;
  autoApproveToken(tokenAddress, effectiveChannel);
}
```

#### 卖出时（第 1769-1806 行）

```typescript
// 🐛 修复：使用路由信息中的 preferredChannel 而不是 DOM 的 channel-selector
if (userSettings?.trading?.autoApproveMode === 'sell') {
  const effectiveChannel = currentTokenRoute?.preferredChannel || channel;
  // ... 授权逻辑
}
```

---

## 问题 2：代币迁移时缺少主动授权

### 问题描述

用户停留在代币页面时，代币从 Four.meme/Flap 迁移到 PancakeSwap，但系统没有主动授权 PancakeSwap Router，用户交易时需要重新授权。

### 修复方案

**文件**：`src/content/index.ts:1512-1565`

```typescript
// 用于跟踪上一次的路由状态，检测迁移变化
let previousTokenRoute: any = null;

function applyTokenRouteToUI(route: any) {
  // ... UI 更新逻辑 ...

  // 🐛 修复：检测代币迁移完成，主动触发 PancakeSwap 授权
  const hasMigrated = previousTokenRoute &&
                      !previousTokenRoute.readyForPancake &&
                      route.readyForPancake &&
                      route.preferredChannel === 'pancake';

  if (hasMigrated && currentTokenAddress && userSettings?.trading?.autoApproveMode) {
    logger.debug('[Dog Bang] 检测到代币迁移完成，主动授权 PancakeSwap');
    autoApproveToken(currentTokenAddress, 'pancake').catch((error) => {
      logger.debug('[Dog Bang] 迁移后自动授权失败:', error);
    });
  }

  // 保存当前路由状态，用于下次比较
  previousTokenRoute = route;
}
```

### 检测逻辑

1. **跟踪状态**：使用 `previousTokenRoute` 保存上一次的路由状态
2. **检测迁移**：比较 `readyForPancake` 从 `false` 变为 `true`
3. **主动授权**：异步调用 `autoApproveToken(tokenAddress, 'pancake')`
4. **不阻塞 UI**：使用 `.catch()` 处理错误，不影响页面更新

---

## 问题 3：非 BNB 筹集币种的双重授权

### 问题描述

非 BNB 筹集币种（如 USD1、USDT）+ 自定义聚合器卖出时需要两次授权：
1. 授权代币给 Four.meme 合约
2. 授权 QuoteToken 给聚合器合约

前端的预授权只授权了代币，没有授权 QuoteToken，导致卖出时需要等待 QuoteToken 授权。

### 修复方案

#### 1. 前端适配层：添加批量授权接口

**文件**：`src/shared/frontend-adapter.ts`

```typescript
/**
 * 批量授权代币（用于非 BNB 筹集币种的双重授权）
 */
export async function batchApproveTokens(approvals: Array<{
  tokenAddress: string;
  channel: string;
}>) {
  return chrome.runtime.sendMessage({
    action: 'batch_approve_tokens',
    data: { approvals }
  });
}
```

#### 2. 后端：实现批量授权处理器

**文件**：`src/background/index.ts`

```typescript
// 批量授权代币
async function handleBatchApproveTokens({ approvals }) {
  if (!Array.isArray(approvals) || approvals.length === 0) {
    return { success: false, error: '授权列表为空' };
  }

  const results = [];
  let allSuccess = true;

  for (const approval of approvals) {
    const { tokenAddress, channel } = approval;
    try {
      const result = await handleApproveToken({ tokenAddress, channel });
      results.push({ tokenAddress, channel, ...result });
      if (!result.success) {
        allSuccess = false;
      }
    } catch (error) {
      results.push({ tokenAddress, channel, success: false, error: error.message });
      allSuccess = false;
    }
  }

  return {
    success: allSuccess,
    results,
    message: allSuccess ? '批量授权成功' : '部分授权失败'
  };
}
```

#### 3. 支持 'aggregator' 通道

**文件**：`src/background/index.ts`

```typescript
// 获取授权地址（根据通道）
let spenderAddress;
switch (channel) {
  case 'pancake':
    spenderAddress = CONTRACTS.PANCAKE_ROUTER;
    break;
  case 'four':
  case 'xmode':
    spenderAddress = CONTRACTS.FOUR_TOKEN_MANAGER_V2;
    break;
  case 'flap':
    spenderAddress = CONTRACTS.FLAP_PORTAL;
    break;
  case 'aggregator':
    // 自定义聚合器合约地址
    const aggregatorSettings = getAggregatorRuntimeSettings();
    spenderAddress = aggregatorSettings.contractAddress;
    break;
  default:
    spenderAddress = CONTRACTS.PANCAKE_ROUTER;
}
```

#### 4. 卖出时的双重预授权逻辑

**文件**：`src/content/index.ts:1769-1806`

```typescript
if (userSettings?.trading?.autoApproveMode === 'sell' && tokenAddress && channel) {
  const effectiveChannel = currentTokenRoute?.preferredChannel || channel;
  const sellApprovalKey = `${tokenAddress.toLowerCase()}:${effectiveChannel}`;

  if (!sellAutoApproveCache.has(sellApprovalKey)) {
    // 检测是否需要双重授权
    const isAggregatorEnabled = userSettings?.aggregator?.enabled === true;
    const quoteToken = currentTokenRoute?.quoteToken;
    const isNonBnbQuote = quoteToken && quoteToken !== '0x0000000000000000000000000000000000000000';
    // 注意：只有 Four.meme 需要聚合器，Flap Portal 内置了自动兑换功能
    const isFour = effectiveChannel === 'four' || effectiveChannel === 'xmode';
    const needsDualApproval = isAggregatorEnabled && isNonBnbQuote && isFour;

    if (needsDualApproval) {
      // 双重授权：代币 + QuoteToken
      logger.debug('[Dog Bang] 非 BNB 筹集币种，执行双重预授权');

      await sendMessageViaAdapter({
        action: 'batch_approve_tokens',
        data: {
          approvals: [
            { tokenAddress, channel: effectiveChannel },  // 授权代币给 Four.meme
            { tokenAddress: quoteToken, channel: 'aggregator' }  // 授权 QuoteToken 给聚合器
          ]
        }
      }).catch((error) => {
        logger.debug('[Dog Bang] 双重预授权失败:', error);
      });
    } else {
      // 单次授权
      await autoApproveToken(tokenAddress, effectiveChannel);
    }

    sellAutoApproveCache.add(sellApprovalKey);
  }
}
```

### 检测条件

双重授权需要同时满足以下条件：

1. **启用自定义聚合器**：`userSettings.aggregator.enabled === true`
2. **非 BNB 筹集币种**：`quoteToken !== '0x0000...'`
3. **Four.meme 通道**：`channel === 'four' || channel === 'xmode'`（**不包括 Flap**）

**重要说明**：Flap Portal 合约内置了自动兑换功能（Token → QuoteToken → BNB），因此 Flap 代币只需要单次授权给 Flap Portal，不需要额外授权 QuoteToken 给聚合器

### 授权流程

1. **检测条件**：判断是否需要双重授权
2. **批量授权**：
   - 授权代币给 Four.meme 合约（用于卖出）
   - 授权 QuoteToken 给聚合器合约（用于兑换 QuoteToken → BNB）
3. **缓存标记**：避免重复授权

---

## 后端授权逻辑（已完整实现）

### 卖出时的自动授权

**文件**：`src/background/custom-aggregator-agent.ts:744-790`

后端在卖出时会自动处理所有必要的授权：

1. **授权代币给 Four.meme 合约**（第 744-760 行）
   ```typescript
   await ensureAggregatorTokenApproval({
     tokenAddress,
     spender: fourTokenManager,
     amount: amountToSell,
     ...
   });
   ```

2. **授权 QuoteToken 给聚合器合约**（第 762-790 行）
   ```typescript
   await ensureAggregatorTokenApproval({
     tokenAddress: quoteToken,
     spender: normalizedAggregator,
     amount: quoteApproveThreshold,
     ...
   });
   ```

### 前端预授权的作用

前端的预授权是**性能优化**：
- 在用户点击卖出之前，提前检查并授权
- 避免交易时等待授权交易确认（节省 1-2 秒）
- 提升用户体验

**即使前端没有预授权，后端也会在交易时自动处理所有授权**。

---

## 完整的授权流程

### 场景 1：BNB 筹集币种

```
1. 用户点击卖出
2. 前端预授权：代币 → Four.meme 合约
3. 后端卖出：检查授权 → 已授权 → 直接卖出
```

### 场景 2：非 BNB 筹集币种（未启用聚合器）

```
1. 用户点击卖出
2. 前端预授权：代币 → Four.meme 合约
3. 后端卖出：检查授权 → 已授权 → 直接卖出
```

### 场景 3：非 BNB 筹集币种（Four.meme + 启用聚合器）

```
1. 用户点击卖出
2. 前端双重预授权：
   - 代币 → Four.meme 合约
   - QuoteToken → 聚合器合约
3. 后端卖出：
   - 检查代币授权 → 已授权
   - 检查 QuoteToken 授权 → 已授权
   - 直接卖出（无需等待授权）
```

### 场景 3b：非 BNB 筹集币种（Flap）

```
1. 用户点击卖出
2. 前端单次预授权：
   - 代币 → Flap Portal 合约
3. 后端卖出：
   - 检查代币授权 → 已授权
   - Flap Portal 内置自动兑换（Token → QuoteToken → BNB）
   - 直接卖出（无需 QuoteToken 授权）
```

### 场景 4：代币迁移

```
1. 用户停留在代币页面
2. 代币从 Four.meme/Flap 迁移到 PancakeSwap
3. 系统检测到 readyForPancake 变为 true
4. 主动授权：代币 → PancakeSwap Router
5. 用户后续交易无需再授权
```

---

## 技术细节

### 1. 通道与 Spender 地址映射

| 通道 | Spender 地址 | 用途 |
|------|-------------|------|
| `pancake` | `CONTRACTS.PANCAKE_ROUTER` | PancakeSwap 交易 |
| `four` / `xmode` | `CONTRACTS.FOUR_TOKEN_MANAGER_V2` | Four.meme 交易 |
| `flap` | `CONTRACTS.FLAP_PORTAL` | Flap 交易（内置自动兑换） |
| `aggregator` | `userSettings.aggregator.contractAddress` | 自定义聚合器（仅 Four.meme 需要） |

### 2. 授权检查逻辑

```typescript
// 如果授权额度大于总供应量的 50%，认为已授权
const approved = allowance > totalSupply / 2n;
```

### 3. 批量授权的顺序执行

批量授权使用 `for...of` 循环顺序执行，确保：
- 每个授权交易使用正确的 nonce
- 避免 nonce 冲突
- 返回每个授权的详细结果

### 4. 缓存机制

```typescript
const sellApprovalKey = `${tokenAddress.toLowerCase()}:${effectiveChannel}`;
sellAutoApproveCache.add(sellApprovalKey);
```

- 使用 Set 缓存已授权的代币+通道组合
- 避免重复授权
- 页面刷新后清空缓存

---

## 修复效果

### 修复前

**问题 1：通道不匹配**
```
授权 PancakeSwap → 实际使用 Four.meme → 卖出时需要重新授权
```

**问题 2：迁移后未授权**
```
代币迁移完成 → 用户交易 → 需要授权 PancakeSwap → 等待 1-2 秒
```

**问题 3：缺少 QuoteToken 授权**
```
卖出 → 代币已授权 → QuoteToken 未授权 → 等待授权 → 增加 1-2 秒
```

### 修复后

**问题 1：通道一致**
```
授权 Four.meme → 实际使用 Four.meme → 卖出时无需授权 ✓
```

**问题 2：主动授权**
```
代币迁移完成 → 自动授权 PancakeSwap → 用户交易 → 无需授权 ✓
```

**问题 3：双重预授权**
```
卖出前 → 代币 + QuoteToken 都已授权 → 卖出时无需等待 ✓
```

### 性能提升

- ✅ 避免授权错误的合约
- ✅ 代币迁移时自动授权，无需用户等待
- ✅ 非 BNB 筹集币种卖出时节省 1-2 秒（QuoteToken 授权时间）
- ✅ 提升用户体验，减少交易等待时间

---

## 相关文件

### 前端
- `src/content/index.ts:1573-1580` - 买入时的授权修复
- `src/content/index.ts:1769-1806` - 卖出时的双重授权
- `src/content/index.ts:1512-1565` - 代币迁移监听
- `src/shared/frontend-adapter.ts` - 批量授权接口

### 后端
- `src/background/index.ts:3726-3863` - 单次授权处理器
- `src/background/index.ts:4238-4272` - 批量授权处理器
- `src/background/index.ts:3759-3778` - 通道与 Spender 映射
- `src/background/custom-aggregator-agent.ts:744-790` - 卖出时的自动授权

### 文档
- `docs/approval-channel-mismatch-fix.md` - 授权通道不匹配修复文档

---

## 测试建议

### 功能测试

- [ ] Four.meme BNB 筹集代币：买入 → 卖出无需授权
- [ ] Four.meme USD1 筹集代币（启用聚合器）：买入 → 卖出无需授权（双重预授权）
- [ ] Four.meme USD1 筹集代币（未启用聚合器）：买入 → 卖出无需授权（单次授权）
- [ ] Flap BNB 筹集代币：买入 → 卖出无需授权
- [ ] Flap USD1 筹集代币：买入 → 卖出无需授权（单次授权，Flap Portal 内置自动兑换）
- [ ] 代币迁移：停留页面 → 迁移完成 → 自动授权 PancakeSwap

### 性能测试

- [ ] 非 BNB 筹集币种卖出：无需等待 QuoteToken 授权
- [ ] 代币迁移后交易：无需等待 PancakeSwap 授权
- [ ] 批量授权：两次授权顺序执行，无 nonce 冲突

### 回归测试

- [ ] 关闭自动授权：手动授权仍然正常
- [ ] 关闭聚合器：单次授权正常
- [ ] BNB 筹集币种：不受影响

---

## 总结

### 问题

1. 授权检查使用 DOM 值，后端使用 `preferredChannel`，导致通道不匹配
2. 代币迁移完成后没有主动授权 PancakeSwap
3. 非 BNB 筹集币种缺少 QuoteToken 的预授权

### 修复

1. 前端授权使用 `currentTokenRoute.preferredChannel`，与后端保持一致
2. 检测迁移状态变化，主动触发 PancakeSwap 授权
3. 实现批量授权接口，支持双重预授权（仅 Four.meme）
4. 正确区分 Four.meme（需要聚合器）和 Flap（内置自动兑换）

### 效果

- ✅ 授权正确的合约
- ✅ 代币迁移时自动授权
- ✅ Four.meme 非 BNB 筹集币种完整预授权（双重授权）
- ✅ Flap 非 BNB 筹集币种单次授权（内置自动兑换）
- ✅ 提升交易速度和用户体验

---

**修复日期**：2026-02-06
**修复版本**：1.1.9
**影响范围**：所有启用自动授权功能的用户
**状态**：已完整实现，等待测试验证
