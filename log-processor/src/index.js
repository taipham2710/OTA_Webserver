import express from 'express';
import ingestRoutes from './routes/ingestRoutes.js';
import { config } from './config/index.js';
import { errorHandler } from './utils/errors.js';
import { getElasticsearchClient } from './clients/elasticsearchClient.js';
import { getInfluxWriteApi } from './clients/influxClient.js';

const app = express();

app.use(express.json());

app.use('/', ingestRoutes);

app.use(errorHandler);

const start = async () => {
  // Non-fatal Elasticsearch health check
  try {
    const esClient = getElasticsearchClient();
    await esClient.ping();
    console.log('Elasticsearch: healthy');
  } catch (err) {
    console.warn(
      'Elasticsearch: unreachable (service will still start)',
      err?.message || '',
    );
  }

  // Non-fatal InfluxDB health check
  try {
    const writeApi = getInfluxWriteApi();
    // Trivial no-op: write a lightweight health record and flush
    const line = `health_check,service=log_processor value=0 ${Date.now()}000000`;
    writeApi.writeRecord(line);
    await writeApi.flush();
    console.log('InfluxDB: healthy');
  } catch (err) {
    console.warn(
      'InfluxDB: unreachable (service will still start)',
      err?.message || '',
    );
  }

  app.listen(config.server.port, () => {
    console.log(
      `Log Processor service listening on port ${config.server.port}`,
    );
  });
};

start().catch((err) => {
  // As a last resort, log and exit; this should be extremely rare
  console.error('Failed to start Log Processor service:', err);
  process.exit(1);
});


