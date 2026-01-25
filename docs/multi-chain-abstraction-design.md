# 多链差异抽象设计方案

> **目标**: 在保持代码清晰的前提下，最大化复用现有结构支持 Solana

---

## 📋 核心差异点分析

### 1. Gas/Fee 机制差异

| 维度 | BSC (EVM) | Solana | 影响范围 |
|------|-----------|--------|----------|
| **费用单位** | Gwei (10^-9 ETH) | Lamports (10^-9 SOL) | UI 显示、用户输入 |
| **费用构成** | Gas Price × Gas Limit | Base Fee (5000) + Priority Fee | 费用估算、交易构建 |
| **动态调整** | EIP-1559 (Base + Tip) | 固定基础费 + 可选优先费 | 费用推荐逻辑 |
| **最大费用** | maxFeePerGas | 无概念，固定上限 | 用户设置 |
| **费用估算API** | eth_estimateGas | getFeeForMessage | RPC 调用 |

### 2. 交易参数差异

| 参数 | BSC | Solana | 处理策略 |
|------|-----|--------|----------|
| **Chain ID** | 56 (number) | 无 (用 RPC endpoint 区分) | 适配器内部处理 |
| **Nonce** | 必需 (account nonce) | 无 (用 recent blockhash) | 适配器层转换 |
| **Gas Price** | Wei (bigint) | Lamports (number) | 统一为 NativeFee 类型 |
| **Gas Limit** | 必需估算 | 无 (Compute Units 自动) | 可选参数 |
| **Blockhash** | 无 | 必需 (recent blockhash) | 适配器自动获取 |
| **签名** | ECDSA (r,s,v) | Ed25519 (64 bytes) | 适配器内部实现 |

### 3. RPC 接口差异

| 操作 | BSC RPC 方法 | Solana RPC 方法 | 统一接口 |
|------|--------------|-----------------|----------|
| **获取余额** | eth_getBalance | getBalance | `getBalance(address)` |
| **发送交易** | eth_sendRawTransaction | sendTransaction | `sendTransaction(signed)` |
| **估算 Gas** | eth_estimateGas | getFeeForMessage | `estimateFee(tx)` |
| **获取交易** | eth_getTransactionByHash | getTransaction | `getTransaction(hash)` |
| **区块高度** | eth_blockNumber | getSlot | `getBlockHeight()` |
| **确认交易** | eth_getTransactionReceipt | getSignatureStatuses | `waitForConfirmation(hash)` |

### 4. UI 显示差异

| 元素 | BSC | Solana | 解决方案 |
|------|-----|--------|----------|
| **地址格式** | 0x1234...5678 (42 char) | AbC1...Xyz9 (32-44 char) | 自适应格式化 |
| **余额小数** | 18 位 | 9 位 | 链配置定义 |
| **Gas 标签** | "Gas Price" / "Gwei" | "Priority Fee" / "SOL" | 链特定文案 |
| **确认状态** | "1/12 confirmations" | "Confirmed/Finalized" | 统一状态机 |
| **交易链接** | BscScan | Solscan/Solana Explorer | 链配置 URL 模板 |

---

## 🎯 解决方案设计

### 方案 1：参数归一化层 ⭐⭐⭐⭐⭐

创建统一的参数类型，由适配器负责转换为链特定格式。

#### 1.1 统一费用类型

```typescript
// src/shared/chain-types.ts

/**
 * 统一的费用类型（不同链的费用机制抽象）
 */
export type UnifiedFee = {
  // 费用类型（让上层知道如何解释）
  type: 'evm-gas' | 'solana-lamports';

  // 标准化的费用金额（统一为原生代币的最小单位）
  amount: string; // Wei (BSC) 或 Lamports (Solana)

  // 用户友好的显示值
  display: {
    value: string;      // "0.0005"
    unit: string;       // "BNB" or "SOL"
    symbol: string;     // "Gwei" or "Lamports"
  };

  // 链特定的详细信息（可选）
  details?: EvmGasDetails | SolanaFeeDetails;
};

/**
 * EVM Gas 详细信息
 */
export type EvmGasDetails = {
  gasPrice: string;      // Wei
  gasLimit: string;      // 数量
  maxFeePerGas?: string; // EIP-1559
  maxPriorityFeePerGas?: string;
};

/**
 * Solana Fee 详细信息
 */
export type SolanaFeeDetails = {
  baseFee: number;           // 固定 5000 lamports
  priorityFee: number;       // 用户设置的优先费
  computeUnitLimit?: number; // Compute units (可选)
  computeUnitPrice?: number; // micro-lamports per CU
};
```

#### 1.2 统一交易参数

```typescript
// src/shared/chain-types.ts

/**
 * 统一的交易构建参数
 */
export type UnifiedTransactionParams = {
  // 通用参数
  from: string;
  to?: string;           // 合约地址（可选，用于合约调用）
  value?: string;        // 转账金额（原生代币，最小单位）
  data?: string;         // 交易数据

  // 费用设置（使用统一类型）
  fee: UnifiedFee;

  // 链特定参数（由适配器填充）
  chainSpecific?: EvmTxParams | SolanaTxParams;
};

/**
 * EVM 特定参数
 */
export type EvmTxParams = {
  chainId: number;
  nonce: number;
  gasPrice: string;
  gasLimit: string;
  // EIP-1559
  maxFeePerGas?: string;
  maxPriorityFeePerGas?: string;
};

/**
 * Solana 特定参数
 */
export type SolanaTxParams = {
  recentBlockhash: string;
  feePayer: string;
  instructions: any[]; // Solana Instructions
  // 可选配置
  commitment?: 'processed' | 'confirmed' | 'finalized';
  skipPreflight?: boolean;
};
```

#### 1.3 适配器实现示例

```typescript
// src/chains/evm/evm-adapter.ts

export class EvmChainAdapter implements ChainAdapter {
  async buildTransaction(params: UnifiedTransactionParams): Promise<Transaction> {
    // 1. 从统一参数提取 EVM 特定数据
    const evmParams = params.chainSpecific as EvmTxParams;

    // 2. 如果没有提供，自动填充
    if (!evmParams) {
      const nonce = await this.publicClient.getTransactionCount({
        address: params.from as `0x${string}`
      });

      evmParams = {
        chainId: this.chainId,
        nonce,
        gasPrice: params.fee.details.gasPrice,
        gasLimit: params.fee.details.gasLimit
      };
    }

    // 3. 构建 viem 交易
    const viemTx = {
      from: params.from as `0x${string}`,
      to: params.to as `0x${string}`,
      value: BigInt(params.value || '0'),
      data: params.data as `0x${string}`,
      ...evmParams
    };

    return {
      chainType: 'evm',
      rawData: viemTx
    };
  }

  /**
   * 估算交易费用（返回统一格式）
   */
  async estimateFee(params: UnifiedTransactionParams): Promise<UnifiedFee> {
    // 估算 Gas
    const gasLimit = await this.publicClient.estimateGas({
      account: params.from as `0x${string}`,
      to: params.to as `0x${string}`,
      value: BigInt(params.value || '0'),
      data: params.data as `0x${string}`
    });

    // 获取 Gas Price
    const gasPrice = await this.publicClient.getGasPrice();

    // 计算总费用（Wei）
    const totalWei = gasLimit * gasPrice;

    // 转换为用户友好格式
    const bnbAmount = formatEther(totalWei);
    const gweiPrice = formatGwei(gasPrice);

    return {
      type: 'evm-gas',
      amount: totalWei.toString(),
      display: {
        value: bnbAmount,
        unit: 'BNB',
        symbol: `${gweiPrice} Gwei`
      },
      details: {
        gasPrice: gasPrice.toString(),
        gasLimit: gasLimit.toString()
      }
    };
  }
}

// src/chains/solana/solana-adapter.ts

export class SolanaChainAdapter implements ChainAdapter {
  async buildTransaction(params: UnifiedTransactionParams): Promise<Transaction> {
    // 1. 获取 recent blockhash
    const { blockhash } = await this.connection.getLatestBlockhash();

    // 2. 构建 Solana 交易
    const transaction = new Transaction({
      recentBlockhash: blockhash,
      feePayer: new PublicKey(params.from)
    });

    // 3. 添加指令（从 params.data 解析或直接传入）
    if (params.chainSpecific?.instructions) {
      params.chainSpecific.instructions.forEach(ix => {
        transaction.add(ix);
      });
    }

    // 4. 设置优先费（如果提供）
    const feeDetails = params.fee.details as SolanaFeeDetails;
    if (feeDetails?.priorityFee > 0) {
      transaction.add(
        ComputeBudgetProgram.setComputeUnitPrice({
          microLamports: feeDetails.computeUnitPrice || 1
        })
      );
    }

    return {
      chainType: 'solana',
      rawData: transaction
    };
  }

  /**
   * 估算交易费用（返回统一格式）
   */
  async estimateFee(params: UnifiedTransactionParams): Promise<UnifiedFee> {
    // Solana 基础费用固定
    const baseFee = 5000; // lamports

    // 优先费（可选，从用户设置获取）
    const priorityFee = params.fee?.details?.priorityFee || 0;

    // 总费用
    const totalLamports = baseFee + priorityFee;

    // 转换为 SOL
    const solAmount = (totalLamports / 1e9).toFixed(9);

    return {
      type: 'solana-lamports',
      amount: totalLamports.toString(),
      display: {
        value: solAmount,
        unit: 'SOL',
        symbol: `${totalLamports} Lamports`
      },
      details: {
        baseFee,
        priorityFee
      }
    };
  }
}
```

---

### 方案 2：UI 组件抽象 ⭐⭐⭐⭐⭐

创建链无关的 UI 组件，自动适配不同链的显示需求。

#### 2.1 地址显示组件

```tsx
// src/ui/components/AddressDisplay.tsx

import { useChain } from '../hooks/useChain';

type AddressFormat = {
  prefix: string;      // "0x" or ""
  visibleStart: number; // 6 or 4
  visibleEnd: number;   // 4
  totalLength: number;  // 42 or varies
};

const CHAIN_ADDRESS_FORMATS: Record<ChainType, AddressFormat> = {
  bsc: {
    prefix: '0x',
    visibleStart: 6,
    visibleEnd: 4,
    totalLength: 42
  },
  solana: {
    prefix: '',
    visibleStart: 4,
    visibleEnd: 4,
    totalLength: 44 // Base58, varies
  }
};

export function AddressDisplay({
  address,
  showFull = false,
  showCopy = true
}: {
  address: string;
  showFull?: boolean;
  showCopy?: boolean;
}) {
  const { currentChain } = useChain();
  const format = CHAIN_ADDRESS_FORMATS[currentChain];

  // 自动格式化地址
  const formatted = showFull
    ? address
    : `${address.slice(0, format.visibleStart)}...${address.slice(-format.visibleEnd)}`;

  // 地址验证（链特定）
  const isValid = validateAddress(address, currentChain);

  return (
    <div className={`address-display ${!isValid ? 'invalid' : ''}`}>
      <ChainIcon chain={currentChain} size="small" />
      <span className="address-text" title={address}>
        {formatted}
      </span>
      {showCopy && (
        <CopyButton
          text={address}
          successMessage="地址已复制"
        />
      )}
    </div>
  );
}

/**
 * 链特定地址验证
 */
function validateAddress(address: string, chain: ChainType): boolean {
  switch (chain) {
    case 'bsc':
      return /^0x[a-fA-F0-9]{40}$/.test(address);
    case 'solana':
      try {
        new PublicKey(address);
        return true;
      } catch {
        return false;
      }
    default:
      return false;
  }
}
```

#### 2.2 费用显示组件

```tsx
// src/ui/components/FeeDisplay.tsx

export function FeeDisplay({
  fee,
  editable = false,
  onChange
}: {
  fee: UnifiedFee;
  editable?: boolean;
  onChange?: (fee: UnifiedFee) => void;
}) {
  const { currentChain } = useChain();

  // 根据链类型显示不同的 UI
  if (fee.type === 'evm-gas') {
    return (
      <EvmGasDisplay
        fee={fee}
        editable={editable}
        onChange={onChange}
      />
    );
  }

  if (fee.type === 'solana-lamports') {
    return (
      <SolanaFeeDisplay
        fee={fee}
        editable={editable}
        onChange={onChange}
      />
    );
  }

  return null;
}

/**
 * EVM Gas 显示（现有逻辑）
 */
function EvmGasDisplay({
  fee,
  editable,
  onChange
}: {
  fee: UnifiedFee;
  editable: boolean;
  onChange?: (fee: UnifiedFee) => void;
}) {
  const details = fee.details as EvmGasDetails;

  return (
    <div className="fee-display evm">
      <div className="fee-header">
        <span className="label">Gas 费用</span>
        <span className="amount">{fee.display.value} {fee.display.unit}</span>
      </div>

      {editable && (
        <div className="fee-details">
          <div className="field">
            <label>Gas Price</label>
            <input
              type="number"
              value={formatGwei(BigInt(details.gasPrice))}
              onChange={(e) => {
                const newGasPrice = parseGwei(e.target.value);
                onChange?.({
                  ...fee,
                  details: {
                    ...details,
                    gasPrice: newGasPrice.toString()
                  }
                });
              }}
            />
            <span className="unit">Gwei</span>
          </div>

          <div className="field">
            <label>Gas Limit</label>
            <input
              type="number"
              value={details.gasLimit}
              onChange={(e) => {
                onChange?.({
                  ...fee,
                  details: {
                    ...details,
                    gasLimit: e.target.value
                  }
                });
              }}
            />
          </div>
        </div>
      )}

      <div className="fee-breakdown">
        <small>Gas Price: {fee.display.symbol}</small>
        <small>Gas Limit: {details.gasLimit}</small>
      </div>
    </div>
  );
}

/**
 * Solana Fee 显示（新增）
 */
function SolanaFeeDisplay({
  fee,
  editable,
  onChange
}: {
  fee: UnifiedFee;
  editable: boolean;
  onChange?: (fee: UnifiedFee) => void;
}) {
  const details = fee.details as SolanaFeeDetails;

  return (
    <div className="fee-display solana">
      <div className="fee-header">
        <span className="label">交易费用</span>
        <span className="amount">{fee.display.value} {fee.display.unit}</span>
      </div>

      {editable && (
        <div className="fee-details">
          <div className="field">
            <label>优先费</label>
            <input
              type="number"
              value={details.priorityFee}
              onChange={(e) => {
                const newPriorityFee = parseInt(e.target.value) || 0;
                onChange?.({
                  ...fee,
                  amount: (details.baseFee + newPriorityFee).toString(),
                  details: {
                    ...details,
                    priorityFee: newPriorityFee
                  }
                });
              }}
            />
            <span className="unit">Lamports</span>
          </div>

          <div className="fee-presets">
            <button onClick={() => setPriorityFee(0)}>无</button>
            <button onClick={() => setPriorityFee(10000)}>低</button>
            <button onClick={() => setPriorityFee(50000)}>中</button>
            <button onClick={() => setPriorityFee(100000)}>高</button>
          </div>
        </div>
      )}

      <div className="fee-breakdown">
        <small>基础费用: {details.baseFee} Lamports</small>
        <small>优先费: {details.priorityFee} Lamports</small>
      </div>
    </div>
  );
}
```

#### 2.3 交易确认组件

```tsx
// src/ui/components/TransactionConfirmation.tsx

type TransactionStatus =
  | { state: 'pending'; progress?: number }
  | { state: 'confirming'; confirmations: number; required: number }
  | { state: 'confirmed' }
  | { state: 'finalized' }
  | { state: 'failed'; error: string };

export function TransactionConfirmation({
  txHash,
  chain
}: {
  txHash: string;
  chain: ChainType;
}) {
  const [status, setStatus] = useState<TransactionStatus>({ state: 'pending' });

  useEffect(() => {
    const adapter = getChainAdapter(chain);

    // 监听交易状态
    const unsubscribe = adapter.watchTransaction(txHash, (newStatus) => {
      setStatus(newStatus);
    });

    return unsubscribe;
  }, [txHash, chain]);

  return (
    <div className="tx-confirmation">
      <StatusDisplay status={status} chain={chain} />

      <div className="tx-link">
        <a
          href={getExplorerUrl(txHash, chain)}
          target="_blank"
          rel="noopener"
        >
          在区块浏览器中查看 ↗
        </a>
      </div>
    </div>
  );
}

function StatusDisplay({
  status,
  chain
}: {
  status: TransactionStatus;
  chain: ChainType;
}) {
  // EVM 链显示确认数
  if (chain === 'bsc' && status.state === 'confirming') {
    return (
      <div className="status confirming">
        <Spinner />
        <span>确认中 ({status.confirmations}/{status.required})</span>
        <ProgressBar
          value={status.confirmations}
          max={status.required}
        />
      </div>
    );
  }

  // Solana 显示 commitment
  if (chain === 'solana') {
    if (status.state === 'confirming') {
      return (
        <div className="status confirming">
          <Spinner />
          <span>已确认 (Confirmed)</span>
        </div>
      );
    }

    if (status.state === 'finalized') {
      return (
        <div className="status finalized">
          ✓ 已最终确认 (Finalized)
        </div>
      );
    }
  }

  // 通用状态
  if (status.state === 'pending') {
    return <div className="status pending"><Spinner /> 等待确认...</div>;
  }

  if (status.state === 'confirmed') {
    return <div className="status confirmed">✓ 交易成功</div>;
  }

  if (status.state === 'failed') {
    return <div className="status failed">✗ 交易失败: {status.error}</div>;
  }

  return null;
}

/**
 * 获取浏览器链接（链特定）
 */
function getExplorerUrl(txHash: string, chain: ChainType): string {
  const explorers: Record<ChainType, string> = {
    bsc: `https://bscscan.com/tx/${txHash}`,
    solana: `https://solscan.io/tx/${txHash}`
  };

  return explorers[chain];
}
```

---

### 方案 3：配置驱动的链管理 ⭐⭐⭐⭐⭐

将所有链特定的配置独立管理，通过配置文件驱动行为。

#### 3.1 链配置类型定义

```typescript
// src/config/chain-config.types.ts

/**
 * 完整的链配置定义
 */
export type ChainConfig = {
  // 基础信息
  id: ChainType;
  name: string;
  displayName: string;

  // 原生代币
  nativeCurrency: {
    name: string;
    symbol: string;
    decimals: number;
  };

  // RPC 配置
  rpc: {
    primary: string;
    fallback: string[];
    timeout: number;
    retryAttempts: number;
  };

  // WebSocket（可选）
  ws?: {
    url: string;
    reconnectDelay: number;
  };

  // 费用配置
  fee: {
    type: 'evm-gas' | 'solana-lamports';
    defaults: EvmGasDefaults | SolanaFeeDefaults;
    displayFormat: {
      unit: string;           // "Gwei" or "Lamports"
      decimals: number;       // 显示小数位数
      symbolPosition: 'prefix' | 'suffix';
    };
  };

  // 交易配置
  transaction: {
    confirmationBlocks?: number;  // EVM only
    commitment?: 'processed' | 'confirmed' | 'finalized'; // Solana only
    timeout: number;
  };

  // 地址格式
  address: {
    regex: RegExp;
    displayFormat: {
      start: number;
      end: number;
    };
    prefix?: string;
  };

  // 区块浏览器
  explorer: {
    name: string;
    baseUrl: string;
    txPath: string;        // "/tx/{hash}"
    addressPath: string;   // "/address/{address}"
    tokenPath?: string;    // "/token/{address}"
  };

  // 支持的 DEX
  dexes: string[];
};

/**
 * EVM Gas 默认配置
 */
export type EvmGasDefaults = {
  gasPrice: string;           // Wei
  gasLimit: string;
  maxFeePerGas?: string;
  maxPriorityFeePerGas?: string;
};

/**
 * Solana Fee 默认配置
 */
export type SolanaFeeDefaults = {
  baseFee: number;            // 5000 lamports
  priorityFee: number;        // 0 (default)
  computeUnitLimit?: number;
};
```

#### 3.2 BSC 配置

```typescript
// src/config/chains/bsc.config.ts

export const BSC_CONFIG: ChainConfig = {
  id: 'bsc',
  name: 'bsc',
  displayName: 'Binance Smart Chain',

  nativeCurrency: {
    name: 'BNB',
    symbol: 'BNB',
    decimals: 18
  },

  rpc: {
    primary: 'https://api.zan.top/node/v1/bsc/mainnet/...',
    fallback: [
      'https://bsc-mainnet.nodereal.io/v1/...',
      'https://bsc-dataseed.bnbchain.org/'
    ],
    timeout: 10000,
    retryAttempts: 3
  },

  ws: {
    url: 'wss://api.zan.top/node/ws/v1/bsc/mainnet/...',
    reconnectDelay: 2000
  },

  fee: {
    type: 'evm-gas',
    defaults: {
      gasPrice: '3000000000', // 3 Gwei
      gasLimit: '350000'
    },
    displayFormat: {
      unit: 'Gwei',
      decimals: 2,
      symbolPosition: 'suffix'
    }
  },

  transaction: {
    confirmationBlocks: 12,
    timeout: 60000
  },

  address: {
    regex: /^0x[a-fA-F0-9]{40}$/,
    displayFormat: {
      start: 6,
      end: 4
    },
    prefix: '0x'
  },

  explorer: {
    name: 'BscScan',
    baseUrl: 'https://bscscan.com',
    txPath: '/tx/{hash}',
    addressPath: '/address/{address}',
    tokenPath: '/token/{address}'
  },

  dexes: ['pancake', 'four', 'flap']
};
```

#### 3.3 Solana 配置

```typescript
// src/config/chains/solana.config.ts

export const SOLANA_CONFIG: ChainConfig = {
  id: 'solana',
  name: 'solana',
  displayName: 'Solana',

  nativeCurrency: {
    name: 'Solana',
    symbol: 'SOL',
    decimals: 9
  },

  rpc: {
    primary: 'https://api.mainnet-beta.solana.com',
    fallback: [
      'https://solana-api.projectserum.com',
      'https://rpc.ankr.com/solana'
    ],
    timeout: 10000,
    retryAttempts: 3
  },

  ws: {
    url: 'wss://api.mainnet-beta.solana.com',
    reconnectDelay: 2000
  },

  fee: {
    type: 'solana-lamports',
    defaults: {
      baseFee: 5000,
      priorityFee: 0
    },
    displayFormat: {
      unit: 'Lamports',
      decimals: 0,
      symbolPosition: 'suffix'
    }
  },

  transaction: {
    commitment: 'confirmed',
    timeout: 30000
  },

  address: {
    regex: /^[1-9A-HJ-NP-Za-km-z]{32,44}$/, // Base58
    displayFormat: {
      start: 4,
      end: 4
    }
  },

  explorer: {
    name: 'Solscan',
    baseUrl: 'https://solscan.io',
    txPath: '/tx/{hash}',
    addressPath: '/account/{address}',
    tokenPath: '/token/{address}'
  },

  dexes: ['jupiter', 'raydium', 'orca']
};
```

#### 3.4 配置管理器

```typescript
// src/config/chain-registry.ts

const CHAIN_CONFIGS = new Map<ChainType, ChainConfig>([
  ['bsc', BSC_CONFIG],
  ['solana', SOLANA_CONFIG]
]);

/**
 * 获取链配置
 */
export function getChainConfig(chain: ChainType): ChainConfig {
  const config = CHAIN_CONFIGS.get(chain);
  if (!config) {
    throw new Error(`Chain ${chain} not configured`);
  }
  return config;
}

/**
 * 获取所有支持的链
 */
export function getSupportedChains(): ChainType[] {
  return Array.from(CHAIN_CONFIGS.keys());
}

/**
 * 检查链是否支持
 */
export function isChainSupported(chain: string): chain is ChainType {
  return CHAIN_CONFIGS.has(chain as ChainType);
}
```

---

### 方案 4：节点管理统一化 ⭐⭐⭐⭐

创建统一的 RPC 管理器，处理不同链的节点交互。

#### 4.1 RPC 管理器接口

```typescript
// src/shared/rpc-manager.ts

/**
 * 统一的 RPC 请求结果
 */
export type RpcResult<T> = {
  success: boolean;
  data?: T;
  error?: string;
  rpcUrl?: string;      // 哪个节点返回的结果
  latency?: number;     // 请求延迟（ms）
};

/**
 * RPC 管理器接口
 */
export interface RpcManager {
  // 切换节点
  switchNode(url: string): Promise<void>;

  // 自动切换到下一个可用节点
  switchToNextNode(): Promise<void>;

  // 测试节点可用性
  testNode(url: string): Promise<boolean>;

  // 获取当前节点
  getCurrentNode(): string;

  // 获取所有节点状态
  getNodesStatus(): NodeStatus[];

  // 执行请求（自动重试和切换节点）
  request<T>(method: string, params: any[]): Promise<RpcResult<T>>;
}

/**
 * 节点状态
 */
export type NodeStatus = {
  url: string;
  available: boolean;
  latency: number;      // ms
  lastCheck: number;    // timestamp
  failureCount: number;
};
```

#### 4.2 EVM RPC 管理器

```typescript
// src/chains/evm/evm-rpc-manager.ts

export class EvmRpcManager implements RpcManager {
  private nodes: string[];
  private currentIndex: number = 0;
  private nodeStatuses: Map<string, NodeStatus>;
  private publicClient: any; // viem PublicClient

  constructor(config: ChainConfig) {
    this.nodes = [config.rpc.primary, ...config.rpc.fallback];
    this.nodeStatuses = new Map();
    this.initializeClient();
  }

  private initializeClient() {
    const currentNode = this.nodes[this.currentIndex];
    this.publicClient = createPublicClient({
      chain: bsc,
      transport: http(currentNode, {
        timeout: 10000,
        retryCount: 3
      })
    });
  }

  async request<T>(method: string, params: any[]): Promise<RpcResult<T>> {
    const maxRetries = this.nodes.length;
    let lastError: Error | null = null;

    for (let i = 0; i < maxRetries; i++) {
      try {
        const startTime = Date.now();

        // 发送请求
        const result = await this.publicClient.request({
          method,
          params
        });

        const latency = Date.now() - startTime;

        // 更新节点状态
        this.updateNodeStatus(this.getCurrentNode(), true, latency);

        return {
          success: true,
          data: result as T,
          rpcUrl: this.getCurrentNode(),
          latency
        };

      } catch (error) {
        lastError = error as Error;

        // 记录失败
        this.updateNodeStatus(this.getCurrentNode(), false, 0);

        // 尝试下一个节点
        await this.switchToNextNode();
      }
    }

    return {
      success: false,
      error: lastError?.message || 'All RPC nodes failed'
    };
  }

  async switchToNextNode(): Promise<void> {
    this.currentIndex = (this.currentIndex + 1) % this.nodes.length;
    this.initializeClient();
  }

  getCurrentNode(): string {
    return this.nodes[this.currentIndex];
  }

  private updateNodeStatus(url: string, available: boolean, latency: number) {
    const status = this.nodeStatuses.get(url) || {
      url,
      available: true,
      latency: 0,
      lastCheck: 0,
      failureCount: 0
    };

    status.available = available;
    status.lastCheck = Date.now();

    if (available) {
      status.latency = latency;
      status.failureCount = 0;
    } else {
      status.failureCount++;
    }

    this.nodeStatuses.set(url, status);
  }

  getNodesStatus(): NodeStatus[] {
    return Array.from(this.nodeStatuses.values());
  }
}
```

#### 4.3 Solana RPC 管理器

```typescript
// src/chains/solana/solana-rpc-manager.ts

export class SolanaRpcManager implements RpcManager {
  private nodes: string[];
  private currentIndex: number = 0;
  private nodeStatuses: Map<string, NodeStatus>;
  private connection: Connection | null = null;

  constructor(config: ChainConfig) {
    this.nodes = [config.rpc.primary, ...config.rpc.fallback];
    this.nodeStatuses = new Map();
    this.initializeConnection();
  }

  private initializeConnection() {
    const currentNode = this.nodes[this.currentIndex];
    this.connection = new Connection(currentNode, {
      commitment: 'confirmed',
      confirmTransactionInitialTimeout: 30000
    });
  }

  async request<T>(method: string, params: any[]): Promise<RpcResult<T>> {
    const maxRetries = this.nodes.length;
    let lastError: Error | null = null;

    for (let i = 0; i < maxRetries; i++) {
      try {
        if (!this.connection) {
          throw new Error('Connection not initialized');
        }

        const startTime = Date.now();

        // Solana RPC 方法映射
        let result: any;
        switch (method) {
          case 'getBalance':
            result = await this.connection.getBalance(
              new PublicKey(params[0])
            );
            break;

          case 'getTransaction':
            result = await this.connection.getTransaction(params[0]);
            break;

          case 'sendTransaction':
            result = await this.connection.sendRawTransaction(params[0]);
            break;

          case 'getLatestBlockhash':
            result = await this.connection.getLatestBlockhash();
            break;

          default:
            // 通用 RPC 调用
            result = await (this.connection as any)[method](...params);
        }

        const latency = Date.now() - startTime;

        this.updateNodeStatus(this.getCurrentNode(), true, latency);

        return {
          success: true,
          data: result as T,
          rpcUrl: this.getCurrentNode(),
          latency
        };

      } catch (error) {
        lastError = error as Error;

        this.updateNodeStatus(this.getCurrentNode(), false, 0);

        await this.switchToNextNode();
      }
    }

    return {
      success: false,
      error: lastError?.message || 'All Solana RPC nodes failed'
    };
  }

  async switchToNextNode(): Promise<void> {
    this.currentIndex = (this.currentIndex + 1) % this.nodes.length;
    this.initializeConnection();
  }

  getCurrentNode(): string {
    return this.nodes[this.currentIndex];
  }

  // ... 其他方法与 EVM 类似
}
```

#### 4.4 统一的 RPC 工厂

```typescript
// src/shared/rpc-factory.ts

export function createRpcManager(chain: ChainType): RpcManager {
  const config = getChainConfig(chain);

  switch (chain) {
    case 'bsc':
      return new EvmRpcManager(config);

    case 'solana':
      return new SolanaRpcManager(config);

    default:
      throw new Error(`Unsupported chain: ${chain}`);
  }
}
```

---

## 🎨 使用示例

### 示例 1：构建交易（链无关）

```typescript
// src/background/index.ts

async function executeSwap(
  chain: ChainType,
  dexId: string,
  inputToken: string,
  outputToken: string,
  amount: string,
  slippage: number
) {
  // 1. 获取链适配器
  const adapter = getChainAdapter(chain);

  // 2. 获取 DEX 适配器
  const dex = getDexAdapter(chain, dexId);

  // 3. 获取报价
  const quote = await dex.getQuote({
    inputToken,
    outputToken,
    amount,
    slippage
  });

  // 4. 估算费用（统一接口）
  const fee = await adapter.estimateFee({
    from: currentAddress,
    to: dex.contractAddress,
    data: quote.calldata
  });

  // 5. 用户确认（显示统一格式的费用）
  const confirmed = await showConfirmDialog({
    quote,
    fee  // UI 组件会自动适配显示
  });

  if (!confirmed) return;

  // 6. 构建交易（适配器自动处理链特定逻辑）
  const tx = await adapter.buildTransaction({
    from: currentAddress,
    to: dex.contractAddress,
    data: quote.calldata,
    fee
  });

  // 7. 签名并发送（适配器内部处理）
  const txHash = await adapter.signAndSend(tx);

  // 8. 监控交易（统一接口，内部处理不同确认机制）
  await adapter.waitForConfirmation(txHash);

  return txHash;
}
```

### 示例 2：UI 组件使用

```tsx
// src/sidepanel/TradingPanel.tsx

function TradingPanel() {
  const { currentChain, setChain } = useChain();
  const { address } = useWallet();
  const [fee, setFee] = useState<UnifiedFee | null>(null);

  // 估算费用（自动适配链）
  useEffect(() => {
    const adapter = getChainAdapter(currentChain);

    adapter.estimateFee({
      from: address,
      to: swapContract,
      data: swapCalldata
    }).then(setFee);
  }, [currentChain, swapCalldata]);

  return (
    <div className="trading-panel">
      {/* 链选择器 */}
      <ChainSelector
        value={currentChain}
        onChange={setChain}
      />

      {/* 地址显示（自动格式化） */}
      <AddressDisplay
        address={address}
        chain={currentChain}
      />

      {/* 余额显示（自动转换单位） */}
      <BalanceDisplay
        balance={balance}
        chain={currentChain}
      />

      {/* 交易输入 */}
      <SwapInput />

      {/* 费用显示（自动适配 UI） */}
      {fee && (
        <FeeDisplay
          fee={fee}
          editable={true}
          onChange={setFee}
        />
      )}

      {/* 执行按钮 */}
      <button onClick={handleSwap}>
        交易
      </button>
    </div>
  );
}
```

---

## ✅ 方案总结

| 方案 | 复用度 | 清晰度 | 开发效率 | 推荐度 |
|------|--------|--------|----------|--------|
| **参数归一化** | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐⭐ | ✅ 必须 |
| **UI 组件抽象** | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ✅ 必须 |
| **配置驱动** | ⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ✅ 必须 |
| **统一 RPC 管理** | ⭐⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐⭐ | ✅ 推荐 |

### 核心优势

1. **最大化复用** - 90% 的业务逻辑代码无需修改
2. **高度清晰** - 链特定代码隔离在适配器层
3. **易于扩展** - 添加新链只需实现适配器和配置
4. **类型安全** - TypeScript 编译期保证正确性
5. **用户友好** - UI 自动适配，无需学习成本

### 实施建议

1. **第一步**: 创建类型定义（`chain-types.ts`, `chain-config.types.ts`）
2. **第二步**: 实现链配置（`bsc.config.ts`, `solana.config.ts`）
3. **第三步**: 重构现有代码到 EVM 适配器
4. **第四步**: 创建 UI 组件库（`AddressDisplay`, `FeeDisplay` 等）
5. **第五步**: 实现 Solana 适配器
6. **第六步**: 全面测试和优化

---

**文档版本**: v1.0
**最后更新**: 2025-01-09
