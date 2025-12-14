import { getMinioClient } from '../clients/minio.js';
import { getInfluxClient } from '../clients/influxdb.js';
import { getElasticsearchClient } from '../clients/elasticsearch.js';
import { getMongoClient } from '../clients/mongodb.js';
import { config } from '../config/index.js';

// Liveness probe - always returns 200 OK, no async operations
export const livenessHandler = (req, res) => {
  res.status(200).send('OK');
};

// Readiness probe - checks if server is listening
let serverReady = false;
export const setServerReady = () => {
  serverReady = true;
};

export const readinessHandler = (req, res) => {
  if (serverReady) {
    res.status(200).json({ status: 'ready', timestamp: new Date().toISOString() });
  } else {
    res.status(503).json({ status: 'not ready', timestamp: new Date().toISOString() });
  }
};

// Health check - checks all dependencies but never throws
export const healthCheckHandler = async (req, res) => {
  // Top-level safety wrapper - ensures we NEVER crash the process
  try {
    const health = {
      status: 'healthy',
      timestamp: new Date().toISOString(),
      services: {},
    };

    // MinIO check - wrapped in try-catch to prevent crashes
    try {
      const minioClient = getMinioClient();
      await minioClient.listBuckets();
      health.services.minio = 'healthy';
    } catch (error) {
      health.services.minio = 'unhealthy';
      health.status = 'degraded';
      health.services.minio_error = error?.message || 'Unknown error';
    }

    // InfluxDB check - wrapped in try-catch with timeout protection
    try {
      const influxClient = getInfluxClient();
      const queryApi = influxClient.getQueryApi(config.influx.org);
      // Actually test the connection with a simple query
      await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('InfluxDB query timeout')), 5000);
        queryApi.queryRows(`from(bucket: "${config.influx.bucket}") |> range(start: -1m) |> limit(n: 1)`, {
          next() {
            // Query succeeded
          },
          error(err) {
            clearTimeout(timeout);
            reject(err);
          },
          complete() {
            clearTimeout(timeout);
            resolve();
          },
        });
      });
      health.services.influxdb = 'healthy';
    } catch (error) {
      health.services.influxdb = 'unhealthy';
      health.status = 'degraded';
      health.services.influxdb_error = error?.message || 'Unknown error';
    }

    // Elasticsearch check - wrapped in try-catch
    try {
      const esClient = getElasticsearchClient();
      await esClient.ping();
      health.services.elasticsearch = 'healthy';
    } catch (error) {
      health.services.elasticsearch = 'unhealthy';
      health.status = 'degraded';
      health.services.elasticsearch_error = error?.message || 'Unknown error';
    }

    // MongoDB check - wrapped in try-catch
    try {
      await getMongoClient();
      health.services.mongodb = 'healthy';
    } catch (error) {
      health.services.mongodb = 'unhealthy';
      health.status = 'degraded';
      health.services.mongodb_error = error?.message || 'Unknown error';
    }

    // Always return 200, even if degraded - never crash the process
    res.status(200).json(health);
  } catch (error) {
    // Ultimate safety net - if anything unexpected happens, return degraded status
    res.status(200).json({
      status: 'degraded',
      timestamp: new Date().toISOString(),
      error: 'Health check failed unexpectedly',
      services: {},
    });
  }
};

