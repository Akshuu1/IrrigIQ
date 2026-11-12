import { MongoMemoryServer } from 'mongodb-memory-server';
import { spawn } from 'node:child_process';
import http from 'node:http';

async function waitForHttp(url, timeoutMs = 30000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      await new Promise((resolve, reject) => {
        const req = http.get(url, (res) => {
          if (res.statusCode && res.statusCode < 500) {
            resolve();
          } else {
            reject(new Error(`Status ${res.statusCode}`));
          }
        });
        req.on('error', reject);
        req.setTimeout(1000, () => {
          req.destroy();
          reject(new Error('Timeout'));
        });
      });
      return true;
    } catch {
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  throw new Error(`Timed out waiting for HTTP service at ${url}`);
}

async function main() {
  console.log('🚀 Setting up self-contained E2E test environment...');

  // 1. Start MongoMemoryServer
  console.log('📦 Starting MongoDB 7.0 engine for E2E...');
  const mongod = await MongoMemoryServer.create({
    binary: { version: '7.0.14' },
  });
  const mongoUri = mongod.getUri();
  console.log(`   MongoDB URI: ${mongoUri}`);

  // 2. Start API Server
  console.log('🌐 Starting IrrigIQ API on port 4001...');
  const apiEnv = {
    ...process.env,
    NODE_ENV: 'development',
    PORT: '4001',
    MONGODB_URI: mongoUri,
    REDIS_URL: 'redis://127.0.0.1:6380',
    JWT_SECRET: 'development-super-secret-jwt-key-min-32-chars-long',
    CORS_ORIGIN: 'http://localhost:3000,http://127.0.0.1:3000',
  };

  const apiProcess = spawn('node', ['--import', 'tsx', 'apps/api/src/index.ts'], {
    env: apiEnv,
    stdio: 'pipe',
  });

  apiProcess.stdout?.on('data', (d) => {
    const s = d.toString();
    if (s.includes('listening on port') || s.includes('error')) {
      process.stdout.write(`[API] ${s}`);
    }
  });
  apiProcess.stderr?.on('data', (d) => process.stderr.write(`[API ERR] ${d}`));

  await waitForHttp('http://127.0.0.1:4001/health', 30000);
  console.log('   ✅ API server is healthy at http://127.0.0.1:4001');

  // 3. Start Vite Web Client
  console.log('🖥️  Starting IrrigIQ Web client on port 3000...');
  const webEnv = {
    ...process.env,
    VITE_PROXY_TARGET: 'http://127.0.0.1:4001',
  };

  const webProcess = spawn('npx', ['vite', '--port', '3000', '--host', '127.0.0.1'], {
    cwd: 'apps/web',
    env: webEnv,
    stdio: 'pipe',
  });

  webProcess.stdout?.on('data', (d) => {
    const s = d.toString();
    if (s.includes('Local:') || s.includes('error')) {
      process.stdout.write(`[WEB] ${s}`);
    }
  });
  webProcess.stderr?.on('data', (d) => process.stderr.write(`[WEB ERR] ${d}`));

  await waitForHttp('http://127.0.0.1:3000', 30000);
  console.log('   ✅ Web client is ready at http://127.0.0.1:3000');

  // 4. Run Playwright
  console.log('\n🎭 Executing Playwright E2E Test Suite...\n');
  const pwProcess = spawn('npx', ['playwright', 'test'], {
    env: {
      ...process.env,
      PLAYWRIGHT_BASE_URL: 'http://localhost:3000',
    },
    stdio: 'inherit',
  });

  const exitCode = await new Promise((resolve) => {
    pwProcess.on('close', (code) => resolve(code ?? 0));
  });

  console.log(`\n🧹 Teardown: Stopping Web, API, and MongoDB...`);
  webProcess.kill();
  apiProcess.kill();
  await mongod.stop();

  console.log(`🎭 Playwright finished with exit code: ${exitCode}`);
  process.exit(exitCode);
}

main().catch((err) => {
  console.error('E2E run failed:', err);
  process.exit(1);
});
