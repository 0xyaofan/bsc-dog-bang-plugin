// 最简单的清理缓存脚本
// 在浏览器控制台（Service Worker 或页面控制台）中执行

// 方法1: 重新加载插件（最简单，最彻底）
// 打开 chrome://extensions/ 点击刷新按钮

// 方法2: 清除路由缓存（在控制台执行）
(async () => {
  // 导入并清除旧缓存
  const { default: tokenRouteCache } = await import('./background/index.js');
  if (tokenRouteCache && tokenRouteCache.clear) {
    tokenRouteCache.clear();
  }

  // 清除新缓存
  const { routeCacheManager } = await import('./shared/token-route.js');
  routeCacheManager.clearAll();

  console.log('✓ 缓存已清除');
})();

// 方法3: 最简单的方式（推荐）
// 直接重新加载插件即可，所有缓存会在启动时自动清除
