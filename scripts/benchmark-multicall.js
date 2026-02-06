/**
 * MultiCall vs 并发查询性能测试
 *
 * 测试场景：
 * 1. 查询3个合约的 allowance（授权）
 * 2. 查询代币的 symbol, decimals, totalSupply
 * 3. 查询多个代币的余额
 */

import { createPublicClient, http } from 'viem';
import { bsc } from 'viem/chains';

// BSC 主网 RPC
const RPC_URL = 'https://api.zan.top/node/v1/bsc/mainnet/9ca4f22e10234d7ab736c8a8dc2911a6';

// 测试用的地址
const TEST_TOKEN = '0x55d398326f99059fF775485246999027B3197955'; // USDT
const TEST_WALLET = '0x39039D3dD16c831940AE3841c8a622ad96788525';
const PANCAKE_ROUTER = '0x10ED43C718714eb63d5aA57B78B54704E256024E';
const FOUR_TOKEN_MANAGER = '0x8888888888888888888888888888888888888888'; // 示例地址
const FLAP_PORTAL = '0x9999999999999999999999999999999999999999'; // 示例地址

const ERC20_ABI = [
  {
    inputs: [
      { name: 'owner', type: 'address' },
      { name: 'spender', type: 'address' }
    ],
    name: 'allowance',
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function'
  },
  {
    inputs: [{ name: 'account', type: 'address' }],
    name: 'balanceOf',
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function'
  },
  {
    inputs: [],
    name: 'symbol',
    outputs: [{ name: '', type: 'string' }],
    stateMutability: 'view',
    type: 'function'
  },
  {
    inputs: [],
    name: 'decimals',
    outputs: [{ name: '', type: 'uint8' }],
    stateMutability: 'view',
    type: 'function'
  },
  {
    inputs: [],
    name: 'totalSupply',
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function'
  }
];

// 创建客户端
const client = createPublicClient({
  chain: bsc,
  transport: http(RPC_URL)
});

/**
 * 方法1：并发查询（Promise.all）
 */
async function benchmarkConcurrent() {
  const start = performance.now();

  const [allowance1, allowance2, allowance3] = await Promise.all([
    client.readContract({
      address: TEST_TOKEN,
      abi: ERC20_ABI,
      functionName: 'allowance',
      args: [TEST_WALLET, PANCAKE_ROUTER]
    }),
    client.readContract({
      address: TEST_TOKEN,
      abi: ERC20_ABI,
      functionName: 'allowance',
      args: [TEST_WALLET, FOUR_TOKEN_MANAGER]
    }),
    client.readContract({
      address: TEST_TOKEN,
      abi: ERC20_ABI,
      functionName: 'allowance',
      args: [TEST_WALLET, FLAP_PORTAL]
    })
  ]);

  const duration = performance.now() - start;

  return {
    method: 'Concurrent (Promise.all)',
    duration: duration.toFixed(2),
    rpcCalls: 3,
    results: [allowance1, allowance2, allowance3]
  };
}

/**
 * 方法2：Viem MultiCall
 */
async function benchmarkMultiCall() {
  const start = performance.now();

  // 使用 viem 的 multicall 功能
  const results = await client.multicall({
    contracts: [
      {
        address: TEST_TOKEN,
        abi: ERC20_ABI,
        functionName: 'allowance',
        args: [TEST_WALLET, PANCAKE_ROUTER]
      },
      {
        address: TEST_TOKEN,
        abi: ERC20_ABI,
        functionName: 'allowance',
        args: [TEST_WALLET, FOUR_TOKEN_MANAGER]
      },
      {
        address: TEST_TOKEN,
        abi: ERC20_ABI,
        functionName: 'allowance',
        args: [TEST_WALLET, FLAP_PORTAL]
      }
    ]
  });

  const duration = performance.now() - start;

  // 提取结果
  const decoded = results.map(r => r.result);

  return {
    method: 'Viem MultiCall',
    duration: duration.toFixed(2),
    rpcCalls: 1,
    results: decoded
  };
}

/**
 * 运行基准测试
 */
async function runBenchmark() {
  console.log('🚀 开始性能测试：MultiCall vs 并发查询\n');
  console.log('测试场景：查询3个合约的 allowance');
  console.log('测试代币：USDT (BSC)');
  console.log('测试次数：每种方法运行5次\n');

  const concurrentResults = [];
  const multicallResults = [];

  // 预热
  console.log('⏳ 预热中...');
  await benchmarkConcurrent();
  await benchmarkMultiCall();
  console.log('✅ 预热完成\n');

  // 测试并发查询
  console.log('📊 测试并发查询 (Promise.all)...');
  for (let i = 0; i < 5; i++) {
    const result = await benchmarkConcurrent();
    concurrentResults.push(parseFloat(result.duration));
    console.log(`  第 ${i + 1} 次: ${result.duration}ms`);
    await sleep(500); // 避免限流
  }

  console.log('\n📊 测试 Viem MultiCall...');
  for (let i = 0; i < 5; i++) {
    const result = await benchmarkMultiCall();
    multicallResults.push(parseFloat(result.duration));
    console.log(`  第 ${i + 1} 次: ${result.duration}ms`);
    await sleep(500); // 避免限流
  }

  // 计算统计数据
  const concurrentAvg = average(concurrentResults);
  const multicallAvg = average(multicallResults);
  const improvement = ((concurrentAvg - multicallAvg) / concurrentAvg * 100).toFixed(2);

  console.log('\n' + '='.repeat(60));
  console.log('📈 测试结果汇总');
  console.log('='.repeat(60));
  console.log(`\n并发查询 (Promise.all):`);
  console.log(`  平均耗时: ${concurrentAvg.toFixed(2)}ms`);
  console.log(`  RPC 调用次数: 3 次`);
  console.log(`  最快: ${Math.min(...concurrentResults).toFixed(2)}ms`);
  console.log(`  最慢: ${Math.max(...concurrentResults).toFixed(2)}ms`);

  console.log(`\nViem MultiCall:`);
  console.log(`  平均耗时: ${multicallAvg.toFixed(2)}ms`);
  console.log(`  RPC 调用次数: 1 次`);
  console.log(`  最快: ${Math.min(...multicallResults).toFixed(2)}ms`);
  console.log(`  最慢: ${Math.max(...multicallResults).toFixed(2)}ms`);

  console.log(`\n性能对比:`);
  if (multicallAvg < concurrentAvg) {
    console.log(`  ✅ MultiCall 更快，提升 ${improvement}%`);
    console.log(`  ✅ 减少 RPC 调用：3 次 -> 1 次 (减少 66.7%)`);
  } else {
    console.log(`  ⚠️  并发查询更快，快 ${Math.abs(parseFloat(improvement))}%`);
    console.log(`  ⚠️  但 MultiCall 减少 RPC 调用：3 次 -> 1 次`);
  }

  console.log('\n💡 建议:');
  if (multicallAvg < concurrentAvg * 0.8) {
    console.log('  ✅ 强烈推荐使用 MultiCall（速度更快且减少 RPC 调用）');
  } else if (multicallAvg < concurrentAvg) {
    console.log('  ✅ 推荐使用 MultiCall（速度相近但减少 RPC 调用）');
  } else if (multicallAvg < concurrentAvg * 1.2) {
    console.log('  ✅ 推荐使用 MultiCall（速度略慢但减少 RPC 调用，避免限流）');
  } else {
    console.log('  ⚠️  可以继续使用并发查询（速度明显更快）');
    console.log('  ⚠️  但建议在高频场景使用 MultiCall 避免限流');
  }

  console.log('\n' + '='.repeat(60));
}

function average(arr) {
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// 运行测试
runBenchmark().catch(console.error);
