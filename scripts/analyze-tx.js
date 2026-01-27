/**
 * 分析成功的买入交易
 */

import { createPublicClient, http, decodeAbiParameters, parseAbiParameters } from 'viem';
import { bsc } from 'viem/chains';

const TX_HASH = '0x3acb99af049fc7b1c3252a98169fd314deee75180c3068f9537db5faa36cb070';

const client = createPublicClient({
  chain: bsc,
  transport: http('https://bsc-dataseed.bnbchain.org/')
});

async function main() {
  console.log('分析交易:', TX_HASH);
  console.log('');

  // 获取交易详情
  const tx = await client.getTransaction({ hash: TX_HASH });

  console.log('交易详情:');
  console.log('  From:', tx.from);
  console.log('  To:', tx.to);
  console.log('  Value:', tx.value.toString(), 'wei');
  console.log('  Gas:', tx.gas.toString());
  console.log('');

  // 获取交易回执
  const receipt = await client.getTransactionReceipt({ hash: TX_HASH });

  console.log('交易状态:', receipt.status === 'success' ? '✅ 成功' : '❌ 失败');
  console.log('Gas Used:', receipt.gasUsed.toString());
  console.log('');

  // 解析输入数据
  console.log('Input Data:');
  console.log('  Function Selector:', tx.input.slice(0, 10));
  console.log('  Data Length:', tx.input.length);
  console.log('');

  // 分析日志事件
  console.log('事件日志:');
  console.log(`  共 ${receipt.logs.length} 个事件`);
  console.log('');

  // 查找 Swap 事件
  const swapEvents = receipt.logs.filter(log => {
    // PancakeSwap V2 Swap event signature
    // Swap(address indexed sender, uint amount0In, uint amount1In, uint amount0Out, uint amount1Out, address indexed to)
    return log.topics[0] === '0xd78ad95fa46c994b6551d0da85fc275fe613ce37657fb8d5e3d130840159d822';
  });

  if (swapEvents.length > 0) {
    console.log(`找到 ${swapEvents.length} 个 Swap 事件:`);
    swapEvents.forEach((event, index) => {
      console.log(`\n  Swap ${index + 1}:`);
      console.log(`    Pair 地址: ${event.address}`);
      console.log(`    Topics: ${event.topics.length}`);
    });
  }

  // 分析路径
  console.log('\n路径分析:');
  console.log(`  交易调用的合约: ${tx.to}`);

  // 检查是否是 PancakeSwap Router
  const PANCAKE_ROUTER = '0x10ED43C718714eb63d5aA57B78B54704E256024E'.toLowerCase();
  const PANCAKE_SMART_ROUTER = '0x13f4EA83D0bd40E75C8222255bc855a974568Dd4'.toLowerCase();

  if (tx.to.toLowerCase() === PANCAKE_ROUTER) {
    console.log('  ✅ 使用 PancakeSwap V2 Router');
  } else if (tx.to.toLowerCase() === PANCAKE_SMART_ROUTER) {
    console.log('  ✅ 使用 PancakeSwap SmartRouter (V3)');
  } else {
    console.log('  ⚠️  使用其他合约:', tx.to);
  }

  console.log(`\n  Swap 跳数: ${swapEvents.length}`);

  if (swapEvents.length > 0) {
    console.log('\n  路径推断:');
    console.log('  WBNB (起点)');
    swapEvents.forEach((event, index) => {
      console.log(`    ↓ Swap ${index + 1} (Pair: ${event.address})`);
      console.log(`    ↓ 中间代币 ${index + 1}`);
    });
    console.log('    ↓ 最终代币 (UDOG)');
  }

  // 打印完整的 input data 用于进一步分析
  console.log('\n完整 Input Data (前 500 字符):');
  console.log(tx.input.slice(0, 500));
}

main().catch(console.error);
