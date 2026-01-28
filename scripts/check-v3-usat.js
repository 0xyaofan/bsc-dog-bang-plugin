/**
 * 检查 PancakeSwap V3 中的 USAT 流动性池
 */

import { createPublicClient, http, getAddress } from 'viem';
import { bsc } from 'viem/chains';

const PANCAKE_V3_FACTORY = getAddress('0x0BFbCF9fa4f9C56B0F40a671Ad40E0805A091865');
const WBNB = getAddress('0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c');
const USAT = getAddress('0xdb7a6d5a127ea5c0a3576677112f13d731232a27');
const USDT = getAddress('0x55d398326f99059ff775485246999027b3197955');

const V3_FACTORY_ABI = [
  {
    inputs: [
      { internalType: 'address', name: 'tokenA', type: 'address' },
      { internalType: 'address', name: 'tokenB', type: 'address' },
      { internalType: 'uint24', name: 'fee', type: 'uint24' }
    ],
    name: 'getPool',
    outputs: [{ internalType: 'address', name: 'pool', type: 'address' }],
    stateMutability: 'view',
    type: 'function'
  }
];

const FEE_TIERS = [100, 500, 2500, 10000]; // 0.01%, 0.05%, 0.25%, 1%

const client = createPublicClient({
  chain: bsc,
  transport: http('https://bsc-dataseed.bnbchain.org/')
});

async function checkV3Pool(token0, token1, fee) {
  try {
    const pool = await client.readContract({
      address: PANCAKE_V3_FACTORY,
      abi: V3_FACTORY_ABI,
      functionName: 'getPool',
      args: [token0, token1, fee]
    });
    return pool !== '0x0000000000000000000000000000000000000000' ? pool : null;
  } catch (error) {
    return null;
  }
}

async function main() {
  console.log('检查 PancakeSwap V3 中的 USAT 流动性池...\n');
  console.log('USAT:', USAT);
  console.log('WBNB:', WBNB);
  console.log('');

  const pairs = [
    { name: 'WBNB', address: WBNB },
    { name: 'USDT', address: USDT }
  ];

  let foundAny = false;

  for (const { name, address } of pairs) {
    console.log(`检查 USAT-${name}:`);

    for (const fee of FEE_TIERS) {
      const pool = await checkV3Pool(USAT, address, fee);
      if (pool) {
        console.log(`  ✅ 找到池 (fee ${fee/10000}%): ${pool}`);
        foundAny = true;
      }
    }

    if (!foundAny) {
      console.log(`  ❌ 没有找到任何费率的池`);
    }
    console.log('');
  }

  if (!foundAny) {
    console.log('结论：USAT 在 PancakeSwap V3 中也没有流动性池');
    console.log('');
    console.log('这个代币可能：');
    console.log('1. 使用其他 DEX（非 PancakeSwap）');
    console.log('2. 使用自定义的流动性提供方式');
    console.log('3. 需要特殊的合约来交易');
  }
}

main().catch(console.error);
