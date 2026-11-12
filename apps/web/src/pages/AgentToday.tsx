import React, { useState, useEffect, useMemo } from 'react';
import {
  apiClient,
  AgentTodayItem,
  AgentTodayDashboardData,
  TimelineEntry,
} from '../api/client.js';

const CACHE_KEY = 'irrigiq_agent_today_cache';
const OFFLINE_MARKS_KEY = 'irrigiq_offline_marks';

export function AgentToday(): React.JSX.Element {
  const [data, setData] = useState<AgentTodayDashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isOffline, setIsOffline] = useState(!navigator.onLine);
  const [lang, setLang] = useState<'en' | 'hi'>('hi');

  // Filters
  const [search, setSearch] = useState('');
  const [filterNeedsWater, setFilterNeedsWater] = useState(false);
  const [filterNotYetSent, setFilterNotYetSent] = useState(false);
  const [filterNoReply2Days, setFilterNoReply2Days] = useState(false);
  const [selectedVillage, setSelectedVillage] = useState<string>('');

  // Modals
  const [selectedTimelineFarmer, setSelectedTimelineFarmer] = useState<{
    id: string;
    name: string;
  } | null>(null);
  const [timelineEntries, setTimelineEntries] = useState<TimelineEntry[]>([]);
  const [loadingTimeline, setLoadingTimeline] = useState(false);

  const [notFollowedModalItem, setNotFollowedModalItem] = useState<AgentTodayItem | null>(null);
  const [customReason, setCustomReason] = useState('');

  const [copyFeedback, setCopyFeedback] = useState<string | null>(null);
  const [bulkSending, setBulkSending] = useState(false);
  const [bulkSendResult, setBulkSendResult] = useState<string | null>(null);

  // Online / offline listeners
  useEffect(() => {
    const handleOnline = () => {
      setIsOffline(false);
      syncOfflineMarks();
    };
    const handleOffline = () => setIsOffline(true);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  // Fetch Dashboard data
  const loadDashboard = async () => {
    setLoading(true);
    setError(null);
    try {
      if (navigator.onLine) {
        const dashboard = await apiClient.getAgentTodayDashboard();
        setData(dashboard);
        localStorage.setItem(CACHE_KEY, JSON.stringify(dashboard));
      } else {
        // Load from cache
        const cached = localStorage.getItem(CACHE_KEY);
        if (cached) {
          setData(JSON.parse(cached));
        } else {
          setError(
            lang === 'hi'
              ? 'ऑफ़लाइन मोड में कोई कैश्ड डेटा नहीं मिला।'
              : 'No cached data found in offline mode.',
          );
        }
      }
    } catch {
      // Fallback to cache on error
      const cached = localStorage.getItem(CACHE_KEY);
      if (cached) {
        setData(JSON.parse(cached));
      } else {
        setError(
          lang === 'hi' ? 'डेटा लोड करने में त्रुटि।' : 'Failed to load dashboard data.',
        );
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadDashboard();
  }, []);

  // Sync queued offline marks
  const syncOfflineMarks = async () => {
    const stored = localStorage.getItem(OFFLINE_MARKS_KEY);
    if (!stored) return;

    try {
      const marks: Array<{
        farmerId: string;
        fieldId?: string;
        status: 'followed' | 'not followed' | 'note';
        reason?: string;
      }> = JSON.parse(stored);

      if (marks.length === 0) return;

      for (const m of marks) {
        await apiClient.markFarmerStatus(m.farmerId, {
          fieldId: m.fieldId,
          status: m.status,
          reason: m.reason,
        });
      }

      localStorage.removeItem(OFFLINE_MARKS_KEY);
      // Reload dashboard after sync
      loadDashboard();
    } catch (err) {
      console.warn('Offline marks sync failed, will retry later', err);
    }
  };

  // Mark Status Handler (Followed / Not Followed)
  const handleMarkStatus = async (
    item: AgentTodayItem,
    status: 'followed' | 'not followed',
    reason?: string,
  ) => {
    // 1. Optimistically update local state
    if (data) {
      const updatedItems = data.items.map((i) => {
        if (i.id === item.id) {
          return {
            ...i,
            adviceStatus: status,
            notFollowedReason: status === 'not followed' ? reason || 'Not followed' : null,
          };
        }
        return i;
      });

      const updatedData: AgentTodayDashboardData = {
        ...data,
        items: updatedItems,
        summary: {
          ...data.summary,
          followed: updatedItems.filter((i) => i.adviceStatus === 'followed').length,
          notFollowed: updatedItems.filter((i) => i.adviceStatus === 'not followed').length,
        },
      };

      setData(updatedData);
      localStorage.setItem(CACHE_KEY, JSON.stringify(updatedData));
    }

    // 2. Perform API or queue offline
    if (navigator.onLine) {
      try {
        await apiClient.markFarmerStatus(item.farmerId, {
          fieldId: item.fieldId,
          status,
          reason,
        });
      } catch {
        queueOfflineMark(item.farmerId, item.fieldId, status, reason);
      }
    } else {
      queueOfflineMark(item.farmerId, item.fieldId, status, reason);
    }

    setNotFollowedModalItem(null);
    setCustomReason('');
  };

  const queueOfflineMark = (
    farmerId: string,
    fieldId?: string,
    status: 'followed' | 'not followed' = 'followed',
    reason?: string,
  ) => {
    const stored = localStorage.getItem(OFFLINE_MARKS_KEY);
    const marks = stored ? JSON.parse(stored) : [];
    marks.push({ farmerId, fieldId, status, reason });
    localStorage.setItem(OFFLINE_MARKS_KEY, JSON.stringify(marks));
  };

  // Copy Message Handler
  const handleCopy = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopyFeedback(id);
    setTimeout(() => setCopyFeedback(null), 2500);
  };

  // Bulk Send Handler
  const handleBulkSend = async () => {
    if (
      !window.confirm(
        lang === 'hi'
          ? 'क्या आप सभी लंबित किसानों को सलाह भेजना चाहते हैं? (केवल सहमति वाले किसानों को ही भेजा जाएगा)'
          : 'Send advisory to all pending farmers? (Rate-limited, only sent to farmers with active consent)',
      )
    ) {
      return;
    }

    setBulkSending(true);
    setBulkSendResult(null);

    try {
      const res = await apiClient.bulkSendPendingAdvisories();
      const msg =
        lang === 'hi'
          ? `✅ ${res.sentCount} भेजे गए, ${res.skippedNoConsentCount} बिना सहमति छोड़े गए`
          : `✅ ${res.sentCount} sent, ${res.skippedNoConsentCount} skipped (no consent)`;
      setBulkSendResult(msg);
      loadDashboard();
    } catch {
      setBulkSendResult(
        lang === 'hi' ? '❌ बल्क भेजने में त्रुटि' : '❌ Failed to bulk send advisories',
      );
    } finally {
      setBulkSending(false);
      setTimeout(() => setBulkSendResult(null), 5000);
    }
  };

  // Send Single Telegram Advisory
  const handleSendTelegram = async (item: AgentTodayItem) => {
    if (!item.channelId) return;
    try {
      await apiClient.sendFarmerAdvisory(item.farmerId, {
        channelId: item.channelId,
        text: item.digestText,
      });
      alert(lang === 'hi' ? '✅ टेलीग्राम पर सलाह भेजी गई!' : '✅ Advisory sent on Telegram!');
      loadDashboard();
    } catch {
      alert(lang === 'hi' ? '❌ टेलीग्राम भेजने में त्रुटि' : '❌ Failed to send on Telegram');
    }
  };

  // Open Timeline
  const openTimeline = async (farmer: { id: string; name: string }) => {
    setSelectedTimelineFarmer(farmer);
    setLoadingTimeline(true);
    try {
      const res = await apiClient.getFarmerTimeline(farmer.id);
      setTimelineEntries(res.timeline || []);
    } catch {
      setTimelineEntries([]);
    } finally {
      setLoadingTimeline(false);
    }
  };

  // Filtered items
  const filteredItems = useMemo(() => {
    if (!data?.items) return [];

    return data.items.filter((item) => {
      // Search
      if (search.trim()) {
        const s = search.trim().toLowerCase();
        const matchName = item.farmerName.toLowerCase().includes(s);
        const matchField = item.fieldName.toLowerCase().includes(s);
        if (!matchName && !matchField) return false;
      }

      // Needs water
      if (filterNeedsWater && item.action !== 'irrigate') return false;

      // Not yet sent
      if (filterNotYetSent && item.adviceStatus !== 'not sent') return false;

      // No reply for 2 days
      if (filterNoReply2Days && !item.noReply2Days) return false;

      // Village
      if (selectedVillage && item.village.toLowerCase() !== selectedVillage.toLowerCase()) {
        return false;
      }

      return true;
    });
  }, [data, search, filterNeedsWater, filterNotYetSent, filterNoReply2Days, selectedVillage]);

  return (
    <div className="max-w-4xl mx-auto px-3 sm:px-6 py-4 pb-20">
      {/* Offline Alert Banner */}
      {isOffline && (
        <div className="bg-amber-100 border-l-4 border-amber-500 text-amber-800 p-3 mb-4 rounded shadow-sm text-sm font-medium flex items-center justify-between">
          <span>
            ⚠️ {lang === 'hi' ? 'ऑफ़लाइन मोड (कैश्ड डेटा)' : 'Offline Mode (Cached Data)'}:{' '}
            {lang === 'hi'
              ? 'सिंचाई स्थिति दर्ज करने पर ऑनलाइन होने पर स्वतः सिंक हो जाएगी।'
              : 'Actions will be automatically synced once you reconnect.'}
          </span>
        </div>
      )}

      {/* Top Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 mb-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 tracking-tight">
            {lang === 'hi' ? '🌾 दैनिक सिंचाई कार्य सूची (Today)' : "🌾 Agent 'Today' Dashboard"}
          </h1>
          <p className="text-xs sm:text-sm text-gray-500">
            {data?.date || new Date().toLocaleDateString('en-CA')} •{' '}
            {lang === 'hi'
              ? 'किसानों को सलाह भेजें और प्रगति ट्रैक करें'
              : 'Deliver daily advisories and track farm adherence'}
          </p>
        </div>

        <div className="flex items-center gap-2 self-end sm:self-auto">
          {/* Language Switcher */}
          <div className="inline-flex rounded-lg border border-gray-300 bg-white p-0.5 shadow-sm">
            <button
              type="button"
              onClick={() => setLang('en')}
              className={`px-3 py-1.5 text-xs font-semibold rounded-md ${
                lang === 'en' ? 'bg-emerald-600 text-white' : 'text-gray-700 hover:bg-gray-50'
              }`}
            >
              English
            </button>
            <button
              type="button"
              onClick={() => setLang('hi')}
              className={`px-3 py-1.5 text-xs font-semibold rounded-md ${
                lang === 'hi' ? 'bg-emerald-600 text-white' : 'text-gray-700 hover:bg-gray-50'
              }`}
            >
              हिंदी
            </button>
          </div>
        </div>
      </div>

      {/* Summary KPI Cards */}
      {data?.summary && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-4">
          <div className="bg-white border rounded-xl p-3 shadow-sm flex flex-col justify-between">
            <span className="text-xs font-semibold text-gray-500 uppercase">
              {lang === 'hi' ? 'कुल खेत' : 'Total Fields'}
            </span>
            <span className="text-2xl font-extrabold text-gray-900">{data.summary.total}</span>
          </div>

          <div className="bg-blue-50 border border-blue-200 rounded-xl p-3 shadow-sm flex flex-col justify-between">
            <span className="text-xs font-semibold text-blue-700 uppercase">
              {lang === 'hi' ? '💧 पानी चाहिए' : '💧 Needs Water'}
            </span>
            <span className="text-2xl font-extrabold text-blue-900">{data.summary.needsWater}</span>
          </div>

          <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 shadow-sm flex flex-col justify-between">
            <span className="text-xs font-semibold text-amber-700 uppercase">
              {lang === 'hi' ? '⏳ भेजा नहीं' : '⏳ Pending Send'}
            </span>
            <span className="text-2xl font-extrabold text-amber-900">
              {data.summary.pendingSend}
            </span>
          </div>

          <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-3 shadow-sm flex flex-col justify-between">
            <span className="text-xs font-semibold text-emerald-700 uppercase">
              {lang === 'hi' ? '✅ सिंचाई पूरी' : '✅ Followed'}
            </span>
            <span className="text-2xl font-extrabold text-emerald-900">
              {data.summary.followed}
            </span>
          </div>
        </div>
      )}

      {/* Bulk Send Button Banner */}
      <div className="bg-gradient-to-r from-emerald-600 to-teal-700 text-white rounded-xl p-4 mb-4 shadow flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div>
          <h2 className="font-bold text-base">
            {lang === 'hi' ? '🚀 सभी को सलाह भेजें' : '🚀 Bulk Send Advisories'}
          </h2>
          <p className="text-xs text-emerald-100">
            {lang === 'hi'
              ? 'दर-सीमित (Rate-limited), केवल सक्रिय सहमति वाले किसानों को भेजा जाएगा।'
              : 'Sends to all pending farmers. Skips farmers without active consent.'}
          </p>
          {bulkSendResult && <div className="mt-1 text-xs font-bold">{bulkSendResult}</div>}
        </div>

        <button
          type="button"
          disabled={bulkSending || isOffline}
          onClick={handleBulkSend}
          className="w-full sm:w-auto px-5 py-3 min-h-[48px] bg-white text-emerald-800 font-bold rounded-lg shadow hover:bg-emerald-50 active:scale-95 transition disabled:opacity-50 text-sm whitespace-nowrap"
        >
          {bulkSending
            ? lang === 'hi'
              ? 'भेजा जा रहा है...'
              : 'Sending...'
            : lang === 'hi'
              ? 'सभी लंबित भेजें (Send All)'
              : 'Send All Pending'}
        </button>
      </div>

      {/* Filter and Search Bar */}
      <div className="bg-white border rounded-xl p-3 mb-4 shadow-sm space-y-3">
        <div className="flex flex-col sm:flex-row gap-2">
          {/* Search Input */}
          <div className="relative flex-1">
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={
                lang === 'hi' ? 'किसान या खेत का नाम खोजें...' : 'Search farmer or field...'
              }
              className="w-full pl-3 pr-8 py-2.5 min-h-[44px] text-sm border rounded-lg focus:ring-2 focus:ring-emerald-500 focus:outline-none"
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch('')}
                className="absolute right-2.5 top-2.5 text-gray-400 hover:text-gray-600"
              >
                ✕
              </button>
            )}
          </div>

          {/* Village Filter */}
          {data?.villages && data.villages.length > 0 && (
            <select
              value={selectedVillage}
              onChange={(e) => setSelectedVillage(e.target.value)}
              className="min-h-[44px] text-sm border rounded-lg px-3 py-2 bg-white focus:ring-2 focus:ring-emerald-500"
            >
              <option value="">{lang === 'hi' ? 'सभी गाँव (All Villages)' : 'All Villages'}</option>
              {data.villages.map((v) => (
                <option key={v} value={v}>
                  {v}
                </option>
              ))}
            </select>
          )}
        </div>

        {/* Quick Filter Chips */}
        <div className="flex flex-wrap gap-1.5 pt-1">
          <button
            type="button"
            onClick={() => {
              setFilterNeedsWater(!filterNeedsWater);
            }}
            className={`px-3 py-1.5 min-h-[38px] text-xs font-semibold rounded-full border transition ${
              filterNeedsWater
                ? 'bg-blue-600 text-white border-blue-600'
                : 'bg-gray-100 text-gray-700 border-gray-200 hover:bg-gray-200'
            }`}
          >
            💧 {lang === 'hi' ? 'पानी चाहिए' : 'Needs Water'}
          </button>

          <button
            type="button"
            onClick={() => {
              setFilterNotYetSent(!filterNotYetSent);
            }}
            className={`px-3 py-1.5 min-h-[38px] text-xs font-semibold rounded-full border transition ${
              filterNotYetSent
                ? 'bg-amber-600 text-white border-amber-600'
                : 'bg-gray-100 text-gray-700 border-gray-200 hover:bg-gray-200'
            }`}
          >
            ⏳ {lang === 'hi' ? 'भेजा नहीं' : 'Not Yet Sent'}
          </button>

          <button
            type="button"
            onClick={() => {
              setFilterNoReply2Days(!filterNoReply2Days);
            }}
            className={`px-3 py-1.5 min-h-[38px] text-xs font-semibold rounded-full border transition ${
              filterNoReply2Days
                ? 'bg-rose-600 text-white border-rose-600'
                : 'bg-gray-100 text-gray-700 border-gray-200 hover:bg-gray-200'
            }`}
          >
            ⚠️ {lang === 'hi' ? '2 दिन से जवाब नहीं' : 'No Reply (2 Days)'}
          </button>

          {(filterNeedsWater || filterNotYetSent || filterNoReply2Days || selectedVillage || search) && (
            <button
              type="button"
              onClick={() => {
                setFilterNeedsWater(false);
                setFilterNotYetSent(false);
                setFilterNoReply2Days(false);
                setSelectedVillage('');
                setSearch('');
              }}
              className="px-3 py-1.5 min-h-[38px] text-xs font-semibold text-gray-500 hover:text-gray-700 underline"
            >
              {lang === 'hi' ? 'फ़िल्टर हटाएं (Reset)' : 'Reset Filters'}
            </button>
          )}
        </div>
      </div>

      {/* Loading & Error States */}
      {loading && !data && (
        <div className="py-12 text-center text-gray-500">
          <div className="animate-spin inline-block w-8 h-8 border-4 border-emerald-500 border-t-transparent rounded-full mb-2" />
          <p>{lang === 'hi' ? 'कार्य सूची लोड हो रही है...' : 'Loading dashboard...'}</p>
        </div>
      )}

      {error && !data && (
        <div className="bg-red-50 border border-red-200 text-red-700 p-4 rounded-xl text-center">
          {error}
        </div>
      )}

      {/* Farmers List */}
      <div className="space-y-3">
        {filteredItems.length === 0 && !loading && (
          <div className="bg-white border rounded-xl p-8 text-center text-gray-500">
            <span className="text-3xl block mb-2">🌾</span>
            <p className="font-semibold text-gray-700">
              {lang === 'hi' ? 'कोई किसान नहीं मिला' : 'No farmers found'}
            </p>
            <p className="text-xs text-gray-400 mt-1">
              {lang === 'hi'
                ? 'फ़िल्टर बदलें या नया किसान आयात करें।'
                : 'Try adjusting filters or import farmers.'}
            </p>
          </div>
        )}

        {filteredItems.map((item) => {
          const isIrrigate = item.action === 'irrigate';

          // Status Badge Styling
          const statusStyles: Record<string, { bg: string; text: string; label: string }> = {
            'not sent': {
              bg: 'bg-amber-100 text-amber-800 border-amber-300',
              text: 'text-amber-800',
              label: lang === 'hi' ? '⏳ भेजा नहीं (Not Sent)' : '⏳ Not Sent',
            },
            sent: {
              bg: 'bg-blue-100 text-blue-800 border-blue-300',
              text: 'text-blue-800',
              label: lang === 'hi' ? '📤 भेजा गया (Sent)' : '📤 Sent',
            },
            seen: {
              bg: 'bg-purple-100 text-purple-800 border-purple-300',
              text: 'text-purple-800',
              label: lang === 'hi' ? '👁️ देखा गया (Seen)' : '👁️ Seen',
            },
            replied: {
              bg: 'bg-cyan-100 text-cyan-800 border-cyan-300',
              text: 'text-cyan-800',
              label: lang === 'hi' ? '💬 जवाब आया (Replied)' : '💬 Replied',
            },
            followed: {
              bg: 'bg-emerald-100 text-emerald-800 border-emerald-300',
              text: 'text-emerald-800',
              label: lang === 'hi' ? '✅ सिंचाई पूरी (Followed)' : '✅ Followed',
            },
            'not followed': {
              bg: 'bg-rose-100 text-rose-800 border-rose-300',
              text: 'text-rose-800',
              label: lang === 'hi' ? '❌ नहीं की (Not Followed)' : '❌ Not Followed',
            },
          };

          const statusBadge = statusStyles[item.adviceStatus] || statusStyles['not sent']!;

          return (
            <div
              key={item.id}
              className="bg-white border rounded-xl p-4 shadow-sm hover:shadow transition"
            >
              {/* Card Header */}
              <div className="flex items-start justify-between gap-2 mb-2">
                <div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-bold text-base sm:text-lg text-gray-900">
                      {item.farmerName}
                    </span>
                    {item.village && (
                      <span className="px-2 py-0.5 text-xs bg-gray-100 text-gray-600 rounded-md font-medium">
                        📍 {item.village}
                      </span>
                    )}
                    <span className="px-2 py-0.5 text-xs bg-emerald-50 text-emerald-700 border border-emerald-200 rounded-md font-medium">
                      🌱 {item.cropName}
                    </span>
                  </div>
                  <div className="text-xs text-gray-500 mt-0.5">
                    {item.fieldName} • {item.areaHa} ha
                  </div>
                </div>

                {/* Action Badge */}
                <span
                  className={`px-3 py-1 rounded-full text-xs font-bold border ${
                    isIrrigate
                      ? 'bg-blue-600 text-white border-blue-600'
                      : 'bg-gray-100 text-gray-600 border-gray-300'
                  }`}
                >
                  {isIrrigate
                    ? lang === 'hi'
                      ? '💧 सिंचाई करें'
                      : '💧 Irrigate'
                    : lang === 'hi'
                      ? '⏭️ छोड़ें'
                      : '⏭️ Skip'}
                </span>
              </div>

              {/* Advisory Details: Duration & Power Window */}
              <div className="bg-gray-50 rounded-lg p-2.5 mb-3 text-xs sm:text-sm text-gray-700 flex flex-wrap items-center justify-between gap-2">
                <div>
                  {isIrrigate ? (
                    <span>
                      ⏱️ <strong>{item.pumpMinutes} min</strong> ({item.litres.toLocaleString()} L •{' '}
                      {item.grossMm} mm)
                    </span>
                  ) : (
                    <span className="text-gray-500">
                      {lang === 'hi'
                        ? 'आज सिंचाई की आवश्यकता नहीं है।'
                        : 'Adequate moisture. No water needed today.'}
                    </span>
                  )}
                  {item.powerWindow && (
                    <span className="ml-2 inline-block text-amber-700 font-semibold">
                      ⚡ {item.powerWindow.start} - {item.powerWindow.end}
                    </span>
                  )}
                </div>

                {/* Consent & Channel Indicator */}
                <div className="flex items-center gap-1.5">
                  <span
                    className={`px-1.5 py-0.5 text-[10px] rounded font-bold ${
                      item.hasConsent
                        ? 'bg-emerald-100 text-emerald-800'
                        : 'bg-rose-100 text-rose-800'
                    }`}
                  >
                    {item.hasConsent
                      ? lang === 'hi'
                        ? 'सहमति ✓'
                        : 'Consent ✓'
                      : lang === 'hi'
                        ? 'सहमति नहीं ✗'
                        : 'No Consent ✗'}
                  </span>
                  {item.channelLinked && (
                    <span className="px-1.5 py-0.5 text-[10px] rounded font-bold bg-blue-100 text-blue-800">
                      Telegram ✓
                    </span>
                  )}
                </div>
              </div>

              {/* Status & Reply Info Line */}
              <div className="flex items-center justify-between gap-2 flex-wrap mb-3 text-xs">
                <div className="flex items-center gap-2">
                  <span
                    className={`px-2.5 py-1 rounded-md text-xs font-semibold border ${statusBadge.bg}`}
                  >
                    {statusBadge.label}
                  </span>

                  {item.lastReplyTime && (
                    <span className="text-gray-500">
                      💬 {lang === 'hi' ? 'जवाब' : 'Reply'}:{' '}
                      {new Date(item.lastReplyTime).toLocaleTimeString([], {
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                      {item.lastReplyText && ` "${item.lastReplyText}"`}
                    </span>
                  )}

                  {item.notFollowedReason && (
                    <span className="text-rose-600 font-medium">
                      ⚠️ {lang === 'hi' ? 'कारण' : 'Reason'}: {item.notFollowedReason}
                    </span>
                  )}
                </div>

                {/* Timeline trigger */}
                <button
                  type="button"
                  onClick={() => openTimeline({ id: item.farmerId, name: item.farmerName })}
                  className="text-xs font-semibold text-emerald-700 hover:text-emerald-900 underline"
                >
                  📜 {lang === 'hi' ? 'इतिहास (Timeline)' : 'Timeline'}
                </button>
              </div>

              {/* Action Buttons: Min 48px touch target */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-1 border-t">
                {/* 1. Share on WhatsApp */}
                <a
                  href={item.waShareUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center justify-center gap-1.5 min-h-[48px] px-3 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-lg text-xs sm:text-sm shadow-sm transition active:scale-95 text-center"
                >
                  💬 <span>{lang === 'hi' ? 'WhatsApp' : 'WhatsApp'}</span>
                </a>

                {/* 2. Telegram Send (if linked) */}
                <button
                  type="button"
                  disabled={!item.channelLinked || isOffline}
                  onClick={() => handleSendTelegram(item)}
                  className={`flex items-center justify-center gap-1.5 min-h-[48px] px-3 py-2 font-bold rounded-lg text-xs sm:text-sm border transition active:scale-95 ${
                    item.channelLinked && !isOffline
                      ? 'bg-blue-50 text-blue-700 border-blue-300 hover:bg-blue-100'
                      : 'bg-gray-100 text-gray-400 border-gray-200 cursor-not-allowed'
                  }`}
                >
                  📱 <span>{lang === 'hi' ? 'Telegram' : 'Telegram'}</span>
                </button>

                {/* 3. Copy Advisory Text */}
                <button
                  type="button"
                  onClick={() => handleCopy(item.digestText, item.id)}
                  className="flex items-center justify-center gap-1.5 min-h-[48px] px-3 py-2 bg-gray-100 hover:bg-gray-200 text-gray-800 font-semibold rounded-lg text-xs sm:text-sm border border-gray-200 transition active:scale-95"
                >
                  📋{' '}
                  <span>
                    {copyFeedback === item.id
                      ? lang === 'hi'
                        ? 'कॉपी हुआ ✓'
                        : 'Copied ✓'
                      : lang === 'hi'
                        ? 'कॉपी'
                        : 'Copy'}
                  </span>
                </button>

                {/* 4. Mark Followed / Not Followed Dropdown or split */}
                <div className="flex gap-1">
                  <button
                    type="button"
                    onClick={() => handleMarkStatus(item, 'followed')}
                    className="flex-1 flex items-center justify-center min-h-[48px] px-2 py-1 bg-emerald-100 hover:bg-emerald-200 text-emerald-800 font-bold rounded-lg text-xs border border-emerald-300 transition active:scale-95"
                    title={lang === 'hi' ? 'सिंचाई की' : 'Mark Followed'}
                  >
                    ✅ {lang === 'hi' ? 'की' : 'Done'}
                  </button>

                  <button
                    type="button"
                    onClick={() => setNotFollowedModalItem(item)}
                    className="flex-1 flex items-center justify-center min-h-[48px] px-2 py-1 bg-rose-50 hover:bg-rose-100 text-rose-700 font-bold rounded-lg text-xs border border-rose-200 transition active:scale-95"
                    title={lang === 'hi' ? 'नहीं की' : 'Not Followed'}
                  >
                    ❌ {lang === 'hi' ? 'छोड़ी' : 'Skip'}
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Not Followed Reason Modal */}
      {notFollowedModalItem && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-end sm:items-center justify-center p-3">
          <div className="bg-white rounded-2xl w-full max-w-md p-5 shadow-2xl animate-in fade-in">
            <h3 className="font-bold text-lg text-gray-900 mb-1">
              {lang === 'hi' ? 'सिंचाई न करने का कारण' : 'Reason for Not Following'}
            </h3>
            <p className="text-xs text-gray-500 mb-4">
              {notFollowedModalItem.farmerName} • {notFollowedModalItem.fieldName}
            </p>

            {/* Quick Reason Chips */}
            <div className="grid grid-cols-2 gap-2 mb-4">
              {[
                { en: 'No Power / बिजली नहीं', val: 'No electricity / power outage' },
                { en: 'Pump Breakdown / पंप खराब', val: 'Pump repair issue' },
                { en: 'Rain Occurred / बारिश हुई', val: 'Rain in village' },
                { en: 'Farmer Busy / समय नहीं मिला', val: 'Personal unavailability' },
              ].map((r) => (
                <button
                  key={r.val}
                  type="button"
                  onClick={() => handleMarkStatus(notFollowedModalItem, 'not followed', r.val)}
                  className="p-3 text-xs font-semibold text-gray-800 bg-gray-50 border border-gray-200 rounded-xl hover:bg-rose-50 hover:border-rose-300 text-left min-h-[48px]"
                >
                  {r.en}
                </button>
              ))}
            </div>

            {/* Custom Reason Input */}
            <div className="mb-4">
              <label className="block text-xs font-semibold text-gray-700 mb-1">
                {lang === 'hi' ? 'अन्य कारण लिखें:' : 'Or enter custom reason:'}
              </label>
              <input
                type="text"
                value={customReason}
                onChange={(e) => setCustomReason(e.target.value)}
                placeholder={lang === 'hi' ? 'उदा. नहर में पानी नहीं' : 'e.g. Canal water stopped'}
                className="w-full text-sm border rounded-lg p-2.5 min-h-[44px]"
              />
            </div>

            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setNotFollowedModalItem(null)}
                className="flex-1 py-3 min-h-[48px] bg-gray-100 text-gray-700 font-semibold rounded-lg text-sm"
              >
                {lang === 'hi' ? 'रद्द करें' : 'Cancel'}
              </button>
              <button
                type="button"
                disabled={!customReason.trim()}
                onClick={() =>
                  handleMarkStatus(notFollowedModalItem, 'not followed', customReason.trim())
                }
                className="flex-1 py-3 min-h-[48px] bg-rose-600 text-white font-bold rounded-lg text-sm disabled:opacity-50"
              >
                {lang === 'hi' ? 'दर्ज करें' : 'Submit'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Farmer Timeline Modal */}
      {selectedTimelineFarmer && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-3">
          <div className="bg-white rounded-2xl w-full max-w-lg max-h-[85vh] flex flex-col shadow-2xl animate-in fade-in">
            {/* Modal Header */}
            <div className="p-4 border-b flex items-center justify-between">
              <div>
                <h3 className="font-bold text-base text-gray-900">
                  📜 {selectedTimelineFarmer.name} - {lang === 'hi' ? 'इतिहास' : 'Timeline'}
                </h3>
                <p className="text-xs text-gray-500">
                  {lang === 'hi'
                    ? 'सलाह, जवाब, पंप और नोट्स का कालक्रम'
                    : 'History of advisories, replies, pump logs and notes'}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSelectedTimelineFarmer(null)}
                className="p-2 text-gray-400 hover:text-gray-600 rounded-full"
              >
                ✕
              </button>
            </div>

            {/* Timeline Scrollable Content */}
            <div className="p-4 overflow-y-auto flex-1 space-y-3">
              {loadingTimeline && (
                <div className="py-8 text-center text-gray-500 text-sm">
                  <div className="animate-spin inline-block w-6 h-6 border-2 border-emerald-500 border-t-transparent rounded-full mb-2" />
                  <p>{lang === 'hi' ? 'लोड हो रहा है...' : 'Loading timeline...'}</p>
                </div>
              )}

              {!loadingTimeline && timelineEntries.length === 0 && (
                <div className="py-8 text-center text-gray-400 text-sm">
                  {lang === 'hi'
                    ? 'इस किसान के लिए कोई इतिहास उपलब्ध नहीं है।'
                    : 'No timeline records found for this farmer.'}
                </div>
              )}

              {!loadingTimeline &&
                timelineEntries.map((entry) => {
                  const icons: Record<string, string> = {
                    advice_sent: '📤',
                    whatsapp_shared: '💬',
                    reply_received: '↩️',
                    pump_run: '⏱️',
                    irrigation_logged: '💧',
                    note: '📝',
                  };

                  return (
                    <div key={entry.id} className="border-l-2 border-emerald-500 pl-3 py-1">
                      <div className="flex items-center justify-between text-xs text-gray-400 mb-0.5">
                        <span>
                          {icons[entry.type] || '•'} {entry.title}
                        </span>
                        <span>{new Date(entry.timestamp).toLocaleString()}</span>
                      </div>
                      <div className="text-sm text-gray-800 font-medium">{entry.description}</div>
                    </div>
                  );
                })}
            </div>

            <div className="p-3 border-t bg-gray-50 text-right rounded-b-2xl">
              <button
                type="button"
                onClick={() => setSelectedTimelineFarmer(null)}
                className="px-4 py-2 min-h-[44px] bg-gray-200 hover:bg-gray-300 text-gray-800 font-semibold rounded-lg text-xs"
              >
                {lang === 'hi' ? 'बंद करें' : 'Close'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default AgentToday;

