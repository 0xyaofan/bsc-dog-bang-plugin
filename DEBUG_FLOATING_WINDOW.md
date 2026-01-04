# 浮动窗口调试指南

## 问题现象
点击浮动窗口按钮时报错：`Could not establish connection. Receiving end does not exist.`

## 调试步骤

### 1. 重新加载插件
1. 打开 Chrome 浏览器，访问 `chrome://extensions/`
2. 找到 "BSC 打狗棒" 插件
3. 点击刷新按钮（🔄）重新加载插件

### 2. 访问支持的页面
浮动窗口仅在以下页面上可用：
- `https://gmgn.ai/*/token/*` (例如: https://gmgn.ai/sol/token/xxxx)
- `https://web3.binance.com/*/token/*`
- `https://four.meme/token/*` (例如: https://four.meme/token/xxxx)
- `https://flap.sh/*` (例如: https://flap.sh/xxxxx)

请确保访问的是代币详情页，而不是首页或其他页面。

### 3. 打开开发者工具检查日志
1. 在代币页面上，按 F12 打开开发者工具
2. 切换到 "Console" 标签
3. 查看是否有以下日志：
   ```
   [Dog Bang] Content script loaded on: https://xxxxx
   ```

**如果没有这条日志**：说明 content script 没有注入到页面
- 检查当前页面 URL 是否匹配上述支持的模式
- 重新加载插件（步骤1）
- 刷新当前页面（F5）

**如果有这条日志**：说明 content script 已正确加载，继续下一步

### 4. 测试发送消息
1. 打开插件 Popup（点击浏览器工具栏的插件图标）
2. 在 Popup 的开发者工具中检查日志（右键 Popup → 检查）
3. 点击 "🚀 浮动窗口" 按钮
4. 查看两个地方的日志：

**在 Popup 的 Console 中**：
```
[Popup] 浮动窗口支持检测: https://xxxxx supported: true
[Popup] 当前标签页: {id: xxx, url: "https://xxxxx", ...}
[Popup] 发送消息到 tab: xxx URL: https://xxxxx
```

**在页面的 Console 中**：
```
[Dog Bang] Received message: open_floating_window {action: "open_floating_window"}
```

### 5. 常见问题

#### 问题1: 页面日志中没有 "Content script loaded"
**原因**: content script 没有注入
**解决**:
- 确认访问的是支持的页面（见步骤2）
- 重新加载插件
- 刷新页面

#### 问题2: Popup 日志显示 `supported: false`
**原因**: 当前页面不在支持列表中
**解决**:
- 检查页面 URL 是否匹配支持的模式
- 必须是代币详情页，不能是首页或列表页

#### 问题3: 页面有 "Content script loaded" 但没有 "Received message"
**原因**: 消息发送到了错误的 tab，或者监听器没有正确注册
**解决**:
- 查看 Popup 日志中的 tab.id 和 tab.url 是否正确
- 重新加载插件
- 刷新页面

## 测试 URL 示例

可以使用以下 URL 进行测试（需要替换实际的 token 地址）：

```
https://four.meme/token/0xYourTokenAddress
https://flap.sh/0xYourTokenAddress
https://gmgn.ai/bsc/token/0xYourTokenAddress
```

## 开发者备注

已添加的调试日志位置：
1. `src/content/index.ts:2587` - Content script 加载确认
2. `src/content/index.ts:2360` - 消息接收确认
3. `src/popup/App.tsx:151` - 页面支持检测
4. `src/popup/App.tsx:290,297` - 消息发送日志
