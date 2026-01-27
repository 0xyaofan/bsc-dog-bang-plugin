/**
 * 检查 USAT 与已知桥接代币的流动性池
 */

import { createPublicClient, http, getAddress } from 'viem';
import { bsc } from 'viem/chains';

const PANCAKE_FACTORY = getAddress('0xca143ce32fe78f1f7019d7d551a6402fc5350c73');
const WBNB = getAddress('0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c');
const USAT = getAddress('0xdb7a6d5a127ea5c0a3576677112f13d731232a27');

// 已知的桥接代币
const BRIDGE_TOKENS = {
  USDT: getAddress('0x55d398326f99059ff775485246999027b3197955'),
  USDC: getAddress('0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d'),
  BUSD: getAddress('0xe9e7cea3dedca5984780bafc599bd69add087d56'),
  ASTER: getAddress('0x000ae314e2a2172a039b26378814c252734f556a'),
  USD1: getAddress('0x8d0d000ee44948fc98c9b98a4fa4921476f08b0d'),
  UNITED_STABLES_U: getAddress('0xce24439f2d9c6a2289f741120fe202248b666666'),
  CAKE: getAddress('0x0e09fabb73bd3ade0a17ecc321fd13a19e81ce82')
};

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

async function checkPair(token0, token1) {
  try {
    const pairAddress = await client.readContract({
      address: PANCAKE_FACTORY,
      abi: FACTORY_ABI,
      functionName: 'getPair',
      args: [token0, token1]
    });
    return pairAddress !== '0x0000000000000000000000000000000000000000' ? pairAddress : null;
  } catch (error) {
    return null;
  }
}

async function main() {
  console.log('检查 USAT 与已知桥接代币的流动性池...\n');
  console.log('USAT:', USAT);
  console.log('');

  const validPaths = [];

  for (const [name, address] of Object.entries(BRIDGE_TOKENS)) {
    // 检查 USAT 与桥接代币的池
    const usatBridgePair = await checkPair(USAT, address);

    if (usatBridgePair) {
      // 检查桥接代币与 WBNB 的池
      const bridgeWbnbPair = await checkPair(address, WBNB);

      if (bridgeWbnbPair) {
        console.log(`✅ 找到有效路径: WBNB → ${name} → USAT`);
        console.log(`   USAT-${name} Pair: ${usatBridgePair}`);
        console.log(`   ${name}-WBNB Pair: ${bridgeWbnbPair}`);
        console.log('');
        validPaths.push({ bridge: name, address, usatBridgePair, bridgeWbnbPair });
      } else {
        console.log(`⚠️  USAT-${name} 池存在，但 ${name}-WBNB 池不存在`);
        console.log(`   USAT-${name} Pair: ${usatBridgePair}`);
        console.log('');
      }
    }
  }

  if (validPaths.length === 0) {
    console.log('❌ 没有找到有效的 2-hop 路径');
    console.log('');
    console.log('可能的解决方案:');
    console.log('1. 实现 3-hop 或更多跳的路由支持');
    console.log('2. 使用 PancakeSwap V3 的智能路由');
    console.log('3. 使用其他聚合器（如 1inch）');
  } else {
    console.log(`\n✅ 找到 ${validPaths.length} 个有效路径`);
    console.log('\n建议的路由配置:');
    for (const { bridge, address } of validPaths) {
      console.log(`- 添加 ${bridge} (${address}) 作为 USAT 的桥接代币`);
    }
  }
}

main().catch(console.error);
