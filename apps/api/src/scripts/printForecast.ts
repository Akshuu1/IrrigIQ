import { fetchForecast, weatherCellKey } from '../services/weather.service.js';

async function main() {
  const args = process.argv.slice(2);
  const lat = args[0] ? parseFloat(args[0]) : 26.9; // Jaipur default
  const lon = args[1] ? parseFloat(args[1]) : 75.8;

  const cellKey = weatherCellKey(lat, lon);
  console.log(`\n======================================================`);
  console.log(` IrrigIQ Weather Service - 7-Day Forecast`);
  console.log(` Location: Lat ${lat}, Lon ${lon} (Grid Cell: ${cellKey})`);
  console.log(` Timezone: Asia/Kolkata`);
  console.log(`======================================================\n`);

  try {
    const days = await fetchForecast(lat, lon, 7);

    console.log(`| Date       | Tmax (°C) | Tmin (°C) | Rain (mm) | ET0 (mm) | Source       |`);
    console.log(`|------------|-----------|-----------|-----------|----------|--------------|`);

    for (const day of days) {
      const date = day.date.padEnd(10);
      const tmax = `${day.tmaxC.toFixed(1)}°C`.padEnd(9);
      const tmin = `${day.tminC.toFixed(1)}°C`.padEnd(9);
      const rain = `${day.rainMm.toFixed(2)}`.padEnd(9);
      const et0 = `${day.et0Mm.toFixed(2)}`.padEnd(8);
      const source = day.source.padEnd(12);

      console.log(`| ${date} | ${tmax} | ${tmin} | ${rain} | ${et0} | ${source} |`);
    }

    console.log(`\nForecast successfully fetched and normalized.`);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`Error fetching forecast:`, msg);
    process.exit(1);
  }
}

main();
