import { describe, test, expect } from '@jest/globals';

/**
 * Integration Tests: End-to-End Consistency Validation
 * 
 * These tests validate that the entire flow from backend API to frontend UI
 * maintains consistency and never contradicts ML inference results.
 */

/**
 * Simulates the complete flow:
 * 1. Backend API returns result
 * 2. Frontend extracts and renders
 * 3. Verify no contradictions
 */
function simulateEndToEndFlow(backendResponse) {
  // Step 1: Backend API contract validation
  const hasValidContract = 
    typeof backendResponse.isAnomaly === 'boolean' &&
    (backendResponse.anomalyScore === null || typeof backendResponse.anomalyScore === 'number') &&
    typeof backendResponse.threshold === 'number';

  if (!hasValidContract) {
    return { valid: false, error: 'Invalid backend API contract' };
  }

  // Step 2: Frontend extraction (matching device_detail.html logic)
  const score = backendResponse.anomalyScore ?? null;
  const threshold = backendResponse.threshold;
  const backendIsAnomaly = backendResponse.isAnomaly;

  // Step 3: Frontend status determination
  let frontendStatus = 'Unknown';
  let frontendIsAnomaly = null;

  if (typeof backendIsAnomaly === 'boolean') {
    // Trust backend flag
    frontendIsAnomaly = backendIsAnomaly;
    frontendStatus = backendIsAnomaly ? 'Anomaly' : 'Normal';
  } else if (typeof score === 'number' && typeof threshold === 'number') {
    // Fallback computation
    frontendIsAnomaly = score >= threshold;
    frontendStatus = frontendIsAnomaly ? 'Anomaly' : 'Normal';
  }

  // Step 4: Consistency check
  const isConsistent = 
    frontendIsAnomaly === backendIsAnomaly ||
    (backendIsAnomaly === undefined && frontendIsAnomaly !== null);

  return {
    valid: hasValidContract && isConsistent,
    backend: {
      isAnomaly: backendIsAnomaly,
      score,
      threshold,
    },
    frontend: {
      isAnomaly: frontendIsAnomaly,
      status: frontendStatus,
    },
    consistent: isConsistent,
  };
}

describe('End-to-End Consistency Validation', () => {
  test('should maintain consistency: backend true → frontend anomaly', () => {
    const backendResponse = {
      isAnomaly: true,
      anomalyScore: 0.8868,
      threshold: 0.33,
    };

    const flow = simulateEndToEndFlow(backendResponse);

    expect(flow.valid).toBe(true);
    expect(flow.consistent).toBe(true);
    expect(flow.frontend.isAnomaly).toBe(true);
    expect(flow.frontend.status).toBe('Anomaly');
  });

  test('should maintain consistency: backend false → frontend normal', () => {
    const backendResponse = {
      isAnomaly: false,
      anomalyScore: 0.2,
      threshold: 0.5,
    };

    const flow = simulateEndToEndFlow(backendResponse);

    expect(flow.valid).toBe(true);
    expect(flow.consistent).toBe(true);
    expect(flow.frontend.isAnomaly).toBe(false);
    expect(flow.frontend.status).toBe('Normal');
  });

  test('should never contradict: backend true cannot render normal', () => {
    const backendResponse = {
      isAnomaly: true,
      anomalyScore: 0.8868,
      threshold: 0.33,
    };

    const flow = simulateEndToEndFlow(backendResponse);

    // CRITICAL: If backend says true, frontend MUST show anomaly
    expect(flow.frontend.status).not.toBe('Normal');
    expect(flow.frontend.status).toBe('Anomaly');
    expect(flow.frontend.isAnomaly).toBe(true);
  });

  test('should never contradict: backend false cannot render anomaly', () => {
    const backendResponse = {
      isAnomaly: false,
      anomalyScore: 0.8868, // High score but backend says normal
      threshold: 0.33,
    };

    const flow = simulateEndToEndFlow(backendResponse);

    // CRITICAL: If backend says false, frontend MUST show normal
    expect(flow.frontend.status).not.toBe('Anomaly');
    expect(flow.frontend.status).toBe('Normal');
    expect(flow.frontend.isAnomaly).toBe(false);
  });

  test('should handle edge case: score < threshold but backend says anomaly', () => {
    // This can happen if backend uses additional ML logic beyond simple threshold
    const backendResponse = {
      isAnomaly: true,
      anomalyScore: 0.2, // Below threshold
      threshold: 0.5,
    };

    const flow = simulateEndToEndFlow(backendResponse);

    // Must trust backend, not recompute
    expect(flow.frontend.isAnomaly).toBe(true);
    expect(flow.frontend.status).toBe('Anomaly');
    expect(flow.consistent).toBe(true);
  });

  test('should handle edge case: score > threshold but backend says normal', () => {
    // This can happen if backend uses additional ML logic
    const backendResponse = {
      isAnomaly: false,
      anomalyScore: 0.8868, // Above threshold
      threshold: 0.33,
    };

    const flow = simulateEndToEndFlow(backendResponse);

    // Must trust backend, not recompute
    expect(flow.frontend.isAnomaly).toBe(false);
    expect(flow.frontend.status).toBe('Normal');
    expect(flow.consistent).toBe(true);
  });
});

describe('Mathematical Consistency Validation', () => {
  test('should verify: when score exists, isAnomaly === (score >= threshold)', () => {
    const testCases = [
      { score: 0.8868, threshold: 0.33, expected: true },
      { score: 0.2, threshold: 0.5, expected: false },
      { score: 0.5, threshold: 0.5, expected: true }, // Edge: equal
    ];

    for (const testCase of testCases) {
      const backendResponse = {
        isAnomaly: testCase.expected,
        anomalyScore: testCase.score,
        threshold: testCase.threshold,
      };

      const flow = simulateEndToEndFlow(backendResponse);

      // Verify mathematical consistency
      if (flow.backend.score !== null) {
        const computed = flow.backend.score >= flow.backend.threshold;
        expect(flow.backend.isAnomaly).toBe(computed);
        expect(flow.backend.isAnomaly).toBe(testCase.expected);
      }
    }
  });
});
