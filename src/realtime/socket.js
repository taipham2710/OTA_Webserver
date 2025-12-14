import { Server } from 'socket.io';
import { subscribeToChannel } from './redis.js';
import { config } from '../config/index.js';

let io = null;

const authenticateSocket = (socket, next) => {
  next();
};

export const initSocket = (httpServer) => {
  io = new Server(httpServer, {
    cors: {
      origin: '*',
      methods: ['GET', 'POST'],
    },
    transports: ['websocket', 'polling'],
  });

  io.use(authenticateSocket);

  io.on('connection', (socket) => {
    console.log(`Socket connected: ${socket.id}`);

    socket.on('subscribe_device', (deviceId) => {
      if (deviceId && typeof deviceId === 'string') {
        socket.join(`device:${deviceId}`);
        console.log(`Socket ${socket.id} subscribed to device: ${deviceId}`);
      }
    });

    socket.on('disconnect', () => {
      console.log(`Socket disconnected: ${socket.id}`);
    });
  });

  // Subscribe to Redis channels
  const channels = ['logs', 'metrics', 'ota_progress', 'anomaly'];

  // Use async IIFE to properly await subscriptions
  (async () => {
    for (const channel of channels) {
      try {
        await subscribeToChannel(channel, (payload) => {
          if (!io) return;

          try {
            if (channel === 'logs' && payload.device_id) {
              io.to(`device:${payload.device_id}`).emit('logs', payload);
            } else if (channel === 'metrics' && payload.device_id) {
              io.to(`device:${payload.device_id}`).emit('metrics', payload);
            } else if (channel === 'ota_progress' && payload.device_id) {
              io.to(`device:${payload.device_id}`).emit('ota_progress', payload);
              io.emit('device:update', { deviceId: payload.device_id, ...payload });
            } else if (channel === 'anomaly' && payload.device_id) {
              io.to(`device:${payload.device_id}`).emit('anomaly', payload);
              io.emit('device:update', { deviceId: payload.device_id, ...payload });
            } else {
              io.emit(channel, payload);
            }
          } catch (error) {
            console.error(`Error emitting ${channel} event:`, error.message);
          }
        });
      } catch (error) {
        console.warn(`Failed to subscribe to Redis channel ${channel}:`, error.message);
      }
    }
  })();

  console.log('Socket.IO server initialized');
  return io;
};

export const getIO = () => {
  return io;
};

