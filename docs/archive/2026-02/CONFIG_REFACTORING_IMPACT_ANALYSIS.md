# 配置重构影响分析与 P2 任务方案

## 📊 现有配置系统分析

### 1. 现有配置架构

**配置存储层** (`src/shared/user-settings.ts`):
- 使用 `chrome.storage.local` 存储用户配置
- 存储键: `dongBangUserSettings`
- 配置结构:
  ```typescript
  UserSettings {
    system: SystemSettings      // 系统配置（RPC、日志、轮询间隔）
    trading: TradingSettings     // 交易配置（预设值、Gas、滑点）
    channels: ChannelSettings    // 通道配置（Four.meme quote tokens）
    aggregator: AggregatorSettings // 聚合器配置
  }
  ```

**配置UI层** (`src/sidepanel/main.tsx`):
- 4个配置子标签页:
  1. **交易配置** (trade): 买入/卖出预设、滑点、Gas价格、自动授权
  2. **通道配置** (channel): Four.meme 募集币种管理
  3. **聚合器配置** (aggregator): 自定义合约开关、执行方式、合约地址
  4. **系统配置** (system): RPC节点、日志模式、轮询间隔

**配置应用层**:
- `applySettingsToRuntime()`: 将用户配置应用到运行时
  - 更新 `DEBUG_CONFIG.ENABLED`
  - 更新 `DEBUG_CONFIG.PERF_ENABLED`
  - 更新 `TX_WATCHER_CONFIG.POLLING_INTERVAL`
  - 更新 Four.meme quote token 列表

### 2. 新配置系统架构

**P0/P1 已完成的重构**:
- `src/shared/config/plugin-config.ts`: 插件系统配置（不可由用户修改）
- `src/shared/config/user-preferences.ts`: 用户偏好配置（SDK相关）
- `src/shared/config/ui-config.ts`: UI显示配置
- `src/shared/config/sdk-config-adapter.ts`: SDK配置适配器

## 🔍 影响评估

### ✅ 无影响部分

1. **现有UI完全兼容**
   - `user-settings.ts` 已更新为使用新的 `config/index.js` 导入
   - `UserSettings` 接口和函数签名未改变
   - `loadUserSettings()` / `saveUserSettings()` 功能完全保持
   - sidepanel UI 无需修改

2. **配置存储格式不变**
   - 仍使用 `chrome.storage.local`
   - 存储键 `dongBangUserSettings` 不变
   - 数据结构完全兼容

3. **运行时配置应用正常**
   - `applySettingsToRuntime()` 仍然有效
   - `DEBUG_CONFIG` / `TX_WATCHER_CONFIG` 引用正确

### ⚠️ 需要注意的部分

1. **配置系统双轨制**
   - **旧系统** (`user-settings.ts`): 插件UI配置，存储在 `chrome.storage.local`
   - **新系统** (`user-preferences.ts`): SDK配置，也存储在 `chrome.storage.local`
   - **存储键不同**: `dongBangUserSettings` vs `userPreferences`
   - **配置项有重叠**: 例如 `defaultSlippage`、`customRpcUrl` 等

2. **配置同步问题**
   - 用户在UI中修改的配置（`user-settings.ts`）不会自动同步到SDK配置（`user-preferences.ts`）
   - SDK使用的配置可能与UI显示的不一致

## 🎯 P2 任务方案

### 方案：统一配置系统

**目标**: 将 `user-preferences.ts` 合并到 `user-settings.ts`，消除配置双轨制

### 阶段 1: 配置合并

#### 1.1 扩展 UserSettings 接口

在 `user-settings.ts` 中添加 SDK 相关配置：

```typescript
export type UserSettings = {
  system: SystemSettings;
  trading: TradingSettings;
  channels: ChannelSettings;
  aggregator: AggregatorSettings;

  // 新增：SDK 配置
  sdk: {
    // 交易配置
    defaultSlippage: number;        // 默认滑点（百分比，如 15）
    defaultGasPrice: number;        // 默认 Gas 价格（Gwei）
    preferredDeadline: number;      // 交易截止时间（秒）
    preferredChannel?: string;      // 偏好通道
    autoSelectChannel: boolean;     // 自动选择最佳通道

    // RPC 配置
    customRpcUrl?: string;          // 自定义 RPC URL
    useCustomRpc: boolean;          // 是否使用自定义 RPC

    // UI 配置
    showNotifications: boolean;     // 显示通知
    autoRefreshBalance: boolean;    // 自动刷新余额

    // 监控配置
    enableWebSocketMonitor: boolean; // 启用 WebSocket 监控
    enableDebugMode: boolean;       // 启用调试模式
  };
};
```

#### 1.2 更新默认配置

```typescript
export const DEFAULT_USER_SETTINGS: UserSettings = {
  // ... 现有配置
  sdk: {
    defaultSlippage: 15,
    defaultGasPrice: 5,
    preferredDeadline: 300,
    autoSelectChannel: true,
    useCustomRpc: false,
    showNotifications: true,
    autoRefreshBalance: true,
    enableWebSocketMonitor: false,
    enableDebugMode: false,
  }
};
```

#### 1.3 更新 SDK 配置适配器

修改 `sdk-config-adapter.ts` 使用统一的 `user-settings.ts`:

```typescript
import { loadUserSettings } from '../user-settings.js';

export async function createPluginTradingConfig() {
  const settings = await loadUserSettings();

  return {
    defaultSlippage: Math.floor(settings.sdk.defaultSlippage * 100), // 转换为 bps
    defaultDeadline: settings.sdk.preferredDeadline,
    autoSelectBestChannel: settings.sdk.autoSelectChannel,
  };
}

export async function createPluginTransportConfig() {
  const settings = await loadUserSettings();

  const builder = createTransportConfig();

  // 如果用户设置了自定义 RPC
  if (settings.sdk.useCustomRpc && settings.sdk.customRpcUrl) {
    builder.addNode({
      id: 'custom-primary',
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

  // 添加备用节点
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
  builder.enableDynamicSelection({
    interval: 30000,
    sampleCount: 10,
    switchThreshold: 0.2,
    minStableTime: 300000,
    latencyFloor: 50,
    weights: {
      latency: 0.5,
      stability: 0.3,
      successRate: 0.2,
    },
  });

  return builder.build();
}
```

#### 1.4 删除 user-preferences.ts

将 `user-preferences.ts` 标记为废弃并删除：

```bash
# 备份
mv src/shared/config/user-preferences.ts src/shared/config/user-preferences.ts.backup

# 或直接删除
rm src/shared/config/user-preferences.ts
```

### 阶段 2: UI 增强

#### 2.1 添加 SDK 配置子标签页

在 sidepanel 中添加第5个配置标签页 "SDK配置":

```typescript
const sdkConfigTab = document.createElement('button');
sdkConfigTab.type = 'button';
sdkConfigTab.className = 'config-sub-tab';
sdkConfigTab.dataset.section = 'sdk';
sdkConfigTab.textContent = 'SDK';

const sdkConfigPane = document.createElement('div');
sdkConfigPane.className = 'config-subpane';
sdkConfigPane.dataset.section = 'sdk';

const sdkForm = document.createElement('form');
sdkForm.className = 'config-sub-form';
sdkForm.innerHTML = `
  <section class="config-section">
    <h3 class="config-section-title">交易配置</h3>

    <div class="config-field">
      <label class="config-label">默认滑点 (%)</label>
      <input type="number" name="sdkSlippage" class="config-input"
             min="0.1" max="100" step="0.1" placeholder="15" />
      <p class="config-hint">SDK 交易时使用的默认滑点</p>
    </div>

    <div class="config-field">
      <label class="config-label">默认 Gas 价格 (Gwei)</label>
      <input type="number" name="sdkGasPrice" class="config-input"
             min="1" max="100" step="0.1" placeholder="5" />
      <p class="config-hint">SDK 交易时使用的默认 Gas 价格</p>
    </div>

    <div class="config-field">
      <label class="config-label">交易截止时间 (秒)</label>
      <input type="number" name="sdkDeadline" class="config-input"
             min="60" max="3600" step="60" placeholder="300" />
      <p class="config-hint">交易必须在此时间内完成</p>
    </div>

    <div class="config-field">
      <label class="config-label">偏好通道</label>
      <select name="sdkPreferredChannel" class="config-input">
        <option value="">自动选择</option>
        <option value="pancake">PancakeSwap</option>
        <option value="four">Four.meme</option>
        <option value="flap">Flap</option>
        <option value="luna">Luna</option>
      </select>
    </div>

    <div class="config-field">
      <label class="config-toggle">
        <input type="checkbox" name="sdkAutoSelectChannel" />
        <span>自动选择最佳通道</span>
      </label>
    </div>
  </section>

  <section class="config-section">
    <h3 class="config-section-title">RPC 配置</h3>

    <div class="config-field">
      <label class="config-toggle">
        <input type="checkbox" name="sdkUseCustomRpc" />
        <span>使用自定义 RPC（优先级高于系统配置）</span>
      </label>
    </div>

    <div class="config-field">
      <label class="config-label">自定义 RPC URL</label>
      <input type="text" name="sdkCustomRpcUrl" class="config-input"
             placeholder="https://..." />
      <p class="config-hint">SDK 专用的 RPC 节点，优先级最高</p>
    </div>
  </section>

  <section class="config-section">
    <h3 class="config-section-title">其他配置</h3>

    <div class="config-field">
      <label class="config-toggle">
        <input type="checkbox" name="sdkShowNotifications" />
        <span>显示交易通知</span>
      </label>
    </div>

    <div class="config-field">
      <label class="config-toggle">
        <input type="checkbox" name="sdkAutoRefreshBalance" />
        <span>自动刷新余额</span>
      </label>
    </div>

    <div class="config-field">
      <label class="config-toggle">
        <input type="checkbox" name="sdkEnableWebSocketMonitor" />
        <span>启用 WebSocket 监控</span>
      </label>
    </div>

    <div class="config-field">
      <label class="config-toggle">
        <input type="checkbox" name="sdkEnableDebugMode" />
        <span>启用 SDK 调试模式</span>
      </label>
    </div>
  </section>

  <div class="config-actions">
    <button type="submit" class="config-action-button primary">保存</button>
    <button type="button" class="config-action-button secondary sdk-reset">重置</button>
  </div>
`;

const sdkStatus = document.createElement('div');
sdkStatus.className = 'config-status';
sdkConfigPane.append(sdkForm, sdkStatus);
```

#### 2.2 添加表单填充和保存逻辑

```typescript
function populateSdkForm(settings: UserSettings) {
  const form = sdkForm;
  if (!form) return;

  const slippage = form.querySelector<HTMLInputElement>('input[name="sdkSlippage"]');
  const gasPrice = form.querySelector<HTMLInputElement>('input[name="sdkGasPrice"]');
  const deadline = form.querySelector<HTMLInputElement>('input[name="sdkDeadline"]');
  const preferredChannel = form.querySelector<HTMLSelectElement>('select[name="sdkPreferredChannel"]');
  const autoSelectChannel = form.querySelector<HTMLInputElement>('input[name="sdkAutoSelectChannel"]');
  const useCustomRpc = form.querySelector<HTMLInputElement>('input[name="sdkUseCustomRpc"]');
  const customRpcUrl = form.querySelector<HTMLInputElement>('input[name="sdkCustomRpcUrl"]');
  const showNotifications = form.querySelector<HTMLInputElement>('input[name="sdkShowNotifications"]');
  const autoRefreshBalance = form.querySelector<HTMLInputElement>('input[name="sdkAutoRefreshBalance"]');
  const enableWebSocketMonitor = form.querySelector<HTMLInputElement>('input[name="sdkEnableWebSocketMonitor"]');
  const enableDebugMode = form.querySelector<HTMLInputElement>('input[name="sdkEnableDebugMode"]');

  if (slippage) slippage.value = String(settings.sdk.defaultSlippage);
  if (gasPrice) gasPrice.value = String(settings.sdk.defaultGasPrice);
  if (deadline) deadline.value = String(settings.sdk.preferredDeadline);
  if (preferredChannel) preferredChannel.value = settings.sdk.preferredChannel || '';
  if (autoSelectChannel) autoSelectChannel.checked = settings.sdk.autoSelectChannel;
  if (useCustomRpc) useCustomRpc.checked = settings.sdk.useCustomRpc;
  if (customRpcUrl) customRpcUrl.value = settings.sdk.customRpcUrl || '';
  if (showNotifications) showNotifications.checked = settings.sdk.showNotifications;
  if (autoRefreshBalance) autoRefreshBalance.checked = settings.sdk.autoRefreshBalance;
  if (enableWebSocketMonitor) enableWebSocketMonitor.checked = settings.sdk.enableWebSocketMonitor;
  if (enableDebugMode) enableDebugMode.checked = settings.sdk.enableDebugMode;
}

sdkForm?.addEventListener('submit', async (event) => {
  event.preventDefault();
  const formData = new FormData(sdkForm);

  try {
    await patchUserSettings({
      sdk: {
        defaultSlippage: Number(formData.get('sdkSlippage')) || 15,
        defaultGasPrice: Number(formData.get('sdkGasPrice')) || 5,
        preferredDeadline: Number(formData.get('sdkDeadline')) || 300,
        preferredChannel: (formData.get('sdkPreferredChannel') as string) || undefined,
        autoSelectChannel: formData.get('sdkAutoSelectChannel') === 'on',
        useCustomRpc: formData.get('sdkUseCustomRpc') === 'on',
        customRpcUrl: (formData.get('sdkCustomRpcUrl') as string) || undefined,
        showNotifications: formData.get('sdkShowNotifications') === 'on',
        autoRefreshBalance: formData.get('sdkAutoRefreshBalance') === 'on',
        enableWebSocketMonitor: formData.get('sdkEnableWebSocketMonitor') === 'on',
        enableDebugMode: formData.get('sdkEnableDebugMode') === 'on',
      }
    });
    showConfigStatus(sdkStatus, 'SDK 配置已保存', 'success');
  } catch (error) {
    showConfigStatus(sdkStatus, `保存失败: ${(error as Error).message}`, 'error');
  }
});

const sdkResetButton = sdkForm.querySelector<HTMLButtonElement>('.sdk-reset');
sdkResetButton?.addEventListener('click', async (event) => {
  event.preventDefault();
  try {
    await patchUserSettings({
      sdk: DEFAULT_USER_SETTINGS.sdk
    });
    showConfigStatus(sdkStatus, 'SDK 配置已重置', 'success');
  } catch (error) {
    showConfigStatus(sdkStatus, `重置失败: ${(error as Error).message}`, 'error');
  }
});
```

### 阶段 3: 迁移 ABI 定义

#### 3.1 创建 abis.ts

```bash
# 创建 ABI 文件
touch src/shared/config/abis.ts
```

#### 3.2 迁移 ABI 定义

将 `trading-config.ts` 中的所有 ABI 定义移动到 `abis.ts`:

```typescript
/**
 * 合约 ABI 定义
 */

export const ERC20_ABI = [
  // ... ERC20 ABI
] as const;

export const ROUTER_ABI = [
  // ... Router ABI
] as const;

export const PANCAKE_FACTORY_ABI = [
  // ... Factory ABI
] as const;

// ... 其他 ABI
```

#### 3.3 更新导入

更新 `sdk-config-adapter.ts`:

```typescript
// 从 abis.ts 导入
export {
  ERC20_ABI,
  ROUTER_ABI,
  PANCAKE_FACTORY_ABI,
  PANCAKE_V3_FACTORY_ABI,
  PANCAKE_V3_SMART_ROUTER_ABI,
  PANCAKE_V3_QUOTER_ABI,
  FOUR_TOKEN_MANAGER_ABI,
  FLAP_PORTAL_ABI,
  LUNA_FUN_ABI,
  MEME_SWAP_AGGREGATOR_ABI,
} from './abis.js';

// 从 trading-config.ts 临时导出其他配置
export {
  QUOTE_TOKEN_POOL_CONFIG,
  RPC_CONFIG,
  TX_CONFIG,
  CHANNELS,
  CHANNEL_DEFINITIONS,
} from '../trading-config.js';
```

### 阶段 4: 迁移其他配置

#### 4.1 迁移 QUOTE_TOKEN_POOL_CONFIG

移动到 `sdk-config-adapter.ts`:

```typescript
export const QUOTE_TOKEN_POOL_CONFIG = {
  // ... 配置内容
} as const;
```

#### 4.2 迁移 RPC_CONFIG

合并到 `plugin-config.ts` 的 `NETWORK_CONFIG`:

```typescript
export const NETWORK_CONFIG = {
  BSC_RPC: '...',
  BSC_CHAIN_ID: 56,
  BSC_RPC_FALLBACK: [...],

  // 从 RPC_CONFIG 迁移
  TIMEOUT: 10000,
  RETRY_COUNT: 3,
  // ...
};
```

#### 4.3 迁移 TX_CONFIG

拆分为系统配置和用户偏好：

**系统配置** (plugin-config.ts):
```typescript
export const TX_CONFIG = {
  MIN_GAS_PRICE: 0.05,
  APPROVE_GAS_PRICE: 0.06,
  // ... 其他系统级配置
};
```

**用户偏好** (user-settings.ts):
```typescript
// 已在 trading.defaultBuyGasValue / defaultSellGasValue 中
```

#### 4.4 迁移 CHANNELS 和 CHANNEL_DEFINITIONS

移动到 `ui-config.ts`:

```typescript
export const CHANNELS = [
  'pancake',
  'four',
  'xmode',
  'flap',
  'luna'
] as const;

export const CHANNEL_DEFINITIONS = {
  // ... 定义内容
} as const;
```

### 阶段 5: 清理旧配置文件

#### 5.1 备份 trading-config.ts

```bash
mv src/shared/trading-config.ts src/shared/trading-config.ts.backup
```

#### 5.2 验证构建

```bash
npm run build
```

#### 5.3 运行测试

```bash
npm run test:run
```

#### 5.4 删除备份（确认无问题后）

```bash
rm src/shared/trading-config.ts.backup
rm src/shared/config/user-preferences.ts.backup
```

## 📝 实施检查清单

### 阶段 1: 配置合并
- [ ] 扩展 `UserSettings` 接口添加 `sdk` 字段
- [ ] 更新 `DEFAULT_USER_SETTINGS`
- [ ] 更新 `normalizeUserSettings()` 处理 `sdk` 配置
- [ ] 修改 `sdk-config-adapter.ts` 使用 `user-settings.ts`
- [ ] 删除 `user-preferences.ts`
- [ ] 验证构建成功

### 阶段 2: UI 增强
- [ ] 添加 SDK 配置子标签页
- [ ] 实现 `populateSdkForm()`
- [ ] 实现 SDK 表单保存逻辑
- [ ] 实现 SDK 配置重置逻辑
- [ ] 更新 `populateAllConfigForms()` 包含 SDK 表单
- [ ] 测试 UI 功能

### 阶段 3: 迁移 ABI
- [ ] 创建 `src/shared/config/abis.ts`
- [ ] 迁移所有 ABI 定义
- [ ] 更新 `sdk-config-adapter.ts` 导入
- [ ] 验证构建成功

### 阶段 4: 迁移其他配置
- [ ] 迁移 `QUOTE_TOKEN_POOL_CONFIG` 到 `sdk-config-adapter.ts`
- [ ] 迁移 `RPC_CONFIG` 到 `plugin-config.ts`
- [ ] 拆分 `TX_CONFIG`
- [ ] 迁移 `CHANNELS` 和 `CHANNEL_DEFINITIONS` 到 `ui-config.ts`
- [ ] 验证构建成功

### 阶段 5: 清理
- [ ] 备份 `trading-config.ts`
- [ ] 验证构建成功
- [ ] 运行测试套件
- [ ] 手动测试所有功能
- [ ] 删除备份文件

## 🎯 预期收益

1. **配置统一**: 消除双轨制，所有配置在一个地方管理
2. **UI完整**: 用户可以通过UI配置所有SDK参数
3. **配置同步**: UI配置自动应用到SDK
4. **代码简化**: 删除重复的配置系统
5. **维护性提升**: 配置逻辑更清晰，易于维护

## ⚠️ 风险和缓解

### 风险 1: 配置迁移导致数据丢失

**缓解措施**:
- 保持向后兼容，自动迁移旧配置
- 在 `normalizeUserSettings()` 中处理旧格式
- 提供配置导出/导入功能

### 风险 2: UI 变更影响用户体验

**缓解措施**:
- 保持现有UI布局和交互
- 新增的SDK配置作为独立标签页
- 提供配置说明和默认值

### 风险 3: SDK 配置不生效

**缓解措施**:
- 在 `sdk-config-adapter.ts` 中添加日志
- 提供配置验证功能
- 添加配置测试用例

## 📅 时间估算

- **阶段 1**: 配置合并 - 2-3 小时
- **阶段 2**: UI 增强 - 3-4 小时
- **阶段 3**: 迁移 ABI - 1 小时
- **阶段 4**: 迁移其他配置 - 2 小时
- **阶段 5**: 清理和测试 - 2 小时

**总计**: 10-12 小时

## 🎉 总结

配置重构 P0/P1 阶段已成功完成，现有配置UI完全兼容。P2 阶段将统一配置系统，消除双轨制，并为用户提供完整的SDK配置UI。整个迁移过程保持向后兼容，不会影响现有功能。
