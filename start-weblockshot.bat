@echo off
rem WebLockShot 一键启动（构建 + 伴生服务）
cd /d "%~dp0"
if not exist node_modules (
  echo 首次运行，安装依赖中...
  call npm install
)
if not exist dist (
  echo 构建生产包中...
  call npm run build
)
echo 启动 WebLockShot 伴生服务 http://localhost:5174
node server\weblockshot-server.mjs --port 5174
pause
