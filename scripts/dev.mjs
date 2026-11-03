/* global console, process */
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
  console.log('🚀 Starting API (http://localhost:4000) and Web Frontend (http://localhost:5173)...');

  const api = spawn('npm', ['run', 'dev', '-w', '@irrigiq/api'], { stdio: 'inherit', shell: true });
  const web = spawn('npm', ['run', 'dev', '-w', '@irrigiq/web'], { stdio: 'inherit', shell: true });

  const cleanup = () => {
    api.kill();
    web.kill();
    process.exit(0);
  };

  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);
});
