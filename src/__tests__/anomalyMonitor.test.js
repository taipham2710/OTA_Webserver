import { describe, test, expect } from '@jest/globals';
import { computeAnomalyMonitor } from '../services/anomalyMonitorService.js';

const iso = (d) => new Date(d).toISOString();

describe('Anomaly Monitor', () => {
  test('normal-only events => normal state', () => {
    const now = new Date('2025-12-28T12:00:00Z');
    const events = [
      { deviceId: 'device-1', score: 0.01, risk_level: 'low', action: 'ALLOW', decided_at: iso('2025-12-28T11:59:00Z') },
      { deviceId: 'device-1', score: 0.02, risk_level: 'low', action: 'ALLOW', decided_at: iso('2025-12-28T11:58:00Z') },
      { deviceId: 'device-1', score: 0.015, risk_level: 'low', action: 'ALLOW', decided_at: iso('2025-12-28T11:50:00Z') },
    ];

    const monitor = computeAnomalyMonitor({ deviceId: 'device-1', events, now });
    expect(monitor.device_id).toBe('device-1');
    expect(monitor.status.state).toBe('normal');
    expect(monitor.windows.last_15m.count).toBe(3);
    expect(monitor.windows.last_15m.anomaly_ratio).toBe(0);
    expect(monitor.windows.last_15m.block_ratio).toBe(0);
  });

  test('mixed low+medium => borderline', () => {
    const now = new Date('2025-12-28T12:00:00Z');
    const events = [
      { deviceId: 'device-1', score: 0.02, risk_level: 'low', action: 'ALLOW', decided_at: iso('2025-12-28T11:59:30Z') },
      { deviceId: 'device-1', score: 0.03, risk_level: 'medium', action: 'ALLOW', decided_at: iso('2025-12-28T11:59:00Z') },
      { deviceId: 'device-1', score: 0.025, risk_level: 'low', action: 'ALLOW', decided_at: iso('2025-12-28T11:58:30Z') },
      { deviceId: 'device-1', score: 0.04, risk_level: 'medium', action: 'ALLOW', decided_at: iso('2025-12-28T11:58:00Z') },
      { deviceId: 'device-1', score: 0.01, risk_level: 'low', action: 'ALLOW', decided_at: iso('2025-12-28T11:57:30Z') },
    ];

    const monitor = computeAnomalyMonitor({ deviceId: 'device-1', events, now });
    expect(monitor.windows.last_5m.count).toBe(5);
    expect(monitor.windows.last_5m.anomaly_ratio).toBeGreaterThanOrEqual(0.2);
    expect(monitor.status.state).toBe('borderline');
  });

  test('BLOCK-dominant => persistently_anomalous', () => {
    const now = new Date('2025-12-28T12:00:00Z');
    const events = [
      { deviceId: 'device-1', score: 0.1, risk_level: 'high', action: 'BLOCK', decided_at: iso('2025-12-28T11:59:50Z') },
      { deviceId: 'device-1', score: 0.11, risk_level: 'high', action: 'BLOCK', decided_at: iso('2025-12-28T11:59:30Z') },
      { deviceId: 'device-1', score: 0.09, risk_level: 'medium', action: 'BLOCK', decided_at: iso('2025-12-28T11:59:10Z') },
      { deviceId: 'device-1', score: 0.08, risk_level: 'low', action: 'ALLOW', decided_at: iso('2025-12-28T11:58:50Z') },
      { deviceId: 'device-1', score: 0.12, risk_level: 'high', action: 'BLOCK', decided_at: iso('2025-12-28T11:58:30Z') },
    ];

    const monitor = computeAnomalyMonitor({ deviceId: 'device-1', events, now });
    expect(monitor.status.state).toBe('persistently_anomalous');
    expect(monitor.windows.last_15m.block_ratio).toBeGreaterThanOrEqual(0.6);
    expect(monitor.current.action).toBe('BLOCK');
  });
});

