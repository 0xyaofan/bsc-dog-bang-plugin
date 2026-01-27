/**
 * 检查 USAT 与常见代币的流动性池
 */

import { createPublicClient, http, getAddress } from 'viem';
import { bsc } from 'viem/chains';

const PANCAKE_FACTORY = getAddress('0xca143ce32fe78f1f7019d7d551a6402fc5350c73');
const WBNB = getAddress('0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c');
const USAT = getAddress('0xdb7a6d5a127ea5c0a3576677112f13d731232a27');
const USDT = getAddress('0x55d398326f99059ff775485246999027b3197955');
const USDC = getAddress('0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d');
const BUSD = getAddress('0xe9e7cea3dedca5984780bafc599bd69add087d56');

const FACTORY_ABI = [
  {
    inputs: [
      { internalType: 'address', name: '', type: 'address' },
      { internalType: 'address', name: '', type: 'address' }
    ],
    name: 'getPair',
    outputs: [{ internalType: 'address', name: '', type: 'address' }],
    stateMutability: 'view',
    type: 'function'
  }
];

const client = createPublicClient({
  chain: bsc,
  transport: http('https://bsc-dataseed.bnbchain.org/')
});

async function checkPair(token0, token1, label) {
  try {
    const pairAddress = await client.readContract({
      address: PANCAKE_FACTORY,
      abi: FACTORY_ABI,
      functionName: 'getPair',
      args: [token0, token1]
    });

    const exists = pairAddress !== '0x0000000000000000000000000000000000000000';
    console.log(`${label}: ${exists ? '✅ 存在' : '❌ 不存在'}`);
    if (exists) {
      console.log(`  Pair 地址: ${pairAddress}`);
    }
    return { exists, pairAddress };
  } catch (error) {
    console.log(`${label}: ❌ 查询失败 - ${error.message}`);
    return { exists: false, pairAddress: null };
  }
}

async function main() {
  console.log('检查 USAT 与常见代币的流动性池...\n');
  console.log('USAT:', USAT);
  console.log('');

  // 检查 USAT 与各种代币的池
  const pairs = [
    { token: WBNB, name: 'WBNB' },
    { token: USDT, name: 'USDT' },
    { token: USDC, name: 'USDC' },
    { token: BUSD, name: 'BUSD' }
  ];

  const results = [];
  for (const { token, name } of pairs) {
    const result = await checkPair(USAT, token, `USAT-${name} 池`);
    results.push({ name, ...result });
  }

  console.log('\n可用的桥接路径:');
  for (const { name, exists, pairAddress } of results) {
    if (exists) {
      console.log(`✅ WBNB → ${name} → USAT → TOKEN`);
      console.log(`   需要检查 WBNB-${name} 池是否存在`);
    }
  }

  // 检查 WBNB 与稳定币的池
  console.log('\n检查 WBNB 与稳定币的流动性池:');
  for (const { token, name } of pairs.slice(1)) {
    await checkPair(WBNB, token, `WBNB-${name} 池`);
  }
}

main().catch(console.error);
