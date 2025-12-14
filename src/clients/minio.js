import { Client } from 'minio';
import { config } from '../config/index.js';

let minioClient = null;

export const getMinioClient = () => {
  if (!minioClient) {
    const [host, port] = config.minio.endpoint.split(':');
    minioClient = new Client({
      endPoint: host,
      port: parseInt(port, 10) || 9000,
      useSSL: config.minio.useSSL,
      accessKey: config.minio.accessKey,
      secretKey: config.minio.secretKey,
    });
  }
  return minioClient;
};

export const ensureBucketExists = async () => {
  const client = getMinioClient();
  const bucketExists = await client.bucketExists(config.minio.bucket);
  if (!bucketExists) {
    await client.makeBucket(config.minio.bucket);
  }
};

