import { createClient } from 'redis';
import { config } from '../config/index.js';

let subscriber = null;
let isConnected = false;
let lastErrorTime = 0;
const ERROR_LOG_INTERVAL = 5000; // Only log errors every 5 seconds
const channelHandlers = new Map();

export const getRedisSubscriber = async () => {
  if (subscriber && isConnected) {
    return subscriber;
  }

  try {
    const clientOptions = {
      url: config.redis.url,
    };

    if (config.redis.password) {
      clientOptions.password = config.redis.password;
    }

    subscriber = createClient(clientOptions);

    subscriber.on('error', (err) => {
      const now = Date.now();
      // Only log errors every ERROR_LOG_INTERVAL to prevent spam
      if (now - lastErrorTime > ERROR_LOG_INTERVAL) {
        console.error('Redis subscriber error:', err.message || err.toString() || err);
        if (err.code === 'ECONNREFUSED') {
          console.error('Redis connection refused. Is Redis server running?');
          console.error('Try starting Redis with: redis-server');
        } else {
          console.error('Redis error details:', {
            code: err.code,
            errno: err.errno,
            syscall: err.syscall,
            address: err.address,
            port: err.port
          });
        }
        lastErrorTime = now;
      }
      isConnected = false;
    });

    subscriber.on('connect', () => {
      console.log('Redis subscriber connected');
      isConnected = true;
    });

    subscriber.on('disconnect', () => {
      console.warn('Redis subscriber disconnected');
      isConnected = false;
    });

    // Register ONE global message listener
    subscriber.on('message', (receivedChannel, message) => {
      const handler = channelHandlers.get(receivedChannel);
      if (handler) {
        try {
          const payload = JSON.parse(message);
          handler(payload);
        } catch (parseError) {
          console.error(`Failed to parse Redis message from ${receivedChannel}:`, parseError.message);
        }
      }
    });

    await subscriber.connect();
    console.log(`Redis subscriber connected to: ${config.redis.url.replace(/:[^:@]+@/, ':****@')}`);
    return subscriber;
  } catch (error) {
    console.warn('Failed to connect Redis subscriber:', error.message || error.toString() || error);
    console.warn('Redis connection details:', {
      url: config.redis.url.replace(/:[^:@]+@/, ':****@'),
      errorCode: error.code,
      errorStack: error.stack
    });
    isConnected = false;
    return null;
  }
};

export const subscribeToChannel = async (channel, callback) => {
  try {
    const client = await getRedisSubscriber();
    if (!client) {
      return false;
    }

    // Register handler in the map
    channelHandlers.set(channel, callback);

    // Subscribe to the channel (only subscribe, don't add new listener)
    await client.subscribe(channel);

    console.log(`Subscribed to Redis channel: ${channel}`);
    return true;
  } catch (error) {
    console.warn(`Failed to subscribe to Redis channel ${channel}:`, error.message);
    return false;
  }
};

export const closeRedisConnection = async () => {
  if (subscriber && isConnected) {
    try {
      await subscriber.quit();
      isConnected = false;
    } catch (error) {
      console.error('Error closing Redis connection:', error.message);
    }
  }
};

