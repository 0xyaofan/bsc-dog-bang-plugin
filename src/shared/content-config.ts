export const CONTENT_CONFIG = {
  // 背景端响应端口请求的超时时间（毫秒）
  PORT_REQUEST_TIMEOUT_MS: 15000,

  // 按钮计时器的 UI 更新间隔
  BUTTON_TIMER_REFRESH_INTERVAL_MS: 100,

  // 通道状态刷新默认间隔和最小延迟
  ROUTE_REFRESH_DEFAULT_DELAY_MS: 5000,
  ROUTE_REFRESH_MIN_DELAY_MS: 1000,

  // 买/卖提交后再次拉取钱包状态与路由的延迟
  POST_TRADE_REFRESH_DELAY_MS: 1500,

  // 卖出估算定时刷新频率
  SELL_ESTIMATE_INTERVAL_MS: 1000,

  // 自动授权前的短暂 debounce，确保通道选择器渲染完成
  AUTO_APPROVE_DEBOUNCE_MS: 10,

  // 调试模式下性能日志的输出间隔
  PERF_LOG_INTERVAL_MS: 5 * 60 * 1000,

  // PUSH 模式下余额轮询频率（当 UI_CONFIG 未配置时的兜底值）
  BALANCE_POLL_FALLBACK_MS: 5000,

  // 状态提示在 UI_CONFIG 未指定时的默认展示时长
  STATUS_MESSAGE_FALLBACK_MS: 5000
};
