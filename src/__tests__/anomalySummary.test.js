import { describe, test, expect } from '@jest/globals';
import { computeAnomalyHistorySummary } from '../services/anomalySummaryService.js';

const iso = (d) => new Date(d).toISOString();

describe('Anomaly History Summary', () => {
  test('counts BLOCK in last 24h from action/decision', () => {
    const now = new Date('2025-12-28T12:00:00Z');
    const events = [
      { deviceId: 'device-1', score: 0.02, action: 'ALLOW', decided_at: iso('2025-12-28T11:00:00Z') },
      { deviceId: 'device-1', score: 0.05, decision: 'block', decided_at: iso('2025-12-28T10:00:00Z') },
      { deviceId: 'device-1', score: 0.03, action: 'BLOCK', created_at: iso('2025-12-28T09:00:00Z') },
      { deviceId: 'device-1', score: 0.01, action: 'BLOCK', decided_at: iso('2025-12-26T12:00:00Z') }, // outside 24h
    ];

    const summary = computeAnomalyHistorySummary({ deviceId: 'device-1', events, now });
    expect(summary.device_id).toBe('device-1');
    expect(summary.summary.last_24h.total_events).toBe(3);
    expect(summary.summary.last_24h.block_count).toBe(2);
  });

  test('trend_7d slope direction', () => {
    const now = new Date('2025-12-28T12:00:00Z');

    const improving = [
      { deviceId: 'device-1', score: 0.10, decided_at: iso('2025-12-22T12:00:00Z') },
      { deviceId: 'device-1', score: 0.08, decided_at: iso('2025-12-24T12:00:00Z') },
      { deviceId: 'device-1', score: 0.06, decided_at: iso('2025-12-26T12:00:00Z') },
      { deviceId: 'device-1', score: 0.04, decided_at: iso('2025-12-28T11:59:00Z') },
    ];
    const s1 = computeAnomalyHistorySummary({ deviceId: 'device-1', events: improving, now });
    expect(s1.summary.trend_7d.direction).toBe('improving');

    const degrading = [
      { deviceId: 'device-1', score: 0.01, decided_at: iso('2025-12-22T12:00:00Z') },
      { deviceId: 'device-1', score: 0.03, decided_at: iso('2025-12-24T12:00:00Z') },
      { deviceId: 'device-1', score: 0.05, decided_at: iso('2025-12-26T12:00:00Z') },
      { deviceId: 'device-1', score: 0.07, decided_at: iso('2025-12-28T11:59:00Z') },
    ];
    const s2 = computeAnomalyHistorySummary({ deviceId: 'device-1', events: degrading, now });
    expect(s2.summary.trend_7d.direction).toBe('degrading');
  });
});

