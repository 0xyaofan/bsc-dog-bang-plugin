/**
 * 详细检查 LP Pair 的实际组成
 */

import { createPublicClient, http } from 'viem';
import { bsc } from 'viem/chains';

const BSC_RPC = 'https://api.zan.top/node/v1/bsc/mainnet/9ca4f22e10234d7ab736c8a8dc2911a6/';
const LP_PAIR = '0x493136e93cD1D81863c96f18D9E8e641e8F89a9B';
const EXPECTED_TOKEN = '0xf74548802f4c700315f019fde17178b392ee4444';
const EXPECTED_QUOTE = '0x8d0D000Ee44948FC98c9B98A4FA4921476f08B0d'; // USD1

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
  },
  {
    constant: true,
    inputs: [],
    name: 'factory',
    outputs: [{ name: '', type: 'address' }],
    type: 'function'
  }
];

const erc20Abi = [
  {
    constant: true,
    inputs: [],
    name: 'symbol',
    outputs: [{ name: '', type: 'string' }],
    type: 'function'
  }
];

const client = createPublicClient({
  chain: bsc,
  transport: http(BSC_RPC, { timeout: 15000 })
});

async function main() {
  console.log('========================================');
  console.log('详细检查 LP Pair 组成');
  console.log('========================================\n');

  console.log(`LP Pair 地址: ${LP_PAIR}`);
  console.log(`预期 Token: ${EXPECTED_TOKEN}`);
  console.log(`预期 Quote: ${EXPECTED_QUOTE} (USD1)`);
  console.log('');

  try {
    // 查询 pair 的 token0, token1, factory
    const [token0, token1, factory] = await Promise.all([
      client.readContract({
        address: LP_PAIR,
        abi: pairAbi,
        functionName: 'token0'
      }),
      client.readContract({
        address: LP_PAIR,
        abi: pairAbi,
        functionName: 'token1'
      }),
      client.readContract({
        address: LP_PAIR,
        abi: pairAbi,
        functionName: 'factory'
      })
    ]);

    console.log('Pair 信息:');
    console.log(`  Factory: ${factory}`);
    console.log(`  token0:  ${token0}`);
    console.log(`  token1:  ${token1}`);
    console.log('');

    // 查询 token 符号
    const [symbol0, symbol1] = await Promise.all([
      client.readContract({
        address: token0,
        abi: erc20Abi,
        functionName: 'symbol'
      }),
      client.readContract({
        address: token1,
        abi: erc20Abi,
        functionName: 'symbol'
      })
    ]);

    console.log('Token 符号:');
    console.log(`  token0: ${symbol0}`);
    console.log(`  token1: ${symbol1}`);
    console.log('');

    // 检查是否匹配预期
    const token0Lower = token0.toLowerCase();
    const token1Lower = token1.toLowerCase();
    const expectedTokenLower = EXPECTED_TOKEN.toLowerCase();
    const expectedQuoteLower = EXPECTED_QUOTE.toLowerCase();

    console.log('========================================');
    console.log('📊 匹配检查');
    console.log('========================================\n');

    const hasToken = token0Lower === expectedTokenLower || token1Lower === expectedTokenLower;
    const hasQuote = token0Lower === expectedQuoteLower || token1Lower === expectedQuoteLower;

    console.log(`包含目标 Token (${EXPECTED_TOKEN.slice(0, 10)}...): ${hasToken ? '✅' : '❌'}`);
    console.log(`包含目标 Quote (${EXPECTED_QUOTE.slice(0, 10)}... USD1): ${hasQuote ? '✅' : '❌'}`);
    console.log('');

    if (hasToken && hasQuote) {
      console.log('✅ 确认：Pair 是 (Token, QuoteToken)');
      console.log(`   即 (${symbol0}, ${symbol1})`);
    } else if (hasToken) {
      console.log(`⚠️  Pair 包含目标 Token，但另一个代币不是预期的 Quote Token`);
      console.log(`   实际配对: (${symbol0}, ${symbol1})`);
      console.log(`   预期配对: (Token, USD1)`);
    } else {
      console.log('❌ Pair 不包含目标 Token！');
    }

  } catch (error) {
    console.error('❌ 查询失败:', error.message);
  }
}

main().catch(console.error);
