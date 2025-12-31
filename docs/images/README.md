# 项目截图说明

本目录包含 BSC Dog Bang Plugin 的界面截图，用于文档展示。

## 截图清单

### Popup 界面截图

#### 1. popup-import-wallet-private-key.png
- **用途**: 展示钱包导入界面
- **使用位置**:
  - `docs/user-guide.md` - 首次配置部分
- **说明**: 用户首次使用时导入私钥的界面
- **尺寸**: 建议 350-400px 宽度

#### 2. popup-wallet-locked.png
- **用途**: 展示钱包锁定状态
- **使用位置**:
  - `docs/user-guide.md` - 锁定和解锁钱包部分
- **说明**: 钱包锁定后需要输入密码解锁的界面
- **尺寸**: 建议 350-400px 宽度

#### 3. popup-wallet-info.png
- **用途**: 展示钱包信息界面
- **使用位置**:
  - `README.md` - 界面预览部分
  - `docs/user-guide.md` - 首次配置验证部分
- **说明**: 钱包解锁后显示地址和余额的主界面
- **尺寸**: 建议 300-350px 宽度（README表格），350-400px（使用手册）

### Sidepanel 侧边栏截图

#### 4. sidepanel-in-browser.png
- **用途**: 展示侧边栏在浏览器中的实际效果
- **使用位置**:
  - `README.md` - 界面预览（主要展示图）
  - `docs/user-guide.md` - 了解界面部分
  - `docs/features.md` - 侧边栏交易面板功能说明
- **说明**: 完整的浏览器界面，展示侧边栏与页面内容并存
- **尺寸**: 700-800px 宽度（README），600-700px（其他文档）

#### 5. sidepanel-trade.png
- **用途**: 展示侧边栏交易界面细节
- **使用位置**:
  - `README.md` - 核心界面展示
  - `docs/user-guide.md` - 侧边栏交易面板部分
- **说明**: 侧边栏的买卖交易界面特写
- **尺寸**: 300-350px 宽度

### Sidepanel 设置截图

#### 6. sidepanel-settings-trade-setting.png
- **用途**: 展示交易参数配置
- **使用位置**:
  - `docs/user-guide.md` - 高级设置部分
  - `docs/features.md` - 配置项部分
- **说明**: Gas、滑点、截止时间等交易参数设置界面
- **尺寸**: 280-350px 宽度

#### 7. sidepanel-settings-chanel-setting.png
- **用途**: 展示交易通道配置
- **使用位置**:
  - `docs/user-guide.md` - 高级设置部分
- **说明**: Four.meme、Flap、PancakeSwap 等通道的启用/禁用设置
- **尺寸**: 280-350px 宽度

#### 8. sidepanel-settings-contract-settings.png
- **用途**: 展示合约地址配置
- **使用位置**:
  - `docs/user-guide.md` - 高级设置部分
  - `docs/features.md` - 配置项部分
- **说明**: 各个合约的地址配置界面
- **尺寸**: 280-350px 宽度

#### 9. sidepanel-settings-system-setting.png
- **用途**: 展示系统设置
- **使用位置**:
  - `docs/user-guide.md` - 高级设置部分
- **说明**: RPC节点、调试模式等系统级设置
- **尺寸**: 280-350px 宽度

## 截图规范

### 拍摄要求

1. **分辨率**: 建议使用 Retina 屏幕（2x）拍摄，确保清晰度
2. **窗口大小**:
   - Popup: 保持插件默认大小（约 400x600）
   - Sidepanel: 固定宽度约 400px
   - 浏览器全景: 1920x1080 或 1280x800
3. **背景**: 使用干净的背景，避免干扰信息
4. **内容**:
   - 使用测试数据，不要包含真实私钥
   - 钱包地址可以使用 `0x1234...5678` 格式
   - 余额使用合理的测试数值
5. **格式**: PNG 格式，支持透明背景

### 文件命名规范

```
{组件名}-{功能描述}.png

示例:
- popup-import-wallet.png
- sidepanel-trade.png
- sidepanel-settings-trade.png
```

### 压缩优化

建议使用以下工具压缩图片：
- [TinyPNG](https://tinypng.com/) - 在线压缩
- [ImageOptim](https://imageoptim.com/) - macOS 应用
- [Squoosh](https://squoosh.app/) - Google 在线工具

压缩后大小建议：
- Popup 截图: < 100KB
- Sidepanel 截图: < 150KB
- 浏览器全景: < 300KB

## 更新截图

### 何时需要更新

- UI 界面有重大改版
- 功能发生变化（新增/移除）
- 发现截图不清晰或有误导
- 版本更新时建议检查

### 更新流程

1. 拍摄新截图
2. 按规范命名和压缩
3. 替换旧文件（保持文件名不变）
4. 如果是新增截图，需要更新：
   - 本 README 文档
   - 相关的使用文档
5. 提交 PR 说明更新内容

## 文档中的使用示例

### Markdown 语法

```markdown
<!-- 单张图片 -->
<div align="center">
<img src="../docs/images/popup-wallet-info.png" alt="钱包信息" width="350"/>

*图片说明文字*
</div>

<!-- 表格布局（并排显示） -->
<table>
  <tr>
    <td align="center">
      <img src="docs/images/popup-wallet-info.png" alt="钱包信息" width="300"/><br/>
      <b>钱包管理</b>
    </td>
    <td align="center">
      <img src="docs/images/sidepanel-trade.png" alt="交易界面" width="300"/><br/>
      <b>交易面板</b>
    </td>
  </tr>
</table>
```

### 路径说明

- **README.md 中**: `docs/images/xxx.png`
- **docs/*.md 中**: `../docs/images/xxx.png`

## 维护清单

- [ ] 定期检查截图是否与最新版本匹配
- [ ] 压缩优化新添加的截图
- [ ] 更新本文档的截图说明
- [ ] 验证所有文档中的图片链接有效

## 联系方式

如有截图相关问题，请：
- 提交 Issue: https://github.com/0xyaofan/bsc-dog-bang-plugin/issues
- 标签: `documentation`, `enhancement`

---

Last updated: 2024-12-31
