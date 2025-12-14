import { getElasticsearchClient } from '../clients/elasticsearch.js';
import { AppError } from '../utils/errors.js';

export const queryLogs = async (queryParams = {}) => {
  try {
    const client = getElasticsearchClient();
    const { start, end, limit = 100, deviceId, level } = queryParams;

    const must = [];

    if (deviceId) {
      must.push({ match: { device_id: deviceId } });
    }

    if (level) {
      must.push({ match: { level } });
    }

    if (start || end) {
      const range = {};
      if (start) range.gte = start.toISOString();
      if (end) range.lte = end.toISOString();
      must.push({ range: { timestamp: range } });
    }

    const body =
      must.length > 0
        ? {
            query: {
              bool: {
                must,
              },
            },
            sort: [{ timestamp: { order: 'desc' } }],
            size: limit,
          }
        : {
            query: {
              match_all: {},
            },
            sort: [{ timestamp: { order: 'desc' } }],
            size: limit,
          };

    const response = await client.search({
      index: 'logs-*',
      body,
    });

    return response.body.hits.hits.map((hit) => ({
      id: hit._id,
      ...hit._source,
    }));
  } catch (error) {
    throw new AppError(`Failed to query logs: ${error.message}`, 500);
  }
};

