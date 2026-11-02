import React, { useEffect, useState, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
} from 'recharts';
import { api, type Sensor, type SensorReading } from '../../api/client.js';
import {
  Activity,
  Plus,
  Key,
  Copy,
  Check,
  Radio,
  Cpu,
  Loader2,
  X,
} from 'lucide-react';

interface SoilMoistureLiveSectionProps {
  fieldId: string;
}

export function SoilMoistureLiveSection({
  fieldId,
}: SoilMoistureLiveSectionProps): React.JSX.Element {
  const { t } = useTranslation();

  const [readings, setReadings] = useState<SensorReading[]>([]);
  const [sensors, setSensors] = useState<Sensor[]>([]);
  const [latestMoisture, setLatestMoisture] = useState<number | null>(null);
  const [latestTemp, setLatestTemp] = useState<number | null>(null);
  const [lastReadingTime, setLastReadingTime] = useState<string | null>(null);
  const [isLiveConnected, setIsLiveConnected] = useState<boolean>(false);

  // Sensor creation modal state
  const [isSensorModalOpen, setIsSensorModalOpen] = useState(false);
  const [newSensorName, setNewSensorName] = useState('');
  const [isCreatingSensor, setIsCreatingSensor] = useState(false);
  const [generatedKey, setGeneratedKey] = useState<string | null>(null);
  const [hasCopiedKey, setHasCopiedKey] = useState(false);

  const eventSourceRef = useRef<EventSource | null>(null);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 1. Fetch initial historical moisture readings and sensors
  useEffect(() => {
    let mounted = true;

    async function loadData() {
      try {
        const [moistureRes, sensorsRes] = await Promise.all([
          api.getMoisture(fieldId),
          api.getSensors(fieldId),
        ]);

        if (mounted) {
          if (moistureRes.readings && moistureRes.readings.length > 0) {
            setReadings(moistureRes.readings);
            const last = moistureRes.readings[moistureRes.readings.length - 1];
            if (last) {
              setLatestMoisture(last.moisturePct);
              setLatestTemp(last.tempC);
              setLastReadingTime(new Date(last.timestamp).toLocaleTimeString());
            }
          }
          if (sensorsRes.sensors) {
            setSensors(sensorsRes.sensors);
          }
        }
      } catch (err) {
        console.error('Failed to load initial sensor readings:', err);
      }
    }

    void loadData();

    return () => {
      mounted = false;
    };
  }, [fieldId]);

  // 2. Setup Server-Sent Events (SSE) with auto-reconnect
  useEffect(() => {
    let active = true;

    function connectSSE() {
      if (!active) return;
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
      }

      const streamUrl = api.getMoistureStreamUrl(fieldId);
      const es = new EventSource(streamUrl);
      eventSourceRef.current = es;

      es.onopen = () => {
        if (active) setIsLiveConnected(true);
      };

      es.addEventListener('reading', (event: MessageEvent) => {
        if (!active) return;
        try {
          const data = JSON.parse(event.data);
          const newReading: SensorReading = {
            timestamp: data.timestamp || new Date().toISOString(),
            moisturePct: Number(data.moisturePct),
            tempC: Number(data.tempC),
          };

          setLatestMoisture(newReading.moisturePct);
          setLatestTemp(newReading.tempC);
          setLastReadingTime(new Date(newReading.timestamp).toLocaleTimeString());

          setReadings((prev) => {
            // Keep at most 30 recent live points for smooth charting
            const updated = [...prev, newReading];
            return updated.slice(-30);
          });
        } catch (err) {
          console.error('Failed to parse SSE reading:', err);
        }
      });

      es.onerror = () => {
        if (!active) return;
        setIsLiveConnected(false);
        es.close();
        // Reconnect after 4 seconds
        reconnectTimeoutRef.current = setTimeout(() => {
          connectSSE();
        }, 4000);
      };
    }

    connectSSE();

    return () => {
      active = false;
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
      }
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
    };
  }, [fieldId]);

  // Determine status chip based on 40% and 80% thresholds
  let statusChip = null;
  if (latestMoisture !== null) {
    if (latestMoisture <= 40) {
      statusChip = (
        <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-black bg-rose-950/80 text-rose-300 border border-rose-700 animate-pulse">
          <span className="w-2 h-2 rounded-full bg-rose-400" />
          <span>{t('fieldDetail.moistureDryChip')}</span>
        </span>
      );
    } else if (latestMoisture >= 80) {
      statusChip = (
        <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-black bg-sky-950/80 text-sky-300 border border-sky-700">
          <span className="w-2 h-2 rounded-full bg-sky-400" />
          <span>{t('fieldDetail.moistureWetChip')}</span>
        </span>
      );
    } else {
      statusChip = (
        <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-black bg-emerald-950/80 text-emerald-300 border border-emerald-600">
          <span className="w-2 h-2 rounded-full bg-emerald-400" />
          <span>{t('fieldDetail.moistureGoodChip')}</span>
        </span>
      );
    }
  }

  // Handle sensor creation
  const handleCreateSensor = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newSensorName.trim()) return;

    setIsCreatingSensor(true);
    try {
      const res = await api.createSensor(fieldId, {
        name: newSensorName.trim(),
        isSimulated: true,
      });
      setGeneratedKey(res.apiKey);
      setSensors((prev) => [...prev, res.sensor]);
      setNewSensorName('');
    } catch (err) {
      console.error('Failed to create sensor:', err);
    } finally {
      setIsCreatingSensor(false);
    }
  };

  const handleCopyKey = async () => {
    if (!generatedKey) return;
    await navigator.clipboard.writeText(generatedKey);
    setHasCopiedKey(true);
    setTimeout(() => setHasCopiedKey(false), 3000);
  };

  const chartData = readings.map((r) => ({
    time: new Date(r.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
    moisturePct: r.moisturePct,
    tempC: r.tempC,
  }));

  return (
    <div className="bg-slate-900 border-2 border-slate-800 rounded-3xl p-5 sm:p-7 shadow-xl space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-800/80 pb-4">
        <div className="flex items-center gap-3">
          <h2 className="text-xl sm:text-2xl font-black text-white flex items-center gap-2.5">
            <Activity className="w-5 h-5 text-emerald-400" />
            <span>{t('fieldDetail.soilMoistureTitle')}</span>
          </h2>

          {/* SSE Live Connection Chip */}
          <span
            className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold ${
              isLiveConnected
                ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                : 'bg-slate-800 text-slate-400 border border-slate-700'
            }`}
          >
            <Radio className={`w-3 h-3 ${isLiveConnected ? 'animate-pulse text-emerald-400' : ''}`} />
            <span>{t('fieldDetail.moistureLiveChip')}</span>
          </span>
        </div>

        <button
          type="button"
          onClick={() => {
            setGeneratedKey(null);
            setIsSensorModalOpen(true);
          }}
          className="min-h-[40px] px-3.5 py-1.5 rounded-xl border border-emerald-500/50 bg-emerald-950/40 hover:bg-emerald-950 text-emerald-300 font-bold text-xs flex items-center gap-1.5 transition-colors cursor-pointer self-start sm:self-auto"
        >
          <Plus className="w-4 h-4 stroke-[2.5]" />
          <span>{t('fieldDetail.addSensor')}</span>
        </button>
      </div>

      {/* Moisture Current Metrics & Status Chip */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="bg-slate-950/70 border border-slate-800 rounded-2xl p-4 flex flex-col justify-between">
          <span className="text-xs text-slate-400 font-semibold">{t('fieldDetail.currentMoisture')}</span>
          <div className="flex items-baseline gap-2 mt-2">
            <span className="text-3xl sm:text-4xl font-black text-white">
              {latestMoisture !== null ? `${latestMoisture.toFixed(1)}%` : '—'}
            </span>
          </div>
          <div className="mt-2">{statusChip}</div>
        </div>

        <div className="bg-slate-950/70 border border-slate-800 rounded-2xl p-4 flex flex-col justify-between">
          <span className="text-xs text-slate-400 font-semibold">Soil Temperature</span>
          <div className="text-2xl sm:text-3xl font-extrabold text-slate-200 mt-2">
            {latestTemp !== null ? `${latestTemp.toFixed(1)}°C` : '—'}
          </div>
          <span className="text-[11px] text-slate-500 mt-2">Optimal 15°C – 32°C</span>
        </div>

        <div className="bg-slate-950/70 border border-slate-800 rounded-2xl p-4 flex flex-col justify-between">
          <span className="text-xs text-slate-400 font-semibold">Active Sensors</span>
          <div className="text-2xl sm:text-3xl font-extrabold text-slate-200 mt-2">
            {sensors.length}
          </div>
          <span className="text-[11px] text-slate-400 mt-2">
            {lastReadingTime ? t('fieldDetail.lastMoistureReading', { time: lastReadingTime }) : t('fieldDetail.noReadingsYet')}
          </span>
        </div>
      </div>

      {/* Real-time Line Chart */}
      <div className="space-y-2">
        <div className="w-full h-64 sm:h-72">
          {chartData.length > 0 ? (
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                <XAxis
                  dataKey="time"
                  stroke="#94a3b8"
                  fontSize={11}
                  tickLine={false}
                  axisLine={{ stroke: '#334155' }}
                />
                <YAxis
                  domain={[0, 100]}
                  stroke="#94a3b8"
                  fontSize={11}
                  tickLine={false}
                  axisLine={{ stroke: '#334155' }}
                  unit="%"
                />
                <Tooltip
                  content={({ active, payload }) => {
                    if (active && payload && payload.length) {
                      const data = payload[0]?.payload;
                      return (
                        <div className="bg-slate-950 border border-slate-700 rounded-xl p-2.5 shadow-2xl text-xs space-y-1">
                          <div className="font-semibold text-slate-400">{data.time}</div>
                          <div className="text-emerald-400 font-bold">
                            Moisture: {data.moisturePct}%
                          </div>
                          {data.tempC !== undefined && (
                            <div className="text-amber-300">Temp: {data.tempC}°C</div>
                          )}
                        </div>
                      );
                    }
                    return null;
                  }}
                />
                <Line
                  type="monotone"
                  dataKey="moisturePct"
                  stroke="#10b981"
                  strokeWidth={3}
                  dot={{ r: 3, fill: '#10b981' }}
                  activeDot={{ r: 5, fill: '#34d399' }}
                  isAnimationActive={false}
                />
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-full flex flex-col items-center justify-center border border-dashed border-slate-800 rounded-2xl p-6 text-center text-slate-500 text-sm">
              <Cpu className="w-8 h-8 mb-2 opacity-50" />
              <p>{t('fieldDetail.noReadingsYet')}</p>
              <p className="text-xs text-slate-400 mt-1 max-w-md">{t('fieldDetail.runSimulatorHint')}</p>
            </div>
          )}
        </div>
      </div>

      {/* Sensor Management Modal */}
      {isSensorModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-lg bg-slate-900 border border-slate-800 rounded-3xl p-6 sm:p-7 shadow-2xl space-y-5 animate-fade-in">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h3 className="text-lg font-bold text-white flex items-center gap-2">
                <Cpu className="w-5 h-5 text-emerald-400" />
                <span>{t('fieldDetail.sensorsSection')}</span>
              </h3>
              <button
                type="button"
                onClick={() => setIsSensorModalOpen(false)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* If key was generated, show once with Copy button */}
            {generatedKey ? (
              <div className="space-y-4">
                <div className="p-4 rounded-2xl bg-amber-950/60 border border-amber-600/80 text-amber-200 text-sm space-y-2">
                  <div className="font-bold flex items-center gap-2 text-amber-300">
                    <Key className="w-4 h-4" />
                    <span>{t('fieldDetail.sensorKeyModalTitle')}</span>
                  </div>
                  <p className="text-xs leading-relaxed">{t('fieldDetail.sensorKeyWarning')}</p>
                </div>

                <div className="bg-slate-950 border border-slate-700 rounded-xl p-3.5 flex items-center justify-between gap-2">
                  <code className="text-emerald-400 text-xs font-mono break-all">{generatedKey}</code>
                  <button
                    type="button"
                    onClick={handleCopyKey}
                    className="flex-shrink-0 px-3 py-1.5 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-xs flex items-center gap-1.5 cursor-pointer active:scale-95 transition-all"
                  >
                    {hasCopiedKey ? (
                      <>
                        <Check className="w-3.5 h-3.5" />
                        <span>{t('fieldDetail.keyCopied')}</span>
                      </>
                    ) : (
                      <>
                        <Copy className="w-3.5 h-3.5" />
                        <span>{t('fieldDetail.copyKey')}</span>
                      </>
                    )}
                  </button>
                </div>

                <div className="text-xs text-slate-400 bg-slate-950/60 p-3 rounded-xl border border-slate-800 space-y-1">
                  <div className="font-semibold text-slate-300">Simulator CLI Example:</div>
                  <code className="text-xs text-emerald-400 font-mono block break-all">
                    npm run simulate -- --key {generatedKey} --speed 60
                  </code>
                </div>

                <button
                  type="button"
                  onClick={() => setIsSensorModalOpen(false)}
                  className="w-full min-h-[44px] rounded-xl bg-slate-800 hover:bg-slate-700 text-white font-bold text-sm cursor-pointer"
                >
                  {t('common.close')}
                </button>
              </div>
            ) : (
              <form onSubmit={handleCreateSensor} className="space-y-4">
                <div>
                  <label htmlFor="sensor-name" className="block text-sm font-semibold text-slate-200 mb-1.5">
                    {t('fieldDetail.sensorName')} *
                  </label>
                  <input
                    id="sensor-name"
                    type="text"
                    required
                    value={newSensorName}
                    onChange={(e) => setNewSensorName(e.target.value)}
                    placeholder={t('fieldDetail.sensorNamePlaceholder')}
                    className="w-full min-h-[48px] bg-slate-950 border border-slate-700 focus:border-emerald-400 rounded-xl px-4 py-3 text-sm text-white focus:outline-none"
                  />
                </div>

                <button
                  type="submit"
                  disabled={isCreatingSensor || !newSensorName.trim()}
                  className="w-full min-h-[48px] rounded-xl bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 text-slate-950 font-bold text-sm flex items-center justify-center gap-2 cursor-pointer shadow-md"
                >
                  {isCreatingSensor ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      <span>{t('fieldDetail.addingSensor')}</span>
                    </>
                  ) : (
                    <span>{t('fieldDetail.addSensor')}</span>
                  )}
                </button>
              </form>
            )}

            {/* Existing Sensors List */}
            {sensors.length > 0 && !generatedKey && (
              <div className="border-t border-slate-800 pt-3 space-y-2">
                <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider block">
                  Connected Sensors ({sensors.length})
                </span>
                <div className="space-y-1.5 max-h-40 overflow-y-auto">
                  {sensors.map((s) => (
                    <div
                      key={s.id}
                      className="bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 flex items-center justify-between text-xs"
                    >
                      <span className="font-semibold text-white">{s.name}</span>
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-800 text-slate-300">
                        {s.isSimulated ? t('fieldDetail.sensorSimulated') : t('fieldDetail.sensorHardware')}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
