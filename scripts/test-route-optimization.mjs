/**
 * 测试优化后的 token-route 逻辑
 * 验证 helper.getPancakePair() 的使用
 */

import { createPublicClient, http } from 'viem';
import { bsc } from 'viem/chains';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const helperAbi = JSON.parse(
  fs.readFileSync(join(__dirname, '../abis/token-manager-helper-v3.json'), 'utf-8')
);

const factoryAbi = JSON.parse(
  fs.readFileSync(join(__dirname, '../abis/pancake-factory.json'), 'utf-8')
);

// 配置
const BSC_RPC = 'https://api.zan.top/node/v1/bsc/mainnet/9ca4f22e10234d7ab736c8a8dc2911a6/';
const FOUR_HELPER_V3 = '0xF251F83e40a78868FcfA3FA4599Dad6494E46034';
const PANCAKE_FACTORY = '0xcA143Ce32Fe78f1f7019d7d551a6402fC5350c73';
const TOKEN_ADDRESS = '0xf74548802f4c700315f019fde17178b392ee4444';

const client = createPublicClient({
  chain: bsc,
  transport: http(BSC_RPC, { timeout: 15000 })
});

async function main() {
  console.log('========================================');
  console.log('测试优化后的路由查询逻辑');
  console.log('========================================\n');

  const startTime = Date.now();

  // 1. 查询 tokenInfo（必需）
  console.log('步骤 1: 查询 getTokenInfo()...');
  const t1 = Date.now();
  const info = await client.readContract({
    address: FOUR_HELPER_V3,
    abi: helperAbi,
    functionName: 'getTokenInfo',
    args: [TOKEN_ADDRESS]
  });
  const t1End = Date.now();
  console.log(`  耗时: ${t1End - t1}ms`);

  const liquidityAdded = info[11];
  const quoteToken = info[2];
  console.log(`  liquidityAdded: ${liquidityAdded}`);
  console.log(`  quoteToken: ${quoteToken}`);
  console.log('');

  if (liquidityAdded) {
    // 方案 A: 使用 helper.getPancakePair()（优化后）
    console.log('方案 A (优化): 使用 helper.getPancakePair()');
    const t2 = Date.now();
    const pairFromHelper = await client.readContract({
      address: FOUR_HELPER_V3,
      abi: helperAbi,
      functionName: 'getPancakePair',
      args: [TOKEN_ADDRESS]
    });
    const t2End = Date.now();
    console.log(`  LP Pair: ${pairFromHelper}`);
    console.log(`  耗时: ${t2End - t2}ms`);
    console.log(`  总耗时: ${t2End - startTime}ms (getTokenInfo + getPancakePair)`);
    console.log('');

    // 方案 B: 使用 Factory.getPair()（优化前）
    console.log('方案 B (优化前): 使用 Factory.getPair()');
    const t3 = Date.now();

    // 需要规范化地址（checksum）
    const normalizedToken = TOKEN_ADDRESS;
    const normalizedQuote = quoteToken;

    const pairFromFactory = await client.readContract({
      address: PANCAKE_FACTORY,
      abi: factoryAbi,
      functionName: 'getPair',
      args: [normalizedToken, normalizedQuote]
    });
    const t3End = Date.now();
    console.log(`  LP Pair: ${pairFromFactory}`);
    console.log(`  耗时: ${t3End - t3}ms`);
    console.log(`  总耗时: ${t3End - startTime}ms (getTokenInfo + Factory.getPair)`);
    console.log('');

    // 比较结果
    console.log('========================================');
    console.log('📊 对比结果');
    console.log('========================================\n');

    const helperLower = (pairFromHelper || '').toLowerCase();
    const factoryLower = (pairFromFactory || '').toLowerCase();

    if (helperLower === factoryLower) {
      console.log('✅ 两种方案返回相同的 pair 地址');
    } else {
      console.log('⚠️  两种方案返回不同的 pair 地址！');
      console.log(`  Helper:  ${pairFromHelper}`);
      console.log(`  Factory: ${pairFromFactory}`);
    }
    console.log('');

    const helperTime = t2End - t2;
    const factoryTime = t3End - t3;
    const timeSaved = factoryTime - helperTime;
    const percentSaved = ((timeSaved / factoryTime) * 100).toFixed(1);

    console.log('⏱️  性能对比:');
    console.log(`  helper.getPancakePair():  ${helperTime}ms`);
    console.log(`  Factory.getPair():        ${factoryTime}ms`);
    console.log(`  节省时间: ${timeSaved}ms (${percentSaved}%)`);
    console.log('');

    console.log('💡 优化效果:');
    if (helperLower === factoryLower && helperLower !== '0x0000000000000000000000000000000000000000') {
      console.log('  ✅ helper.getPancakePair() 返回正确的 pair 地址');
      console.log('  ✅ 可以替代 Factory.getPair() 查询');
      console.log(`  ✅ 节省 ${timeSaved}ms 查询时间`);
      console.log('  ✅ 减少一次 RPC 请求');
    } else if (helperLower === '0x0000000000000000000000000000000000000000') {
      console.log('  ⚠️  helper.getPancakePair() 返回零地址');
      console.log('  ⚠️  需要回退到 Factory.getPair() 查询');
    } else {
      console.log('  ⚠️  两种方案结果不一致，需要进一步调查');
    }
  } else {
    console.log('代币未迁移，无需查询 Pancake pair');
  }
}

main().catch(console.error);
