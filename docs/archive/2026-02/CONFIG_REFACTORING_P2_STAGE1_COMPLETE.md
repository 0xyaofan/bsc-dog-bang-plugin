# 配置重构 P2 阶段1完成报告

## ✅ 完成工作

### 阶段 1: 配置合并

**目标**: 将 `user-preferences.ts` 合并到 `user-settings.ts`，消除配置双轨制

#### 1.1 扩展 UserSettings 接口 ✅

**文件**: `src/shared/user-settings.ts`

添加了新的 `SdkSettings` 类型：

```typescript
export type SdkSettings = {
  // ========== 交易配置 ==========
  defaultSlippage: number;        // 默认滑点（%），SDK 使用
  defaultGasPrice: number;        // 默认 Gas Price (Gwei)，SDK 使用
  preferredDeadline: number;      // 偏好的 deadline（秒），SDK 使用

  // ========== 通道配置 ==========
  preferredChannel?: string;      // 偏好的交易通道
  autoSelectChannel: boolean;     // 是否自动选择通道

  // ========== 网络配置 ==========
  customRpcUrl?: string;          // 自定义 RPC URL（SDK 专用）
  useCustomRpc: boolean;          // 是否使用自定义 RPC

  // ========== UI 配置 ==========
  showNotifications: boolean;     // 是否显示通知
  autoRefreshBalance: boolean;    // 是否自动刷新余额

  // ========== 高级配置 ==========
  enableWebSocketMonitor: boolean; // 是否启用 WebSocket 监控
  enableDebugMode: boolean;       // 是否启用调试模式
};

export type UserSettings = {
  system: SystemSettings;
  trading: TradingSettings;
  channels: ChannelSettings;
  aggregator: AggregatorSettings;
  sdk: SdkSettings;  // 新增
};
```

#### 1.2 添加默认 SDK 配置 ✅

```typescript
const DEFAULT_SDK_SETTINGS: SdkSettings = {
  // 交易配置
  defaultSlippage: 15,              // 15%
  defaultGasPrice: 5,               // 5 Gwei
  preferredDeadline: 60 * 20,       // 20 分钟

  // 通道配置
  autoSelectChannel: true,

  // 网络配置
  useCustomRpc: false,

  // UI 配置
  showNotifications: true,
  autoRefreshBalance: true,

  // 高级配置
  enableWebSocketMonitor: false,
  enableDebugMode: false,
};
```

#### 1.3 更新 normalizeUserSettings() ✅

添加了 SDK 配置的规范化逻辑：

```typescript
// SDK 配置规范化
const rawSdk = raw.sdk as Partial<SdkSettings> | undefined;
let sdkSlippage = Number(rawSdk?.defaultSlippage ?? base.sdk.defaultSlippage);
if (!Number.isFinite(sdkSlippage) || sdkSlippage <= 0 || sdkSlippage > 100) {
  sdkSlippage = base.sdk.defaultSlippage;
}
// ... 其他字段的规范化

return {
  // ... 其他配置
  sdk: {
    defaultSlippage: sdkSlippage,
    defaultGasPrice: sdkGasPrice,
    preferredDeadline: sdkDeadline,
    preferredChannel: sdkPreferredChannel,
    autoSelectChannel: sdkAutoSelectChannel,
    customRpcUrl: sdkCustomRpcUrl,
    useCustomRpc: sdkUseCustomRpc,
    showNotifications: sdkShowNotifications,
    autoRefreshBalance: sdkAutoRefreshBalance,
    enableWebSocketMonitor: sdkEnableWebSocketMonitor,
    enableDebugMode: sdkEnableDebugMode,
  }
};
```

#### 1.4 更新 SDK 配置适配器 ✅

**文件**: `src/shared/config/sdk-config-adapter.ts`

修改为使用统一的 `user-settings.ts`:

```typescript
import { loadUserSettings } from '../user-settings.js';

export async function createPluginTransportConfig() {
  const settings = await loadUserSettings();

  const builder = createTransportConfig();

  // 如果用户设置了 SDK 专用自定义 RPC
  if (settings.sdk.useCustomRpc && settings.sdk.customRpcUrl) {
    builder.addNode({
      id: 'sdk-custom-primary',
      url: settings.sdk.customRpcUrl,
      priority: 0,
      timeout: 10000,
    });
  } else if (settings.system.primaryRpc) {
    // 使用系统配置的主节点
    builder.addNode({
      id: 'user-primary',
      url: settings.system.primaryRpc,
      priority: 0,
      timeout: 10000,
    });
  }

  // 添加系统配置的备用节点
  settings.system.fallbackRpcs.forEach((url, index) => {
    builder.addNode({
      id: `user-fallback-${index}`,
      url,
      priority: index + 1,
      timeout: 10000,
    });
  });

  // 添加 SDK 默认节点
  builder.useBscNodes();

  // 启用动态选择
  builder.enableDynamicSelection({...});

  return builder.build();
}

export async function createPluginTradingConfig() {
  const settings = await loadUserSettings();

  return {
    defaultSlippage: Math.floor(settings.sdk.defaultSlippage * 100),
    defaultDeadline: settings.sdk.preferredDeadline,
    autoSelectBestChannel: settings.sdk.autoSelectChannel,
  };
}
```

#### 1.5 删除 user-preferences.ts ✅

```bash
mv src/shared/config/user-preferences.ts src/shared/config/user-preferences.ts.backup
```

#### 1.6 更新 config/index.ts ✅

移除了 `user-preferences.ts` 的导出：

```typescript
// 删除了这部分
// export {
//   type UserPreferences,
//   DEFAULT_USER_PREFERENCES,
//   loadUserPreferences,
//   saveUserPreferences,
//   resetUserPreferences,
// } from './user-preferences.js';
```

---

## 📊 构建结果

**构建命令**:
```bash
npm run build
```

**构建结果**:
```
✓ built in 2.07s
extension/dist/background.js                 204.21 kB │ gzip:  56.50 kB
extension/dist/content.js                     63.84 kB │ gzip:  18.88 kB
extension/dist/offscreen.js                    3.96 kB │ gzip:   1.77 kB
extension/dist/assets/user-settings-*.js     322.40 kB │ gzip:  82.06 kB
```

**状态**: ✅ 构建成功，无错误

**注意**: 有循环依赖警告，但这是现有问题，不是本次改动引入的。

---

## 🎯 配置系统状态

### 已统一的配置

✅ **user-settings.ts** (单一配置源):
- `system`: 系统配置（RPC、日志、轮询间隔）
- `trading`: 交易配置（预设值、Gas、滑点）
- `channels`: 通道配置（Four.meme quote tokens）
- `aggregator`: 聚合器配置
- `sdk`: SDK 配置（新增）

### 配置优先级

**RPC 节点优先级**:
1. `sdk.customRpcUrl` (如果 `sdk.useCustomRpc` 为 true)
2. `system.primaryRpc`
3. `system.fallbackRpcs`
4. SDK 默认节点

**交易配置**:
- SDK 使用 `sdk.defaultSlippage` / `sdk.defaultGasPrice` / `sdk.preferredDeadline`
- UI 使用 `trading.defaultSlippageValue` / `trading.defaultBuyGasValue` / `trading.defaultSellGasValue`

---

## 📋 下一步工作（P2 阶段2）

### 阶段 2: UI 增强

需要在 sidepanel 中添加 SDK 配置子标签页，让用户可以通过 UI 配置 SDK 参数：

1. **添加 SDK 配置子标签页**
   - 位置: `src/sidepanel/main.tsx`
   - 添加第5个配置标签页 "SDK"

2. **实现表单字段**
   - 交易配置: 默认滑点、默认 Gas 价格、交易截止时间、偏好通道、自动选择通道
   - RPC 配置: 使用自定义 RPC、自定义 RPC URL
   - 其他配置: 显示通知、自动刷新余额、启用 WebSocket 监控、启用调试模式

3. **实现表单逻辑**
   - `populateSdkForm()`: 填充表单
   - SDK 表单保存逻辑
   - SDK 配置重置逻辑
   - 更新 `populateAllConfigForms()` 包含 SDK 表单

---

## 🎉 阶段1总结

配置重构 P2 阶段1已完成：

1. ✅ 扩展 `UserSettings` 接口添加 `sdk` 字段
2. ✅ 添加 `DEFAULT_SDK_SETTINGS`
3. ✅ 更新 `normalizeUserSettings()` 处理 `sdk` 配置
4. ✅ 修改 `sdk-config-adapter.ts` 使用 `user-settings.ts`
5. ✅ 删除 `user-preferences.ts`
6. ✅ 验证构建成功

**完成度**: 阶段1 100%

**特点**:
- 配置系统已统一，消除双轨制
- SDK 配置现在存储在 `dongBangUserSettings` 中
- RPC 节点配置支持多级优先级
- 向后兼容（自动规范化旧配置）
- 构建成功，无错误

**下一步**:
- 阶段2: UI 增强（添加 SDK 配置子标签页）
- 阶段3: 迁移 ABI 定义
- 阶段4: 迁移其他配置
- 阶段5: 清理和测试

---

**日期**: 2026-02-12
**状态**: ✅ P2 阶段1完成
**构建**: ✅ 成功
**下一步**: P2 阶段2 - UI 增强
