# Anomaly Detection Test Suite

## Overview

This test suite validates end-to-end consistency between backend anomaly inference results and frontend UI rendering logic. It ensures that the ML Ops pipeline maintains data integrity from API response through UI display.

## Test Files

### 1. `anomalyService.test.js`
**Backend API Contract Validation**

Tests that `/api/anomaly/:deviceId` always returns:
- `isAnomaly`: boolean
- `anomalyScore`: number | null
- `threshold`: number (NEVER null)

**Key Assertions:**
- Threshold is always a number, even on errors
- API contract structure is consistent
- Threshold sourced from model metadata with fallback to 0.5
- Mathematical consistency: `isAnomaly === (anomalyScore >= threshold)` when score exists

### 2. `anomalyLogic.test.js`
**Frontend Logic Unit Tests**

Validates frontend correctly interprets backend API response:
- Uses `anomalyScore` field, never `score` field
- Trusts backend `isAnomaly` flag (does not recompute)
- Handles null values safely (no `toFixed` on null)
- Correct recommendation logic

**Test Cases:**
- Backend `isAnomaly: true` → UI shows "Anomaly Detected"
- Backend `isAnomaly: false` → UI shows "Normal"
- Null score handling
- Edge cases (score < threshold but backend says anomaly)

### 3. `anomalyIntegration.test.js`
**End-to-End Consistency Validation**

Tests complete flow from backend API to frontend UI:
- No contradictions between backend and frontend
- Backend is source of truth
- Mathematical consistency validation

## Running Tests

```bash
npm test
```

## Test Coverage

- ✅ Backend API contract validation
- ✅ Frontend field extraction (anomalyScore vs score)
- ✅ Backend isAnomaly flag trust
- ✅ Null-safe rendering
- ✅ Edge case handling
- ✅ End-to-end consistency

## Success Criteria

All tests must pass to ensure:
1. UI never contradicts backend anomaly result
2. UI always uses `anomalyScore`, never `score`
3. UI trusts backend `isAnomaly` flag
4. UI is null-safe (no `toFixed` on null/undefined)
5. Recommendation logic is mathematically and semantically correct
