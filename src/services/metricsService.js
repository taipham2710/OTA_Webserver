import { getQueryApi } from '../clients/influxdb.js';
import { config } from '../config/index.js';
import { AppError } from '../utils/errors.js';

export const queryMetrics = async (queryParams = {}) => {
  try {
    const queryApi = getQueryApi();
    const { start, end, deviceId, measurement = 'sensor_data' } = queryParams;

    const startTime = start ? start.toISOString() : null;
    const endTime = end ? end.toISOString() : null;

    const startLiteral = startTime ? `time(v: "${startTime}")` : '-1h';
    const endLiteral = endTime ? `time(v: "${endTime}")` : 'now()';

    let fluxQuery = `from(bucket: "${config.influx.bucket}")
      |> range(start: ${startLiteral}, stop: ${endLiteral})
      |> filter(fn: (r) => r._measurement == "${measurement}")`;

    if (deviceId) {
      fluxQuery += `\n      |> filter(fn: (r) => r.device_id == "${deviceId}")`;
    }

    fluxQuery += `\n      |> aggregateWindow(every: 1m, fn: mean, createEmpty: false)
      |> yield(name: "mean")`;

    const results = [];

    await new Promise((resolve, reject) => {
      queryApi.queryRows(fluxQuery, {
        next(row, tableMeta) {
          const record = tableMeta.toObject(row);
          results.push({
            time: record._time,
            field: record._field,
            value: record._value,
            deviceId: record.device_id,
          });
        },
        error(err) {
          reject(err);
        },
        complete() {
          resolve();
        },
      });
    });

    return results;
  } catch (error) {
    if (error.code === 'ECONNREFUSED') {
      throw new AppError('Failed to connect to InfluxDB', 503);
    }

    throw new AppError(`Failed to query metrics: ${error.message}`, 500);
  }
};

