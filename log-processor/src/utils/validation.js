import { AppError } from './errors.js';

const SEVERITIES = new Set(['INFO', 'WARN', 'ERROR']);

export const validateIngestPayload = (body) => {
  if (!body || typeof body !== 'object') {
    throw new AppError('Request body must be a JSON object', 400);
  }

  const { device_id, timestamp, log, severity, ...rest } = body;

  if (!device_id || typeof device_id !== 'string') {
    throw new AppError('device_id is required and must be a string', 400);
  }

  if (!log || typeof log !== 'string') {
    throw new AppError('log is required and must be a string', 400);
  }

  if (!severity || typeof severity !== 'string' || !SEVERITIES.has(severity)) {
    throw new AppError('severity must be one of INFO, WARN, ERROR', 400);
  }

  if (timestamp === undefined || timestamp === null) {
    throw new AppError(
      'timestamp is required and must be a number or ISO string',
      400,
    );
  }

  let ts;
  if (typeof timestamp === 'number') {
    ts = new Date(timestamp);
  } else if (typeof timestamp === 'string') {
    ts = new Date(timestamp);
  } else {
    throw new AppError(
      'timestamp is required and must be a number or ISO string',
      400,
    );
  }

  if (isNaN(ts.getTime())) {
    throw new AppError(
      'timestamp is required and must be a number or ISO string',
      400,
    );
  }

  const sensorFields = {};
  Object.keys(rest).forEach((key) => {
    if (key.startsWith('sensor_')) {
      const value = rest[key];
      if (typeof value === 'number') {
        sensorFields[key] = value;
      }
    }
  });

  return {
    deviceId: device_id,
    timestamp: ts,
    log,
    severity,
    sensorFields,
    extra: rest,
  };
};


