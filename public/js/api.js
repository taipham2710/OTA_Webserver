const API_BASE = '/api';

export const api = {
  async get(endpoint, params = {}) {
    // Ensure endpoint starts with API_BASE
    const fullEndpoint = endpoint.startsWith(API_BASE) ? endpoint : `${API_BASE}${endpoint}`;
    const url = new URL(fullEndpoint, window.location.origin);
    Object.keys(params).forEach(key => {
      if (params[key] !== null && params[key] !== undefined) {
        url.searchParams.append(key, params[key]);
      }
    });

    const response = await fetch(url.toString());
    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.message || `HTTP ${response.status}`);
    }

    return data;
  },

  async post(endpoint, body = {}) {
    // Ensure endpoint starts with API_BASE (avoid double prefix)
    const fullEndpoint = endpoint.startsWith(API_BASE) ? endpoint : `${API_BASE}${endpoint}`;
    const response = await fetch(fullEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.message || `HTTP ${response.status}`);
    }

    return data;
  },

  async patch(endpoint, body = {}) {
    // Ensure endpoint starts with API_BASE (avoid double prefix)
    const fullEndpoint = endpoint.startsWith(API_BASE) ? endpoint : `${API_BASE}${endpoint}`;
    const response = await fetch(fullEndpoint, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.message || `HTTP ${response.status}`);
    }

    return data;
  },

  devices: {
    list: (params) => api.get('/devices', params),
    get: (id) => api.get(`/devices/${id}`),
    stats: () => api.get('/devices/stats'),
    assignFirmware: (deviceId, firmwareVersion) => api.patch(`/devices/${deviceId}/assign-firmware`, { firmwareVersion }),
    anomalies: (deviceId, params) => api.get(`/devices/${deviceId}/anomalies`, params),
  },

  firmware: {
    list: (params) => api.get('/firmware', params),
    get: (version) => api.get(`/firmware/${version}`),
  },

  logs: {
    list: (params) => api.get('/logs', params),
  },

  metrics: {
    list: (params) => api.get('/metrics', params),
  },

  anomaly: {
    get: (deviceId) => api.get(`/anomaly/${deviceId}`),
    history: (deviceId, params) => api.get(`/anomaly/${deviceId}/history`, params),
  },

  ota: {
    history: (deviceId) => api.get(`/ota/history/${deviceId}`),
  },

  model: {
    info: () => api.get('/model/info'),
  },
};

