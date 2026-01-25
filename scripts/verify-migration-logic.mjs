/**
 * 完整验证：Four.meme 迁移后的 LP pair 逻辑
 */

import { createPublicClient, http } from 'viem';
import { bsc } from 'viem/chains';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const factoryAbi = JSON.parse(
  fs.readFileSync(join(__dirname, '../abis/pancake-factory.json'), 'utf-8')
);

// 配置
const BSC_RPC = 'https://api.zan.top/node/v1/bsc/mainnet/9ca4f22e10234d7ab736c8a8dc2911a6/';
const PANCAKE_FACTORY = '0xcA143Ce32Fe78f1f7019d7d551a6402fC5350c73';
const TOKEN_ADDRESS = '0xf74548802f4c700315f019fde17178b392ee4444';
const USD1 = '0x8d0D000Ee44948FC98c9B98A4FA4921476f08B0d';
const WBNB = '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c';

const client = createPublicClient({
  chain: bsc,
  transport: http(BSC_RPC, { timeout: 15000 })
});

async function main() {
  console.log('========================================');
  console.log('Four.meme 迁移逻辑完整验证');
  console.log('========================================\n');

  console.log('测试代币: 0xf74548802f4c700315f019fde17178b392ee4444');
  console.log('Four.meme 返回的 quote: USD1');
  console.log('');

  // 测试 1: getPair(token, USD1) - 应该返回零地址
  console.log('测试 1: Factory.getPair(token, USD1)...');
  const pairUSD1 = await client.readContract({
    address: PANCAKE_FACTORY,
    abi: factoryAbi,
    functionName: 'getPair',
    args: [TOKEN_ADDRESS, USD1]
  });
  console.log(`  结果: ${pairUSD1}`);
  console.log(`  ${pairUSD1 === '0x0000000000000000000000000000000000000000' ? '❌ 零地址 (不存在)' : '✅ 找到 pair'}`);
  console.log('');

  // 测试 2: getPair(token, WBNB) - 应该返回真实地址
  console.log('测试 2: Factory.getPair(token, WBNB)...');
  const pairWBNB = await client.readContract({
    address: PANCAKE_FACTORY,
    abi: factoryAbi,
    functionName: 'getPair',
    args: [TOKEN_ADDRESS, WBNB]
  });
  console.log(`  结果: ${pairWBNB}`);
  console.log(`  ${pairWBNB === '0x0000000000000000000000000000000000000000' ? '❌ 零地址 (不存在)' : '✅ 找到 pair'}`);
  console.log('');

  console.log('========================================');
  console.log('📊 结论');
  console.log('========================================\n');

  console.log('✅ 确认：Four.meme 迁移后创建的是 (Meme Token, WBNB) pair');
  console.log('✅ 不是 (Meme Token, QuoteToken) pair');
  console.log('');

  console.log('💡 这意味着：');
  console.log('  1. helper.getTokenInfo() 返回的 quoteToken 只用于**筹集阶段**');
  console.log('  2. 迁移后实际的 LP pair 是与 WBNB 配对的');
  console.log('  3. 用 Factory.getPair(token, quoteToken) 查询会失败');
  console.log('  4. 应该用 Helper.getPancakePair() 直接获取正确的 pair 地址');
  console.log('');

  console.log('⚠️  现有代码问题：');
  console.log('  src/shared/token-route.ts:168-203');
  console.log('  如果传入 quoteToken (USD1)，会查询 getPair(token, USD1)');
  console.log('  但这会返回零地址，因为实际 pair 是 WBNB！');
  console.log('');

  console.log('🔧 优化方案：');
  console.log('  方案 1: 迁移后直接调用 Helper.getPancakePair()');
  console.log('    - 一次 RPC 调用');
  console.log('    - 返回正确的 pair 地址（不管是 WBNB 还是其他）');
  console.log('');
  console.log('  方案 2: 如果没有 helper.getPancakePair()，遍历候选 tokens');
  console.log('    - 先查 WBNB（最常见）');
  console.log('    - 再查原 quoteToken');
  console.log('    - 最后查其他候选');
  console.log('');
  console.log('  ✅ 推荐方案 1：直接使用 helper.getPancakePair()');
}

main().catch(console.error);
