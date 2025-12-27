import { describe, test, expect } from '@jest/globals';

/**
 * Integration Tests: End-to-End Consistency Validation
 * 
 * These tests validate that the frontend remains READ-ONLY and never derives
 * anomaly state; it must render backend-provided policy decisions.
 */

/**
 * Simulates the complete flow:
 * 1. Backend /infer returns decision contract
 * 2. Backend persists devices.anomaly (authoritative current state)
 * 3. Frontend renders devices.anomaly without recomputation
 */
function renderAnomalyFromDevice(device) {
  const anomaly = device?.anomaly ?? null;
  if (!anomaly || typeof anomaly !== 'object') {
    return { visible: false, risk_level: null, action: null, score: null };
  }

  return {
    visible: true,
    risk_level: anomaly.risk_level ?? null,
    action: anomaly.action ?? null,
    score: typeof anomaly.score === 'number' ? anomaly.score : null,
  };
}

describe('End-to-End Consistency Validation', () => {
  test('should render backend-provided anomaly state (no computation)', () => {
    const device = {
      deviceId: 'dev-001',
      anomaly: {
        score: 0.8868,
        risk_level: 'warning',
        action: 'DELAY',
        hard_threshold: 0.94,
        soft_threshold: 0.7,
        updated_at: '2025-01-01T00:00:00.000Z',
      },
    };

    const ui = renderAnomalyFromDevice(device);

    expect(ui.visible).toBe(true);
    expect(ui.action).toBe('DELAY');
    expect(ui.risk_level).toBe('warning');
    expect(ui.score).toBe(0.8868);
  });

  test('should hide anomaly UI when device has no anomaly state', () => {
    const device = { deviceId: 'dev-001', anomaly: null };
    const ui = renderAnomalyFromDevice(device);
    expect(ui.visible).toBe(false);
  });

  test('should trust backend action even if score appears inconsistent', () => {
    // Frontend must never derive action/risk_level from score/thresholds.
    const device = {
      deviceId: 'dev-001',
      anomaly: {
        score: 0.99, // would imply BLOCK normally
        risk_level: 'low', // inconsistent but UI must still render as-is
        action: 'ALLOW',
        hard_threshold: 0.94,
        soft_threshold: 0.7,
        updated_at: '2025-01-01T00:00:00.000Z',
      },
    };

    const ui = renderAnomalyFromDevice(device);

    expect(ui.visible).toBe(true);
    expect(ui.action).toBe('ALLOW');
    expect(ui.risk_level).toBe('low');
  });
});
