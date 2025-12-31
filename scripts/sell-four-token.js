#!/usr/bin/env node
/**
 * 简易 Four.meme 卖出脚本
 *
 * 用法:
 *   SELLER_PRIVATE_KEY=0xabc... GAS_PRICE_GWEI=0.05 node scripts/sell-four-token.js [tokenAddress] [sellPercent]
 *
 * - 默认代币: 0x71883d847ef27c57cff9532b841793b675184444
 * - sellPercent 默认为 100 (全部卖出)
 */

import { createPublicClient, createWalletClient, http, parseUnits, getAddress } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { bsc } from 'viem/chains';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const DEFAULT_TOKEN = getAddress('0x71883d847ef27c57cff9532b841793b675184444');
const FOUR_TOKEN_MANAGER = getAddress('0x5c952063c7fc8610FFDB798152D69F0B9550762b');
const RPC_URL =
  process.env.BSC_RPC_URL || 'https://bsc-mainnet.nodereal.io/v1/cafa270f244d4dd0b3edd33c1665767f/';

const ERC20_ABI = [
  {
    name: 'balanceOf',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'owner', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }]
  },
  {
    name: 'allowance',
    type: 'function',
    stateMutability: 'view',
    inputs: [
      { name: 'owner', type: 'address' },
      { name: 'spender', type: 'address' }
    ],
    outputs: [{ name: '', type: 'uint256' }]
  },
  {
    name: 'totalSupply',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }]
  },
  {
    name: 'decimals',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint8' }]
  },
  {
    name: 'symbol',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'string' }]
  },
  {
    name: 'approve',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'spender', type: 'address' },
      { name: 'amount', type: 'uint256' }
    ],
    outputs: [{ name: '', type: 'bool' }]
  }
];

function loadTokenManagerAbi() {
  const filePath = join(__dirname, '..', 'abis/token-manager-v2.json');
  return JSON.parse(readFileSync(filePath, 'utf8'));
}

const TOKEN_MANAGER_ABI = loadTokenManagerAbi();

const [tokenArg, percentArg] = process.argv.slice(2);
const TOKEN_ADDRESS = tokenArg ? getAddress(tokenArg) : DEFAULT_TOKEN;
const SELL_PERCENT = Number(percentArg ?? process.env.SELL_PERCENT ?? '100');

const PK_INPUT = process.env.SELLER_PRIVATE_KEY;
if (!PK_INPUT) {
  console.error('请通过环境变量 SELLER_PRIVATE_KEY 提供私钥');
  process.exit(1);
}
const PRIVATE_KEY = PK_INPUT.startsWith('0x') ? PK_INPUT : `0x${PK_INPUT}`;

if (!Number.isFinite(SELL_PERCENT) || SELL_PERCENT <= 0 || SELL_PERCENT > 100) {
  console.error('sellPercent 必须在 1-100 之间');
  process.exit(1);
}

const GAS_PRICE_GWEI = Number(process.env.GAS_PRICE_GWEI ?? '0.05');
const gasPrice = parseUnits(GAS_PRICE_GWEI.toString(), 9);

const account = privateKeyToAccount(PRIVATE_KEY);
const publicClient = createPublicClient({
  chain: bsc,
  transport: http(RPC_URL)
});
const walletClient = createWalletClient({
  account,
  chain: bsc,
  transport: http(RPC_URL)
});

function alignAmountToGweiPrecision(amount, decimals) {
  if (decimals <= 9) {
    return amount;
  }
  const precisionUnit = 10n ** BigInt(decimals - 9);
  if (precisionUnit <= 1n) {
    return amount;
  }
  return amount - (amount % precisionUnit);
}

async function ensureApproval(amountToSell) {
  const allowance = await publicClient.readContract({
    address: TOKEN_ADDRESS,
    abi: ERC20_ABI,
    functionName: 'allowance',
    args: [account.address, FOUR_TOKEN_MANAGER]
  });
  if (allowance >= amountToSell) {
    return null;
  }
  const totalSupply = await publicClient.readContract({
    address: TOKEN_ADDRESS,
    abi: ERC20_ABI,
    functionName: 'totalSupply'
  });
  console.log('授权不足，发送 approve 交易...');
  const approveHash = await walletClient.writeContract({
    account,
    chain: bsc,
    address: TOKEN_ADDRESS,
    abi: ERC20_ABI,
    functionName: 'approve',
    args: [FOUR_TOKEN_MANAGER, totalSupply],
    gasPrice
  });
  await publicClient.waitForTransactionReceipt({ hash: approveHash });
  console.log('授权完成:', approveHash);
  return approveHash;
}

async function main() {
  console.log('准备卖出 Four.meme 代币:', TOKEN_ADDRESS);

  const [balance, decimals, symbol] = await Promise.all([
    publicClient.readContract({
      address: TOKEN_ADDRESS,
      abi: ERC20_ABI,
      functionName: 'balanceOf',
      args: [account.address]
    }),
    publicClient.readContract({
      address: TOKEN_ADDRESS,
      abi: ERC20_ABI,
      functionName: 'decimals'
    }),
    publicClient.readContract({
      address: TOKEN_ADDRESS,
      abi: ERC20_ABI,
      functionName: 'symbol'
    }).catch(() => 'TOKEN')
  ]);

  if (balance <= 0n) {
    console.error('钱包无代币余额，无法卖出');
    return;
  }

  let amountToSell =
    SELL_PERCENT >= 100
      ? balance
      : (balance * BigInt(Math.floor(SELL_PERCENT)) / 100n);
  amountToSell = alignAmountToGweiPrecision(amountToSell, Number(decimals));
  if (amountToSell <= 0n) {
    throw new Error('计算后的卖出数量过小，请调整 SELL_PERCENT');
  }

  console.log(`代币符号: ${symbol}，余额: ${balance.toString()}`);
  console.log(`计划卖出: ${amountToSell.toString()} (${SELL_PERCENT}% 对应的 gwei 对齐数量)`);

  await ensureApproval(amountToSell);

  console.log('发送 sellToken 交易...');
  const sellHash = await walletClient.writeContract({
    account,
    chain: bsc,
    address: FOUR_TOKEN_MANAGER,
    abi: TOKEN_MANAGER_ABI,
    functionName: 'sellToken',
    args: [TOKEN_ADDRESS, amountToSell, 0n],
    gasPrice
  });
  console.log('交易已发送:', sellHash);
  const receipt = await publicClient.waitForTransactionReceipt({ hash: sellHash });
  console.log('卖出完成，区块号:', receipt.blockNumber?.toString());
}

main().catch((error) => {
  console.error('执行失败:', error?.message || error);
  process.exitCode = 1;
});
