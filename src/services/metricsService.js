import { getQueryApi, getWriteApi } from '../clients/influxdb.js';
import { config } from '../config/index.js';
import { AppError } from '../utils/errors.js';
import { Point } from '@influxdata/influxdb-client';

export const ingestMetrics = async (metricsData) => {
  try {
    if (!metricsData.deviceId || typeof metricsData.deviceId !== 'string') {
      throw new AppError('deviceId is required', 400);
    }

    if (!metricsData.metrics || typeof metricsData.metrics !== 'object' || Array.isArray(metricsData.metrics)) {
      throw new AppError('metrics object is required', 400);
    }

    const metrics = metricsData.metrics;
    const metricKeys = Object.keys(metrics);

    if (metricKeys.length === 0) {
      throw new AppError('metrics object must contain at least one metric', 400);
    }

    for (const key of metricKeys) {
      const value = metrics[key];
      if (typeof value !== 'number' || isNaN(value)) {
        throw new AppError(`Metric '${key}' must be a number`, 400);
      }
    }

    const timestamp = metricsData.timestamp
      ? new Date(metricsData.timestamp)
      : new Date();

    if (isNaN(timestamp.getTime())) {
      throw new AppError('Invalid timestamp format', 400);
    }

    const writeApi = getWriteApi();
    const point = new Point('device_metrics')
      .tag('deviceId', metricsData.deviceId)
      .timestamp(timestamp);

    for (const [key, value] of Object.entries(metrics)) {
      point.floatField(key, value);
    }

    writeApi.writePoint(point);
    await writeApi.flush();

    return {
      deviceId: metricsData.deviceId,
      metrics,
      timestamp: timestamp.toISOString(),
    };
  } catch (error) {
    if (error.statusCode) {
      throw error;
    }
    throw new AppError(`Failed to ingest metrics: ${error.message}`, 500);
  }
};

export const queryMetrics = async (queryParams = {}) => {
  try {
    const queryApi = getQueryApi();
    const { start, end, deviceId, limit = 100 } = queryParams;

    if (!deviceId || typeof deviceId !== 'string') {
      throw new AppError('deviceId is required', 400);
    }

    const startTime = start ? start.toISOString() : null;
    const endTime = end ? end.toISOString() : null;

    const startLiteral = startTime ? `time(v: "${startTime}")` : '-24h';
    const endLiteral = endTime ? `time(v: "${endTime}")` : 'now()';

    const fluxQuery = `from(bucket: "${config.influx.bucket}")
      |> range(start: ${startLiteral}, stop: ${endLiteral})
      |> filter(fn: (r) => r._measurement == "device_metrics")
      |> filter(fn: (r) => r.deviceId == "${deviceId}")
      |> sort(columns: ["_time"])
      |> limit(n: ${limit})`;

    const results = [];
    const metricsByTime = {};

    await new Promise((resolve, reject) => {
      queryApi.queryRows(fluxQuery, {
        next(row, tableMeta) {
          const record = tableMeta.toObject(row);
          const time = record._time;
          const field = record._field;
          const value = record._value;

          if (!metricsByTime[time]) {
            metricsByTime[time] = {
              deviceId: record.deviceId,
              timestamp: time,
              metrics: {},
            };
          }

          metricsByTime[time].metrics[field] = value;
        },
        error(err) {
          reject(err);
        },
        complete() {
          resolve();
        },
      });
    });

    const sortedTimes = Object.keys(metricsByTime).sort();
    for (const time of sortedTimes) {
      results.push(metricsByTime[time]);
    }

    return results;
  } catch (error) {
    if (error.statusCode) {
      throw error;
    }
    if (error.code === 'ECONNREFUSED') {
      throw new AppError('Failed to connect to InfluxDB', 503);
    }
    throw new AppError(`Failed to query metrics: ${error.message}`, 500);
  }
};

