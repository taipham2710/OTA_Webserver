import express from 'express';
import cors from 'cors';
import { createServer } from 'http';
import { config } from './src/config/index.js';
import { errorHandler } from './src/utils/errors.js';
import firmwareRoutes from './src/routes/firmwareRoutes.js';
import logsRoutes from './src/routes/logsRoutes.js';
import metricsRoutes from './src/routes/metricsRoutes.js';
import anomalyRoutes from './src/routes/anomalyRoutes.js';
import otaRoutes from './src/routes/otaRoutes.js';
import deviceRoutes from './src/routes/deviceRoutes.js';
import modelRoutes from './src/routes/modelRoutes.js';
import healthRoutes from './src/routes/healthRoutes.js';
import { setServerReady } from './src/controllers/healthController.js';
import { ensureBucketExists } from './src/clients/minio.js';
import { getMongoClient } from './src/clients/mongodb.js';
import { initSocket } from './src/realtime/socket.js';
import { ensureLogsIndexTemplate } from './src/services/elasticsearchTemplate.js';

const app = express();
const httpServer = createServer(app);

// Enable CORS for browser-based dashboard (Kubernetes / multi-origin)
// NOTE: Keep this before all routes so preflight and API calls are handled correctly.
app.use(
  cors({
    origin: [
      'http://edge.khoaluan.local',
      'http://localhost:3000',
    ],
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  }),
);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));

app.use('/api/firmware', firmwareRoutes);
app.use('/api/logs', logsRoutes);
app.use('/api/metrics', metricsRoutes);
app.use('/api/anomaly', anomalyRoutes);
app.use('/api/ota', otaRoutes);
app.use('/api/devices', deviceRoutes);
app.use('/api/model', modelRoutes);
app.use('/health', healthRoutes);

app.use(errorHandler);

const startServer = async () => {
  try {
    await ensureBucketExists();
    await getMongoClient();
    console.log('Connected to services');
  } catch (error) {
    console.warn('Warning: Some services may not be available:', error.message);
  }

  // Ensure Elasticsearch index template exists
  try {
    await ensureLogsIndexTemplate();
  } catch (error) {
    console.warn('Warning: Elasticsearch template setup failed:', error.message);
  }

  // Initialize Socket.IO
  try {
    initSocket(httpServer);
  } catch (error) {
    console.warn('Warning: Socket.IO initialization failed:', error.message);
  }

  // Bind to 0.0.0.0 to accept connections from all interfaces (Kubernetes requirement)
  httpServer.listen(config.server.port, '0.0.0.0', () => {
    setServerReady();
    console.log(`OTA Webserver running on port ${config.server.port}`);
    console.log(`Health check: http://0.0.0.0:${config.server.port}/health`);
    console.log(`Liveness probe: http://0.0.0.0:${config.server.port}/health/live`);
    console.log(`Readiness probe: http://0.0.0.0:${config.server.port}/health/ready`);
  });
};

startServer().catch((error) => {
  console.error('Failed to start server:', error);
  process.exit(1);
});

