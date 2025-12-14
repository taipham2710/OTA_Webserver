let socket = null;
let isConnected = false;
let fallbackPolling = false;
let eventHandlers = {
  logs: [],
  metrics: [],
  ota_progress: [],
  anomaly: [],
  'device:update': [],
};

const AUTH_TOKEN = 'default-token-change-in-production';

export const realtime = {
  connect() {
    if (socket?.connected) {
      isConnected = true;
      return socket;
    }

    if (fallbackPolling) {
      console.log('Using polling fallback (Socket.IO unavailable)');
      return null;
    }

    try {
      socket = io({
        auth: {
          token: AUTH_TOKEN,
        },
        transports: ['websocket', 'polling'],
      });

      socket.on('connect', () => {
        console.log('WebSocket connected');
        isConnected = true;
        fallbackPolling = false;
      });

      socket.on('disconnect', () => {
        console.log('WebSocket disconnected');
        isConnected = false;
      });

      socket.on('connect_error', (error) => {
        console.warn('Socket.IO connection error:', error.message);
        isConnected = false;
        if (!fallbackPolling) {
          console.log('Falling back to polling mode');
          fallbackPolling = true;
        }
      });

      // Register existing event handlers
      Object.keys(eventHandlers).forEach((event) => {
        eventHandlers[event].forEach((handler) => {
          socket.on(event, handler);
        });
      });

      return socket;
    } catch (error) {
      console.warn('Socket.IO not available:', error);
      fallbackPolling = true;
      return null;
    }
  },

  disconnect() {
    if (socket) {
      socket.disconnect();
      socket = null;
      isConnected = false;
    }
  },

  on(event, callback) {
    if (fallbackPolling) {
      console.warn(`Event '${event}' handler registered but using polling fallback`);
      return;
    }

    if (!eventHandlers[event]) {
      eventHandlers[event] = [];
    }
    eventHandlers[event].push(callback);

    if (socket) {
      socket.on(event, callback);
    }
  },

  off(event, callback) {
    if (socket) {
      socket.off(event, callback);
    }
    if (eventHandlers[event]) {
      eventHandlers[event] = eventHandlers[event].filter(h => h !== callback);
    }
  },

  subscribeDevice(deviceId) {
    if (socket && isConnected) {
      socket.emit('subscribe_device', deviceId);
    }
  },

  isConnected() {
    return isConnected && socket?.connected;
  },

  isPollingFallback() {
    return fallbackPolling;
  },
};

