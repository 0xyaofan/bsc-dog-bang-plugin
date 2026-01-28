/**
 * 深度搜索 USAT 到 WBNB 的路径
 * 尝试找到任何可能的连接方式
 */

import { createPublicClient, http, getAddress } from 'viem';
import { bsc } from 'viem/chains';

const PANCAKE_FACTORY = getAddress('0xca143ce32fe78f1f7019d7d551a6402fc5350c73');
const WBNB = getAddress('0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c');
const USAT = getAddress('0xdb7a6d5a127ea5c0a3576677112f13d731232a27');

// 扩展的代币列表
const ALL_TOKENS = {
  WBNB: '0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c',
  USDT: '0x55d398326f99059ff775485246999027b3197955',
  USDC: '0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d',
  BUSD: '0xe9e7cea3dedca5984780bafc599bd69add087d56',
  DAI: '0x1af3f329e8be154074d8769d1ffa4ee058b1dbc3',
  CAKE: '0x0e09fabb73bd3ade0a17ecc321fd13a19e81ce82',
  ETH: '0x2170ed0880ac9a755fd29b2688956bd959f933f8',
  BTCB: '0x7130d2a12b9bcbfae4f2634d864a1ee1ce3ead9c',
  ASTER: '0x000ae314e2a2172a039b26378814c252734f556a',
  USD1: '0x8d0d000ee44948fc98c9b98a4fa4921476f08b0d',
  UNITED_STABLES_U: '0xce24439f2d9c6a2289f741120fe202248b666666',
  DOT: '0x7083609fce4d1d8dc0c979aab8c869ea2c873402',
  ADA: '0x3ee2200efb3400fabb9aacf31297cbdd1d435d47',
  XRP: '0x1d2f0da169ceb9fc7b3144628db156f3f6c60dbe',
  VAI: '0x4bd17003473389a42daf6a0a729f6fdb328bbbd7',
  ALPACA: '0x8f0528ce5ef7b51152a59745befdd91d97091d2f',
  BIFI: '0xca3f508b8e4dd382ee878a314789373d80a5190a',
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
      args: [getAddress(token0), getAddress(token1)]
    });
    return pairAddress !== '0x0000000000000000000000000000000000000000' ? pairAddress : null;
  } catch (error) {
    return null;
  }
}

async function main() {
  console.log('深度搜索 USAT 到 WBNB 的路径...\n');
  console.log('USAT:', USAT);
  console.log('WBNB:', WBNB);
  console.log('');

  // 第一步：找到所有与 USAT 有 Pair 的代币
  console.log('第一步：查找所有与 USAT 有流动性池的代币...');
  const usatPairs = [];

  for (const [name, address] of Object.entries(ALL_TOKENS)) {
    if (address.toLowerCase() === USAT.toLowerCase()) continue;

    const pair = await checkPair(USAT, address);
    if (pair) {
      usatPairs.push({ name, address, pair });
      console.log(`  ✅ USAT-${name}: ${pair}`);
    }
  }

  if (usatPairs.length === 0) {
    console.log('  ❌ USAT 与任何已知代币都没有流动性池');
    console.log('');
    console.log('结论：USAT 是一个孤立的代币，无法通过 PancakeSwap V2 从 WBNB 到达');
    console.log('');
    console.log('可能的解决方案：');
    console.log('1. 使用 PancakeSwap V3（可能支持不同的流动性池）');
    console.log('2. 使用其他 DEX（如 Uniswap、SushiSwap 等）');
    console.log('3. 使用聚合器（如 1inch、ParaSwap 等）');
    console.log('4. 用户需要先手动获取 USAT，然后才能购买 UDOG');
    return;
  }

  console.log(`\n找到 ${usatPairs.length} 个与 USAT 配对的代币\n`);

  // 第二步：检查这些代币是否与 WBNB 有 Pair
  console.log('第二步：检查这些代币是否与 WBNB 有流动性池...');
  const validBridges = [];

  for (const { name, address, pair } of usatPairs) {
    const wbnbPair = await checkPair(address, WBNB);
    if (wbnbPair) {
      validBridges.push({ name, address, usatPair: pair, wbnbPair });
      console.log(`  ✅ ${name} 可以作为桥接: WBNB-${name} (${wbnbPair})`);
    } else {
      console.log(`  ❌ ${name} 不能作为桥接: 没有 WBNB-${name} 池`);
    }
  }

  console.log('');

  if (validBridges.length === 0) {
    console.log('❌ 没有找到有效的 2-hop 桥接路径');
    console.log('');
    console.log('第三步：尝试查找 3-hop 路径...');

    // 对于每个与 USAT 配对的代币，检查它是否与其他代币有 Pair，而那些代币又与 WBNB 有 Pair
    for (const { name: usatPairName, address: usatPairAddress } of usatPairs) {
      console.log(`\n检查 ${usatPairName} 的桥接可能性...`);

      for (const [bridgeName, bridgeAddress] of Object.entries(ALL_TOKENS)) {
        if (bridgeAddress.toLowerCase() === usatPairAddress.toLowerCase()) continue;
        if (bridgeAddress.toLowerCase() === USAT.toLowerCase()) continue;
        if (bridgeAddress.toLowerCase() === WBNB.toLowerCase()) continue;

        const pair1 = await checkPair(WBNB, bridgeAddress);
        if (!pair1) continue;

        const pair2 = await checkPair(bridgeAddress, usatPairAddress);
        if (!pair2) continue;

        console.log(`  ✅ 找到 3-hop 路径: WBNB → ${bridgeName} → ${usatPairName} → USAT`);
        console.log(`     WBNB-${bridgeName}: ${pair1}`);
        console.log(`     ${bridgeName}-${usatPairName}: ${pair2}`);
        console.log(`     ${usatPairName}-USAT: ${usatPairs.find(p => p.name === usatPairName)?.pair}`);
      }
    }
  } else {
    console.log(`✅ 找到 ${validBridges.length} 个有效的 2-hop 桥接路径:\n`);
    for (const { name, address, usatPair, wbnbPair } of validBridges) {
      console.log(`路径: WBNB → ${name} → USAT → UDOG`);
      console.log(`  WBNB-${name}: ${wbnbPair}`);
      console.log(`  ${name}-USAT: ${usatPair}`);
      console.log('');
    }
  }
}

main().catch(console.error);
