import { getMinioClient } from '../clients/minio.js';
import { AppError } from '../utils/errors.js';

// NOTE: GET /api/model/info is metadata-only.
// Source of truth:
// - models/<version>/metadata.json (canonical)
// - models/<version>/threshold.json (fallback only if metadata.json has no threshold)
//
// IMPORTANT: This service is read-only for ML semantics.
// It must not reshape, normalize, or infer fields from metadata.json.
export const getModelInfo = async () => {
  const BUCKET = 'models';
  let resolvedVersion = null;

  const isPlainObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

  const coerceModelVersion = (metadata, fallback) => {
    if (metadata && typeof metadata.model_version === 'string' && metadata.model_version.trim().length > 0) {
      return metadata.model_version.trim();
    }
    if (typeof fallback === 'string' && fallback.trim().length > 0) {
      return fallback.trim();
    }
    return null;
  };

  const pickThresholdFallback = (thresholdJson) => {
    if (!thresholdJson) return null;
    if (!isPlainObject(thresholdJson)) return null;

    // Accept only objects that already match the expected metadata.json threshold shape.
    // Do NOT wrap/compute/guess threshold structure.
    if (isPlainObject(thresholdJson.strategy)) return thresholdJson;
    if (isPlainObject(thresholdJson.threshold) && isPlainObject(thresholdJson.threshold.strategy)) return thresholdJson.threshold;

    return null;
  };

  try {
    await assertBucketExists(BUCKET);

    resolvedVersion = await resolveCurrentModelVersion();
    const modelDir = `models/${resolvedVersion}`;

    const metadata = await loadJSONFromMinIO_STRICT(BUCKET, `${resolvedVersion}/metadata.json`);
    const metadataObject = isPlainObject(metadata) ? metadata : {};

    // Only read threshold.json when metadata.json has no threshold field.
    let thresholdFallback = null;
    if (metadataObject.threshold === undefined || metadataObject.threshold === null) {
      const thresholdJson = await loadJSONFromMinIO_OPTIONAL(BUCKET, `${resolvedVersion}/threshold.json`);
      thresholdFallback = pickThresholdFallback(thresholdJson);
    }

    const modelVersion = coerceModelVersion(metadataObject, resolvedVersion);

    return {
      model_dir: modelDir,
      model_version: modelVersion,
      ...metadataObject,
      // Ensure model_version is always present (fallback to resolved version).
      model_version: modelVersion,
      // Preserve metadata.json structure; only inject threshold if metadata.json had none.
      ...(thresholdFallback ? { threshold: thresholdFallback } : {}),
    };
  } catch (error) {
    const versionInfo = resolvedVersion ? ` (version=${resolvedVersion})` : '';
    console.warn(`Failed to load model info from MinIO${versionInfo}: ${error.message}`);
    return null;
  }
};

// Assert bucket exists - throws error if bucket is missing
const assertBucketExists = async (bucketName) => {
  const client = getMinioClient();
  const exists = await client.bucketExists(bucketName);
  if (!exists) {
    throw new AppError(`MinIO bucket '${bucketName}' does not exist`, 500);
  }
};

// Strict JSON loader from MinIO - throws error if file missing or invalid
const loadJSONFromMinIO_STRICT = async (bucket, objectPath) => {
  console.log(`[MinIO] Reading bucket=${bucket} object=${objectPath}`);
  
  const client = getMinioClient();
  
  // First, check if object exists
  try {
    await client.statObject(bucket, objectPath);
  } catch (error) {
    if (error.code === 'NoSuchKey' || error.code === 'NotFound') {
      throw new AppError(`Missing MinIO object: ${bucket}/${objectPath}`, 500);
    }
    throw new AppError(`Error checking MinIO object ${bucket}/${objectPath}: ${error.message}`, 500);
  }
  
  // Load object stream
  let dataStream;
  try {
    dataStream = await client.getObject(bucket, objectPath);
  } catch (error) {
    throw new AppError(`Error reading MinIO object ${bucket}/${objectPath}: ${error.message}`, 500);
  }
  
  // Read stream chunks
  const chunks = [];
  try {
    for await (const chunk of dataStream) {
      chunks.push(chunk);
    }
  } catch (error) {
    throw new AppError(`Error reading stream from ${bucket}/${objectPath}: ${error.message}`, 500);
  }
  
  // Parse JSON
  const content = Buffer.concat(chunks).toString('utf-8');
  try {
    return JSON.parse(content);
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new AppError(`Invalid JSON in MinIO object ${bucket}/${objectPath}: ${error.message}`, 500);
    }
    throw new AppError(`JSON parse error for ${bucket}/${objectPath}: ${error.message}`, 500);
  }
};

// Strict text loader from MinIO - throws error if file missing or empty
const loadTextFromMinIO_STRICT = async (bucket, objectPath) => {
  console.log(`[MinIO] Reading text bucket=${bucket} object=${objectPath}`);
  
  const client = getMinioClient();
  
  // First, check if object exists
  try {
    await client.statObject(bucket, objectPath);
  } catch (error) {
    if (error.code === 'NoSuchKey' || error.code === 'NotFound') {
      throw new AppError(`Missing MinIO object: ${bucket}/${objectPath}`, 500);
    }
    throw new AppError(`Error checking MinIO object ${bucket}/${objectPath}: ${error.message}`, 500);
  }
  
  // Load object stream
  let dataStream;
  try {
    dataStream = await client.getObject(bucket, objectPath);
  } catch (error) {
    throw new AppError(`Error reading MinIO object ${bucket}/${objectPath}: ${error.message}`, 500);
  }
  
  // Read stream chunks
  const chunks = [];
  try {
    for await (const chunk of dataStream) {
      chunks.push(chunk);
    }
  } catch (error) {
    throw new AppError(`Error reading stream from ${bucket}/${objectPath}: ${error.message}`, 500);
  }
  
  // Return text content
  return Buffer.concat(chunks).toString('utf-8');
};

// Optional JSON loader from MinIO - returns null if file missing, throws on parse errors
const loadJSONFromMinIO_OPTIONAL = async (bucket, objectPath) => {
  console.log(`[MinIO] Reading (optional) bucket=${bucket} object=${objectPath}`);
  
  const client = getMinioClient();
  
  // Check if object exists
  try {
    await client.statObject(bucket, objectPath);
  } catch (error) {
    if (error.code === 'NoSuchKey' || error.code === 'NotFound') {
      console.log(`[MinIO] Optional object not found: ${bucket}/${objectPath}`);
      return null;
    }
    // Other errors are still thrown
    throw new AppError(`Error checking MinIO object ${bucket}/${objectPath}: ${error.message}`, 500);
  }
  
  // Load object stream
  let dataStream;
  try {
    dataStream = await client.getObject(bucket, objectPath);
  } catch (error) {
    throw new AppError(`Error reading MinIO object ${bucket}/${objectPath}: ${error.message}`, 500);
  }
  
  // Read stream chunks
  const chunks = [];
  try {
    for await (const chunk of dataStream) {
      chunks.push(chunk);
    }
  } catch (error) {
    throw new AppError(`Error reading stream from ${bucket}/${objectPath}: ${error.message}`, 500);
  }
  
  // Parse JSON
  const content = Buffer.concat(chunks).toString('utf-8');
  try {
    return JSON.parse(content);
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new AppError(`Invalid JSON in MinIO object ${bucket}/${objectPath}: ${error.message}`, 500);
    }
    throw new AppError(`JSON parse error for ${bucket}/${objectPath}: ${error.message}`, 500);
  }
};

// Resolve current model version from MinIO
async function resolveCurrentModelVersion() {
  const BUCKET = 'models';
  const CURRENT_OBJECT = 'current';

  console.log('[Model] Resolving current model version from MinIO');

  const raw = await loadTextFromMinIO_STRICT(BUCKET, CURRENT_OBJECT);
  const version = raw.trim();

  if (!version) {
    throw new AppError('models/current is empty', 500);
  }

  // Validate version folder exists by attempting to stat a file in it
  const client = getMinioClient();
  try {
    await client.statObject(BUCKET, `${version}/metadata.json`);
  } catch (error) {
    if (error.code === 'NoSuchKey' || error.code === 'NotFound') {
      throw new AppError(`Model version folder not found: models/${version}/`, 500);
    }
    throw error;
  }

  console.log(`[Model] Active model version resolved: ${version}`);
  return version;
}

export const getCurrentModel = async () => {
  // Kept for compatibility: returns the active model metadata payload.
  // Uses the same source of truth as GET /api/model/info.
  const modelInfo = await getModelInfo();
  if (!modelInfo) {
    throw new AppError('Model artifacts not available', 500);
  }
  return modelInfo;
};

const statObjectExists = async (bucket, objectPath) => {
  const client = getMinioClient();
  try {
    await client.statObject(bucket, objectPath);
    return true;
  } catch (error) {
    if (error.code === 'NoSuchKey' || error.code === 'NotFound') {
      return false;
    }
    throw new AppError(`Error checking MinIO object ${bucket}/${objectPath}: ${error.message}`, 500);
  }
};

// Read-only: returns artifact existence booleans for operational UI checklists.
// Does not parse artifacts and does not interpret any ML internals.
export const getModelArtifactsStatus = async () => {
  const BUCKET = 'models';
  await assertBucketExists(BUCKET);

  const version = await resolveCurrentModelVersion();

  const artifacts = {
    metadataJson: true, // resolveCurrentModelVersion validates {version}/metadata.json exists
    thresholdJson: await statObjectExists(BUCKET, `${version}/threshold.json`),
    featureImportanceJson: await statObjectExists(BUCKET, `${version}/feature_importance.json`),
    driftBaselineJson: await statObjectExists(BUCKET, `${version}/drift_baseline.json`),
  };

  return { modelVersion: version, artifacts };
};
