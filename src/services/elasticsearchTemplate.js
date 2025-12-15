import { getElasticsearchClient } from '../clients/elasticsearch.js';

const LOGS_INDEX_TEMPLATE_NAME = 'logs-iot-template';

export const ensureLogsIndexTemplate = async () => {
  try {
    const client = getElasticsearchClient();

    try {
      const existsResponse = await client.indices.existsIndexTemplate({
        name: LOGS_INDEX_TEMPLATE_NAME,
      });
      const templateExists = existsResponse?.body ?? existsResponse;

      if (templateExists) {
        console.log(`Elasticsearch index template '${LOGS_INDEX_TEMPLATE_NAME}' already exists`);
        return;
      }
    } catch (notFoundError) {
      // Template doesn't exist, proceed to create it
    }

    await client.indices.putIndexTemplate({
      name: LOGS_INDEX_TEMPLATE_NAME,
      body: {
        index_patterns: ['logs-iot-*'],
        template: {
          mappings: {
            properties: {
              deviceId: { type: 'keyword' },
              level: { type: 'keyword' },
              message: { type: 'text' },
              timestamp: { type: 'date' },
              ingestedAt: { type: 'date' },
            },
          },
        },
      },
    });

    console.log(`Elasticsearch index template '${LOGS_INDEX_TEMPLATE_NAME}' created successfully`);
  } catch (error) {
    console.warn(`Warning: Failed to ensure Elasticsearch index template: ${error.message}`);
  }
};
