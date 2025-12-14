import { AppError } from './errors.js';

export const validateDeviceId = (deviceId) => {
  if (!deviceId || typeof deviceId !== 'string' || deviceId.trim().length === 0) {
    throw new AppError('Device ID is required and must be a non-empty string', 400);
  }
  return deviceId.trim();
};

export const validateQueryParams = (params) => {
  const { start, end, limit = 100 } = params;
  
  const validated = {
    limit: Math.min(Math.max(parseInt(limit, 10) || 100, 1), 1000),
  };

  if (start) {
    const startDate = new Date(start);
    if (isNaN(startDate.getTime())) {
      throw new AppError('Invalid start date format', 400);
    }
    validated.start = startDate;
  }

  if (end) {
    const endDate = new Date(end);
    if (isNaN(endDate.getTime())) {
      throw new AppError('Invalid end date format', 400);
    }
    validated.end = endDate;
  }

  return validated;
};

