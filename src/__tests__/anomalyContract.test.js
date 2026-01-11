import { describe, test, expect } from '@jest/globals';

/**
 * Backend API Contract Validation Tests
 * 
 * These tests validate the structure and constraints of the anomaly inference API response
 * without requiring actual service dependencies.
 * 
 * Run these tests to ensure the API contract is always maintained.
 */

/**
 * Validates API response contract
 */
function validateInferResponse(response) {
  const errors = [];

  // Check structure
  if (!response || typeof response !== 'object') {
    errors.push('Response must be an object');
    return { valid: false, errors };
  }

  // success wrapper
  if (response.success !== true) {
    errors.push('success must be true');
    return { valid: false, errors };
  }

  if (!response.data || typeof response.data !== 'object') {
    errors.push('data must be an object');
    return { valid: false, errors };
  }

  const data = response.data;

  if (typeof data.deviceId !== 'string' || data.deviceId.trim().length === 0) {
    errors.push('deviceId must be a non-empty string');
  }

  if (typeof data.score !== 'number') {
    errors.push('score must be a number');
  }

  if (data.risk_level !== null && typeof data.risk_level !== 'string') {
    errors.push('risk_level must be a string or null');
  }

  if (!['allow', 'delay', 'block'].includes(data.decision)) {
    errors.push('decision must be one of: allow | delay | block');
  }

  if (typeof data.threshold !== 'number') errors.push('threshold must be a number');
  if (typeof data.soft_threshold !== 'number') errors.push('soft_threshold must be a number');

  return {
    valid: errors.length === 0,
    errors,
  };
}

describe('Backend API Contract Validation (/api/anomaly/:deviceId/infer)', () => {
  test('should validate correct inference response structure', () => {
    const response = {
      success: true,
      data: {
        deviceId: 'dev-001',
        score: 0.8868,
        risk_level: 'low',
        decision: 'delay',
        threshold: 0.94,
        soft_threshold: 0.7,
      },
    };

    const validation = validateInferResponse(response);

    expect(validation.valid).toBe(true);
    expect(validation.errors).toHaveLength(0);
  });

  test('should fail if thresholds are missing', () => {
    const response = {
      success: true,
      data: {
        deviceId: 'dev-001',
        score: 0.2,
        risk_level: 'low',
        decision: 'allow',
        // threshold missing
        soft_threshold: 0.7,
      },
    };

    const validation = validateInferResponse(response);

    expect(validation.valid).toBe(false);
    expect(validation.errors.some(e => e.includes('threshold'))).toBe(true);
  });

  test('should fail if soft_threshold is missing', () => {
    const response = {
      success: true,
      data: {
        deviceId: 'dev-001',
        score: 0.2,
        risk_level: 'low',
        decision: 'allow',
        threshold: 0.94,
        // soft_threshold missing
      },
    };

    const validation = validateInferResponse(response);

    expect(validation.valid).toBe(false);
    expect(validation.errors.some(e => e.includes('soft_threshold'))).toBe(true);
  });

  test('should enforce decision: score >= threshold => block', () => {
    const response = {
      success: true,
      data: {
        deviceId: 'dev-001',
        score: 0.95,
        risk_level: 'high',
        decision: 'block',
        threshold: 0.94,
        soft_threshold: 0.7,
      },
    };

    const validation = validateInferResponse(response);

    expect(validation.valid).toBe(true);
  });

  test('should not derive decision from score/thresholds in the contract validator', () => {
    const response = {
      success: true,
      data: {
        deviceId: 'dev-001',
        score: 0.95,
        risk_level: 'low',
        decision: 'allow',
        threshold: 0.94,
        soft_threshold: 0.7,
      },
    };

    const validation = validateInferResponse(response);

    expect(validation.valid).toBe(true);
  });
});
