#!/usr/bin/env node

interface SimulatorArgs {
  api: string;
  key: string;
  speed: number; // 60 means 1 day per 60 seconds
  runOnce?: boolean;
}

function parseArgs(args: string[]): SimulatorArgs {
  const result: SimulatorArgs = {
    api: process.env.API_URL || 'http://localhost:4000',
    key: process.env.SENSOR_KEY || '',
    speed: 60,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--api' && args[i + 1]) {
      result.api = args[++i]!;
    } else if (arg === '--key' && args[i + 1]) {
      result.key = args[++i]!;
    } else if (arg === '--speed' && args[i + 1]) {
      result.speed = parseFloat(args[++i]!);
    } else if (arg === '--runOnce') {
      result.runOnce = true;
    }
  }

  return result;
}

/**
 * Soil Moisture Simulator
 * Model:
 * Each simulated day:
 * - Moisture falls by ETc divided by soil active root zone depth capacity.
 * - Rises with rainfall or logged irrigation.
 * - Adds small sensor measurement noise (+/- 0.3%).
 * - Clamps moisture between 0% and 100%.
 */
export async function runSimulator(options?: Partial<SimulatorArgs>): Promise<void> {
  const cliArgs = parseArgs(process.argv.slice(2));
  const config: SimulatorArgs = { ...cliArgs, ...options };

  if (!config.key) {
    console.error('❌ Error: Sensor API key is required.');
    console.error('Usage: npm run simulate -- --api <url> --key <sensorKey> --speed 60');
    process.exit(1);
  }

  // Normalize API url (strip trailing slash)
  const apiUrl = config.api.replace(/\/+$/, '');

  console.log('🌱 IrrigIQ Soil Moisture Simulator');
  console.log(`🔗 Target API : ${apiUrl}`);
  console.log(`🔑 Sensor Key : ${config.key.slice(0, 8)}...${config.key.slice(-4)}`);
  console.log(`⚡ Speed      : ${config.speed} (1 simulated day = ${60 / (config.speed / 60)}s)`);

  let currentMoisture = 55.0; // Initial moisture %
  let simulatedDay = 1;
  let simulatedHour = 6; // Starts at 06:00 AM

  // 1 simulated day = (60 / (speed / 60)) seconds.
  // We advance in 1-hour increments (24 ticks per simulated day).
  const tickIntervalMs = Math.max(200, Math.round(((60 / config.speed) * 60 * 1000) / 24));

  // Physics constants:
  // ETc: ~4.0 mm/day during vegetative/mid stage
  // Active soil capacity: ~35 mm
  // Daily moisture drop = (4.0 / 35) * 100 = ~11.4% per day
  const dailyEtcMm = 4.2;
  const rootCapacityMm = 35.0;
  const hourlyDropPct = (dailyEtcMm / rootCapacityMm / 24) * 100;

  let isRunning = true;
  process.on('SIGINT', () => {
    console.log('\n🛑 Stopping simulator gracefully...');
    isRunning = false;
    process.exit(0);
  });

  async function step(): Promise<void> {
    simulatedHour++;
    if (simulatedHour >= 24) {
      simulatedHour = 0;
      simulatedDay++;
    }

    // Solar cycle weighting: higher ETc during midday sun (10:00 to 16:00)
    const sunFactor =
      simulatedHour >= 6 && simulatedHour <= 18
        ? 1.0 + Math.sin(((simulatedHour - 6) / 12) * Math.PI) * 0.8
        : 0.2;

    const moistureDrop = hourlyDropPct * sunFactor;

    // Small sensor noise (+/- 0.2%)
    const noise = (Math.random() - 0.5) * 0.4;

    // Simulated irrigation trigger: if moisture drops below 35%, simulated farmer irrigates
    let irrigationRise = 0;
    if (currentMoisture <= 35 && (simulatedHour === 7 || simulatedHour === 17)) {
      irrigationRise = 25.0; // +25% jump from irrigation
      console.log(`💦 [Day ${simulatedDay}, ${simulatedHour}:00] Irrigation detected! Moisture rising.`);
    }

    // Random light rain chance (~5% per day)
    let rainRise = 0;
    if (simulatedDay % 5 === 0 && simulatedHour === 14) {
      rainRise = 12.0;
      console.log(`🌧️ [Day ${simulatedDay}, ${simulatedHour}:00] Rain event! Moisture rising.`);
    }

    currentMoisture = currentMoisture - moistureDrop + irrigationRise + rainRise + noise;
    currentMoisture = Math.min(100, Math.max(0, Number(currentMoisture.toFixed(1))));

    // Diurnal temperature: 20°C min (night), 33°C max (afternoon)
    const tempC = Number(
      (26.5 + 6.5 * Math.sin(((simulatedHour - 9) / 24) * 2 * Math.PI) + (Math.random() - 0.5)).toFixed(1),
    );

    const now = new Date();
    const payload = {
      moisturePct: currentMoisture,
      tempC,
      timestamp: now.toISOString(),
    };

    try {
      const response = await fetch(`${apiUrl}/sensor-readings`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': config.key,
        },
        body: JSON.stringify(payload),
      });

      const timeStr = `${String(simulatedHour).padStart(2, '0')}:00`;
      if (response.ok) {
        console.log(
          `⏱️  [Day ${simulatedDay}, ${timeStr}] Moisture: ${currentMoisture.toFixed(1)}% | Temp: ${tempC}°C | Status: ${response.status} OK`,
        );
      } else {
        const errText = await response.text();
        console.warn(
          `⚠️  [Day ${simulatedDay}, ${timeStr}] API Response ${response.status}: ${errText}`,
        );
      }
    } catch (err: unknown) {
      console.error(`❌ Failed connecting to API at ${apiUrl}:`, (err as Error).message);
    }
  }

  // Initial step
  await step();

  if (config.runOnce) {
    return;
  }

  while (isRunning) {
    await new Promise((resolve) => setTimeout(resolve, tickIntervalMs));
    await step();
  }
}

// Execute CLI when directly run
if (process.argv[1]?.endsWith('simulator/src/index.ts') || process.argv[1]?.endsWith('simulator/dist/index.js')) {
  runSimulator().catch((err) => {
    console.error('Fatal simulator error:', err);
    process.exit(1);
  });
}
