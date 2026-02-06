/**
 * 查询 Four.meme 已迁移代币的完整信息
 * 目的：确认迁移后 helper 返回的数据结构
 */

import { createPublicClient, http } from 'viem';
import { bsc } from 'viem/chains';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// 读取 ABI
const helperAbi = JSON.parse(
  fs.readFileSync(join(__dirname, '../abis/token-manager-helper-v3.json'), 'utf-8')
);

const factoryAbi = JSON.parse(
  fs.readFileSync(join(__dirname, '../abis/pancake-factory.json'), 'utf-8')
);

// 配置
const FOUR_HELPER_V3 = '0xF251F83e40a78868FcfA3FA4599Dad6494E46034';
const PANCAKE_FACTORY = '0xcA143Ce32Fe78f1f7019d7d551a6402fC5350c73';
const BSC_RPC = 'https://api.zan.top/node/v1/bsc/mainnet/9ca4f22e10234d7ab736c8a8dc2911a6/';

// 已迁移的代币地址
const TOKEN_ADDRESS = '0x7f0c0db02609b7acd5ed60dc81a1208b15144444';

// 创建客户端
const client = createPublicClient({
  chain: bsc,
  transport: http(BSC_RPC, {
    timeout: 15000
  })
});

async function main() {
  console.log('========================================');
  console.log('Four.meme 已迁移代币信息查询');
  console.log('========================================');
  console.log(`代币地址: ${TOKEN_ADDRESS}`);
  console.log(`Helper 合约: ${FOUR_HELPER_V3}`);
  console.log('');

  try {
    // 1. 查询 getTokenInfo
    console.log('1️⃣  调用 getTokenInfo()...');
    const tokenInfo = await client.readContract({
      address: FOUR_HELPER_V3,
      abi: helperAbi,
      functionName: 'getTokenInfo',
      args: [TOKEN_ADDRESS]
    });

    console.log('返回结果:');
    console.log('  version:', tokenInfo[0]?.toString());
    console.log('  tokenManager:', tokenInfo[1]);
    console.log('  quote (筹集币种):', tokenInfo[2]);
    console.log('  lastPrice:', tokenInfo[3]?.toString());
    console.log('  tradingFeeRate:', tokenInfo[4]?.toString());
    console.log('  minTradingFee:', tokenInfo[5]?.toString());
    console.log('  launchTime:', tokenInfo[6]?.toString());
    console.log('  offers:', tokenInfo[7]?.toString());
    console.log('  maxOffers:', tokenInfo[8]?.toString());
    console.log('  funds:', tokenInfo[9]?.toString());
    console.log('  maxFunds:', tokenInfo[10]?.toString());
    console.log('  liquidityAdded:', tokenInfo[11]);
    console.log('');

    const quoteToken = tokenInfo[2];
    const liquidityAdded = tokenInfo[11];

    // 2. 查询 getPancakePair
    console.log('2️⃣  调用 getPancakePair()...');
    const pairFromHelper = await client.readContract({
      address: FOUR_HELPER_V3,
      abi: helperAbi,
      functionName: 'getPancakePair',
      args: [TOKEN_ADDRESS]
    });

    console.log('返回结果:');
    console.log('  LP Pair 地址:', pairFromHelper);
    console.log('');

    // 3. 直接查询 Pancake Factory
    if (quoteToken && quoteToken !== '0x0000000000000000000000000000000000000000') {
      console.log('3️⃣  直接查询 PancakeSwap Factory...');
      console.log(`查询参数: getPair(${TOKEN_ADDRESS}, ${quoteToken})`);

      const pairFromFactory = await client.readContract({
        address: PANCAKE_FACTORY,
        abi: factoryAbi,
        functionName: 'getPair',
        args: [TOKEN_ADDRESS, quoteToken]
      });

      console.log('返回结果:');
      console.log('  LP Pair 地址:', pairFromFactory);
      console.log('');

      // 比较两个结果
      if (pairFromHelper.toLowerCase() === pairFromFactory.toLowerCase()) {
        console.log('✅ Helper 返回的 pair 地址与 Factory 查询一致');
      } else {
        console.log('⚠️  Helper 返回的 pair 地址与 Factory 查询不一致！');
      }
    }

    console.log('');
    console.log('========================================');
    console.log('📊 分析结论');
    console.log('========================================');

    console.log(`状态: ${liquidityAdded ? '✅ 已迁移到 Pancake' : '❌ 未迁移'}`);
    console.log(`筹集币种: ${quoteToken || '未知'}`);
    console.log(`LP Pair: ${pairFromHelper || '不存在'}`);
    console.log('');

    if (liquidityAdded && quoteToken && pairFromHelper) {
      console.log('💡 优化建议:');
      console.log('  1. ✅ Four.meme helper 迁移后仍然返回 quoteToken');
      console.log('  2. ✅ helper 提供了 getPancakePair() 方法直接获取 LP 地址');
      console.log('  3. 💡 可以使用 getPancakePair() 代替 Factory.getPair() 查询');
      console.log('  4. 💡 如果 helper.getPancakePair() 返回非零地址，无需再查询 Factory');
      console.log('');
      console.log('📝 代码优化方向:');
      console.log('  - 迁移后可以调用 helper.getPancakePair() 直接获取 LP 地址');
      console.log('  - 减少一次 Factory.getPair() 的 RPC 查询');
    } else if (!liquidityAdded) {
      console.log('💡 未迁移状态:');
      console.log('  - 使用平台合约交易（Four.meme TokenManager）');
      console.log('  - 不需要查询 Pancake pair');
      console.log('  - 自定义聚合器合约处理 BNB ↔ Quote Token 兑换');
    }

  } catch (error) {
    console.error('❌ 查询失败:', error.message);
    if (error.cause) {
      console.error('原因:', error.cause);
    }
  }
}

main().catch(console.error);
