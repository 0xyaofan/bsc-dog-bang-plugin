/**
 * 查询 Pair 合约的代币信息
 */

import { createPublicClient, http, getAddress } from 'viem';
import { bsc } from 'viem/chains';

const PAIR_ADDRESS = getAddress('0x51C5d5F9d135fe709A899b7473b2793A9AE24D4A');
const TARGET_TOKEN = getAddress('0xcc411e6eac8f660972bf06ac5ea12058267755f0');

// Pair ABI
const PAIR_ABI = [
  {
    inputs: [],
    name: 'token0',
    outputs: [{ internalType: 'address', name: '', type: 'address' }],
    stateMutability: 'view',
    type: 'function'
  },
  {
    inputs: [],
    name: 'token1',
    outputs: [{ internalType: 'address', name: '', type: 'address' }],
    stateMutability: 'view',
    type: 'function'
  }
];

// ERC20 ABI for name and symbol
const ERC20_ABI = [
  {
    inputs: [],
    name: 'name',
    outputs: [{ internalType: 'string', name: '', type: 'string' }],
    stateMutability: 'view',
    type: 'function'
  },
  {
    inputs: [],
    name: 'symbol',
    outputs: [{ internalType: 'string', name: '', type: 'string' }],
    stateMutability: 'view',
    type: 'function'
  },
  {
    inputs: [],
    name: 'decimals',
    outputs: [{ internalType: 'uint8', name: '', type: 'uint8' }],
    stateMutability: 'view',
    type: 'function'
  }
];

const client = createPublicClient({
  chain: bsc,
  transport: http('https://bsc-dataseed.bnbchain.org/')
});

async function getTokenInfo(address) {
  try {
    const [name, symbol, decimals] = await Promise.all([
      client.readContract({
        address,
        abi: ERC20_ABI,
        functionName: 'name'
      }),
      client.readContract({
        address,
        abi: ERC20_ABI,
        functionName: 'symbol'
      }),
      client.readContract({
        address,
        abi: ERC20_ABI,
        functionName: 'decimals'
      })
    ]);
    return { name, symbol, decimals };
  } catch (error) {
    return { name: 'Unknown', symbol: 'Unknown', decimals: 0 };
  }
}

async function main() {
  console.log('查询 Pair 合约信息...\n');
  console.log('Pair 地址:', PAIR_ADDRESS);
  console.log('目标代币:', TARGET_TOKEN);
  console.log('');

  // 获取 pair 的两个代币
  const token0 = await client.readContract({
    address: PAIR_ADDRESS,
    abi: PAIR_ABI,
    functionName: 'token0'
  });

  const token1 = await client.readContract({
    address: PAIR_ADDRESS,
    abi: PAIR_ABI,
    functionName: 'token1'
  });

  console.log('Token0 地址:', token0);
  console.log('Token1 地址:', token1);
  console.log('');

  // 获取代币信息
  console.log('获取代币详细信息...\n');

  const token0Info = await getTokenInfo(token0);
  console.log('Token0:');
  console.log('  名称:', token0Info.name);
  console.log('  符号:', token0Info.symbol);
  console.log('  精度:', token0Info.decimals);
  console.log('  地址:', token0);
  console.log('');

  const token1Info = await getTokenInfo(token1);
  console.log('Token1:');
  console.log('  名称:', token1Info.name);
  console.log('  符号:', token1Info.symbol);
  console.log('  精度:', token1Info.decimals);
  console.log('  地址:', token1);
  console.log('');

  // 确认哪个是目标代币
  if (token0.toLowerCase() === TARGET_TOKEN.toLowerCase()) {
    console.log('✅ Token0 是目标代币');
    console.log(`配对代币是: ${token1Info.symbol} (${token1})`);
  } else if (token1.toLowerCase() === TARGET_TOKEN.toLowerCase()) {
    console.log('✅ Token1 是目标代币');
    console.log(`配对代币是: ${token0Info.symbol} (${token0})`);
  } else {
    console.log('❌ 目标代币不在这个 Pair 中');
  }
}

main().catch(console.error);
