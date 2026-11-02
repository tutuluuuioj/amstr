module.exports = {
  apps: [
    {
      name: "amstr-autonomous-keeper",
      script: "src/autonomous-runner.ts",
      interpreter: "node",
      interpreter_args: "--loader tsx",
      cwd: __dirname,
      autorestart: true,
      watch: false,
      max_memory_restart: "300M",
      restart_delay: 3000,
      exp_backoff_restart_delay: 2000,
      env: {
        NODE_ENV: "production",
        // Alerts: Discord Webhook or Telegram Bot
        ALERT_WEBHOOK_URL: process.env.ALERT_WEBHOOK_URL || "",
        TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN || "",
        TELEGRAM_CHAT_ID: process.env.TELEGRAM_CHAT_ID || "",
      },
      log_date_format: "YYYY-MM-DD HH:mm:ss Z",
      error_file: "./logs/keeper-error.log",
      out_file: "./logs/keeper-out.log",
      merge_logs: true,
    },
  ],
};
