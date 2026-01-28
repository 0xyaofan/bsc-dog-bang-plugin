/**
 * 检查 USAT-UDOG V3 池
 */

import { createPublicClient, http, getAddress } from 'viem';
import { bsc } from 'viem/chains';

const PANCAKE_V3_FACTORY = getAddress('0x0BFbCF9fa4f9C56B0F40a671Ad40E0805A091865');
const WBNB = getAddress('0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c');
const USAT = getAddress('0xdb7a6d5a127ea5c0a3576677112f13d731232a27');
const UDOG = getAddress('0xcc411e6eac8f660972bf06ac5ea12058267755f0');

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
  console.log('检查完整的 V3 路由可行性...\n');
  console.log('WBNB:', WBNB);
  console.log('USAT:', USAT);
  console.log('UDOG:', UDOG);
  console.log('');

  // 检查 WBNB-USAT V3 池
  console.log('第一步：WBNB → USAT');
  let wbnbUsatPool = null;
  let wbnbUsatFee = null;

  for (const fee of FEE_TIERS) {
    const pool = await checkV3Pool(WBNB, USAT, fee);
    if (pool) {
      wbnbUsatPool = pool;
      wbnbUsatFee = fee;
      console.log(`  ✅ 找到 V3 池 (fee ${fee/10000}%): ${pool}`);
      break;
    }
  }

  if (!wbnbUsatPool) {
    console.log('  ❌ 没有找到 WBNB-USAT V3 池');
    return;
  }

  console.log('');

  // 检查 USAT-UDOG V3 池
  console.log('第二步：USAT → UDOG');
  let usatUdogPool = null;
  let usatUdogFee = null;

  for (const fee of FEE_TIERS) {
    const pool = await checkV3Pool(USAT, UDOG, fee);
    if (pool) {
      usatUdogPool = pool;
      usatUdogFee = fee;
      console.log(`  ✅ 找到 V3 池 (fee ${fee/10000}%): ${pool}`);
      break;
    }
  }

  if (!usatUdogPool) {
    console.log('  ❌ 没有找到 USAT-UDOG V3 池');
    console.log('');
    console.log('结论：无法完全使用 V3 路由');
    console.log('USAT-UDOG 只有 V2 池，需要混合 V2/V3 路由');
    return;
  }

  console.log('');
  console.log('✅ 完整的 V3 路由可行！');
  console.log('');
  console.log('路径：');
  console.log(`  WBNB → USAT (V3, fee ${wbnbUsatFee/10000}%)`);
  console.log(`  USAT → UDOG (V3, fee ${usatUdogFee/10000}%)`);
  console.log('');
  console.log('池地址：');
  console.log(`  WBNB-USAT: ${wbnbUsatPool}`);
  console.log(`  USAT-UDOG: ${usatUdogPool}`);
  console.log('');
  console.log('可以使用 PancakeSwap V3 SmartRouter 的 exactInput 函数');
  console.log('编码路径：WBNB → USAT → UDOG');
}

main().catch(console.error);
