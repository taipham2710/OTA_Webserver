import { Client } from '@elastic/elasticsearch';
import { config } from '../config/index.js';

let esClient = null;

export const getElasticsearchClient = () => {
  if (!esClient) {
    const options = { node: config.elasticsearch.url };

    if (config.elasticsearch.username && config.elasticsearch.password) {
      options.auth = {
        username: config.elasticsearch.username,
        password: config.elasticsearch.password,
      };
    }

    esClient = new Client(options);
  }

  return esClient;
};


