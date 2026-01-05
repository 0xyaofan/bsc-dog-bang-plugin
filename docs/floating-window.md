# 浮动交易窗口使用说明

<div align="center">

![浮动交易窗口](docs/images/float-trade.png)

*极简高效的浮动交易窗口，支持拖拽、自动恢复位置*

</div>

---

## 概述

浮动交易窗口是 BSC 打狗棒插件的核心功能之一，它提供了一个极简、高效的交易界面，专为快速交易设计。

### 为什么需要浮动窗口？

- ✅ **不遮挡页面**：相比侧边栏，浮动窗口更加灵活，可以放置在屏幕任意位置
- ✅ **极简高效**：只显示交易必需功能，去除冗余信息，操作更快速
- ✅ **跨页面持久**：在网站内导航或切换代币时，浮动窗口保持打开
- ✅ **位置记忆**：刷新页面后自动恢复到上次的位置和状态
- ✅ **流畅拖拽**：使用 GPU 加速的拖拽技术，丝滑流畅

## 打开浮动窗口

### 方法一：通过插件 Popup

1. 点击浏览器工具栏的插件图标
2. 确保钱包已解锁
3. 点击"交易浮窗"按钮

**支持的页面**：
- `https://gmgn.ai/*/token/*` - GMGN 代币页面
- `https://web3.binance.com/*/token/*` - Binance Web3 代币页面
- `https://four.meme/token/*` - Four.meme 代币页面
- `https://flap.sh/*` - Flap.sh 页面

### 方法二：通过代码调用

```javascript
// 自动检测当前页面的代币地址
createFloatingTradingWindow();

// 或指定代币地址
createFloatingTradingWindow('0x1234...');
```

## 功能特性

浮动交易窗口是一个极简、高效的交易界面，专为快速交易设计。

### 主要特点

1. **极简设计**
   - 紧凑的窗口尺寸（220px 宽度）
   - 只显示必要的交易按钮和设置
   - 不显示钱包状态等冗余信息

2. **高效操作**
   - 一键买入/卖出（使用预设固定值）
   - 点击按钮直接触发交易，无需额外确认
   - 可拖拽到屏幕任意位置

3. **智能状态管理**
   - 窗口位置自动记忆（localStorage）
   - 设置折叠状态自动保存
   - 刷新页面后自动恢复位置和状态
   - 关闭窗口记录状态，下次不会自动打开

4. **可折叠设置区**
   - 滑点和 Gas 设置默认收起
   - 点击"设置"按钮展开/收起
   - 减少屏幕占用空间

5. **性能优化**
   - 使用 `transform` + GPU 加速实现丝滑拖拽
   - `requestAnimationFrame` 确保 60fps 流畅度
   - Pointer Events API 支持触控设备

## 窗口结构

```
┌─────────────────────┐
│       ⋯          ✕  │ ← 顶栏（拖拽手柄居中 + 关闭按钮）
├─────────────────────┤
│ 买入 (BNB)          │
│ [0.02] [0.05] ...   │ ← 买入按钮（固定值）
│                     │
│ 卖出 (%)            │
│ [25%] [50%] ...     │ ← 卖出按钮（固定值）
│                     │
│ ▼ 设置              │ ← 折叠/展开按钮
├─────────────────────┤
│ 滑点 (%)：          │
│ [10%] [50%] [输入]  │ ← 设置区（可折叠）
│                     │
│ Buy Gas：           │
│ [0.05] [1] [输入]   │
│                     │
│ Sell Gas：          │
│ [0.05] [1] [输入]   │
└─────────────────────┘
```

## 使用方法

### 交易流程

1. **买入交易**
   - 点击任意买入按钮（如"0.05"）
   - 按钮显示"..."表示交易进行中
   - 交易完成后按钮恢复原状

2. **卖出交易**
   - 点击任意卖出按钮（如"50%"）
   - 按钮显示"..."表示交易进行中
   - 交易完成后按钮恢复原状

3. **调整设置**
   - 点击"设置"按钮展开设置区
   - 点击预设按钮或手动输入数值
   - 设置即时生效，下次交易使用新设置

### 窗口操作

1. **拖拽移动**
   - 鼠标移到顶栏"⋯"区域（横向拖拽图标）
   - 按住鼠标左键拖动（支持触控设备）
   - 松开鼠标完成移动
   - 位置自动保存到 localStorage
   - 窗口自动保持在视口内，不会超出边界

2. **关闭窗口**
   - 点击右上角"✕"按钮
   - 关闭状态会被记录，刷新页面后不会自动恢复

3. **折叠/展开设置**
   - 点击"设置"按钮切换展开/收起状态
   - 状态自动保存

4. **刷新页面后**
   - 如果窗口之前是打开的，会自动恢复
   - 恢复到上次的位置和折叠状态
   - 如果窗口之前已关闭，则不会自动打开

5. **切换页面**
   - 在同一网站内导航，窗口保持打开
   - 切换到不同代币页面，窗口继续存在
   - 可以随时通过 Popup 打开/关闭窗口

## 技术实现

### 状态持久化

窗口使用 `localStorage` 保存以下状态：

```typescript
type FloatingWindowState = {
  position: { x: number; y: number };  // 窗口位置
  collapsed: boolean;                   // 设置区折叠状态
  opened: boolean;                      // 窗口是否打开（用于刷新恢复）
}
```

**存储键名**：`dogBangFloatingWindow`

**状态管理逻辑**：
- 打开窗口时：`opened = true`
- 关闭窗口时：`opened = false`
- 插件重新加载时：`opened = false`（避免异常恢复）
- 页面加载时：检查 `opened` 状态，自动恢复窗口

### 性能优化

**拖拽优化**：
```typescript
// 使用 transform 代替 left/top，利用 GPU 加速
floatingWindow.style.transform = `translate(${x}px, ${y}px)`;

// 使用 requestAnimationFrame 批处理更新
requestAnimationFrame(() => {
  floatingWindow.style.transform = `translate(${newX}px, ${newY}px)`;
});

// Pointer Events API 支持触控设备
dragHandle.addEventListener('pointerdown', (e) => {
  dragHandle.setPointerCapture(e.pointerId);
});
```

**CSS 优化**：
```css
.dog-bang-floating-window {
  will-change: transform;  /* 提示浏览器优化 */
}

.dog-bang-floating-window.dragging {
  transition: none;  /* 拖拽时禁用过渡 */
}
```

### 样式类名

- `.dog-bang-floating-window` - 窗口容器
- `.floating-header` - 顶栏
- `.floating-drag-handle` - 拖拽手柄
- `.floating-close-btn` - 关闭按钮
- `.floating-trade-section` - 交易区
- `.floating-quick-btn` - 买入/卖出按钮
- `.floating-settings-section` - 设置区
- `.floating-toggle-btn` - 折叠/展开按钮

### 交易接口

浮动窗口与侧边栏共用相同的后端交易机制，通过 `safeSendMessage` 与 background 通信：

```javascript
// 买入
await safeSendMessage({
  action: 'buy_token',
  data: {
    tokenAddress,
    amount,
    slippage,
    gasPrice,
    channel,
    forceChannel
  }
});

// 卖出
await safeSendMessage({
  action: 'sell_token',
  data: {
    tokenAddress,
    percent,
    slippage,
    gasPrice,
    channel,
    forceChannel,
    tokenInfo
  }
});
```

**共享特性**：
- 使用侧边栏相同的交易通道（PancakeSwap、Four.meme 等）
- 共享滑点和 Gas 设置
- 共享 `userChannelOverride` 状态（用户手动选择通道）
- 统一的错误处理和交易状态通知

## 设计理念

浮动窗口专注于以下设计目标：

1. **极简** - 移除所有非必要元素，只保留交易核心功能
2. **高效** - 一键交易，减少操作步骤
3. **灵活** - 可拖拽，可收起设置，适应不同使用场景
4. **智能** - 记忆位置和状态，提供一致的使用体验

## 与 Side Panel 的区别

| 特性 | 浮动窗口 | Side Panel |
|------|---------|-----------|
| 位置 | 可拖拽到任意位置 | 固定在浏览器侧边栏 |
| 大小 | 紧凑（220px） | 较大（360px） |
| 信息显示 | 只显示交易按钮 | 显示完整信息（余额、状态等） |
| 交易方式 | 一键触发 | 需要点击买入/卖出按钮 |
| 设置区 | 可折叠 | 始终展开 |
| 适用场景 | 快速交易 | 详细交易管理 |

## 样式自定义

可以通过修改 `extension/styles.css` 中的以下变量来自定义样式：

```css
/* 窗口尺寸 */
.dog-bang-floating-window {
  width: 220px;  /* 调整窗口宽度 */
}

/* 按钮颜色 */
.floating-quick-btn {
  background: linear-gradient(135deg, #3b82f6 0%, #2563eb 100%);
}

/* 买入按钮颜色 */
.floating-quick-btn[data-action="buy"] { ... }

/* 卖出按钮颜色 */
.floating-quick-btn[data-action="sell"] { ... }
```

## 浏览器兼容性

- Chrome/Edge 88+
- Firefox 78+
- Safari 14+

## 注意事项

1. 浮动窗口使用 `z-index: 999999` 确保始终在最上层
2. 窗口拖拽有边界限制，防止拖出屏幕
3. 交易按钮在交易进行中会自动禁用，防止重复点击
4. 设置区折叠状态会在每次切换后立即保存
