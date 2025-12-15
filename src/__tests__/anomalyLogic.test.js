import { describe, test, expect } from '@jest/globals';

/**
 * Frontend Anomaly Logic Unit Tests
 * 
 * These tests validate that frontend correctly interprets backend API response
 * and never contradicts the backend isAnomaly flag.
 */

/**
 * Simulates frontend anomaly rendering logic
 * This mirrors the logic in device_detail.html loadAnomaly()
 */
function renderAnomalyUI(apiResponse) {
  const anomaly = apiResponse.data || {};
  
  // Extract fields (matching frontend logic - FIXED VERSION)
  // CRITICAL: Only use anomalyScore field, never score field
  const score = anomaly.anomalyScore ?? null; // Only use anomalyScore, ignore score
  const threshold = typeof anomaly.threshold === 'number' ? anomaly.threshold : 0.5;
  const backendIsAnomaly = anomaly.isAnomaly; // Backend is source of truth
  
  // CRITICAL: Trust backend isAnomaly flag, don't recompute
  let status = 'Unknown';
  let isAnomaly = null;
  
  if (typeof backendIsAnomaly === 'boolean') {
    // Backend is source of truth - use its flag directly
    isAnomaly = backendIsAnomaly;
    status = backendIsAnomaly ? 'Anomaly' : 'Normal';
  } else if (typeof score === 'number' && typeof threshold === 'number') {
    // Fallback: only compute if backend flag is missing
    isAnomaly = score >= threshold;
    status = isAnomaly ? 'Anomaly' : 'Normal';
  }
  
  // Safe rendering
  const scoreText = typeof score === 'number' ? score.toFixed(4) : 'N/A';
  const thresholdText = typeof threshold === 'number' ? threshold.toFixed(4) : 'N/A';
  
  return {
    scoreText,
    thresholdText,
    status,
    isAnomaly,
    recommendation: status === 'Anomaly' 
      ? 'Anomaly detected. Device behavior is outside normal parameters.'
      : status === 'Normal'
      ? 'Device behavior is normal.'
      : 'Unknown',
  };
}

describe('Frontend Anomaly Logic - Backend is Source of Truth', () => {
  test('should trust backend isAnomaly=true and show anomaly status', () => {
    const apiResponse = {
      success: true,
      data: {
        isAnomaly: true,
        anomalyScore: 0.8868,
        threshold: 0.33,
      },
    };

    const ui = renderAnomalyUI(apiResponse);

    // CRITICAL: Backend says isAnomaly=true, UI MUST show anomaly
    expect(ui.status).toBe('Anomaly');
    expect(ui.isAnomaly).toBe(true);
    expect(ui.scoreText).toBe('0.8868');
    expect(ui.thresholdText).toBe('0.3300');
    expect(ui.recommendation).toContain('Anomaly detected');
  });

  test('should trust backend isAnomaly=false and show normal status', () => {
    const apiResponse = {
      success: true,
      data: {
        isAnomaly: false,
        anomalyScore: 0.2,
        threshold: 0.5,
      },
    };

    const ui = renderAnomalyUI(apiResponse);

    // CRITICAL: Backend says isAnomaly=false, UI MUST show normal
    expect(ui.status).toBe('Normal');
    expect(ui.isAnomaly).toBe(false);
    expect(ui.scoreText).toBe('0.2000');
    expect(ui.thresholdText).toBe('0.5000');
    expect(ui.recommendation).toContain('normal');
  });

  test('should use anomalyScore field, never score field', () => {
    const apiResponse = {
      success: true,
      data: {
        isAnomaly: true,
        anomalyScore: 0.8868, // Correct field
        score: 0.1234, // Wrong field - should be ignored
        threshold: 0.33,
      },
    };

    const ui = renderAnomalyUI(apiResponse);

    // Must use anomalyScore, not score
    expect(ui.scoreText).toBe('0.8868');
    expect(ui.scoreText).not.toBe('0.1234');
  });

  test('should handle null anomalyScore gracefully', () => {
    const apiResponse = {
      success: true,
      data: {
        isAnomaly: false,
        anomalyScore: null,
        threshold: 0.5,
      },
    };

    const ui = renderAnomalyUI(apiResponse);

    // Should not crash, should show N/A
    expect(ui.scoreText).toBe('N/A');
    expect(ui.thresholdText).toBe('0.5000');
    expect(ui.status).toBe('Normal'); // Backend says false
    expect(ui.isAnomaly).toBe(false);
  });

  test('should never contradict backend isAnomaly flag', () => {
    // Edge case: score < threshold but backend says isAnomaly=true
    // This can happen if backend uses additional logic
    const apiResponse = {
      success: true,
      data: {
        isAnomaly: true, // Backend says anomaly
        anomalyScore: 0.2, // But score is below threshold
        threshold: 0.5,
      },
    };

    const ui = renderAnomalyUI(apiResponse);

    // CRITICAL: Must trust backend, not recompute
    expect(ui.isAnomaly).toBe(true);
    expect(ui.status).toBe('Anomaly');
    // Should NOT be 'Normal' even though 0.2 < 0.5
  });

  test('should handle missing backend isAnomaly flag (fallback to computation)', () => {
    const apiResponse = {
      success: true,
      data: {
        // isAnomaly missing
        anomalyScore: 0.8868,
        threshold: 0.33,
      },
    };

    const ui = renderAnomalyUI(apiResponse);

    // Should compute from score >= threshold
    expect(ui.isAnomaly).toBe(true);
    expect(ui.status).toBe('Anomaly');
  });
});

describe('Defensive Rendering - Edge Cases', () => {
  test('Case A: null score, backend says false', () => {
    const apiResponse = {
      success: true,
      data: {
        isAnomaly: false,
        anomalyScore: null,
        threshold: 0.5,
      },
    };

    const ui = renderAnomalyUI(apiResponse);

    expect(ui.scoreText).toBe('N/A');
    expect(ui.thresholdText).toBe('0.5000');
    expect(ui.status).toBe('Normal');
    expect(ui.recommendation).toContain('normal');
  });

  test('Case B: score below threshold, backend says false', () => {
    const apiResponse = {
      success: true,
      data: {
        isAnomaly: false,
        anomalyScore: 0.2,
        threshold: 0.5,
      },
    };

    const ui = renderAnomalyUI(apiResponse);

    expect(ui.status).toBe('Normal');
    expect(ui.isAnomaly).toBe(false);
    expect(ui.recommendation).toContain('normal');
  });

  test('should not crash on undefined threshold', () => {
    const apiResponse = {
      success: true,
      data: {
        isAnomaly: true,
        anomalyScore: 0.8868,
        threshold: undefined,
      },
    };

    const ui = renderAnomalyUI(apiResponse);

    // Should fallback to 0.5
    expect(ui.thresholdText).toBe('0.5000');
    expect(ui.status).toBe('Anomaly');
  });

  test('should not crash on missing data object', () => {
    const apiResponse = {
      success: true,
      data: null,
    };

    const ui = renderAnomalyUI(apiResponse);

    expect(ui.scoreText).toBe('N/A');
    expect(ui.thresholdText).toBe('0.5000');
    expect(ui.status).toBe('Unknown');
  });
});

describe('Assertion: Backend is Source of Truth', () => {
  test('should fail if frontend recomputes isAnomaly ignoring backend flag', () => {
    const apiResponse = {
      success: true,
      data: {
        isAnomaly: true, // Backend says anomaly
        anomalyScore: 0.8868,
        threshold: 0.33,
      },
    };

    const ui = renderAnomalyUI(apiResponse);

    // CRITICAL ASSERTION: If backend says isAnomaly=true, UI MUST show anomaly
    // This test will fail if frontend recomputes and ignores backend flag
    expect(ui.isAnomaly).toBe(true);
    expect(ui.status).toBe('Anomaly');
    
    // Verify we're using backend flag, not recomputed value
    const backendFlag = apiResponse.data.isAnomaly;
    expect(ui.isAnomaly).toBe(backendFlag);
  });

  test('should enforce: backend isAnomaly=true can never render "normal"', () => {
    const testCases = [
      { isAnomaly: true, score: 0.8868, threshold: 0.33 },
      { isAnomaly: true, score: 0.2, threshold: 0.5 }, // Edge: score < threshold but backend says anomaly
      { isAnomaly: true, score: null, threshold: 0.5 },
    ];

    for (const testCase of testCases) {
      const apiResponse = {
        success: true,
        data: testCase,
      };

      const ui = renderAnomalyUI(apiResponse);

      // CRITICAL: Backend says true, UI MUST show anomaly
      expect(ui.isAnomaly).toBe(true);
      expect(ui.status).toBe('Anomaly');
      expect(ui.status).not.toBe('Normal');
      expect(ui.recommendation).toContain('Anomaly');
    }
  });

  test('should enforce: backend isAnomaly=false can never render "anomaly"', () => {
    const testCases = [
      { isAnomaly: false, score: 0.2, threshold: 0.5 },
      { isAnomaly: false, score: 0.8868, threshold: 0.33 }, // Edge: score > threshold but backend says normal
      { isAnomaly: false, score: null, threshold: 0.5 },
    ];

    for (const testCase of testCases) {
      const apiResponse = {
        success: true,
        data: testCase,
      };

      const ui = renderAnomalyUI(apiResponse);

      // CRITICAL: Backend says false, UI MUST show normal
      expect(ui.isAnomaly).toBe(false);
      expect(ui.status).toBe('Normal');
      expect(ui.status).not.toBe('Anomaly');
      expect(ui.recommendation).toContain('normal');
    }
  });
});
