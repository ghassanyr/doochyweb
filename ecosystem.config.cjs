module.exports = {
  apps: [
    {
      name: "doochyweb",
      cwd: __dirname,
      script: "dist/server/index.js",
      instances: 1,
      autorestart: true,
      max_memory_restart: "512M",
      time: true,
    },
  ],
};