import { getElasticsearchClient } from '../clients/elasticsearch.js';
import { AppError } from '../utils/errors.js';

const getDailyIndexName = (date) => {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `logs-iot-${year}.${month}.${day}`;
};

export const ingestLog = async (logData) => {
  try {
    const client = getElasticsearchClient();

    if (!logData.deviceId || typeof logData.deviceId !== 'string') {
      throw new AppError('deviceId is required', 400);
    }

    if (!logData.message || typeof logData.message !== 'string') {
      throw new AppError('message is required', 400);
    }

    const timestamp = logData.timestamp ? new Date(logData.timestamp) : new Date();
    const level = logData.level || 'info';
    const ingestedAt = new Date().toISOString();

    const logDocument = {
      deviceId: logData.deviceId,
      level: level.toLowerCase(),
      message: logData.message,
      timestamp: timestamp.toISOString(),
      ingestedAt,
    };

    const indexName = getDailyIndexName(timestamp);

    const response = await client.index({
      index: indexName,
      document: logDocument,
    });

    return {
      id: response._id,
      ...logDocument,
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

