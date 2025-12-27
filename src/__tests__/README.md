# Anomaly Detection Test Suite

## Overview

This test suite validates end-to-end consistency between backend policy decisions and frontend UI rendering logic. The UI is read-only and must render persisted anomaly state without deriving risk/action.

## Test Files

### 1. `anomalyContract.test.js`
**Backend API Contract Validation**

Tests that `POST /api/anomaly/:deviceId/infer` returns:
- `success: true`
- `data.deviceId`: string
- `data.score`: number
- `data.risk_level`: string | null
- `data.decision`: `"allow" | "delay" | "block"`
- `data.threshold`: number
- `data.soft_threshold`: number

**Key Assertions:**
- API contract structure is consistent
- Decision consistency: decision must match (score, threshold, soft_threshold)

### 2. `anomalyLogic.test.js`
**Frontend Logic Unit Tests**

Validates frontend correctly renders `devices.anomaly`:
- No computation/derivation of risk/action from score
- Null-safe rendering (no `toFixed` on null/undefined)

**Test Cases:**
- Renders `risk_level` + `action` + thresholds when present
- Handles missing anomaly state

### 3. `anomalyIntegration.test.js`
**End-to-End Consistency Validation**

Tests complete flow from persisted state to UI rendering:
- UI trusts backend-provided fields and does not derive them

## Running Tests

```bash
npm test
```

## Test Coverage

- Backend API contract validation
- Null-safe rendering
- End-to-end consistency

## Success Criteria

All tests must pass to ensure:
1. UI is strictly read-only for anomaly decisions
2. UI renders current state only from `devices.anomaly`
3. UI renders history only from `anomaly_events`
4. UI is null-safe (no `toFixed` on null/undefined)
