/**
 * 尝试发现 USAT 的桥接路径
 * 通过暴力搜索常见代币
 */

import { createPublicClient, http, getAddress } from 'viem';
import { bsc } from 'viem/chains';

const PANCAKE_FACTORY = getAddress('0xca143ce32fe78f1f7019d7d551a6402fc5350c73');
const WBNB = getAddress('0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c');
const USAT = getAddress('0xdb7a6d5a127ea5c0a3576677112f13d731232a27');

// 扩展的代币列表（包括一些不太常见的代币）
const POTENTIAL_BRIDGES = {
  // 主流稳定币
  USDT: '0x55d398326f99059ff775485246999027b3197955',
  USDC: '0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d',
  BUSD: '0xe9e7cea3dedca5984780bafc599bd69add087d56',
  DAI: '0x1af3f329e8be154074d8769d1ffa4ee058b1dbc3',

  // DeFi 代币
  CAKE: '0x0e09fabb73bd3ade0a17ecc321fd13a19e81ce82',
  ASTER: '0x000ae314e2a2172a039b26378814c252734f556a',
  USD1: '0x8d0d000ee44948fc98c9b98a4fa4921476f08b0d',
  UNITED_STABLES_U: '0xce24439f2d9c6a2289f741120fe202248b666666',

  // 其他可能的桥接代币
  ETH: '0x2170ed0880ac9a755fd29b2688956bd959f933f8',
  BTCB: '0x7130d2a12b9bcbfae4f2634d864a1ee1ce3ead9c',
  DOT: '0x7083609fce4d1d8dc0c979aab8c869ea2c873402',
  ADA: '0x3ee2200efb3400fabb9aacf31297cbdd1d435d47',
  XRP: '0x1d2f0da169ceb9fc7b3144628db156f3f6c60dbe',

  // BSC 生态代币
  VAI: '0x4bd17003473389a42daf6a0a729f6fdb328bbbd7',
  ALPACA: '0x8f0528ce5ef7b51152a59745befdd91d97091d2f',
  BIFI: '0xca3f508b8e4dd382ee878a314789373d80a5190a'
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
  console.log('搜索 USAT 的桥接路径...\n');
  console.log('USAT:', USAT);
  console.log('WBNB:', WBNB);
  console.log('');

  const validPaths = [];

  console.log('检查中...');
  let checked = 0;
  const total = Object.keys(POTENTIAL_BRIDGES).length;

  for (const [name, address] of Object.entries(POTENTIAL_BRIDGES)) {
    checked++;
    process.stdout.write(`\r进度: ${checked}/${total}`);

    // 检查 USAT 与桥接代币的池
    const usatBridgePair = await checkPair(USAT, address);

    if (usatBridgePair) {
      // 检查桥接代币与 WBNB 的池
      const bridgeWbnbPair = await checkPair(address, WBNB);

      if (bridgeWbnbPair) {
        validPaths.push({
          bridge: name,
          address: getAddress(address),
          usatBridgePair,
          bridgeWbnbPair
        });
      }
    }
  }

  console.log('\n');

  if (validPaths.length === 0) {
    console.log('❌ 没有找到有效的 2-hop 路径');
    console.log('');
    console.log('这意味着需要 3-hop 或更多跳的路径。');
    console.log('');
    console.log('建议的解决方案:');
    console.log('1. 使用 PancakeSwap SmartRouter（支持自动多跳路由）');
    console.log('2. 实现 3-hop 路由支持');
    console.log('3. 使用链下路由 API');
  } else {
    console.log(`✅ 找到 ${validPaths.length} 个有效路径:\n`);
    for (const { bridge, address, usatBridgePair, bridgeWbnbPair } of validPaths) {
      console.log(`路径: WBNB → ${bridge} → USAT → TOKEN`);
      console.log(`  ${bridge} 地址: ${address}`);
      console.log(`  WBNB-${bridge} Pair: ${bridgeWbnbPair}`);
      console.log(`  ${bridge}-USAT Pair: ${usatBridgePair}`);
      console.log('');
    }

    console.log('配置建议:');
    console.log('将以下代币添加到 dynamicBridgeTokens:');
    for (const { bridge, address } of validPaths) {
      console.log(`  ${bridge}: '${address}',`);
    }
  }
}

main().catch(console.error);
