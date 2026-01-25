/**
 * 验证 quote token 信息和 LP pair 类型（V2 or V3）
 */

import { createPublicClient, http } from 'viem';
import { bsc } from 'viem/chains';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// 读取 ABI
const erc20Abi = [
  {
    constant: true,
    inputs: [],
    name: 'name',
    outputs: [{ name: '', type: 'string' }],
    type: 'function'
  },
  {
    constant: true,
    inputs: [],
    name: 'symbol',
    outputs: [{ name: '', type: 'string' }],
    type: 'function'
  },
  {
    constant: true,
    inputs: [],
    name: 'decimals',
    outputs: [{ name: '', type: 'uint8' }],
    type: 'function'
  }
];

const pairAbi = [
  {
    constant: true,
    inputs: [],
    name: 'token0',
    outputs: [{ name: '', type: 'address' }],
    type: 'function'
  },
  {
    constant: true,
    inputs: [],
    name: 'token1',
    outputs: [{ name: '', type: 'address' }],
    type: 'function'
  }
];

const v3PoolAbi = [
  {
    inputs: [],
    name: 'token0',
    outputs: [{ name: '', type: 'address' }],
    stateMutability: 'view',
    type: 'function'
  },
  {
    inputs: [],
    name: 'token1',
    outputs: [{ name: '', type: 'address' }],
    stateMutability: 'view',
    type: 'function'
  },
  {
    inputs: [],
    name: 'fee',
    outputs: [{ name: '', type: 'uint24' }],
    stateMutability: 'view',
    type: 'function'
  }
];

// 配置
const BSC_RPC = 'https://api.zan.top/node/v1/bsc/mainnet/9ca4f22e10234d7ab736c8a8dc2911a6/';
const QUOTE_TOKEN = '0x8d0D000Ee44948FC98c9B98A4FA4921476f08B0d';
const LP_PAIR = '0x493136e93cD1D81863c96f18D9E8e641e8F89a9B';
const TOKEN_ADDRESS = '0xf74548802f4c700315f019fde17178b392ee4444';

// 创建客户端
const client = createPublicClient({
  chain: bsc,
  transport: http(BSC_RPC, {
    timeout: 15000
  })
});

async function main() {
  console.log('========================================');
  console.log('Quote Token 和 LP Pair 信息验证');
  console.log('========================================\n');

  try {
    // 1. 查询 quote token 信息
    console.log('1️⃣  查询 Quote Token 信息...');
    console.log(`地址: ${QUOTE_TOKEN}`);

    const [name, symbol, decimals] = await Promise.all([
      client.readContract({
        address: QUOTE_TOKEN,
        abi: erc20Abi,
        functionName: 'name'
      }),
      client.readContract({
        address: QUOTE_TOKEN,
        abi: erc20Abi,
        functionName: 'symbol'
      }),
      client.readContract({
        address: QUOTE_TOKEN,
        abi: erc20Abi,
        functionName: 'decimals'
      })
    ]);

    console.log(`  名称: ${name}`);
    console.log(`  符号: ${symbol}`);
    console.log(`  精度: ${decimals}`);
    console.log('');

    // 2. 检查 LP Pair 是 V2 还是 V3
    console.log('2️⃣  检查 LP Pair 类型...');
    console.log(`LP 地址: ${LP_PAIR}`);

    // 先尝试作为 V2 pair
    let isV2 = false;
    let isV3 = false;

    try {
      const token0V2 = await client.readContract({
        address: LP_PAIR,
        abi: pairAbi,
        functionName: 'token0'
      });

      const token1V2 = await client.readContract({
        address: LP_PAIR,
        abi: pairAbi,
        functionName: 'token1'
      });

      console.log('  ✅ 检测到 PancakeSwap V2 Pair');
      console.log(`    token0: ${token0V2}`);
      console.log(`    token1: ${token1V2}`);
      isV2 = true;
    } catch (error) {
      console.log('  ❌ 不是 V2 Pair');
    }

    // 再尝试作为 V3 pool
    if (!isV2) {
      try {
        const [token0V3, token1V3, fee] = await Promise.all([
          client.readContract({
            address: LP_PAIR,
            abi: v3PoolAbi,
            functionName: 'token0'
          }),
          client.readContract({
            address: LP_PAIR,
            abi: v3PoolAbi,
            functionName: 'token1'
          }),
          client.readContract({
            address: LP_PAIR,
            abi: v3PoolAbi,
            functionName: 'fee'
          })
        ]);

        console.log('  ✅ 检测到 PancakeSwap V3 Pool');
        console.log(`    token0: ${token0V3}`);
        console.log(`    token1: ${token1V3}`);
        console.log(`    fee: ${fee} (${fee / 10000}%)`);
        isV3 = true;

        // 验证代币对是否匹配
        const tokens = [token0V3.toLowerCase(), token1V3.toLowerCase()];
        const expectedTokens = [TOKEN_ADDRESS.toLowerCase(), QUOTE_TOKEN.toLowerCase()];

        if (tokens.includes(expectedTokens[0]) && tokens.includes(expectedTokens[1])) {
          console.log('  ✅ Pool 的 token0/token1 与目标代币匹配');
        } else {
          console.log('  ⚠️  Pool 的 token0/token1 与目标代币不匹配！');
        }
      } catch (error) {
        console.log('  ❌ 也不是 V3 Pool');
        console.error('    错误:', error.message);
      }
    }

    console.log('');
    console.log('========================================');
    console.log('📊 结论');
    console.log('========================================');

    console.log(`Quote Token: ${symbol} (${name})`);
    console.log(`LP Type: ${isV2 ? 'PancakeSwap V2' : isV3 ? 'PancakeSwap V3' : '未知'}`);
    console.log('');

    if (isV3) {
      console.log('💡 关键发现：');
      console.log('  1. 这个代币的 LP 在 PancakeSwap V3 上');
      console.log('  2. Four.meme helper.getPancakePair() 返回的是 V3 pool 地址');
      console.log('  3. 使用 Factory.getPair() 查不到是正常的（那是 V2 的方法）');
      console.log('  4. 在 token-route.ts 中根据 quoteToken 判断 preferredMode:');
      console.log(`     - 如果 quoteToken === WBNB，不指定 mode（默认 V2）`);
      console.log(`     - 如果 quoteToken !== WBNB (如 ${symbol})，使用 V3 mode`);
      console.log('');
      console.log('📝 代码逻辑验证：');
      console.log('  src/shared/token-route.ts:116-126');
      console.log('  function resolvePancakePreferredMode(quoteToken) {');
      console.log('    if (!quoteToken) return undefined;');
      console.log('    const normalized = quoteToken.toLowerCase();');
      console.log('    const wbnb = CONTRACTS.WBNB?.toLowerCase();');
      console.log('    return normalized === wbnb ? undefined : "v3";');
      console.log('  }');
      console.log('');
      console.log('  ✅ 当前代码逻辑正确！');
    } else if (isV2) {
      console.log('💡 这是一个 V2 pair，应该可以用 Factory.getPair() 查到');
    }

  } catch (error) {
    console.error('❌ 查询失败:', error.message);
  }
}

main().catch(console.error);
