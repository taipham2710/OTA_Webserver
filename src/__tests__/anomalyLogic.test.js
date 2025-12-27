import { describe, test, expect } from '@jest/globals';

/**
 * Frontend Anomaly Logic Unit Tests
 * 
 * These tests validate that the frontend remains READ-ONLY:
 * - No anomaly / risk / threshold computation in the UI
 * - UI renders only the persisted devices.anomaly state
 */

/**
 * Simulates frontend anomaly rendering logic (device_detail.html)
 * Reads only devices.anomaly and renders values directly.
 */
function renderAnomalyUI(apiResponse) {
  const device = apiResponse?.data || {};
  const anomaly = device?.anomaly || null;

  const riskLevel = anomaly?.risk_level ?? null;
  const action = anomaly?.action ?? null;
  const scoreText = typeof anomaly?.score === 'number' ? anomaly.score.toFixed(4) : 'N/A';
  const hardText = typeof anomaly?.hard_threshold === 'number' ? anomaly.hard_threshold.toFixed(4) : 'N/A';
  const softText = typeof anomaly?.soft_threshold === 'number' ? anomaly.soft_threshold.toFixed(4) : 'N/A';

  let status = 'N/A';
  if (riskLevel === 'high') status = 'High';
  else if (riskLevel === 'warning') status = 'Warning';
  else if (riskLevel === 'low') status = 'Low';

  return {
    scoreText,
    status,
    riskLevel,
    action,
    hardText,
    softText,
  };
}

describe('Frontend Anomaly Logic - Read-only devices.anomaly', () => {
  test('should render high risk state', () => {
    const apiResponse = {
      success: true,
      data: {
        deviceId: 'dev-001',
        anomaly: {
          score: 0.95,
          risk_level: 'high',
          action: 'BLOCK',
          hard_threshold: 0.94,
          soft_threshold: 0.7,
          updated_at: '2025-01-01T00:00:00.000Z',
        },
      },
    };

    const ui = renderAnomalyUI(apiResponse);

    expect(ui.status).toBe('High');
    expect(ui.riskLevel).toBe('high');
    expect(ui.action).toBe('BLOCK');
    expect(ui.scoreText).toBe('0.9500');
    expect(ui.hardText).toBe('0.9400');
    expect(ui.softText).toBe('0.7000');
  });

  test('should render warning risk state', () => {
    const apiResponse = {
      success: true,
      data: {
        deviceId: 'dev-001',
        anomaly: {
          score: 0.75,
          risk_level: 'warning',
          action: 'DELAY',
          hard_threshold: 0.94,
          soft_threshold: 0.7,
          updated_at: '2025-01-01T00:00:00.000Z',
        },
      },
    };

    const ui = renderAnomalyUI(apiResponse);

    expect(ui.status).toBe('Warning');
    expect(ui.riskLevel).toBe('warning');
    expect(ui.action).toBe('DELAY');
    expect(ui.scoreText).toBe('0.7500');
  });

  test('should render low risk state', () => {
    const apiResponse = {
      success: true,
      data: {
        deviceId: 'dev-001',
        anomaly: {
          score: 0.2,
          risk_level: 'low',
          action: 'ALLOW',
          hard_threshold: 0.94,
          soft_threshold: 0.7,
          updated_at: '2025-01-01T00:00:00.000Z',
        },
      },
    };

    const ui = renderAnomalyUI(apiResponse);

    expect(ui.status).toBe('Low');
    expect(ui.riskLevel).toBe('low');
    expect(ui.action).toBe('ALLOW');
    expect(ui.scoreText).toBe('0.2000');
  });

  test('should handle missing anomaly state gracefully', () => {
    const apiResponse = {
      success: true,
      data: {
        deviceId: 'dev-001',
        anomaly: null,
      },
    };

    const ui = renderAnomalyUI(apiResponse);

    expect(ui.scoreText).toBe('N/A');
    expect(ui.hardText).toBe('N/A');
    expect(ui.softText).toBe('N/A');
    expect(ui.status).toBe('N/A');
    expect(ui.riskLevel).toBe(null);
    expect(ui.action).toBe(null);
  });
});

describe('Defensive Rendering - Edge Cases', () => {
  test('should not crash on missing data object', () => {
    const apiResponse = { success: true, data: null };
    const ui = renderAnomalyUI(apiResponse);
    expect(ui.scoreText).toBe('N/A');
    expect(ui.status).toBe('N/A');
  });
});
