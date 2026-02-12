/**
 * UI 相关配置
 * 通道显示信息、图标等
 */

/**
 * 通道 UI 配置
 */
export const CHANNEL_UI_CONFIG = {
  pancake: {
    displayName: 'PancakeSwap',
    shortName: 'Pancake',
    icon: '🥞',
    color: '#D1884F',
    description: 'DEX aggregator with V2/V3 routing',
  },
  'pancake-v3': {
    displayName: 'PancakeSwap V3',
    shortName: 'Pancake V3',
    icon: '🥞',
    color: '#D1884F',
    description: 'PancakeSwap V3 concentrated liquidity',
  },
  four: {
    displayName: 'Four.meme',
    shortName: 'Four',
    icon: '4️⃣',
    color: '#4444FF',
    description: 'Four.meme launchpad',
  },
  xmode: {
    displayName: 'XMode',
    shortName: 'XMode',
    icon: '❌',
    color: '#FF4444',
    description: 'XMode launchpad',
  },
  flap: {
    displayName: 'Flap',
    shortName: 'Flap',
    icon: '🦅',
    color: '#FFD700',
    description: 'Flap launchpad',
  },
  luna: {
    displayName: 'Luna.fun',
    shortName: 'Luna',
    icon: '🌙',
    color: '#9370DB',
    description: 'Luna.fun launchpad',
  },
} as const;

export type ChannelId = keyof typeof CHANNEL_UI_CONFIG;

/**
 * 获取通道显示名称
 */
export function getChannelDisplayName(channelId: string): string {
  const config = CHANNEL_UI_CONFIG[channelId as ChannelId];
  return config?.displayName || channelId;
}

/**
 * 获取通道短名称
 */
export function getChannelShortName(channelId: string): string {
  const config = CHANNEL_UI_CONFIG[channelId as ChannelId];
  return config?.shortName || channelId;
}

/**
 * 获取通道图标
 */
export function getChannelIcon(channelId: string): string {
  const config = CHANNEL_UI_CONFIG[channelId as ChannelId];
  return config?.icon || '🔗';
}

/**
 * 获取通道颜色
 */
export function getChannelColor(channelId: string): string {
  const config = CHANNEL_UI_CONFIG[channelId as ChannelId];
  return config?.color || '#666666';
}
