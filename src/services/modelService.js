import axios from 'axios';
import { config } from '../config/index.js';

// NOTE: This is a metadata-only endpoint that fetches model information
// from the inference service. It does NOT affect server startup if
// the inference service is unavailable.
// MVP implementation: no retries, no caching.
export const getModelInfo = async () => {
  try {
    const response = await axios.get(`${config.inference.api}/metadata`, {
      timeout: 5000,
      headers: {
        'Content-Type': 'application/json',
      },
    });

    // Return response data on success
    return response.data;
  } catch (error) {
    // Return null on failure (do not throw)
    // This allows the server to start even if inference service is unavailable
    if (error.response) {
      // 4xx or 5xx response
      console.warn(`Inference service metadata error: ${error.response.status} - ${error.response.data?.message || error.message}`);
    } else if (error.request) {
      // Network error or timeout
      console.warn('Inference service metadata unavailable or timeout');
    } else {
      // Other error
      console.warn(`Failed to get model info: ${error.message}`);
    }
    return null;
  }
};

