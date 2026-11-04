import { spawn } from 'node:child_process';

console.log('🌱 Starting IrrigIQ Development Environment...');

// 1. Build shared package first
const build = spawn('npm', ['run', 'build', '-w', '@irrigiq/shared'], { stdio: 'inherit', shell: true });

build.on('close', (code) => {
  if (code !== 0) {
    console.error('❌ Failed to build @irrigiq/shared');
    process.exit(code ?? 1);
  }

  console.log('✅ @irrigiq/shared compiled successfully.');
  console.log('🚀 Starting API (http://localhost:4001) and Web Frontend (http://localhost:3000 / 5173)...');

  const env = {
    ...process.env,
    PORT: process.env.PORT || '4001',
    API_PORT: process.env.API_PORT || '4001',
    MONGODB_URI: process.env.MONGODB_URI || 'mongodb://127.0.0.1:27018/irrigiq',
    REDIS_URL: process.env.REDIS_URL || 'redis://127.0.0.1:6380',
    VITE_PROXY_TARGET: 'http://127.0.0.1:4001',
  };

  const api = spawn('npm', ['run', 'dev', '-w', '@irrigiq/api'], { stdio: 'inherit', shell: true, env });
  const web = spawn('npm', ['run', 'dev', '-w', '@irrigiq/web'], { stdio: 'inherit', shell: true, env });

  const cleanup = () => {
    api.kill();
    web.kill();
    process.exit(0);
  };

  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);
});
