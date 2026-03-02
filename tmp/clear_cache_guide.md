# 清理代币缓存指南

## 方法 1: 浏览器控制台（最简单）

### 步骤：

1. **打开 Chrome 扩展管理页面**
   - 地址栏输入：`chrome://extensions/`
   - 找到 "BSC Dog Bang Trade Plugin"
   - 点击 "Service Worker" 或 "检查视图"

2. **在控制台执行以下代码**

#### 清除特定代币的缓存（推荐）

```javascript
// 清除测试代币的缓存
const TOKEN = '0xe747e54783ba3f77a8e5251a3cba19ebe9c0e197';

// 方式1: 使用 SDK 清理（推荐）
chrome.runtime.sendMessage({
  action: 'clear_sdk_route_cache',
  data: { tokenAddress: TOKEN }
}, (response) => {
  console.log('SDK 缓存已清除:', response);
});

// 方式2: 使用插件内部清理
chrome.runtime.sendMessage({
  action: 'clear_plugin_route_cache',
  data: { tokenAddress: TOKEN }
}, (response) => {
  console.log('插件缓存已清除:', response);
});
```

#### 清除所有缓存

```javascript
// 清除所有路由缓存
chrome.runtime.sendMessage({
  action: 'clear_all_route_cache'
}, (response) => {
  console.log('所有缓存已清除:', response);
});
```

## 方法 2: 添加清理缓存的消息处理器

如果上述方法不工作，需要在插件中添加处理器。

### 修改 `src/background/index.ts`

在 `ACTION_HANDLER_MAP` 中添加（约第 2449 行）：

```typescript
const ACTION_HANDLER_MAP = {
  // ... 现有的处理器 ...
  get_cache_info: handleGetCacheInfo,

  // 新增：清理缓存处理器
  clear_sdk_route_cache: handleClearSDKRouteCache,
  clear_plugin_route_cache: handleClearPluginRouteCache,
  clear_all_route_cache: handleClearAllRouteCache,
};
```

在文件末尾添加处理函数：

```typescript
/**
 * 清除 SDK 路由缓存
 */
async function handleClearSDKRouteCache({ tokenAddress }: { tokenAddress?: string } = {}) {
  try {
    const { clearRouteCache } = await import('./sdk-trading-v2.js');
    clearRouteCache(tokenAddress);

    logger.info('[Cache] SDK 路由缓存已清除', { tokenAddress });

    return {
      success: true,
      message: tokenAddress
        ? `已清除代币 ${tokenAddress} 的 SDK 缓存`
        : '已清除所有 SDK 缓存'
    };
  } catch (error) {
    logger.error('[Cache] 清除 SDK 缓存失败', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

/**
 * 清除插件路由缓存
 */
async function handleClearPluginRouteCache({ tokenAddress }: { tokenAddress?: string } = {}) {
  try {
    const { clearRouteCache } = await import('../shared/token-route.js');
    clearRouteCache(tokenAddress);

    logger.info('[Cache] 插件路由缓存已清除', { tokenAddress });

    return {
      success: true,
      message: tokenAddress
        ? `已清除代币 ${tokenAddress} 的插件缓存`
        : '已清除所有插件缓存'
    };
  } catch (error) {
    logger.error('[Cache] 清除插件缓存失败', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

/**
 * 清除所有路由缓存
 */
async function handleClearAllRouteCache() {
  try {
    // 清除 SDK 缓存
    const { clearRouteCache: clearSDKCache } = await import('./sdk-trading-v2.js');
    clearSDKCache();

    // 清除插件缓存
    const { clearRouteCache: clearPluginCache } = await import('../shared/token-route.js');
    clearPluginCache();

    logger.info('[Cache] 所有路由缓存已清除');

    return {
      success: true,
      message: '已清除所有路由缓存（SDK + 插件）'
    };
  } catch (error) {
    logger.error('[Cache] 清除所有缓存失败', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}
```

## 方法 3: 直接在代码中调用（开发调试）

如果你在开发环境中，可以直接在代码中调用：

```typescript
// 在 src/background/index.ts 或其他文件中

// 清除 SDK 缓存
import { clearRouteCache as clearSDKCache } from './sdk-trading-v2.js';
clearSDKCache('0xe747e54783ba3f77a8e5251a3cba19ebe9c0e197');

// 清除插件缓存
import { clearRouteCache as clearPluginCache } from '../shared/token-route.js';
clearPluginCache('0xe747e54783ba3f77a8e5251a3cba19ebe9c0e197');
```

## 方法 4: 重新加载插件（最彻底）

如果需要完全清除所有缓存：

1. 打开 `chrome://extensions/`
2. 找到插件，点击刷新按钮 🔄
3. 或者关闭再重新启用插件

**注意**：这会清除所有缓存，包括钱包状态（需要重新解锁）

## 方法 5: 使用 Chrome DevTools

1. 打开插件的 Service Worker 控制台
2. 在 Sources 面板中找到缓存相关的代码
3. 设置断点并手动调用清理函数

## 验证缓存是否清除

清除缓存后，可以通过以下方式验证：

```javascript
// 查看缓存统计
chrome.runtime.sendMessage({
  action: 'get_cache_info'
}, (response) => {
  console.log('缓存信息:', response);
});
```

或者直接查看日志：

```javascript
// 查询路由时会显示是否使用缓存
chrome.runtime.sendMessage({
  action: 'get_token_route',
  data: { tokenAddress: '0xe747e54783ba3f77a8e5251a3cba19ebe9c0e197' }
}, (response) => {
  console.log('路由信息:', response);
  // 如果缓存已清除，会重新查询
});
```

## 自动清除缓存的场景

插件会在以下情况自动清除缓存：

1. **交易完成后**：清除相关代币的余额和授权缓存
2. **钱包切换后**：清除所有钱包相关缓存
3. **缓存过期**：路由缓存默认 30 秒过期

## 缓存类型说明

### 1. SDK 路由缓存
- **位置**：`@bsc-trading/manager` 内部
- **内容**：代币的路由信息（平台、通道、quoteToken 等）
- **TTL**：60 秒
- **清理方法**：`clearRouteCache(tokenAddress)`

### 2. 插件路由缓存
- **位置**：`src/shared/route-query/route-cache-manager.ts`
- **内容**：预加载的路由信息
- **TTL**：已迁移代币永久缓存，未迁移 1 分钟
- **清理方法**：`routeCacheManager.deleteRoute(tokenAddress)`

### 3. Pancake Pair 缓存
- **位置**：`src/shared/route-query/pancake-pair-finder.ts`
- **内容**：V2/V3 池子信息
- **TTL**：永久缓存
- **清理方法**：`pancakePairFinder.clearCache(tokenAddress)`

### 4. 代币信息缓存
- **位置**：`src/background/index.ts`
- **内容**：余额、授权、元数据
- **TTL**：各不相同
- **清理方法**：`invalidateWalletDerivedCaches(walletAddress, tokenAddress)`

## 快速清理脚本

保存以下脚本为书签，点击即可清理：

```javascript
javascript:(function(){
  const TOKEN = '0xe747e54783ba3f77a8e5251a3cba19ebe9c0e197';
  chrome.runtime.sendMessage({
    action: 'clear_all_route_cache'
  }, (r) => alert(r.success ? '缓存已清除' : '清除失败: ' + r.error));
})();
```

## 常见问题

### Q: 清除缓存后还是使用旧的路由？
A: 可能是浏览器缓存了 Service Worker。尝试：
1. 关闭所有相关标签页
2. 重新加载插件
3. 清除浏览器缓存

### Q: 如何确认缓存已清除？
A: 查看控制台日志，应该看到：
```
[RouteSelector] 开始选择路由
[RouteSelector] 没有找到缓存路由
```

### Q: 清除缓存会影响交易吗？
A: 不会。清除缓存只会导致下次查询时重新获取路由信息，不影响正在进行的交易。

## 测试当前代币

针对测试代币 `0xe747e54783ba3f77a8e5251a3cba19ebe9c0e197`：

```javascript
// 1. 清除缓存
chrome.runtime.sendMessage({
  action: 'clear_all_route_cache'
}, (r) => console.log('清除结果:', r));

// 2. 等待 1 秒

// 3. 重新查询路由
setTimeout(() => {
  chrome.runtime.sendMessage({
    action: 'get_token_route',
    data: { tokenAddress: '0xe747e54783ba3f77a8e5251a3cba19ebe9c0e197' }
  }, (r) => console.log('新路由:', r));
}, 1000);

// 4. 查看控制台日志，应该看到：
// [RouteSelector] quoteToken: 0x55d398326f99059ff775485246999027b3197955
// [RouteSelector] 生成路由选项 count: 8
```
