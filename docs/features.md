# 功能说明

本文档详细介绍 BSC 打狗棒插件的所有功能特性。

## 目录

- [核心功能](#核心功能)
- [钱包管理](#钱包管理)
- [交易功能](#交易功能)
- [支持的平台](#支持的平台)
- [高级特性](#高级特性)

## 核心功能

### 1. 多平台集成

BSC 打狗棒支持以下 Meme 代币交易平台：

#### Four.meme
- 直接与 Four.meme TokenManager 合约交互
- 支持原生代币买卖
- 实时价格查询
- 手续费优化

#### Flap.sh
- 支持 Flap Portal 合约交易
- 原生 BNB 和代币互换
- 自动路由选择

#### PancakeSwap
- PancakeSwap Router V2 集成
- 支持任意 BEP20 代币交易
- 自动路径查找
- 最优价格计算

#### Luna.fun（开发中）
- 即将支持 Luna.fun 平台

### 2. 页面注入功能

插件会在支持的网站上自动注入交易界面：

- **gmgn.ai**: 在代币详情页添加快捷交易按钮
- **four.meme**: 直接在代币页面集成买卖功能
- **flap.sh**: 增强交易体验
- **web3.binance.com**: 快速交易入口

## 钱包管理

### 私钥导入

```
支持格式: 0x + 64位十六进制字符
示例: 0x1234567890abcdef...
```

**安全特性**:
- 私钥通过 AES-256-GCM 加密存储
- 仅保存在浏览器本地存储
- 需要密码才能解密使用

### 钱包状态

插件支持三种钱包状态：

1. **未导入**: 需要导入私钥
2. **已锁定**: 需要输入密码解锁
3. **已解锁**: 可以进行交易

### 自动锁定

为了安全，插件会在以下情况自动锁定钱包：
- 插件刷新或重启
- 浏览器关闭
- 用户手动锁定

## 交易功能

### 买入代币

**支持的买入方式**:
- BNB 买入代币
- 自定义买入金额
- 百分比快捷按钮（10%, 25%, 50%, 100%）

**买入流程**:
1. 选择代币
2. 输入 BNB 数量
3. 设置滑点（默认 10%）
4. 确认交易
5. 等待区块链确认

### 卖出代币

**支持的卖出方式**:
- 代币换 BNB
- 按百分比卖出（25%, 50%, 75%, 100%）
- 自定义卖出数量

**卖出流程**:
1. 选择代币
2. 输入卖出数量或百分比
3. 确认交易
4. 等待确认

### 交易参数配置

#### Gas 设置
- **Gas Price**: 可自定义，默认 3 Gwei
- **Gas Limit**:
  - 买入: 300,000
  - 卖出: 350,000
  - Approve: 100,000

#### 滑点设置
- **默认滑点**: 10%
- **可调范围**: 0.1% - 50%
- **自动滑点保护**: 防止价格剧烈波动

#### 截止时间
- **默认**: 20 分钟
- **可自定义**: 1-60 分钟

### 交易监控

插件提供实时交易状态监控：

**监控方式**:
1. **WebSocket 连接**: 实时监听区块链事件
2. **HTTP 轮询**: WebSocket 失败时的降级方案
3. **智能重连**: 自动处理连接中断

**交易状态**:
- ⏳ 待确认
- ✅ 成功
- ❌ 失败
- ⚠️ 超时

## 支持的平台

### gmgn.ai

**URL 模式**: `https://gmgn.ai/*/token/*`

**注入功能**:
- 代币价格展示
- 快速买卖按钮
- 持仓信息

### Four.meme

**URL 模式**: `https://four.meme/token/*`

**注入功能**:
- 原生交易界面
- 实时价格
- K线图集成

### Flap.sh

**URL 模式**: `https://flap.sh/*`

**注入功能**:
- 交易增强
- 价格对比
- 交易历史

### Web3.binance.com

**URL 模式**: `https://web3.binance.com/*/token/*`

**注入功能**:
- 快捷交易
- 钱包集成

## 高级特性

### 1. 性能优化

**Promise 去重**:
- 避免重复的 RPC 请求
- 提高响应速度
- 减少网络负载

**智能缓存**:
- 代币信息缓存
- 价格数据缓存
- ABI 缓存

### 2. 错误处理

**自动重试机制**:
- RPC 请求失败自动重试
- 多节点切换
- 指数退避策略

**用户友好的错误提示**:
- 余额不足
- Gas 过低
- 滑点过大
- 合约执行失败

### 3. Debug 模式

开发者可以启用调试模式查看详细日志：

```javascript
// 在浏览器控制台执行
chrome.storage.local.set({ DEBUG_ENABLED: true })
```

**Debug 功能**:
- 详细的交易日志
- 性能分析
- 错误堆栈
- RPC 请求追踪

### 4. 侧边栏交易面板

支持 Chrome 114+ 的 Side Panel API：

**特性**:
- 不遮挡页面内容
- 独立的交易界面
- 多标签页共享
- 实时数据同步

<div align="center">
<img src="../docs/images/sidepanel-in-browser.png" alt="侧边栏交易面板" width="600"/>

*侧边栏在浏览器中的实际效果*
</div>

### 5. Offscreen Document

用于安全的加密操作：

**用途**:
- 私钥加密/解密
- 交易签名
- 隔离敏感操作

## 配置项

插件提供了完整的配置界面，支持自定义各种参数：

<div align="center">
<table>
  <tr>
    <td align="center">
      <img src="../docs/images/sidepanel-settings-trade-setting.png" alt="交易设置" width="280"/><br/>
      <b>交易参数配置</b>
    </td>
    <td align="center">
      <img src="../docs/images/sidepanel-settings-contract-settings.png" alt="合约设置" width="280"/><br/>
      <b>合约地址配置</b>
    </td>
  </tr>
</table>
</div>

### 网络配置

```typescript
NETWORK_CONFIG = {
  BSC_RPC: "https://bsc-dataseed.binance.org/",
  CHAIN_ID: 56,
  BLOCK_EXPLORER: "https://bscscan.com"
}
```

### 合约地址

```typescript
CONTRACTS = {
  WBNB: "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c",
  PANCAKE_ROUTER: "0x10ED43C718714eb63d5aA57B78B54704E256024E",
  FOUR_TOKEN_MANAGER: "0x...",
  FLAP_PORTAL: "0x..."
}
```

### 交易配置

```typescript
TX_CONFIG = {
  DEFAULT_GAS_PRICE: "3",
  BUY_GAS_LIMIT: "300000",
  SELL_GAS_LIMIT: "350000",
  DEFAULT_SLIPPAGE: 10,
  DEADLINE_MINUTES: 20
}
```

## 权限说明

插件需要以下权限：

- **storage**: 保存钱包和配置
- **notifications**: 交易通知
- **offscreen**: 安全加密操作
- **sidePanel**: 侧边栏界面
- **tabs**: 页面交互

**Host 权限**:
- gmgn.ai
- four.meme
- flap.sh
- web3.binance.com
- BSC RPC 节点

## 安全特性

### 1. 私钥保护

- ✅ AES-256-GCM 加密
- ✅ 密码派生 (PBKDF2)
- ✅ 仅本地存储
- ✅ 内存及时清除

### 2. 交易安全

- ✅ 交易前确认
- ✅ 滑点保护
- ✅ Gas 限制
- ✅ 合约白名单

### 3. 网络安全

- ✅ HTTPS 强制
- ✅ RPC 节点验证
- ✅ CSP 策略

## 性能指标

**典型交易时间**:
- 交易准备: < 500ms
- 交易发送: < 1s
- 区块确认: 3-5s

**资源使用**:
- 内存: < 50MB
- CPU: < 5%
- 网络: 最小化

## 限制与注意事项

1. **仅支持 BSC 主网**
2. **需要 BNB 作为 Gas**
3. **最小交易金额**: 取决于 Gas 费用
4. **滑点限制**: 建议不超过 20%
5. **合约白名单**: 仅支持已验证的合约

## 未来规划

- [ ] 多链支持 (Ethereum, Polygon)
- [ ] 硬件钱包集成
- [ ] 交易机器人
- [ ] 止盈止损
- [ ] 批量交易
- [ ] NFT 支持
