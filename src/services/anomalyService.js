import axios from 'axios';
import { config } from '../config/index.js';
import { AppError } from '../utils/errors.js';

export const getAnomalyAnalysis = async (deviceId) => {
  try {
    const response = await axios.get(`${config.inference.api}/anomaly/${deviceId}`, {
      timeout: 10000,
    });
    return response.data;
  } catch (error) {
    if (error.response) {
      throw new AppError(
        `Inference service error: ${error.response.data?.message || error.message}`,
        error.response.status
      );
    } else if (error.request) {
      throw new AppError('Inference service unavailable', 503);
    } else {
      throw new AppError(`Failed to get anomaly analysis: ${error.message}`, 500);
    }
  }
};

