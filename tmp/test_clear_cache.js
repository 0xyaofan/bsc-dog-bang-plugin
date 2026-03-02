// 清理代币缓存并重新测试
// 在浏览器控制台中执行此脚本

const TOKEN = '0xe747e54783ba3f77a8e5251a3cba19ebe9c0e197';

console.log('=== 开始清理缓存测试 ===\n');

// 步骤 1: 清除所有缓存
console.log('[1/4] 清除所有路由缓存...');
chrome.runtime.sendMessage({
  action: 'clear_all_route_cache'
}, (response) => {
  console.log('✓ 清除结果:', response);

  if (response.success) {
    // 步骤 2: 等待 1 秒
    console.log('\n[2/4] 等待 1 秒...');
    setTimeout(() => {
      console.log('✓ 等待完成\n');

      // 步骤 3: 重新查询路由
      console.log('[3/4] 重新查询路由...');
      chrome.runtime.sendMessage({
        action: 'get_token_route',
        data: { tokenAddress: TOKEN }
      }, (routeResponse) => {
        console.log('✓ 路由查询结果:', routeResponse);

        if (routeResponse.success && routeResponse.route) {
          const route = routeResponse.route;
          console.log('\n路由详情:');
          console.log('  - 平台:', route.platform);
          console.log('  - 首选通道:', route.preferredChannel);
          console.log('  - Quote Token:', route.quoteToken);
          console.log('  - 准备好 Pancake:', route.readyForPancake);
          console.log('  - 元数据:', route.metadata);
        }

        // 步骤 4: 查看缓存信息
        console.log('\n[4/4] 查看缓存信息...');
        chrome.runtime.sendMessage({
          action: 'get_cache_info'
        }, (cacheResponse) => {
          console.log('✓ 缓存信息:', cacheResponse);
          console.log('\n=== 测试完成 ===');
          console.log('\n提示：');
          console.log('1. 查看上方的 "Quote Token" 字段，应该是 USDT 地址');
          console.log('2. 打开 Service Worker 控制台，查找 [RouteSelector] 日志');
          console.log('3. 应该看到 "quoteToken: 0x55d398326f99059ff775485246999027b3197955"');
          console.log('4. 应该看到 "生成路由选项 count: 8" (包含多跳路由)');
        });
      });
    }, 1000);
  }
});
