# 授权通道不匹配问题修复

## 问题描述

用户在交易代币时，页面切换过来显示"已授权"，但卖出时系统判断 allowance 为 0，又重新进行了授权。

### 问题日志

```
[Approve] 开始预授权: {tokenAddress: '0xeb86fa952b871fc106e20d30f5cf43b6b88e4444', channel: 'pancake'}
[Approve] 当前授权额度: 1000000000000000000000000000
[Approve] 授权额度充足，无需重新授权

[Buy] Starting buy transaction: {tokenAddress: '0xeb86fa952b871fc106e20d30f5cf43b6b88e4444', amount: '0.002', slippage: 10, channel: 'four'}
[Buy] 开始执行标准通道买入 (four)...

[EnsureTokenApproval] 检查授权 {tokenAddress: '0xeb86fa95', spenderAddress: '0x5c952063', amount: '67237659724701000000000', currentAllowance: '0'}
[EnsureTokenApproval] 授权不足，需要授权 (当前: 0, 需要: 67237659724701000000000)
```

---

## 问题分析

### 1. 授权检查的通道

**买入前的预授权**：
```
channel: 'pancake'  →  检查 PancakeSwap Router 的授权
```

**实际买入使用的通道**：
```
channel: 'four'  →  使用 Four.meme 合约 (0x5c952063)
```

**卖出时的授权检查**：
```
spenderAddress: '0x5c952063'  →  检查 Four.meme 合约的授权
发现 allowance: 0  →  需要重新授权
```

### 2. 根本原因

**前端和后端的通道选择逻辑不一致**：

#### 前端（src/content/index.ts:1571-1576）

```typescript
const channel = getInputValue('channel-selector');  // 从 DOM 读取

if (userSettings?.trading?.autoApproveMode === 'buy') {
  autoApproveToken(tokenAddress, channel);  // 使用 DOM 的值
}
```

- 从 `channel-selector` DOM 元素读取通道值
- 可能是默认值 `'pancake'` 或用户手动选择的值
- **不考虑路由信息中的 `preferredChannel`**

#### 后端（src/background/index.ts:3193）

```typescript
resolvedChannelId = routeInfo?.preferredChannel || channel || 'pancake';
```

- **优先使用 `routeInfo.preferredChannel`**（系统根据代币状态自动选择）
- 其次使用前端传递的 `channel` 参数
- 最后使用默认值 `'pancake'`

### 3. 问题流程

1. **页面加载**：`channel-selector` 默认值为 `'pancake'`
2. **用户点击买入**：前端读取 `channel = 'pancake'`
3. **自动授权检查**：`autoApproveToken(tokenAddress, 'pancake')`
   - 检查 PancakeSwap Router 的授权
   - 发现已授权（可能是之前授权过的）
4. **后端买入**：`resolvedChannelId = routeInfo.preferredChannel`
   - 系统根据代币状态自动选择 `'four'` 通道
   - 实际使用 Four.meme 合约进行交易
5. **卖出时**：检查 Four.meme 合约的授权
   - 发现 `allowance = 0`（从未授权过）
   - 需要重新授权

### 4. 通道自动切换逻辑

**前端会根据路由信息自动切换通道**（src/content/index.ts:1532-1538）：

```typescript
if (!userChannelOverride && route.preferredChannel) {
  const channelSelector = document.getElementById('channel-selector') as HTMLSelectElement | null;
  if (channelSelector && channelSelector.value !== route.preferredChannel) {
    channelSelector.value = route.preferredChannel;
    logger.debug('[Dog Bang] 根据通道状态自动切换到:', route.preferredChannel);
  }
}
```

但这个切换可能发生在自动授权之后，导致授权检查使用了旧的通道值。

---

## 修复方案

### 修复代码

**文件**：`src/content/index.ts`

#### 1. 买入时的自动授权（第 1573-1580 行）

```typescript
timer.step('读取交易参数');

// 🐛 修复：使用路由信息中的 preferredChannel 而不是 DOM 的 channel-selector
// 因为后端会根据 routeInfo.preferredChannel 自动选择通道，前端应该与后端保持一致
if (userSettings?.trading?.autoApproveMode === 'buy') {
  const effectiveChannel = currentTokenRoute?.preferredChannel || channel;
  autoApproveToken(tokenAddress, effectiveChannel);
}
```

#### 2. 卖出时的自动授权（第 1745-1756 行）

```typescript
timer.step('参数验证和UI更新');

// 🐛 修复：使用路由信息中的 preferredChannel 而不是 DOM 的 channel-selector
// 因为后端会根据 routeInfo.preferredChannel 自动选择通道，前端应该与后端保持一致
if (userSettings?.trading?.autoApproveMode === 'sell' && tokenAddress && channel) {
  const effectiveChannel = currentTokenRoute?.preferredChannel || channel;
  const sellApprovalKey = `${tokenAddress.toLowerCase()}:${effectiveChannel}`;
  if (!sellAutoApproveCache.has(sellApprovalKey)) {
    await autoApproveToken(tokenAddress, effectiveChannel);
    sellAutoApproveCache.add(sellApprovalKey);
  }
}
```

### 修复逻辑

1. **优先使用 `currentTokenRoute.preferredChannel`**
   - 这是系统根据代币状态（迁移状态、平台等）自动选择的最优通道
   - 与后端的通道选择逻辑保持一致

2. **Fallback 到 DOM 的 `channel` 值**
   - 如果路由信息不可用，使用用户手动选择的通道
   - 保持向后兼容性

3. **确保前后端一致**
   - 前端授权检查的通道 = 后端实际交易使用的通道
   - 避免授权了错误的 spender 地址

---

## 修复效果

### 修复前

```
1. 页面加载，channel-selector = 'pancake'
2. 用户点击买入
3. 自动授权检查 PancakeSwap Router → 已授权 ✓
4. 后端根据 routeInfo 自动切换到 'four' 通道
5. 实际买入使用 Four.meme 合约
6. 卖出时检查 Four.meme 合约授权 → allowance = 0 ✗
7. 需要重新授权 Four.meme 合约
```

**问题**：
- 授权了错误的合约（PancakeSwap Router）
- 实际交易使用的合约（Four.meme）未授权
- 用户体验差：显示已授权，但卖出时又要授权

### 修复后

```
1. 页面加载，获取路由信息
2. currentTokenRoute.preferredChannel = 'four'
3. 用户点击买入
4. 自动授权检查 Four.meme 合约 (使用 preferredChannel)
5. 如果未授权，发送授权交易
6. 后端买入使用 Four.meme 合约
7. 卖出时检查 Four.meme 合约授权 → 已授权 ✓
8. 无需重新授权，直接卖出
```

**改进**：
- 授权正确的合约
- 前后端通道选择一致
- 用户体验好：一次授权，买卖都能用

---

## 技术细节

### 路由信息的来源

**文件**：`src/content/index.ts`

```typescript
let currentTokenRoute: any = null;  // 全局变量，存储当前代币的路由信息

async function loadTokenRoute(tokenAddress) {
  const response = await sendMessageViaAdapter({
    action: 'get_token_route',
    data: { tokenAddress }
  });

  if (response?.success && response.route) {
    currentTokenRoute = response.route;
    applyTokenRouteToUI(response.route);
  }
}
```

**路由信息包含**：
- `preferredChannel`: 系统推荐的最优通道（'four', 'flap', 'pancake' 等）
- `migrationStatus`: 代币迁移状态（'monitoring', 'migrating', 'migrated'）
- `readyForPancake`: 是否已同步到 PancakeSwap
- `lockReason`: 交易锁定原因（如果有）

### 通道选择优先级

**后端逻辑**（src/background/index.ts:3193）：

```typescript
if (forceChannel && channel) {
  resolvedChannelId = channel;  // 用户强制指定通道
} else {
  resolvedChannelId = routeInfo?.preferredChannel || channel || 'pancake';
  // 1. 优先使用 routeInfo.preferredChannel（系统推荐）
  // 2. 其次使用前端传递的 channel（用户选择）
  // 3. 最后使用默认值 'pancake'
}
```

**前端修复后的逻辑**（src/content/index.ts:1576-1579）：

```typescript
const effectiveChannel = currentTokenRoute?.preferredChannel || channel;
// 1. 优先使用 currentTokenRoute.preferredChannel（与后端一致）
// 2. Fallback 到 DOM 的 channel（用户选择）
```

### Spender 地址映射

**不同通道对应不同的 spender 地址**（src/background/index.ts:3759-3772）：

```typescript
let spenderAddress;
switch (channel) {
  case 'pancake':
    spenderAddress = CONTRACTS.PANCAKE_ROUTER;  // PancakeSwap Router
    break;
  case 'four':
  case 'xmode':
    spenderAddress = CONTRACTS.FOUR_TOKEN_MANAGER_V2;  // Four.meme 合约
    break;
  case 'flap':
    spenderAddress = CONTRACTS.FLAP_PORTAL;  // Flap Portal
    break;
  default:
    spenderAddress = CONTRACTS.PANCAKE_ROUTER;
}
```

**授权的本质**：
- ERC20 代币的 `approve(spender, amount)` 函数
- 允许 `spender` 地址从用户钱包转移最多 `amount` 数量的代币
- 不同的交易合约需要不同的授权

---

## 适用场景

### ✅ 受益的场景

1. **Four.meme 代币交易**
   - 系统自动选择 'four' 通道
   - 授权检查 Four.meme 合约而不是 PancakeSwap Router

2. **Flap 代币交易**
   - 系统自动选择 'flap' 通道
   - 授权检查 Flap Portal 而不是 PancakeSwap Router

3. **代币迁移后的交易**
   - 系统根据迁移状态自动切换通道
   - 授权检查正确的合约

4. **用户手动切换通道**
   - 如果路由信息不可用，使用用户选择的通道
   - 保持向后兼容性

### ❌ 不受影响的场景

1. **用户强制指定通道**
   - `forceChannel = true` 时，后端使用用户指定的通道
   - 前端授权检查也使用相同的通道

2. **PancakeSwap 交易**
   - 如果 `preferredChannel = 'pancake'`，前后端都使用 PancakeSwap Router
   - 授权检查正确

---

## 测试建议

### 功能测试

- [ ] Four.meme 代币买入：自动授权 Four.meme 合约
- [ ] Four.meme 代币卖出：无需重新授权
- [ ] Flap 代币买入：自动授权 Flap Portal
- [ ] Flap 代币卖出：无需重新授权
- [ ] PancakeSwap 交易：授权 PancakeSwap Router
- [ ] 用户手动切换通道：授权正确的合约

### 回归测试

- [ ] 关闭自动授权功能：手动授权仍然正常
- [ ] 强制指定通道：授权正确的合约
- [ ] 路由信息不可用：Fallback 到 DOM 的 channel 值

### 日志验证

修复后的日志应该显示：

```
[Approve] 开始预授权: {tokenAddress: '0xeb86fa95...', channel: 'four'}
[Approve] 当前授权额度: 0
[Approve] 执行授权交易...

[Buy] Starting buy transaction: {tokenAddress: '0xeb86fa95...', channel: 'four'}
[Buy] 开始执行标准通道买入 (four)...

[Sell] Starting sell transaction: {tokenAddress: '0xeb86fa95...', channel: 'four'}
[EnsureTokenApproval] 检查授权 {tokenAddress: '0xeb86fa95', spenderAddress: '0x5c952063', currentAllowance: '1000000000000000000000000000'}
[EnsureTokenApproval] 授权充足，无需重新授权
```

**关键点**：
- 预授权的 `channel` 应该是 `'four'`，不是 `'pancake'`
- 买入和卖出使用相同的通道
- 卖出时授权充足，无需重新授权

---

## 相关文件

- `src/content/index.ts:1573-1580` - 买入时的自动授权修复
- `src/content/index.ts:1745-1756` - 卖出时的自动授权修复
- `src/content/index.ts:1532-1538` - 通道自动切换逻辑
- `src/background/index.ts:3193` - 后端通道选择逻辑
- `src/background/index.ts:3759-3772` - Spender 地址映射

---

## 总结

### 问题

授权检查使用 DOM 的 `channel-selector` 值，但后端根据 `routeInfo.preferredChannel` 自动选择通道，导致前后端通道不一致，授权了错误的合约。

### 根本原因

前端和后端的通道选择逻辑不一致：
- 前端：从 DOM 读取 `channel-selector` 值
- 后端：优先使用 `routeInfo.preferredChannel`

### 修复方案

前端授权检查使用 `currentTokenRoute.preferredChannel || channel`，与后端保持一致。

### 预期效果

- 授权正确的合约
- 一次授权，买卖都能用
- 提升用户体验

---

**修复日期**：2026-02-06
**修复版本**：1.1.9
**影响范围**：所有启用自动授权功能的用户
**状态**：已修复，等待测试验证
