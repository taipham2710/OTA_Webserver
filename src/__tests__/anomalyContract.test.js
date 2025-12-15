import { describe, test, expect } from '@jest/globals';

/**
 * Backend API Contract Validation Tests
 * 
 * These tests validate the structure and constraints of the anomaly API response
 * without requiring actual service dependencies.
 * 
 * Run these tests to ensure the API contract is always maintained.
 */

/**
 * Validates API response contract
 */
function validateAnomalyResponse(response) {
  const errors = [];

  // Check structure
  if (!response || typeof response !== 'object') {
    errors.push('Response must be an object');
    return { valid: false, errors };
  }

  // Check isAnomaly
  if (typeof response.isAnomaly !== 'boolean') {
    errors.push('isAnomaly must be a boolean');
  }

  // Check anomalyScore
  if (response.anomalyScore !== null && typeof response.anomalyScore !== 'number') {
    errors.push('anomalyScore must be number or null');
  }

  // Check threshold - CRITICAL: must be number, never null
  if (typeof response.threshold !== 'number') {
    errors.push('threshold must be a number (never null or undefined)');
  }

  if (response.threshold === null || response.threshold === undefined) {
    errors.push('threshold cannot be null or undefined');
  }

  // Check mathematical consistency
  if (response.anomalyScore !== null && typeof response.anomalyScore === 'number') {
    const computedAnomaly = response.anomalyScore >= response.threshold;
    if (response.isAnomaly !== computedAnomaly) {
      errors.push(
        `Mathematical inconsistency: isAnomaly=${response.isAnomaly} but ` +
        `anomalyScore=${response.anomalyScore} >= threshold=${response.threshold} = ${computedAnomaly}`
      );
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

describe('Backend API Contract Validation', () => {
  test('should validate correct API response structure', () => {
    const response = {
      isAnomaly: true,
      anomalyScore: 0.8868,
      threshold: 0.33,
    };

    const validation = validateAnomalyResponse(response);

    expect(validation.valid).toBe(true);
    expect(validation.errors).toHaveLength(0);
  });

  test('should fail if threshold is null', () => {
    const response = {
      isAnomaly: true,
      anomalyScore: 0.8868,
      threshold: null, // INVALID
    };

    const validation = validateAnomalyResponse(response);

    expect(validation.valid).toBe(false);
    expect(validation.errors.some(e => e.includes('threshold'))).toBe(true);
  });

  test('should fail if threshold is undefined', () => {
    const response = {
      isAnomaly: true,
      anomalyScore: 0.8868,
      // threshold missing
    };

    const validation = validateAnomalyResponse(response);

    expect(validation.valid).toBe(false);
    expect(validation.errors.some(e => e.includes('threshold'))).toBe(true);
  });

  test('should fail if isAnomaly is not boolean', () => {
    const response = {
      isAnomaly: 'true', // INVALID: string instead of boolean
      anomalyScore: 0.8868,
      threshold: 0.33,
    };

    const validation = validateAnomalyResponse(response);

    expect(validation.valid).toBe(false);
    expect(validation.errors.some(e => e.includes('isAnomaly'))).toBe(true);
  });

  test('should enforce mathematical consistency', () => {
    const inconsistentResponse = {
      isAnomaly: false, // Says normal
      anomalyScore: 0.8868, // But score is high
      threshold: 0.33, // And above threshold
    };

    const validation = validateAnomalyResponse(inconsistentResponse);

    expect(validation.valid).toBe(false);
    expect(validation.errors.some(e => e.includes('Mathematical inconsistency'))).toBe(true);
  });

  test('should allow null anomalyScore with valid threshold', () => {
    const response = {
      isAnomaly: false,
      anomalyScore: null,
      threshold: 0.5,
    };

    const validation = validateAnomalyResponse(response);

    expect(validation.valid).toBe(true);
  });

  test('should validate edge case: score equals threshold', () => {
    const response = {
      isAnomaly: true,
      anomalyScore: 0.5,
      threshold: 0.5, // Equal
    };

    const validation = validateAnomalyResponse(response);

    // score >= threshold when equal, so isAnomaly should be true
    expect(validation.valid).toBe(true);
  });
});
