import { InfluxDB } from '@influxdata/influxdb-client';
import { config } from '../config/index.js';

let influxClient = null;
let writeApi = null;

export const getInfluxClient = () => {
  if (!influxClient) {
    influxClient = new InfluxDB({
      url: config.influx.url,
      token: config.influx.token,
    });
  }
  return influxClient;
};

export const getQueryApi = () => {
  const client = getInfluxClient();
  return client.getQueryApi(config.influx.org);
};

export const getWriteApi = () => {
  if (!writeApi) {
    const client = getInfluxClient();
    writeApi = client.getWriteApi(config.influx.org, config.influx.bucket);
  }
  return writeApi;
};

