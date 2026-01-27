/**
 * 检查神秘合约的信息
 */

import { createPublicClient, http, getAddress } from 'viem';
import { bsc } from 'viem/chains';

const CONTRACT_ADDRESS = getAddress('0x9e488cad7d2f459cd86428b1ece855506bdba8b3');

const client = createPublicClient({
  chain: bsc,
  transport: http('https://bsc-dataseed.bnbchain.org/')
});

async function main() {
  console.log('检查合约:', CONTRACT_ADDRESS);
  console.log('');

  // 检查是否是合约
  const code = await client.getBytecode({ address: CONTRACT_ADDRESS });

  if (code && code !== '0x') {
    console.log('✅ 这是一个合约');
    console.log('  代码长度:', code.length, '字节');
  } else {
    console.log('❌ 这不是一个合约（可能是 EOA）');
  }

  console.log('');
  console.log('BSCScan 链接:');
  console.log(`https://bscscan.com/address/${CONTRACT_ADDRESS}`);
  console.log('');

  // 获取该合约的最近交易
  console.log('获取最近的交易...');

  try {
    const latestBlock = await client.getBlockNumber();
    console.log('  当前区块:', latestBlock.toString());

    // 尝试获取合约的余额
    const balance = await client.getBalance({ address: CONTRACT_ADDRESS });
    console.log('  合约余额:', balance.toString(), 'wei');
  } catch (error) {
    console.log('  获取信息失败:', error.message);
  }

  console.log('');
  console.log('建议:');
  console.log('1. 在 BSCScan 上查看这个合约的详细信息');
  console.log('2. 查看合约是否已验证，如果已验证可以看到源代码');
  console.log('3. 分析合约的其他交易，了解它的工作原理');
}

main().catch(console.error);
