import { getElasticsearchClient } from '../clients/elasticsearch.js';
import { AppError } from '../utils/errors.js';

// Name of the Elasticsearch logs data stream (must be pre-created in ES)
// NOTE: Do NOT change simulator or ES template here - only web server ingestion.
const LOGS_DATA_STREAM = 'logs-iot';

export const ingestLog = async (logData) => {
  try {
    const client = getElasticsearchClient();

    if (!logData || typeof logData !== 'object' || Array.isArray(logData)) {
      throw new AppError('Invalid log payload, expected JSON object', 400);
    }

    // Enforce presence of @timestamp at ROOT level for data stream
    if (!('@timestamp' in logData) || !logData['@timestamp']) {
      throw new AppError('Missing @timestamp at root level', 400);
    }

    // Optional sanity checks (do NOT modify payload)
    if (!logData.deviceId || typeof logData.deviceId !== 'string') {
      throw new AppError('deviceId is required', 400);
    }

    if (!logData.message || typeof logData.message !== 'string') {
      throw new AppError('message is required', 400);
    }

    // Preserve the exact payload as sent by simulator
    const doc = {
      ...logData,
    };

    // Debug log before indexing to Elasticsearch
    console.log('[ES-DOC]', JSON.stringify(doc, null, 2));

    const response = await client.index({
      index: LOGS_DATA_STREAM,
      document: doc,
    });

    return {
      id: response._id,
      ...doc,
    };
  } catch (error) {
    if (error.statusCode) {
      throw error;
    }
    throw new AppError(`Failed to ingest log: ${error.message}`, 500);
  }
};

export const queryLogs = async (queryParams = {}) => {
  try {
    const client = getElasticsearchClient();
    const { start, end, limit = 100, deviceId, level } = queryParams;

    const must = [];

    if (deviceId) {
      must.push({ match: { deviceId: deviceId } });
    }

    if (level) {
      must.push({ match: { level: level.toLowerCase() } });
    }

    if (start || end) {
      const range = {};
      if (start) range.gte = start.toISOString();
      if (end) range.lte = end.toISOString();
      must.push({ range: { timestamp: range } });
    }

    const body = {
      size: limit,
      query: must.length > 0
        ? {
            bool: {
              must,
            },
          }
        : {
            match_all: {},
          },
      sort: [
        { timestamp: { order: 'desc' } },
      ],
    };

    const response = await client.search({
      index: 'logs-iot-*',
      body,
    });

    // Elasticsearch v8 client returns response.hits.hits directly (not response.body.hits.hits)
    const hits = response?.hits?.hits ?? [];

    return hits.map((hit) => ({
      id: hit._id,
      ...hit._source,
    }));
  } catch (error) {
    throw new AppError(`Failed to query logs: ${error.message}`, 500);
  }
};