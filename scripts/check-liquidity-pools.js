/**
 * 检查流动性池是否存在
 * 用于验证代币路由配置
 */

import { createPublicClient, http, getAddress } from 'viem';
import { bsc } from 'viem/chains';

// 合约地址（使用 getAddress 确保正确的 checksum）
const PANCAKE_FACTORY = getAddress('0xca143ce32fe78f1f7019d7d551a6402fc5350c73');
const WBNB = getAddress('0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c');
const USAT = getAddress('0xdb7a6d5a127ea5c0a3576677112f13d731232a27');
const TARGET_TOKEN = getAddress('0xcc411e6eac8f660972bf06ac5ea12058267755f0');

// Factory ABI
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

// 创建客户端
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
    return exists;
  } catch (error) {
    console.log(`${label}: ❌ 查询失败`);
    console.error(`  错误: ${error.message}`);
    return false;
  }
}

async function main() {
  console.log('检查 PancakeSwap V2 流动性池...\n');

  console.log('目标代币:', TARGET_TOKEN);
  console.log('USAT:', USAT);
  console.log('WBNB:', WBNB);
  console.log('');

  // 检查 WBNB-USAT 池
  const hasWbnbUsat = await checkPair(WBNB, USAT, 'WBNB-USAT 池');

  // 检查 TOKEN-USAT 池
  const hasTokenUsat = await checkPair(TARGET_TOKEN, USAT, 'TOKEN-USAT 池');

  // 检查 TOKEN-WBNB 池（直接路径）
  const hasTokenWbnb = await checkPair(TARGET_TOKEN, WBNB, 'TOKEN-WBNB 池');

  console.log('\n路由分析:');
  if (hasTokenWbnb) {
    console.log('✅ 可以使用直接路径: WBNB → TOKEN');
  }
  if (hasWbnbUsat && hasTokenUsat) {
    console.log('✅ 可以使用 USAT 桥接: WBNB → USAT → TOKEN');
  }
  if (!hasTokenWbnb && (!hasWbnbUsat || !hasTokenUsat)) {
    console.log('❌ 没有可用的路由路径');
    if (!hasWbnbUsat) {
      console.log('   原因: WBNB-USAT 池不存在');
    }
    if (!hasTokenUsat) {
      console.log('   原因: TOKEN-USAT 池不存在');
    }
  }
}

main().catch(console.error);
