import { getMinioClient } from '../clients/minio.js';
import { AppError } from '../utils/errors.js';

const MODELS_BUCKET = 'models';
const CURRENT_OBJECT = 'current';

const statObjectExists = async (bucket, objectPath) => {
  const client = getMinioClient();
  try {
    await client.statObject(bucket, objectPath);
    return true;
  } catch (error) {
    if (error.code === 'NoSuchKey' || error.code === 'NotFound') {
      return false;
    }
    throw new AppError(`MinIO stat failed for ${bucket}/${objectPath}: ${error.message}`, 500);
  }
};

const readObjectTextIfExists = async (bucket, objectPath) => {
  const client = getMinioClient();

  const exists = await statObjectExists(bucket, objectPath);
  if (!exists) return null;

  const stream = await client.getObject(bucket, objectPath);
  const chunks = [];
  for await (const chunk of stream) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf-8');
};

/**
 * Model activation == rollback == deploy:
 * the single source of truth is models/current, pointing to an existing models/{version}/ directory.
 */
export const activateModelVersion = async ({ modelVersion }) => {
  if (!modelVersion || typeof modelVersion !== 'string' || modelVersion.trim().length === 0) {
    throw new AppError('model_version is required', 400);
  }

  const version = modelVersion.trim();
  const client = getMinioClient();

  const bucketExists = await client.bucketExists(MODELS_BUCKET);
  if (!bucketExists) {
    throw new AppError(`MinIO bucket '${MODELS_BUCKET}' does not exist`, 400);
  }

  // Always validate target version exists (even if already active)
  const metadataPath = `${version}/metadata.json`;
  const ok = await statObjectExists(MODELS_BUCKET, metadataPath);
  if (!ok) {
    throw new AppError(`Model version '${version}' is invalid: missing ${MODELS_BUCKET}/${metadataPath}`, 400);
  }

  // Skip activation if requested version is already active.
  // Comparison is string-based, trimmed.
  const currentRaw = await readObjectTextIfExists(MODELS_BUCKET, CURRENT_OBJECT);
  const current = typeof currentRaw === 'string' ? currentRaw.trim() : null;
  if (current && current === version) {
    return { modelVersion: version, changed: false };
  }

  const body = Buffer.from(`${version}\n`, 'utf-8');
  await client.putObject(MODELS_BUCKET, CURRENT_OBJECT, body, body.length, {
    'Content-Type': 'text/plain; charset=utf-8',
  });

  return { modelVersion: version, changed: true };
};
