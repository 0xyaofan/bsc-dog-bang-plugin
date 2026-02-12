/**
 * 准备代币卖出参数
 *
 * 从 trading-channels-compat.ts 迁移而来
 */

import type { Address } from 'viem';

const GWEI_DECIMALS = 9;

/**
 * 对齐到 Gwei 精度
 */
function alignAmountToGweiPrecision(amount: bigint, decimals?: number): bigint {
  if (amount <= 0n) {
    return amount;
  }
  const tokenDecimals = typeof decimals === 'number' && decimals >= 0 ? decimals : 18;
  if (tokenDecimals <= GWEI_DECIMALS) {
    return amount;
  }
  const precisionUnit = 10n ** BigInt(tokenDecimals - GWEI_DECIMALS);
  if (precisionUnit <= 1n) {
    return amount;
  }
  return amount - (amount % precisionUnit);
}

/**
 * 准备代币卖出参数类型
 */
export type PrepareTokenSellParams = {
  publicClient: any;
  tokenAddress: string;
  accountAddress: string;
  spenderAddress: string;
  percent: number;
  tokenInfo?: any;
  options?: {
    requireGweiPrecision?: boolean;
  };
};

/**
 * 准备代币卖出返回类型
 */
export type PrepareTokenSellResult = {
  balance: bigint;
  allowance: bigint;
  totalSupply: bigint;
  amountToSell: bigint;
};

/**
 * 准备代币卖出：获取余额、授权状态、计算卖出数量
 */
export async function prepareTokenSell({
  publicClient,
  tokenAddress,
  accountAddress,
  spenderAddress,
  percent,
  tokenInfo,
  options
}: PrepareTokenSellParams): Promise<PrepareTokenSellResult> {
  const requireGweiPrecision = Boolean(options?.requireGweiPrecision);

  // 查询代币状态
  const ERC20_ABI = [
    {
      inputs: [{ name: 'account', type: 'address' }],
      name: 'balanceOf',
      outputs: [{ name: '', type: 'uint256' }],
      stateMutability: 'view',
      type: 'function',
    },
    {
      inputs: [
        { name: 'owner', type: 'address' },
        { name: 'spender', type: 'address' },
      ],
      name: 'allowance',
      outputs: [{ name: '', type: 'uint256' }],
      stateMutability: 'view',
      type: 'function',
    },
    {
      inputs: [],
      name: 'totalSupply',
      outputs: [{ name: '', type: 'uint256' }],
      stateMutability: 'view',
      type: 'function',
    },
    {
      inputs: [],
      name: 'decimals',
      outputs: [{ name: '', type: 'uint8' }],
      stateMutability: 'view',
      type: 'function',
    },
  ];

  // 批量查询
  const calls = [
    {
      address: tokenAddress as Address,
      abi: ERC20_ABI,
      functionName: 'balanceOf',
      args: [accountAddress as Address],
    },
    {
      address: tokenAddress as Address,
      abi: ERC20_ABI,
      functionName: 'allowance',
      args: [accountAddress as Address, spenderAddress as Address],
    },
    {
      address: tokenAddress as Address,
      abi: ERC20_ABI,
      functionName: 'totalSupply',
      args: [],
    },
  ];

  if (requireGweiPrecision) {
    calls.push({
      address: tokenAddress as Address,
      abi: ERC20_ABI,
      functionName: 'decimals',
      args: [],
    });
  }

  const results = await publicClient.multicall({ contracts: calls });

  const balance = results[0].result as bigint;
  const allowance = results[1].result as bigint;
  const totalSupply = results[2].result as bigint;
  const decimals = requireGweiPrecision ? (results[3]?.result as number) : undefined;

  if (balance === 0n) {
    throw new Error('代币余额为 0');
  }

  // 计算卖出数量
  let amountToSell = percent === 100
    ? balance
    : balance * BigInt(percent) / 100n;

  if (requireGweiPrecision) {
    amountToSell = alignAmountToGweiPrecision(amountToSell, decimals);
    if (amountToSell <= 0n) {
      throw new Error('卖出数量过小，无法满足 Gwei 精度限制');
    }
  }

  return { balance, allowance, totalSupply, amountToSell };
}
