import { InfluxDB } from '@influxdata/influxdb-client';
import { config } from '../config/index.js';

let influxClient = null;
let writeApi = null;

export const getInfluxWriteApi = () => {
  if (!writeApi) {
    influxClient = new InfluxDB({
      url: config.influx.url,
      token: config.influx.token,
    });

    writeApi = influxClient.getWriteApi(config.influx.org, config.influx.bucket, 'ns');
  }

  return writeApi;
};


