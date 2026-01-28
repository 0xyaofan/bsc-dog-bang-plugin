/**
 * 测试 UDOG 混合 V2/V3 路由检测
 * 验证系统能否正确检测 UDOG-USAT 需要混合路由
 */

import { createPublicClient, http, getAddress } from 'viem';
import { bsc } from 'viem/chains';

// 合约地址
const PANCAKE_V2_FACTORY = getAddress('0xca143ce32fe78f1f7019d7d551a6402fc5350c73');
const PANCAKE_V3_FACTORY = getAddress('0x0BFbCF9fa4f9C56B0F40a671Ad40E0805A091865');
const WBNB = getAddress('0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c');
const USAT = getAddress('0xdb7a6d5a127ea5c0a3576677112f13d731232a27');
const UDOG = getAddress('0xcc411e6eac8f660972bf06ac5ea12058267755f0');

// ABI
const V2_FACTORY_ABI = [
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

async function checkV2Pair(token0, token1) {
  try {
    const pair = await client.readContract({
      address: PANCAKE_V2_FACTORY,
      abi: V2_FACTORY_ABI,
      functionName: 'getPair',
      args: [token0, token1]
    });
    return pair !== '0x0000000000000000000000000000000000000000' ? pair : null;
  } catch (error) {
    return null;
  }
}

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
  console.log('🧪 测试 UDOG 混合 V2/V3 路由检测\n');
  console.log('代币地址:');
  console.log(`  WBNB: ${WBNB}`);
  console.log(`  USAT: ${USAT}`);
  console.log(`  UDOG: ${UDOG}`);
  console.log('');

  // 第一步：检查 WBNB-UDOG 直接路径
  console.log('📍 步骤 1: 检查 WBNB-UDOG 直接路径');
  console.log('');

  console.log('  检查 V2 Pair...');
  const wbnbUdogV2 = await checkV2Pair(WBNB, UDOG);
  if (wbnbUdogV2) {
    console.log(`    ✅ V2 Pair 存在: ${wbnbUdogV2}`);
  } else {
    console.log('    ❌ V2 Pair 不存在');
  }

  console.log('  检查 V3 Pool...');
  let wbnbUdogV3 = null;
  for (const fee of FEE_TIERS) {
    const pool = await checkV3Pool(WBNB, UDOG, fee);
    if (pool) {
      wbnbUdogV3 = pool;
      console.log(`    ✅ V3 Pool 存在 (fee ${fee/10000}%): ${pool}`);
      break;
    }
  }
  if (!wbnbUdogV3) {
    console.log('    ❌ V3 Pool 不存在');
  }

  console.log('');

  // 第二步：检查 WBNB-USAT 路径
  console.log('📍 步骤 2: 检查 WBNB-USAT 路径（第一跳）');
  console.log('');

  console.log('  检查 V2 Pair...');
  const wbnbUsatV2 = await checkV2Pair(WBNB, USAT);
  if (wbnbUsatV2) {
    console.log(`    ✅ V2 Pair 存在: ${wbnbUsatV2}`);
  } else {
    console.log('    ❌ V2 Pair 不存在');
  }

  console.log('  检查 V3 Pool...');
  let wbnbUsatV3 = null;
  let wbnbUsatFee = null;
  for (const fee of FEE_TIERS) {
    const pool = await checkV3Pool(WBNB, USAT, fee);
    if (pool) {
      wbnbUsatV3 = pool;
      wbnbUsatFee = fee;
      console.log(`    ✅ V3 Pool 存在 (fee ${fee/10000}%): ${pool}`);
      break;
    }
  }
  if (!wbnbUsatV3) {
    console.log('    ❌ V3 Pool 不存在');
  }

  console.log('');

  // 第三步：检查 USAT-UDOG 路径
  console.log('📍 步骤 3: 检查 USAT-UDOG 路径（第二跳）');
  console.log('');

  console.log('  检查 V2 Pair...');
  const usatUdogV2 = await checkV2Pair(USAT, UDOG);
  if (usatUdogV2) {
    console.log(`    ✅ V2 Pair 存在: ${usatUdogV2}`);
  } else {
    console.log('    ❌ V2 Pair 不存在');
  }

  console.log('  检查 V3 Pool...');
  let usatUdogV3 = null;
  for (const fee of FEE_TIERS) {
    const pool = await checkV3Pool(USAT, UDOG, fee);
    if (pool) {
      usatUdogV3 = pool;
      console.log(`    ✅ V3 Pool 存在 (fee ${fee/10000}%): ${pool}`);
      break;
    }
  }
  if (!usatUdogV3) {
    console.log('    ❌ V3 Pool 不存在');
  }

  console.log('');
  console.log('═══════════════════════════════════════════════════════');
  console.log('');

  // 分析结果
  console.log('📊 分析结果:');
  console.log('');

  if (!wbnbUdogV2 && !wbnbUdogV3) {
    console.log('  ✅ WBNB-UDOG 没有直接路径（符合预期）');
  } else {
    console.log('  ⚠️  WBNB-UDOG 存在直接路径（不符合预期）');
  }

  if (wbnbUsatV3 && !wbnbUsatV2) {
    console.log('  ✅ WBNB-USAT 只有 V3 池（符合预期）');
  } else if (wbnbUsatV2 && !wbnbUsatV3) {
    console.log('  ⚠️  WBNB-USAT 只有 V2 池（不符合预期）');
  } else if (wbnbUsatV2 && wbnbUsatV3) {
    console.log('  ℹ️  WBNB-USAT 同时有 V2 和 V3 池');
  } else {
    console.log('  ❌ WBNB-USAT 没有任何池');
  }

  if (usatUdogV2 && !usatUdogV3) {
    console.log('  ✅ USAT-UDOG 只有 V2 池（符合预期）');
  } else if (usatUdogV3 && !usatUdogV2) {
    console.log('  ⚠️  USAT-UDOG 只有 V3 池（不符合预期）');
  } else if (usatUdogV2 && usatUdogV3) {
    console.log('  ℹ️  USAT-UDOG 同时有 V2 和 V3 池');
  } else {
    console.log('  ❌ USAT-UDOG 没有任何池');
  }

  console.log('');

  // 判断是否需要混合路由
  if (wbnbUsatV3 && usatUdogV2 && !wbnbUsatV2 && !usatUdogV3) {
    console.log('🎯 结论: 需要混合 V2/V3 路由');
    console.log('');
    console.log('  推荐路径:');
    console.log(`    第一步 (V3): WBNB → USAT (fee ${wbnbUsatFee/10000}%)`);
    console.log(`    第二步 (V2): USAT → UDOG`);
    console.log('');
    console.log('  池地址:');
    console.log(`    WBNB-USAT V3: ${wbnbUsatV3}`);
    console.log(`    USAT-UDOG V2: ${usatUdogV2}`);
    console.log('');
    console.log('  ✅ 系统应该能够自动执行两步交易');
  } else if (wbnbUsatV2 && usatUdogV3 && !wbnbUsatV3 && !usatUdogV2) {
    console.log('🎯 结论: 需要混合 V2/V3 路由（V2 → V3）');
    console.log('');
    console.log('  推荐路径:');
    console.log('    第一步 (V2): WBNB → USAT');
    console.log('    第二步 (V3): USAT → UDOG');
    console.log('');
    console.log('  ⚠️  当前系统暂不支持 V2 → V3 的混合路由');
  } else if ((wbnbUsatV2 || wbnbUsatV3) && (usatUdogV2 || usatUdogV3)) {
    console.log('ℹ️  结论: 可以使用单一协议路由');
    console.log('');
    if (wbnbUsatV3 && usatUdogV3) {
      console.log('  可以使用纯 V3 路由: WBNB → USAT → UDOG');
    }
    if (wbnbUsatV2 && usatUdogV2) {
      console.log('  可以使用纯 V2 路由: WBNB → USAT → UDOG');
    }
  } else {
    console.log('❌ 结论: 无法找到有效的交易路径');
  }

  console.log('');
  console.log('═══════════════════════════════════════════════════════');
}

main().catch(console.error);
