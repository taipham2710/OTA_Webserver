import axios from 'axios';
import { config } from '../config/index.js';

const client = axios.create({
  baseURL: config.inference.api,
  timeout: 10000,
  headers: {
    'Content-Type': 'application/json',
    Accept: 'application/json',
  },
  validateStatus: () => true,
});

const normalizeUpstreamError = (error) => {
  const message =
    error?.response?.data?.detail ||
    error?.response?.data?.message ||
    error?.message ||
    'Upstream inference service error';

  return {
    status: 502,
    data: {
      error: 'inference_unreachable',
      message,
    },
  };
};

export const inferenceProxy = {
  async health() {
    try {
      const res = await client.get('/health', { timeout: 5000 });
      return { status: res.status, data: res.data };
    } catch (error) {
      return normalizeUpstreamError(error);
    }
  },

  async ready() {
    try {
      const res = await client.get('/ready', { timeout: 5000 });
      return { status: res.status, data: res.data };
    } catch (error) {
      return normalizeUpstreamError(error);
    }
  },

  async metadata() {
    try {
      const res = await client.get('/metadata', { timeout: 5000 });
      return { status: res.status, data: res.data };
    } catch (error) {
      return normalizeUpstreamError(error);
    }
  },

  async predict(body) {
    try {
      const res = await client.post('/predict', body, { timeout: 10000 });
      return { status: res.status, data: res.data };
    } catch (error) {
      return normalizeUpstreamError(error);
    }
  },
};

