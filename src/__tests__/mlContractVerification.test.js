import { describe, test, expect, beforeEach, jest } from '@jest/globals';
import fs from 'fs/promises';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const readBaseFeatures = async () => {
  const raw = await fs.readFile(join(__dirname, '../../feature_list.json'), 'utf-8');
  const list = JSON.parse(raw);
  return list.filter((name) => typeof name === 'string' && !name.startsWith('ota_'));
};

const buildInterleavedOrder = (baseFeatures) => {
  const out = [];
  for (const f of baseFeatures) out.push(f, `${f}_present`);
  return out;
};

const makeQueryApiFromRows = (rows) => ({
  queryRows(_fluxQuery, handlers) {
    for (const row of rows) handlers.next(row, { toObject: (r) => r });
    handlers.complete();
  },
});

describe('ML Contract Verification (timestamp + count-based window + feature vector)', () => {
  let logSpy;
  let errorSpy;

  beforeEach(() => {
    jest.resetModules();
    jest.restoreAllMocks();
    delete process.env.DEBUG_ML;

    logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  test('CONTRACT — TIMESTAMP: ingest without metricsData.timestamp rejects and writes nothing', async () => {
    const writePoint = jest.fn();
    const flush = jest.fn().mockResolvedValue(undefined);

    jest.unstable_mockModule('../clients/influxdb.js', () => ({
      getWriteApi: () => ({ writePoint, flush }),
      getQueryApi: () => ({ queryRows: () => {} }),
    }));

    const { ingestMetricsHandler } = await import('../controllers/metricsController.js');
    const { errorHandler } = await import('../utils/errors.js');

    const req = { body: { deviceId: 'device-001', metrics: { cpu_usage: 0 } } };
    const res = {
      statusCode: null,
      payload: null,
      status(code) {
        this.statusCode = code;
        return this;
      },
      json(payload) {
        this.payload = payload;
        return this;
      },
    };

    let capturedError = null;
    const next = (err) => {
      capturedError = err;
    };

    await ingestMetricsHandler(req, res, next);
    expect(capturedError).not.toBeNull();

    errorHandler(capturedError, req, res, () => {});

    expect(res.statusCode).toBe(400);
    expect(res.payload?.success).toBe(false);
    expect(String(res.payload?.message || '')).toContain('ML_CONTRACT_VIOLATION');
    expect(writePoint).not.toHaveBeenCalled();
    expect(flush).not.toHaveBeenCalled();
  });

  test('CONTRACT — COUNT-BASED WINDOW: 7 events -> uses all events as one window', async () => {
    const baseStart = Date.parse('2026-01-04T00:00:00.000Z'); // Sunday 00:00 UTC
    const times = [6, 1, 0, 5, 2, 4, 3].map((h) => new Date(baseStart + h * 3600_000).toISOString()); // unsorted

    const rows = times.map((t, idx) => ({
      _time: t,
      deviceId: 'device-001',
      timestamp_provided: true,
      cpu_usage: idx === 2 ? 100 : 0, // one non-zero point
    }));

    jest.unstable_mockModule('../clients/influxdb.js', () => ({
      getQueryApi: () => makeQueryApiFromRows(rows),
      getWriteApi: () => ({ writePoint: () => {}, flush: async () => {} }),
    }));

    const { buildMlInferenceVector } = await import('../services/featureAggregationService.js');
    const fv = await buildMlInferenceVector('device-001');

    expect(fv.window_start_hour).toBe(0); // earliest event after sort
    expect(fv.is_weekend).toBe(1); // Sunday
    expect(fv.cpu_usage_mean).toBeCloseTo(100 / 7, 6);
    expect(fv.time_gap_avg).toBe(3600); // 1 hour cadence in seconds
  });

  test('CONTRACT — COUNT-BASED WINDOW: 12 events -> uses last 10 (drops oldest 2)', async () => {
    const baseStart = Date.parse('2026-01-04T00:00:00.000Z'); // Sunday 00:00 UTC
    const times = Array.from({ length: 12 }, (_, i) => new Date(baseStart + i * 3600_000).toISOString());

    const rows = times.map((t, idx) => ({
      _time: t,
      deviceId: 'device-001',
      timestamp_provided: true,
      cpu_usage: idx < 2 ? 100 : 0, // oldest 2 are high, should be dropped
    }));

    jest.unstable_mockModule('../clients/influxdb.js', () => ({
      getQueryApi: () => makeQueryApiFromRows(rows),
      getWriteApi: () => ({ writePoint: () => {}, flush: async () => {} }),
    }));

    const { buildMlInferenceVector } = await import('../services/featureAggregationService.js');
    const fv = await buildMlInferenceVector('device-001');

    expect(fv.window_start_hour).toBe(2); // after dropping oldest 2 events
    expect(fv.cpu_usage_mean).toBeCloseTo(0, 10); // last 10 are all zeros
    expect(fv.time_gap_avg).toBe(3600);
  });

  test('CONTRACT — FEATURE VECTOR INTEGRITY: 154 keys, interleaved order, *_present semantics', async () => {
    const rows = [
      {
        _time: '2026-01-04T00:00:00.000Z',
        deviceId: 'device-001',
        timestamp_provided: true,
        cpu_usage: 0, // zero is still "present"
        // mem_usage absent => not present
      },
    ];

    jest.unstable_mockModule('../clients/influxdb.js', () => ({
      getQueryApi: () => makeQueryApiFromRows(rows),
      getWriteApi: () => ({ writePoint: () => {}, flush: async () => {} }),
    }));

    const baseFeatures = await readBaseFeatures();
    expect(baseFeatures).toHaveLength(77);
    const expectedOrder = buildInterleavedOrder(baseFeatures);

    const { buildMlInferenceVector } = await import('../services/featureAggregationService.js');
    const fv = await buildMlInferenceVector('device-001');

    const keys = Object.keys(fv);
    expect(keys).toHaveLength(154);
    expect(keys).toEqual(expectedOrder);

    expect(fv.cpu_usage_mean_present).toBe(1);
    expect(fv.mem_usage_mean_present).toBe(0);
  });

  test('NEGATIVE — INVALID DATA: missing timestamp provenance throws ML_CONTRACT_VIOLATION', async () => {
    const rows = [
      {
        _time: '2026-01-04T00:00:00.000Z',
        deviceId: 'device-001',
        timestamp_provided: false,
        cpu_usage: 1,
      },
    ];

    jest.unstable_mockModule('../clients/influxdb.js', () => ({
      getQueryApi: () => makeQueryApiFromRows(rows),
      getWriteApi: () => ({ writePoint: () => {}, flush: async () => {} }),
    }));

    const { buildMlInferenceVector } = await import('../services/featureAggregationService.js');
    await expect(buildMlInferenceVector('device-001')).rejects.toMatchObject({
      statusCode: 400,
      message: expect.stringContaining('ML_CONTRACT_VIOLATION'),
    });
  });

  test('ANOMALY INFER — HARD FAIL: ML_CONTRACT_VIOLATION returns 400 and performs no writes', async () => {
    const findOne = jest.fn().mockResolvedValue({ deviceId: 'device-001' });
    const updateOne = jest.fn();
    const insertOne = jest.fn();

    jest.unstable_mockModule('../clients/mongodb.js', () => ({
      getDb: async () => ({
        collection(name) {
          if (name === 'devices') return { findOne, updateOne };
          if (name === 'anomaly_events') return { insertOne };
          return {};
        },
      }),
    }));

    jest.unstable_mockModule('../services/featureAggregationService.js', () => ({
      buildFeatureVectorCountBased: async () => {
        const { AppError } = await import('../utils/errors.js');
        throw new AppError('ML_CONTRACT_VIOLATION: test violation', 400);
      },
    }));

    const predict = jest.fn();
    jest.unstable_mockModule('../services/inferenceProxyService.js', () => ({
      inferenceProxy: { predict },
    }));

    const { postAnomalyInferHandler } = await import('../controllers/anomalyController.js');

    const req = { params: { device_id: 'device-001' }, body: {} };
    const res = {
      statusCode: null,
      payload: null,
      status(code) {
        this.statusCode = code;
        return this;
      },
      json(payload) {
        this.payload = payload;
        return this;
      },
    };

    await postAnomalyInferHandler(req, res, () => {});

    expect(res.statusCode).toBe(400);
    expect(res.payload?.success).toBe(false);
    expect(res.payload?.errorCode).toBe('ML_CONTRACT_VIOLATION');

    expect(updateOne).not.toHaveBeenCalled();
    expect(insertOne).not.toHaveBeenCalled();
    expect(predict).not.toHaveBeenCalled();
  });

  test('DEBUG & ASSERTIONS: DEBUG_ML logs feature count and sample; warns on sparse vector', async () => {
    process.env.DEBUG_ML = '1';

    const baseFeatures = await readBaseFeatures();
    const featureVector = {};
    for (const f of baseFeatures) {
      featureVector[f] = f === 'is_weekend' ? 1 : 0;
      featureVector[`${f}_present`] = f.startsWith('window_') || f === 'is_weekend' ? 1 : 0;
    }

    jest.unstable_mockModule('../services/featureAggregationService.js', () => ({
      buildFeatureVectorCountBased: async () => featureVector,
    }));

    const findOne = jest.fn().mockResolvedValue({ deviceId: 'device-001' });
    const updateOne = jest.fn().mockResolvedValue({ matchedCount: 1 });
    const insertOne = jest.fn();

    jest.unstable_mockModule('../clients/mongodb.js', () => ({
      getDb: async () => ({
        collection(name) {
          if (name === 'devices') return { findOne, updateOne };
          if (name === 'anomaly_events') return { insertOne };
          return {};
        },
      }),
    }));

    jest.unstable_mockModule('../services/inferenceProxyService.js', () => ({
      inferenceProxy: {
        predict: async () => ({
          status: 200,
          data: { anomaly_score: 0.01, threshold: 0.5, soft_threshold: 0.2, risk_level: 'low' },
        }),
      },
    }));

    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

    const { postAnomalyInferHandler } = await import('../controllers/anomalyController.js');

    const req = { params: { device_id: 'device-001' }, body: {} };
    const res = {
      statusCode: null,
      payload: null,
      status(code) {
        this.statusCode = code;
        return this;
      },
      json(payload) {
        this.payload = payload;
        return this;
      },
    };

    await postAnomalyInferHandler(req, res, () => {});

    expect(res.statusCode).toBe(null); // handler uses res.json without setting status on success
    expect(res.payload?.success).toBe(true);

    const debugLine = logSpy.mock.calls.map((c) => String(c[0] || '')).find((l) => l.includes('[ML_VECTOR_DEBUG]'));
    expect(debugLine).toContain('featureCount=154');
    expect(debugLine).toContain('sample=');

    // Sparse vector (only is_weekend non-zero) should warn.
    expect(warnSpy.mock.calls.some((c) => String(c[0] || '').includes('[ML_ASSERT]'))).toBe(true);
  });
});
