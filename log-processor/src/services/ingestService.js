import { getElasticsearchClient } from '../clients/elasticsearchClient.js';
import { getInfluxWriteApi } from '../clients/influxClient.js';
import { AppError } from '../utils/errors.js';

export const processLogEntry = async (normalized) => {
  const { deviceId, timestamp, log, severity, sensorFields, extra } = normalized;

  const esClient = getElasticsearchClient();
  const writeApi = getInfluxWriteApi();

  const tsIso = timestamp.toISOString();

  const esDoc = {
    device_id: deviceId,
    timestamp: tsIso,
    log,
    severity,
    ...extra,
  };

  try {
    await esClient.index({
      index: 'iot_logs',
      document: esDoc,
    });
  } catch (err) {
    throw new AppError(`Failed to write event to Elasticsearch: ${err.message}`, 502);
  }

  const sensorKeys = Object.keys(sensorFields);
  if (sensorKeys.length === 0) {
    return;
  }

  try {
    sensorKeys.forEach((key) => {
      const value = sensorFields[key];
      const measurement = 'sensor_metrics';
      const fieldName = key.replace(/^sensor_/, '');

      const line = `${measurement},device_id=${deviceId},sensor=${fieldName} value=${value} ${timestamp.getTime()}000000`;
      writeApi.writeRecord(line);
    });

    await writeApi.flush();
  } catch (err) {
    throw new AppError(`Failed to write metrics to InfluxDB: ${err.message}`, 502);
  }
};


