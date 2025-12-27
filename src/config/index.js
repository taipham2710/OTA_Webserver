// import dotenv from 'dotenv';

// dotenv.config();

// export const config = {
//   minio: {
//     endpoint: process.env.MINIO_ENDPOINT || 'localhost:9000',
//     accessKey: process.env.MINIO_ACCESS_KEY || 'minioadmin',
//     secretKey: process.env.MINIO_SECRET_KEY || 'minioadmin',
//     bucket: process.env.MINIO_BUCKET || 'firmware',
//     useSSL: process.env.MINIO_USE_SSL === 'true',
//   },
//   influx: {
//     url: process.env.INFLUX_URL || 'http://localhost:8086',
//     token: process.env.INFLUX_TOKEN || '',
//     org: process.env.INFLUX_ORG || '',
//     bucket: process.env.INFLUX_BUCKET || 'metrics',
//   },
//   mongo: {
//     uri: process.env.MONGO_URI || 'mongodb://localhost:27017',
//     db: process.env.MONGO_DB || 'ota',
//   },
//   elasticsearch: {
//     endpoint: process.env.ES_ENDPOINT || 'http://localhost:9200',
//   },
//   inference: {
//     api: process.env.INFERENCE_API || 'http://localhost:8000',
//   },
//   redis: {
//     url: process.env.REDIS_URL || 'redis://localhost:6379',
//     password: process.env.REDIS_PASSWORD || '',
//   },
//   socket: {
//     authToken: process.env.SOCKET_AUTH_TOKEN || 'default-token-change-in-production',
//   },
//   server: {
//     port: parseInt(process.env.PORT || '3000', 10),
//   },
// };

import dotenv from 'dotenv';

// --- Chỉ load file .env ở môi trường non-production ---
if (process.env.NODE_ENV !== 'production') {
  dotenv.config();
}

// --- Hàm helper để kiểm tra các biến bắt buộc ---
const getRequiredEnv = (key, defaultValue = undefined) => {
  const value = process.env[key];
  if (process.env.NODE_ENV === 'production') {
    if (!value) {
      throw new Error(`FATAL ERROR: Environment variable ${key} is required in production.`);
    }
    return value;
  }
  return value || defaultValue;
};

// --- Xây dựng URL Redis một cách an toàn ---
const redisPassword = process.env.REDIS_PASSWORD;
let redisUrl = process.env.REDIS_URL;
if (!redisUrl && process.env.NODE_ENV === 'production') {
  throw new Error('FATAL ERROR: Environment variable REDIS_URL is required in production.');
}
redisUrl = redisUrl || 'redis://localhost:6379';
if (redisPassword) {
  const url = new URL(redisUrl);
  url.password = redisPassword;
  redisUrl = url.toString();
}

export const config = {
  env: process.env.NODE_ENV || 'development',
  minio: {
    endpoint: getRequiredEnv('MINIO_ENDPOINT', 'localhost:9000'),
    accessKey: getRequiredEnv('MINIO_ACCESS_KEY', 'minioadmin'),
    secretKey: getRequiredEnv('MINIO_SECRET_KEY', 'minioadmin'),
    bucket: process.env.MINIO_BUCKET || 'firmware',
    useSSL: process.env.MINIO_USE_SSL === 'true',
  },
  influx: {
    url: getRequiredEnv('INFLUX_URL', 'http://localhost:8086'),
    token: getRequiredEnv('INFLUX_TOKEN', 'local-token'),
    org: getRequiredEnv('INFLUX_ORG', 'my-org'),
    bucket: getRequiredEnv('INFLUX_BUCKET', 'metrics'),
  },
  mongo: {
    uri: getRequiredEnv('MONGO_URI', 'mongodb://localhost:27017/ota_db'),
    db: process.env.MONGO_DB || 'ota',
  },
  elasticsearch: {
    endpoint: getRequiredEnv('ES_ENDPOINT', 'http://localhost:9200'),
    username: process.env.ES_USERNAME || process.env.ELASTICSEARCH_USERNAME || '',
    password: process.env.ES_PASSWORD || process.env.ELASTICSEARCH_PASSWORD || '',
  },
  inference: {
    api: getRequiredEnv('INFERENCE_API', 'http://localhost:8000'),
  },
  redis: {
    url: redisUrl,
    password: redisPassword || '',
  },
  socket: {
    authToken: getRequiredEnv('SOCKET_AUTH_TOKEN', 'local-secret-token'),
  },
  grafana: {
    url: process.env.GRAFANA_URL || '',
  },
  server: {
    port: parseInt(process.env.PORT || '3000', 10),
  },
};