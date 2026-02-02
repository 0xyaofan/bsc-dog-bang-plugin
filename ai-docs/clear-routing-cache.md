# 清除路由缓存指南

## 问题描述

如果插件持续使用 V3 路由而不是更优的 V2 路由，可能是因为缓存了强制模式（forcedMode）。

## 清除方法

### 方法 1：在浏览器控制台执行（推荐）

1. 打开插件所在的页面（如 gmgn.ai 或 four.meme）
2. 按 F12 打开开发者工具
3. 切换到 Console 标签
4. 执行以下代码：

```javascript
// 清除特定代币的强制模式
// 将 TOKEN_ADDRESS 替换为实际的代币地址
const tokenAddress = '0xe1e93e92c0c2aff2dc4d7d4a8b250d973cad4444';

// 发送消息到 background script
chrome.runtime.sendMessage({
  type: 'SET_PANCAKE_PREFERRED_MODE',
  tokenAddress: tokenAddress,
  mode: null  // null 表示清除强制模式
}, (response) => {
  console.log('清除成功:', response);
});
```

### 方法 2：重新加载扩展

1. 访问 `chrome://extensions/`
2. 找到 BSC Dog Bang Plugin
3. 点击"重新加载"按钮（🔄）
4. 这将清除所有内存中的缓存

### 方法 3：清除浏览器缓存

1. 访问 `chrome://settings/clearBrowserData`
2. 选择"高级"标签
3. 时间范围选择"全部时间"
4. 勾选"缓存的图片和文件"
5. 点击"清除数据"

## 验证清除成功

清除缓存后，再次交易时应该看到以下日志：

```
[PancakeSwap] 无路由提示，将比较 V2 和 V3
[PancakeSwap] 🔍 比较 V2 和 V3 路由，选择最优...
[PancakeSwap] V2 路径成功，输出: 1000000000000000000
[PancakeSwap] V3 路径成功，输出: 100000000000000000
[PancakeSwap] ✅ V2 输出更优 (比 V3 多 90000bps)，选择 V2
```

## 如果仍然使用 V3

如果清除缓存后仍然使用 V3，请检查日志中是否有：

```
[PancakeSwap] ⚠️ 检测到强制 V3 模式，跳过 V2
```

如果看到这条日志，说明系统检测到了强制 V3 模式。请联系开发者排查原因。

## 预防措施

为了避免将来出现类似问题，建议：

1. 定期清除浏览器缓存
2. 每次更新扩展后重新加载
3. 关注控制台日志，及时发现异常

## 技术说明

路由缓存（tokenTradeHints）存储在内存中，包含以下信息：
- `forcedMode`: 强制使用的路由模式（'v2' | 'v3' | undefined）
- `lastMode`: 上次成功使用的路由模式
- `routerAddress`: 上次使用的路由器地址
- `lastBuyPath` / `lastSellPath`: 上次成功的交易路径

当 `forcedMode` 被设置时，系统会跳过路由比较，直接使用指定的模式。
