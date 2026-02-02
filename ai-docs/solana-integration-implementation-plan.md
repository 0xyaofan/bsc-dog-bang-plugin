# Solana 集成开发计划

> **项目**: BSC 打狗棒 - 多链支持
> **版本**: v2.0.0
> **创建时间**: 2025-01-09
> **预计工期**: 8-10 周

---

## 📋 目录

1. [需求分析](#需求分析)
2. [技术方案](#技术方案)
3. [详细开发计划](#详细开发计划)
4. [任务分解](#任务分解)
5. [里程碑定义](#里程碑定义)
6. [风险管理](#风险管理)

---

## 需求分析

### 核心需求

#### 1️⃣ 自动链识别和切换

**需求描述**:
- 用户访问代币页面时，插件自动识别该代币属于哪条链（BSC 或 Solana）
- 自动识别交易平台（PancakeSwap, Four.meme, Jupiter, Raydium 等）
- 自动切换到对应的链和 DEX
- 用户无需手动选择链

**实现要点**:
- URL 模式匹配
- 合约地址格式识别
- 交易平台特征检测
- 自动钱包切换

#### 2️⃣ 双钱包管理

**需求描述**:
- 用户可以分别导入一个 BSC 钱包和一个 Solana 钱包
- 支持独立的私钥/助记词导入
- 切换到某链时，如果未导入该链钱包，显示导入提示
- 两个钱包独立加密存储

**实现要点**:
- 钱包状态管理：`{ bsc?: Wallet, solana?: Wallet }`
- 钱包导入流程分离
- 钱包锁定/解锁分离
- 导入提示 UI

#### 3️⃣ 配置界面优化

**需求描述**:
- 系统配置需要支持 Solana RPC 节点配置
- 其他 Solana 特定配置（从专业角度建议）
- 配置界面需要清晰区分 BSC 和 Solana 设置

**Solana 配置项（专业建议）**:

| 配置项 | 说明 | 默认值 | 重要性 |
|--------|------|--------|--------|
| **RPC 节点** | 主节点 + 备用节点列表 | Mainnet-beta | ⭐⭐⭐⭐⭐ |
| **Commitment Level** | 交易确认级别 | `confirmed` | ⭐⭐⭐⭐ |
| **Priority Fee** | 默认优先费 | 0 Lamports | ⭐⭐⭐⭐ |
| **Compute Unit Limit** | 计算单元上限 | Auto | ⭐⭐⭐ |
| **Skip Preflight** | 跳过预检查（加速） | false | ⭐⭐⭐ |
| **Max Retries** | 最大重试次数 | 3 | ⭐⭐⭐ |
| **WebSocket** | 实时数据订阅 | 启用 | ⭐⭐ |
| **Jito MEV** | MEV 保护（高级） | 禁用 | ⭐⭐ |

---

## 技术方案

### 方案 1: 自动链识别

#### 1.1 URL 模式识别

```typescript
// src/shared/chain-detector.ts

type ChainDetectionResult = {
  chain: ChainType;
  platform: string;
  confidence: number; // 0-1
};

const CHAIN_PATTERNS = {
  bsc: [
    {
      pattern: /gmgn\.ai\/.*\/token\/0x[a-fA-F0-9]{40}/,
      platform: 'gmgn',
      confidence: 1.0
    },
    {
      pattern: /web3\.binance\.com\/.*\/token\/0x[a-fA-F0-9]{40}/,
      platform: 'binance',
      confidence: 1.0
    },
    {
      pattern: /four\.meme\/token\/0x[a-fA-F0-9]{40}/,
      platform: 'four',
      confidence: 1.0
    },
    {
      pattern: /flap\.sh\/.*/,
      platform: 'flap',
      confidence: 0.9
    }
  ],
  solana: [
    {
      pattern: /gmgn\.ai\/sol\/token\/[1-9A-HJ-NP-Za-km-z]{32,44}/,
      platform: 'gmgn',
      confidence: 1.0
    },
    {
      pattern: /pump\.fun\/[1-9A-HJ-NP-Za-km-z]{32,44}/,
      platform: 'pumpfun',
      confidence: 1.0
    },
    {
      pattern: /raydium\.io\/.*\/[1-9A-HJ-NP-Za-km-z]{32,44}/,
      platform: 'raydium',
      confidence: 1.0
    },
    {
      pattern: /jup\.ag\/.*\/[1-9A-HJ-NP-Za-km-z]{32,44}/,
      platform: 'jupiter',
      confidence: 1.0
    }
  ]
};

export function detectChainFromUrl(url: string): ChainDetectionResult | null {
  // 遍历所有链的模式
  for (const [chain, patterns] of Object.entries(CHAIN_PATTERNS)) {
    for (const { pattern, platform, confidence } of patterns) {
      if (pattern.test(url)) {
        return {
          chain: chain as ChainType,
          platform,
          confidence
        };
      }
    }
  }

  return null;
}
```

#### 1.2 合约地址识别

```typescript
// src/shared/chain-detector.ts

export function detectChainFromAddress(address: string): ChainType | null {
  // EVM 地址格式: 0x + 40 hex chars
  if (/^0x[a-fA-F0-9]{40}$/.test(address)) {
    return 'bsc';
  }

  // Solana 地址格式: Base58, 32-44 chars
  if (/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address)) {
    try {
      // 验证是否为有效的 Solana 公钥
      new PublicKey(address);
      return 'solana';
    } catch {
      return null;
    }
  }

  return null;
}
```

#### 1.3 页面内容检测

```typescript
// src/content/index.ts

async function detectChainFromPage(): Promise<ChainDetectionResult | null> {
  // 1. 先尝试 URL 检测
  const urlResult = detectChainFromUrl(window.location.href);
  if (urlResult && urlResult.confidence >= 0.9) {
    return urlResult;
  }

  // 2. 提取页面中的合约地址
  const addresses = extractAddressesFromPage();

  for (const address of addresses) {
    const chain = detectChainFromAddress(address);
    if (chain) {
      return {
        chain,
        platform: 'unknown',
        confidence: 0.7
      };
    }
  }

  // 3. 检测页面特征（DOM 结构、特定文本等）
  const pageFeatures = analyzePageFeatures();
  if (pageFeatures.chain) {
    return pageFeatures;
  }

  return null;
}

function extractAddressesFromPage(): string[] {
  const addresses: string[] = [];

  // 从 DOM 中提取地址
  const textContent = document.body.innerText;

  // EVM 地址
  const evmMatches = textContent.match(/0x[a-fA-F0-9]{40}/g);
  if (evmMatches) {
    addresses.push(...evmMatches);
  }

  // Solana 地址
  const solanaMatches = textContent.match(/[1-9A-HJ-NP-Za-km-z]{32,44}/g);
  if (solanaMatches) {
    addresses.push(...solanaMatches);
  }

  return addresses;
}
```

#### 1.4 自动切换逻辑

```typescript
// src/background/chain-manager.ts

export class ChainManager {
  private currentChain: ChainType = 'bsc';
  private walletManager: WalletManager;

  async switchChain(
    newChain: ChainType,
    options: { auto?: boolean } = {}
  ): Promise<boolean> {
    // 1. 检查是否已导入该链钱包
    const hasWallet = this.walletManager.hasWallet(newChain);

    if (!hasWallet) {
      // 发送消息到 UI，显示导入提示
      chrome.runtime.sendMessage({
        action: 'show_wallet_import_prompt',
        data: { chain: newChain }
      });
      return false;
    }

    // 2. 切换链
    this.currentChain = newChain;

    // 3. 通知所有相关组件
    chrome.runtime.sendMessage({
      action: 'chain_switched',
      data: {
        chain: newChain,
        auto: options.auto || false
      }
    });

    // 4. 更新 UI 状态
    await this.updateUIState(newChain);

    return true;
  }

  private async updateUIState(chain: ChainType) {
    // 获取该链的钱包地址和余额
    const wallet = this.walletManager.getWallet(chain);
    if (!wallet) return;

    const adapter = getChainAdapter(chain);
    const balance = await adapter.getBalance(wallet.address);

    // 更新存储
    await chrome.storage.local.set({
      currentChain: chain,
      currentAddress: wallet.address,
      currentBalance: balance
    });
  }
}
```

---

### 方案 2: 双钱包管理

#### 2.1 钱包数据结构

```typescript
// src/shared/wallet-types.ts

export type WalletState = {
  bsc?: BscWallet;
  solana?: SolanaWallet;
};

export type BscWallet = {
  address: string;
  encrypted: string; // AES 加密的私钥
  createdAt: number;
  lastUsed: number;
};

export type SolanaWallet = {
  publicKey: string;
  encrypted: string; // AES 加密的 secret key
  createdAt: number;
  lastUsed: number;
};

export type WalletStatus = {
  chain: ChainType;
  imported: boolean;
  locked: boolean;
  address?: string;
};
```

#### 2.2 钱包管理器

```typescript
// src/background/wallet-manager.ts

export class WalletManager {
  private wallets: WalletState = {};
  private unlockedKeys: Map<ChainType, any> = new Map();

  /**
   * 导入 BSC 钱包
   */
  async importBscWallet(privateKey: string, password: string): Promise<string> {
    // 1. 验证私钥格式
    if (!/^0x[a-fA-F0-9]{64}$/.test(privateKey)) {
      throw new Error('Invalid BSC private key format');
    }

    // 2. 派生地址
    const account = privateKeyToAccount(privateKey as `0x${string}`);
    const address = account.address;

    // 3. 加密私钥
    const encrypted = await this.encrypt(privateKey, password);

    // 4. 保存
    this.wallets.bsc = {
      address,
      encrypted,
      createdAt: Date.now(),
      lastUsed: Date.now()
    };

    await this.saveWallets();

    return address;
  }

  /**
   * 导入 Solana 钱包
   */
  async importSolanaWallet(
    secretKeyOrMnemonic: string,
    password: string
  ): Promise<string> {
    let keypair: Keypair;

    // 1. 判断输入格式
    if (secretKeyOrMnemonic.includes(' ')) {
      // 助记词
      const seed = await mnemonicToSeed(secretKeyOrMnemonic);
      const derivedSeed = derivePath("m/44'/501'/0'/0'", seed.toString('hex')).key;
      keypair = Keypair.fromSeed(derivedSeed);
    } else {
      // Base58 私钥
      try {
        const secretKey = bs58.decode(secretKeyOrMnemonic);
        keypair = Keypair.fromSecretKey(secretKey);
      } catch {
        throw new Error('Invalid Solana secret key or mnemonic');
      }
    }

    // 2. 获取公钥
    const publicKey = keypair.publicKey.toBase58();

    // 3. 加密私钥
    const secretKeyBase58 = bs58.encode(keypair.secretKey);
    const encrypted = await this.encrypt(secretKeyBase58, password);

    // 4. 保存
    this.wallets.solana = {
      publicKey,
      encrypted,
      createdAt: Date.now(),
      lastUsed: Date.now()
    };

    await this.saveWallets();

    return publicKey;
  }

  /**
   * 解锁钱包
   */
  async unlockWallet(chain: ChainType, password: string): Promise<boolean> {
    const wallet = this.wallets[chain];
    if (!wallet) {
      throw new Error(`${chain} wallet not imported`);
    }

    try {
      // 解密私钥
      const decrypted = await this.decrypt(wallet.encrypted, password);

      // 验证并保存到内存
      if (chain === 'bsc') {
        const account = privateKeyToAccount(decrypted as `0x${string}`);
        this.unlockedKeys.set(chain, account);
      } else if (chain === 'solana') {
        const secretKey = bs58.decode(decrypted);
        const keypair = Keypair.fromSecretKey(secretKey);
        this.unlockedKeys.set(chain, keypair);
      }

      return true;
    } catch (error) {
      throw new Error('Invalid password');
    }
  }

  /**
   * 锁定钱包
   */
  lockWallet(chain: ChainType): void {
    this.unlockedKeys.delete(chain);
  }

  /**
   * 检查是否已导入钱包
   */
  hasWallet(chain: ChainType): boolean {
    return !!this.wallets[chain];
  }

  /**
   * 检查钱包是否已解锁
   */
  isUnlocked(chain: ChainType): boolean {
    return this.unlockedKeys.has(chain);
  }

  /**
   * 获取钱包状态
   */
  getWalletStatus(chain: ChainType): WalletStatus {
    const wallet = this.wallets[chain];
    return {
      chain,
      imported: !!wallet,
      locked: !this.isUnlocked(chain),
      address: wallet?.address || wallet?.publicKey
    };
  }

  /**
   * 获取所有钱包状态
   */
  getAllWalletStatus(): Record<ChainType, WalletStatus> {
    return {
      bsc: this.getWalletStatus('bsc'),
      solana: this.getWalletStatus('solana')
    };
  }

  // 私有方法
  private async encrypt(data: string, password: string): Promise<string> {
    // 使用 AES-256-GCM 加密
    const key = await this.deriveKey(password);
    // ... 加密实现
  }

  private async decrypt(encrypted: string, password: string): Promise<string> {
    const key = await this.deriveKey(password);
    // ... 解密实现
  }

  private async saveWallets(): Promise<void> {
    await chrome.storage.local.set({
      wallets: this.wallets
    });
  }
}
```

#### 2.3 导入提示 UI

```tsx
// src/ui/components/WalletImportPrompt.tsx

export function WalletImportPrompt({
  chain,
  onImport,
  onCancel
}: {
  chain: ChainType;
  onImport: () => void;
  onCancel: () => void;
}) {
  const chainName = chain === 'bsc' ? 'BSC' : 'Solana';

  return (
    <div className="wallet-import-prompt">
      <div className="prompt-icon">
        <ChainIcon chain={chain} size="large" />
      </div>

      <h3>需要导入 {chainName} 钱包</h3>

      <p>
        当前页面的代币在 {chainName} 链上，
        但您还没有导入 {chainName} 钱包。
      </p>

      <div className="prompt-actions">
        <button className="btn-secondary" onClick={onCancel}>
          取消
        </button>
        <button className="btn-primary" onClick={onImport}>
          立即导入
        </button>
      </div>
    </div>
  );
}
```

---

### 方案 3: Solana 配置管理

#### 3.1 配置类型定义

```typescript
// src/shared/solana-config-types.ts

export type SolanaSystemSettings = {
  // RPC 节点配置
  rpc: {
    primaryNode: string;
    fallbackNodes: string[];
    timeout: number;
    maxRetries: number;
  };

  // 交易配置
  transaction: {
    commitment: 'processed' | 'confirmed' | 'finalized';
    skipPreflight: boolean;
    maxRetries: number;
    preflightCommitment: 'processed' | 'confirmed' | 'finalized';
  };

  // 费用配置
  fee: {
    defaultPriorityFee: number; // Lamports
    priorityFeePresets: {
      none: number;
      low: number;
      medium: number;
      high: number;
      veryHigh: number;
    };
    computeUnitLimit: number | 'auto';
    computeUnitPrice: number; // micro-lamports
  };

  // WebSocket 配置
  websocket: {
    enabled: boolean;
    url: string;
    reconnectDelay: number;
    maxReconnectAttempts: number;
  };

  // 高级功能
  advanced: {
    enableJitoMev: boolean;
    jitoTipAccount?: string;
    jitoTipAmount?: number; // Lamports
    slippageBps: number; // 默认滑点 (basis points)
    enableVersionedTx: boolean; // 支持 Transaction v0
  };
};

export const DEFAULT_SOLANA_SETTINGS: SolanaSystemSettings = {
  rpc: {
    primaryNode: 'https://api.mainnet-beta.solana.com',
    fallbackNodes: [
      'https://solana-api.projectserum.com',
      'https://rpc.ankr.com/solana'
    ],
    timeout: 10000,
    maxRetries: 3
  },

  transaction: {
    commitment: 'confirmed',
    skipPreflight: false,
    maxRetries: 3,
    preflightCommitment: 'confirmed'
  },

  fee: {
    defaultPriorityFee: 0,
    priorityFeePresets: {
      none: 0,
      low: 10000,        // 0.00001 SOL
      medium: 50000,     // 0.00005 SOL
      high: 100000,      // 0.0001 SOL
      veryHigh: 500000   // 0.0005 SOL
    },
    computeUnitLimit: 'auto',
    computeUnitPrice: 1 // micro-lamports per CU
  },

  websocket: {
    enabled: true,
    url: 'wss://api.mainnet-beta.solana.com',
    reconnectDelay: 2000,
    maxReconnectAttempts: 5
  },

  advanced: {
    enableJitoMev: false,
    slippageBps: 50, // 0.5%
    enableVersionedTx: true
  }
};
```

#### 3.2 配置 UI

```tsx
// src/sidepanel/SolanaSettings.tsx

export function SolanaSettingsPanel() {
  const [settings, setSettings] = useState<SolanaSystemSettings>(
    DEFAULT_SOLANA_SETTINGS
  );

  return (
    <div className="settings-panel solana">
      <h2>Solana 系统配置</h2>

      {/* RPC 节点设置 */}
      <section className="settings-section">
        <h3>RPC 节点</h3>

        <div className="setting-field">
          <label>主节点</label>
          <input
            type="text"
            value={settings.rpc.primaryNode}
            onChange={(e) => updateSetting('rpc.primaryNode', e.target.value)}
            placeholder="https://api.mainnet-beta.solana.com"
          />
        </div>

        <div className="setting-field">
          <label>备用节点</label>
          <RpcNodeList
            nodes={settings.rpc.fallbackNodes}
            onChange={(nodes) => updateSetting('rpc.fallbackNodes', nodes)}
          />
        </div>

        <div className="setting-row">
          <div className="setting-field">
            <label>超时时间 (ms)</label>
            <input
              type="number"
              value={settings.rpc.timeout}
              onChange={(e) => updateSetting('rpc.timeout', parseInt(e.target.value))}
            />
          </div>

          <div className="setting-field">
            <label>最大重试次数</label>
            <input
              type="number"
              value={settings.rpc.maxRetries}
              onChange={(e) => updateSetting('rpc.maxRetries', parseInt(e.target.value))}
            />
          </div>
        </div>
      </section>

      {/* 交易设置 */}
      <section className="settings-section">
        <h3>交易配置</h3>

        <div className="setting-field">
          <label>确认级别</label>
          <select
            value={settings.transaction.commitment}
            onChange={(e) => updateSetting('transaction.commitment', e.target.value)}
          >
            <option value="processed">Processed (最快)</option>
            <option value="confirmed">Confirmed (推荐)</option>
            <option value="finalized">Finalized (最安全)</option>
          </select>
          <small className="hint">
            Processed: ~400ms | Confirmed: ~13s | Finalized: ~32s
          </small>
        </div>

        <div className="setting-field">
          <label>
            <input
              type="checkbox"
              checked={settings.transaction.skipPreflight}
              onChange={(e) => updateSetting('transaction.skipPreflight', e.target.checked)}
            />
            跳过预检查 (加速交易，但可能失败)
          </label>
        </div>
      </section>

      {/* 费用设置 */}
      <section className="settings-section">
        <h3>费用配置</h3>

        <div className="setting-field">
          <label>默认优先费</label>
          <div className="priority-fee-selector">
            {Object.entries(settings.fee.priorityFeePresets).map(([level, amount]) => (
              <button
                key={level}
                className={settings.fee.defaultPriorityFee === amount ? 'active' : ''}
                onClick={() => updateSetting('fee.defaultPriorityFee', amount)}
              >
                {level}
                <small>{(amount / 1e9).toFixed(6)} SOL</small>
              </button>
            ))}
          </div>
        </div>

        <div className="setting-field">
          <label>自定义优先费 (Lamports)</label>
          <input
            type="number"
            value={settings.fee.defaultPriorityFee}
            onChange={(e) => updateSetting('fee.defaultPriorityFee', parseInt(e.target.value))}
          />
          <small className="hint">
            1 SOL = 1,000,000,000 Lamports
          </small>
        </div>
      </section>

      {/* WebSocket 设置 */}
      <section className="settings-section">
        <h3>WebSocket 配置</h3>

        <div className="setting-field">
          <label>
            <input
              type="checkbox"
              checked={settings.websocket.enabled}
              onChange={(e) => updateSetting('websocket.enabled', e.target.checked)}
            />
            启用 WebSocket 实时数据
          </label>
        </div>

        {settings.websocket.enabled && (
          <div className="setting-field">
            <label>WebSocket URL</label>
            <input
              type="text"
              value={settings.websocket.url}
              onChange={(e) => updateSetting('websocket.url', e.target.value)}
            />
          </div>
        )}
      </section>

      {/* 高级设置 */}
      <section className="settings-section">
        <h3>高级功能</h3>

        <div className="setting-field">
          <label>
            <input
              type="checkbox"
              checked={settings.advanced.enableJitoMev}
              onChange={(e) => updateSetting('advanced.enableJitoMev', e.target.checked)}
            />
            启用 Jito MEV 保护
          </label>
          <small className="hint">
            通过 Jito 捆绑交易，防止被 MEV 套利（需要额外小费）
          </small>
        </div>

        {settings.advanced.enableJitoMev && (
          <>
            <div className="setting-field">
              <label>Jito Tip 金额 (Lamports)</label>
              <input
                type="number"
                value={settings.advanced.jitoTipAmount || 10000}
                onChange={(e) => updateSetting('advanced.jitoTipAmount', parseInt(e.target.value))}
              />
            </div>
          </>
        )}

        <div className="setting-field">
          <label>默认滑点 (%)</label>
          <input
            type="number"
            step="0.1"
            value={settings.advanced.slippageBps / 100}
            onChange={(e) => updateSetting('advanced.slippageBps', parseFloat(e.target.value) * 100)}
          />
        </div>
      </section>

      {/* 保存按钮 */}
      <div className="settings-actions">
        <button className="btn-secondary" onClick={resetToDefaults}>
          恢复默认
        </button>
        <button className="btn-primary" onClick={saveSettings}>
          保存配置
        </button>
      </div>
    </div>
  );
}
```

---

## 详细开发计划

### 总体时间线

```
Week 1-2:  基础架构搭建
Week 3-4:  双钱包管理实现
Week 5-6:  自动链识别和切换
Week 7:    Solana 配置系统
Week 8:    测试和优化
Week 9-10: Beta 测试和发布准备
```

---

### 阶段一: 基础架构搭建（Week 1-2）

#### Week 1: 类型定义和配置系统

**任务列表**:

- [ ] **Day 1-2**: 创建类型定义
  ```bash
  # 创建文件
  src/shared/chain-types.ts          # 链通用类型
  src/shared/wallet-types.ts         # 钱包类型
  src/shared/chain-detector.ts       # 链检测工具
  src/config/chains/solana.config.ts # Solana 配置
  ```

- [ ] **Day 2-3**: 实现配置系统
  ```typescript
  // src/shared/user-settings.ts 扩展
  export type UserSettings = {
    system: SystemSettings;
    trading: TradingSettings;
    chains: {
      bsc: BscChainSettings;
      solana: SolanaSystemSettings; // 新增
    };
    activeChain: ChainType;
    // ...
  };
  ```

- [ ] **Day 4-5**: 创建抽象层接口
  ```bash
  src/shared/chain-adapter.ts  # ChainAdapter 接口
  src/shared/dex-adapter.ts    # DexAdapter 接口
  src/shared/rpc-manager.ts    # RpcManager 接口
  ```

**验收标准**:
- ✅ 所有类型定义编译通过
- ✅ 配置系统可以读取和保存
- ✅ 接口定义清晰，有完整的 JSDoc

#### Week 2: EVM 代码重构

**任务列表**:

- [ ] **Day 1-2**: 创建 EVM 适配器
  ```bash
  mkdir -p src/chains/evm
  mv src/shared/viem-helper.ts src/chains/evm/

  # 创建新文件
  src/chains/evm/evm-adapter.ts
  src/chains/evm/evm-wallet.ts
  src/chains/evm/evm-rpc-manager.ts
  ```

- [ ] **Day 2-3**: 包装现有 BSC 逻辑到 EVM 适配器
  ```typescript
  export class EvmChainAdapter implements ChainAdapter {
    // 将现有的 publicClient, walletClient 逻辑移动到这里
    // 保持接口一致
  }
  ```

- [ ] **Day 4**: 重构 Background 使用适配器
  ```typescript
  // src/background/index.ts
  import { EvmChainAdapter } from '../chains/evm/evm-adapter';

  const bscAdapter = new EvmChainAdapter(BSC_CONFIG);
  ```

- [ ] **Day 5**: 回归测试
  - 测试 BSC 钱包导入
  - 测试 PancakeSwap 交易
  - 测试 Four.meme 交易
  - 测试 Flap 交易

**验收标准**:
- ✅ 所有 BSC 功能正常工作
- ✅ 代码结构清晰，适配器层独立
- ✅ 无 Breaking Changes

---

### 阶段二: 双钱包管理（Week 3-4）

#### Week 3: 钱包管理器实现

**任务列表**:

- [ ] **Day 1-2**: 实现 WalletManager
  ```typescript
  // src/background/wallet-manager.ts
  export class WalletManager {
    async importBscWallet(privateKey, password) { }
    async importSolanaWallet(secretKey, password) { }
    async unlockWallet(chain, password) { }
    lockWallet(chain) { }
    hasWallet(chain) { }
    isUnlocked(chain) { }
    getAllWalletStatus() { }
  }
  ```

- [ ] **Day 2-3**: 实现加密存储
  ```typescript
  // 使用 Web Crypto API
  private async encrypt(data: string, password: string) {
    // PBKDF2 派生密钥
    // AES-256-GCM 加密
  }

  private async decrypt(encrypted: string, password: string) {
    // 解密并验证
  }
  ```

- [ ] **Day 3-4**: 集成到 Background
  ```typescript
  // src/background/index.ts
  const walletManager = new WalletManager();

  // 处理消息
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.action === 'import_bsc_wallet') { }
    if (msg.action === 'import_solana_wallet') { }
    if (msg.action === 'unlock_wallet') { }
    // ...
  });
  ```

- [ ] **Day 5**: 单元测试
  - 测试钱包导入
  - 测试加密/解密
  - 测试钱包锁定/解锁

**验收标准**:
- ✅ 可以同时导入 BSC 和 Solana 钱包
- ✅ 钱包加密存储安全
- ✅ 钱包状态管理正确

#### Week 4: 钱包 UI 实现

**任务列表**:

- [ ] **Day 1-2**: Popup 钱包导入界面
  ```tsx
  // src/popup/WalletImport.tsx
  <TabSelector tabs={['BSC', 'Solana']} />

  {activeTab === 'bsc' && (
    <BscWalletImport onImport={handleImportBsc} />
  )}

  {activeTab === 'solana' && (
    <SolanaWalletImport onImport={handleImportSol} />
  )}
  ```

- [ ] **Day 2-3**: 钱包状态显示
  ```tsx
  // src/popup/WalletStatus.tsx
  <WalletCard chain="bsc" status={bscStatus} />
  <WalletCard chain="solana" status={solanaStatus} />
  ```

- [ ] **Day 3-4**: 导入提示弹窗
  ```tsx
  // src/ui/components/WalletImportPrompt.tsx
  <Modal show={showPrompt}>
    <WalletImportPrompt
      chain={requiredChain}
      onImport={() => navigate('/import')}
      onCancel={() => setShowPrompt(false)}
    />
  </Modal>
  ```

- [ ] **Day 5**: UI 测试和优化
  - 导入流程测试
  - 交互体验优化
  - 错误提示完善

**验收标准**:
- ✅ 用户可以方便地导入两个钱包
- ✅ 钱包状态显示清晰
- ✅ 导入提示友好

---

### 阶段三: 自动链识别和切换（Week 5-6）

#### Week 5: 链检测实现

**任务列表**:

- [ ] **Day 1-2**: 实现链检测逻辑
  ```typescript
  // src/shared/chain-detector.ts

  // URL 模式检测
  detectChainFromUrl(url: string): ChainDetectionResult

  // 地址格式检测
  detectChainFromAddress(address: string): ChainType

  // 页面内容检测
  detectChainFromPage(): ChainDetectionResult
  ```

- [ ] **Day 2-3**: Content Script 集成
  ```typescript
  // src/content/index.ts

  // 页面加载时检测
  const detection = await detectChainFromPage();

  if (detection) {
    // 发送消息到 Background
    chrome.runtime.sendMessage({
      action: 'chain_detected',
      data: detection
    });
  }
  ```

- [ ] **Day 3-4**: 实现 ChainManager
  ```typescript
  // src/background/chain-manager.ts
  export class ChainManager {
    async switchChain(chain: ChainType, options) {
      // 检查钱包
      // 切换适配器
      // 更新 UI
      // 发送通知
    }
  }
  ```

- [ ] **Day 5**: 测试和优化
  - 测试各种网站的检测准确性
  - 优化检测性能
  - 处理边缘情况

**验收标准**:
- ✅ 访问 BSC 代币页面自动识别为 BSC
- ✅ 访问 Solana 代币页面自动识别为 Solana
- ✅ 检测准确率 > 95%

#### Week 6: 自动切换和 UI 联动

**任务列表**:

- [ ] **Day 1-2**: Background 切换逻辑
  ```typescript
  chrome.runtime.onMessage.addListener(async (msg) => {
    if (msg.action === 'chain_detected') {
      const { chain } = msg.data;

      // 自动切换
      const success = await chainManager.switchChain(chain, {
        auto: true
      });

      if (!success) {
        // 显示导入提示
      }
    }
  });
  ```

- [ ] **Day 2-3**: UI 响应链切换
  ```typescript
  // src/sidepanel/main.tsx
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.action === 'chain_switched') {
      const { chain } = msg.data;

      // 更新当前链
      setCurrentChain(chain);

      // 刷新余额
      refreshBalance(chain);

      // 更新 DEX 列表
      updateDexList(chain);
    }
  });
  ```

- [ ] **Day 3-4**: 链切换动画和反馈
  ```tsx
  // 显示切换提示
  <Toast>
    <ChainIcon chain={newChain} />
    已切换到 {newChain === 'bsc' ? 'BSC' : 'Solana'}
  </Toast>
  ```

- [ ] **Day 5**: 端到端测试
  - 测试自动切换流程
  - 测试手动切换
  - 测试未导入钱包场景
  - 测试错误处理

**验收标准**:
- ✅ 访问代币页面时自动切换链
- ✅ UI 平滑响应链切换
- ✅ 未导入钱包时正确提示

---

### 阶段四: Solana 配置系统（Week 7）

#### Week 7: Solana 设置界面

**任务列表**:

- [ ] **Day 1-2**: 创建 Solana 设置类型和默认值
  ```typescript
  // src/shared/solana-config-types.ts
  export type SolanaSystemSettings = {
    rpc: { ... };
    transaction: { ... };
    fee: { ... };
    websocket: { ... };
    advanced: { ... };
  };
  ```

- [ ] **Day 2-4**: 实现设置界面
  ```tsx
  // src/sidepanel/SolanaSettings.tsx
  <SolanaSettingsPanel
    settings={solanaSettings}
    onChange={updateSettings}
    onSave={saveSettings}
  />
  ```

- [ ] **Day 4-5**: 集成到 UserSettings
  ```typescript
  // src/shared/user-settings.ts
  export type UserSettings = {
    // ...
    chains: {
      bsc: BscChainSettings;
      solana: SolanaSystemSettings;
    }
  };
  ```

**验收标准**:
- ✅ Solana 配置界面完整
- ✅ 配置可以正确保存和读取
- ✅ 重置到默认值功能正常

---

### 阶段五: Solana 基础功能（Week 8）

#### Week 8: Solana 适配器和 RPC

**任务列表**:

- [ ] **Day 1-2**: 安装依赖和创建基础结构
  ```bash
  npm install @solana/web3.js @solana/spl-token bs58

  mkdir -p src/chains/solana
  mkdir -p src/dex/solana
  ```

- [ ] **Day 2-3**: 实现 SolanaChainAdapter
  ```typescript
  // src/chains/solana/solana-adapter.ts
  export class SolanaChainAdapter implements ChainAdapter {
    async connect(rpcUrl: string) { }
    async getBalance(address: string) { }
    async sendTransaction(signedTx) { }
    async waitForConfirmation(txHash) { }
    // ...
  }
  ```

- [ ] **Day 3-4**: 实现 SolanaRpcManager
  ```typescript
  // src/chains/solana/solana-rpc-manager.ts
  export class SolanaRpcManager implements RpcManager {
    async request(method, params) { }
    async switchToNextNode() { }
    // ...
  }
  ```

- [ ] **Day 4-5**: 基础功能测试
  - 测试 Solana 钱包连接
  - 测试余额查询
  - 测试 SOL 转账
  - 测试 RPC 节点切换

**验收标准**:
- ✅ Solana 钱包可以正常导入
- ✅ 可以查询 SOL 和 SPL Token 余额
- ✅ 可以发送 SOL 转账
- ✅ RPC 节点管理正常

---

### 阶段六: 测试和优化（Week 9-10）

#### Week 9: 全面测试

**测试清单**:

**功能测试**:
- [ ] BSC 钱包导入/解锁/锁定
- [ ] Solana 钱包导入/解锁/锁定
- [ ] 双钱包同时管理
- [ ] 自动链检测（gmgn.ai BSC/Solana）
- [ ] 自动链切换
- [ ] 未导入钱包提示
- [ ] BSC DEX 交易（PancakeSwap, Four, Flap）
- [ ] Solana 基础转账
- [ ] 配置保存和读取
- [ ] RPC 节点切换

**安全测试**:
- [ ] 私钥加密强度
- [ ] 内存中私钥清理
- [ ] XSS 防护
- [ ] 输入验证

**性能测试**:
- [ ] 链检测速度
- [ ] 切换链响应时间
- [ ] RPC 请求延迟
- [ ] 内存占用

**兼容性测试**:
- [ ] Chrome 版本兼容性
- [ ] 不同网站兼容性
- [ ] 长时间运行稳定性

#### Week 10: Beta 测试和发布准备

**任务列表**:

- [ ] **Day 1-2**: 修复 Beta 测试发现的问题
- [ ] **Day 2-3**: 性能优化
  - RPC 请求缓存
  - 链检测去抖
  - UI 渲染优化
- [ ] **Day 3-4**: 文档编写
  - 用户使用指南
  - 开发者文档
  - 版本发布说明
- [ ] **Day 5**: 准备发布
  - 构建生产版本
  - 更新 manifest.json
  - 准备 release notes

**验收标准**:
- ✅ 所有测试通过
- ✅ 无严重 Bug
- ✅ 文档完整
- ✅ 准备好发布

---

## 任务分解

### 按优先级排序

#### P0 - 必须完成（核心功能）

1. **双钱包管理** - Week 3-4
   - 钱包导入（BSC + Solana）
   - 加密存储
   - 锁定/解锁

2. **自动链识别** - Week 5
   - URL 模式匹配
   - 地址格式识别
   - 页面内容检测

3. **自动链切换** - Week 6
   - ChainManager
   - 切换逻辑
   - UI 响应

4. **Solana 基础适配器** - Week 8
   - 连接和 RPC
   - 余额查询
   - 转账功能

#### P1 - 应该完成（重要功能）

1. **导入提示 UI** - Week 4
   - 未导入钱包提示
   - 导入引导流程

2. **Solana 配置系统** - Week 7
   - RPC 节点配置
   - 交易参数配置
   - 费用配置

3. **链切换动画** - Week 6
   - 切换提示
   - 平滑过渡

#### P2 - 可以完成（增强功能）

1. **Jito MEV 保护** - Week 10（如有时间）
2. **WebSocket 实时数据** - Week 10（如有时间）
3. **高级费用控制** - Week 10（如有时间）

---

## 里程碑定义

### Milestone 1: 基础架构完成（Week 2 末）
- ✅ 类型定义完整
- ✅ 配置系统可用
- ✅ EVM 代码重构完成
- ✅ BSC 功能回归测试通过
- **发布**: v1.3.0-alpha（内部测试）

### Milestone 2: 双钱包管理完成（Week 4 末）
- ✅ 可以导入 BSC 和 Solana 钱包
- ✅ 钱包状态显示正常
- ✅ 导入提示 UI 完成
- **发布**: v1.3.0-beta1（私有测试）

### Milestone 3: 自动切换完成（Week 6 末）
- ✅ 自动链识别正常
- ✅ 自动切换流程完整
- ✅ UI 联动正常
- **发布**: v1.3.0-beta2（小范围测试）

### Milestone 4: Solana 基础功能完成（Week 8 末）
- ✅ Solana 钱包可用
- ✅ Solana 配置系统完成
- ✅ Solana 基础转账正常
- **发布**: v1.3.0-rc1（候选版本）

### Milestone 5: 正式发布（Week 10 末）
- ✅ 所有测试通过
- ✅ 文档完整
- ✅ 性能优化完成
- **发布**: v2.0.0（正式版本）

---

## 风险管理

### 技术风险

| 风险 | 概率 | 影响 | 缓解措施 | 负责人 |
|------|------|------|----------|--------|
| **Solana SDK 学习曲线** | 高 | 中 | 提前学习文档，参考示例项目 | 开发团队 |
| **链检测准确性不足** | 中 | 高 | 多种检测方式结合，用户反馈优化 | 技术负责人 |
| **钱包加密安全问题** | 低 | 极高 | 使用标准加密库，安全审计 | 安全专家 |
| **RPC 节点不稳定** | 高 | 中 | 多节点备份，自动切换 | 开发团队 |
| **性能问题** | 中 | 中 | 性能监控，及时优化 | 开发团队 |

### 进度风险

| 风险 | 概率 | 影响 | 缓解措施 |
|------|------|------|----------|
| **开发进度延迟** | 中 | 高 | 每周进度检查，及时调整 |
| **测试时间不足** | 中 | 高 | 并行开发和测试，提前测试 |
| **需求变更** | 中 | 中 | 冻结核心需求，后续迭代 |

### 质量风险

| 风险 | 概率 | 影响 | 缓解措施 |
|------|------|------|----------|
| **Bug 遗漏** | 中 | 高 | 充分测试，Beta 测试 |
| **用户体验差** | 中 | 中 | 用户测试，反馈优化 |
| **文档不完整** | 低 | 中 | 开发同步写文档 |

---

## 开发规范

### 代码规范

1. **TypeScript 严格模式**
   - 启用 `strict: true`
   - 禁止 `any`（特殊情况除外）
   - 完整的类型定义

2. **命名规范**
   - 文件名：kebab-case（`chain-adapter.ts`）
   - 类名：PascalCase（`ChainAdapter`）
   - 函数名：camelCase（`getBalance`）
   - 常量：UPPER_SNAKE_CASE（`DEFAULT_SETTINGS`）

3. **注释规范**
   - 所有公共 API 必须有 JSDoc
   - 复杂逻辑必须有行内注释
   - TODO 注释包含负责人和时间

### Git 规范

1. **分支策略**
   - `main` - 生产分支
   - `develop` - 开发分支
   - `feature/xxx` - 功能分支
   - `fix/xxx` - 修复分支

2. **Commit 规范**
   ```
   feat: 添加 Solana 钱包导入功能
   fix: 修复链检测错误
   refactor: 重构 EVM 适配器
   docs: 更新开发文档
   test: 添加钱包管理测试
   ```

3. **PR 规范**
   - 描述清晰
   - 关联 Issue
   - 代码审查通过
   - 测试通过

### 测试规范

1. **单元测试**
   - 覆盖率 > 80%
   - 关键逻辑 100% 覆盖

2. **集成测试**
   - 主要流程测试
   - 跨模块交互测试

3. **E2E 测试**
   - 核心用户场景
   - 回归测试

---

## 发布计划

### 版本规划

- **v1.3.0-alpha** (Week 2): 基础架构
- **v1.3.0-beta1** (Week 4): 双钱包管理
- **v1.3.0-beta2** (Week 6): 自动切换
- **v1.3.0-rc1** (Week 8): Solana 基础功能
- **v2.0.0** (Week 10): 正式发布

### 发布检查清单

**代码质量**:
- [ ] 所有代码通过 lint
- [ ] 所有测试通过
- [ ] 代码审查完成
- [ ] 性能指标达标

**文档**:
- [ ] README 更新
- [ ] CHANGELOG 更新
- [ ] 用户指南完整
- [ ] API 文档完整

**构建**:
- [ ] 生产构建成功
- [ ] manifest.json 版本正确
- [ ] 打包文件完整

**测试**:
- [ ] 单元测试通过
- [ ] 集成测试通过
- [ ] E2E 测试通过
- [ ] Beta 测试反馈处理

---

## 总结

### 关键成功因素

1. ✅ **清晰的抽象层** - 确保代码可维护
2. ✅ **充分的测试** - 保证质量
3. ✅ **及时的沟通** - 解决问题
4. ✅ **用户反馈** - 优化体验

### 预期成果

1. **功能完整**
   - 双钱包管理
   - 自动链识别和切换
   - Solana 基础功能

2. **体验优秀**
   - 自动化程度高
   - 操作流畅
   - 提示友好

3. **代码质量高**
   - 架构清晰
   - 易于扩展
   - 测试充分

4. **文档完善**
   - 用户指南
   - 开发文档
   - API 文档

---

**文档版本**: v1.0
**最后更新**: 2025-01-09
**维护者**: BSC 打狗棒开发团队

**下一步**: 开始 Week 1 的类型定义和配置系统开发
