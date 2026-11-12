/* global __ENV, __VU, __ITER */
import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate, Trend } from 'k6/metrics';

// Custom Metrics
const errorRate = new Rate('custom_error_rate');
const dashboardDuration = new Trend('dashboard_req_duration');
const recommendationDuration = new Trend('recommendation_req_duration');
const sensorDuration = new Trend('sensor_req_duration');

const BASE_URL = __ENV.API_URL || 'http://127.0.0.1:4001';

export const options = {
  scenarios: {
    // Scenario 1: Logged-in farmers reading dashboards and recommendations at ramping rates
    user_browsing: {
      executor: 'ramping-vus',
      startVUs: 1,
      stages: [
        { duration: '5s', target: 10 },
        { duration: '15s', target: 30 },
        { duration: '5s', target: 0 },
      ],
      gracefulRampDown: '2s',
      exec: 'userBrowsingScenario',
    },

    // Scenario 2: 100 simulated sensors posting readings every 30 seconds
    sensor_ingestion: {
      executor: 'constant-vus',
      vus: 100,
      duration: '35s',
      gracefulStop: '2s',
      exec: 'sensorIngestionScenario',
    },
  },

  thresholds: {
    http_req_failed: ['rate<0.01'], // Global error rate < 1%
    http_req_duration: ['p(95)<800'], // 95% of requests under 800ms on a single runner machine
  },
  setupTimeout: '120s',
};

/**
 * Setup runs once before test scenarios:
 * Registers a test user, creates a field, and creates sensors.
 */
export function setup() {
  const uniqueId = Date.now();
  const registerPayload = JSON.stringify({
    email: `loadtest_${uniqueId}@example.com`,
    password: 'Password123!',
    name: 'Load Test Farmer',
    language: 'en',
    areaUnit: 'acre',
  });

  const regRes = http.post(`${BASE_URL}/auth/register`, registerPayload, {
    headers: { 'Content-Type': 'application/json' },
  });

  check(regRes, {
    'user registered successfully': (r) => r.status === 201,
  });

  const regBody = regRes.json();
  const token = regBody.data?.accessToken;

  // Create a test field
  const fieldPayload = JSON.stringify({
    name: 'Load Test Field Alpha',
    geometry: {
      type: 'Polygon',
      coordinates: [
        [
          [77.209, 28.6139],
          [77.215, 28.6139],
          [77.215, 28.619],
          [77.209, 28.619],
          [77.209, 28.6139],
        ],
      ],
    },
    cropKey: 'wheat',
    sowingDate: '2026-10-15',
    soilType: 'loam',
    method: 'drip',
    baseline: {
      everyDays: 5,
      depthMm: 30,
    },
  });

  const fieldRes = http.post(`${BASE_URL}/fields`, fieldPayload, {
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
  });

  check(fieldRes, {
    'field created successfully': (r) => r.status === 201,
  });

  const fieldId = fieldRes.json()?.data?.field?.id;

  // Create 20 sensors to simulate field IoT nodes (shared by 100 VUs via modulo)
  const sensorKeys = [];
  for (let i = 0; i < 20; i++) {
    const sensorRes = http.post(
      `${BASE_URL}/fields/${fieldId}/sensors`,
      JSON.stringify({ name: `Node-${i + 1}`, isSimulated: true }),
      {
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
      },
    );

    if (sensorRes.status === 201) {
      const apiKey = sensorRes.json()?.data?.apiKey;
      if (apiKey) sensorKeys.push(apiKey);
    }
  }

  return {
    token,
    fieldId,
    sensorKeys,
  };
}

/**
 * Scenario 1: Logged-in user reading dashboard fields, recommendations, and savings
 */
export function userBrowsingScenario(data) {
  const authHeaders = {
    Authorization: `Bearer ${data.token}`,
    'Content-Type': 'application/json',
  };

  // 1. Fetch dashboard fields list
  const fieldsRes = http.get(`${BASE_URL}/fields`, { headers: authHeaders });
  dashboardDuration.add(fieldsRes.timings.duration);
  const fieldsOk = check(fieldsRes, {
    'GET /fields status is 200': (r) => r.status === 200,
  });
  errorRate.add(!fieldsOk);

  sleep(0.3);

  // 2. Fetch 7-day recommendations for the field
  const recRes = http.get(`${BASE_URL}/fields/${data.fieldId}/recommendations`, {
    headers: authHeaders,
  });
  recommendationDuration.add(recRes.timings.duration);
  const recOk = check(recRes, {
    'GET /recommendations status is 200': (r) => r.status === 200,
  });
  errorRate.add(!recOk);

  sleep(0.3);

  // 3. Fetch water savings calculation
  const savingsRes = http.get(
    `${BASE_URL}/fields/${data.fieldId}/savings?from=2026-11-01&to=2026-11-07`,
    { headers: authHeaders },
  );
  const savingsOk = check(savingsRes, {
    'GET /savings status is 200': (r) => r.status === 200,
  });
  errorRate.add(!savingsOk);

  // Farmer think-time
  sleep(1.0);
}

/**
 * Scenario 2: 100 simulated IoT sensors posting moisture readings every 30 seconds
 */
export function sensorIngestionScenario(data) {
  // Select sensor key assigned to this VU index (modulo 100)
  const sensorIndex = (__VU - 1) % data.sensorKeys.length;
  const apiKey = data.sensorKeys[sensorIndex];

  if (!apiKey) {
    sleep(1);
    return;
  }

  // Generate realistic soil moisture (50-65%) and temperature (20-30°C)
  const moisturePct = Number((52.0 + Math.sin(__ITER) * 8.0 + Math.random() * 2).toFixed(1));
  const tempC = Number((24.5 + Math.random() * 4).toFixed(1));

  const payload = JSON.stringify({
    moisturePct,
    tempC,
    timestamp: new Date().toISOString(),
  });

  const res = http.post(`${BASE_URL}/sensor-readings`, payload, {
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
    },
  });

  sensorDuration.add(res.timings.duration);
  const postOk = check(res, {
    'POST /sensor-readings status is 200 or 201': (r) => r.status === 200 || r.status === 201,
  });
  errorRate.add(!postOk);

  // Each of the 100 sensors posts every 30 seconds
  sleep(30);
}
