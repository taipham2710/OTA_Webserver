import { getMinioClient } from '../clients/minio.js';
import { AppError } from '../utils/errors.js';

// NOTE: GET /api/model/info should return full model metadata from MinIO artifacts.
// Source of truth:
// - models/<version>/metadata.json
// - models/<version>/threshold.json
// - models/<version>/feature_importance.json
export const getModelInfo = async () => {
  const BUCKET = 'models';
  let resolvedVersion = null;

  const read = (obj, keys) => {
    for (const key of keys) {
      if (obj && typeof obj === 'object' && obj[key] !== undefined) return obj[key];
    }
    return null;
  };

  try {
    await assertBucketExists(BUCKET);

    resolvedVersion = await resolveCurrentModelVersion();
    const modelDir = `models/${resolvedVersion}`;

    const metadata = await loadJSONFromMinIO_STRICT(BUCKET, `${resolvedVersion}/metadata.json`);
    const thresholdJson = await loadJSONFromMinIO_OPTIONAL(BUCKET, `${resolvedVersion}/threshold.json`);
    const featureImportance = await loadFeatureImportanceFromMinIO(resolvedVersion);

    const model_version =
      read(metadata, ['model_version', 'modelVersion', 'version']) ?? resolvedVersion ?? null;
    const model_name = read(metadata, ['model_name', 'modelName', 'name']) ?? null;
    const algorithm = read(metadata, ['algorithm']) ?? null;
    const trained_at =
      read(metadata, ['trained_at', 'trainedAt', 'train_date', 'training_date']) ?? null;
    const training_window =
      read(metadata, ['training_window', 'trainingWindow']) ?? null;
    const feature_count =
      read(metadata, ['feature_count', 'featureCount']) ?? null;

    const data = {
      train_rows: read(metadata?.data, ['train_rows', 'trainRows']) ?? null,
      holdout_rows: read(metadata?.data, ['holdout_rows', 'holdoutRows']) ?? null,
      use_kaggle_for_training:
        read(metadata?.data, [
          'use_kaggle_for_training',
          'useKaggleForTraining',
          'use_kaggle_dataset',
          'useKaggleDataset',
        ]) ?? null,
    };

    // Threshold normalization must always return all fields (or nulls).
    const threshold = normalizeThresholdForInfo(thresholdJson);

    // Metrics handling: if holdout missing/invalid => metrics = null (not an object of nulls).
    let metrics = null;
    const holdout = metadata?.metrics?.holdout;
    const holdoutValid = holdout && typeof holdout === 'object' && !Array.isArray(holdout);
    if (holdoutValid) {
      metrics = {
        holdout: {
          precision: read(holdout, ['precision']) ?? null,
          recall: read(holdout, ['recall']) ?? null,
          f1: read(holdout, ['f1', 'f1_score', 'f1Score']) ?? null,
          roc_auc: read(holdout, ['roc_auc', 'rocAuc']) ?? null,
          pr_auc: read(holdout, ['pr_auc', 'prAuc']) ?? null,
          brier: read(holdout, ['brier', 'brier_score', 'brierScore']) ?? null,
        },
      };
    }

    return {
      model_dir: modelDir,
      model_version,
      model_name,
      algorithm,
      trained_at,
      training_window,
      feature_count,
      data,
      threshold,
      metrics,
      feature_importance: featureImportance,
    };
  } catch (error) {
    const versionInfo = resolvedVersion ? ` (version=${resolvedVersion})` : '';
    console.warn(`Failed to load model info from MinIO${versionInfo}: ${error.message}`);
    return null;
  }
};

// Load feature_importance.json from MinIO (if present) and normalize to:
// [{ name: string, importance: number | null }]
async function loadFeatureImportanceFromMinIO(version) {
  const BUCKET = 'models';
  const objectPath = `${version}/feature_importance.json`;

  const data = await loadJSONFromMinIO_OPTIONAL(BUCKET, objectPath);
  if (!data) return [];

  let rawList = [];
  if (Array.isArray(data)) {
    rawList = data;
  } else if (typeof data === 'object') {
    if (Array.isArray(data.random_forest_importance)) {
      rawList = data.random_forest_importance;
    } else if (Array.isArray(data.xgboost_importance)) {
      rawList = data.xgboost_importance;
    } else if (Array.isArray(data.feature_importance)) {
      rawList = data.feature_importance;
    }
  }

  return rawList
    .map((item) => {
      if (!item) return null;

      if (typeof item === 'string') {
        return { name: item, importance: null };
      }

      if (typeof item !== 'object') {
        return { name: String(item), importance: null };
      }

      const name =
        item.feature ?? item.name ?? item.key ?? (item.id !== undefined ? String(item.id) : null);
      if (!name) return null;

      const rawImportance =
        item.importance ?? item.gain ?? item.weight ?? item.value ?? null;
      const importance = typeof rawImportance === 'number' && !Number.isNaN(rawImportance) ? rawImportance : null;

      return { name: String(name), importance };
    })
    .filter(Boolean);
}

function normalizeThresholdForInfo(thresholdJson) {
  const read = (obj, keys) => {
    for (const key of keys) {
      if (obj && typeof obj === 'object' && obj[key] !== undefined) return obj[key];
    }
    return null;
  };

  if (!thresholdJson || typeof thresholdJson !== 'object') {
    return {
      strategy: null,
      priority: null,
      min_precision: null,
      soft_min_precision: null,
      value: null,
      soft_value: null,
    };
  }

  const root = thresholdJson;
  const nested = thresholdJson.threshold && typeof thresholdJson.threshold === 'object'
    ? thresholdJson.threshold
    : null;

  return {
    strategy: read(root, ['strategy']) ?? read(nested, ['strategy']) ?? null,
    priority: read(root, ['priority']) ?? read(nested, ['priority']) ?? null,
    min_precision: read(root, ['min_precision', 'minPrecision']) ?? read(nested, ['min_precision', 'minPrecision']) ?? null,
    soft_min_precision: read(root, ['soft_min_precision', 'softMinPrecision']) ?? read(nested, ['soft_min_precision', 'softMinPrecision']) ?? null,
    value: read(root, ['value']) ?? read(nested, ['value']) ?? read(root, ['threshold']) ?? null,
    soft_value: read(root, ['soft_value', 'softThreshold', 'soft_threshold']) ?? read(nested, ['soft_value', 'softThreshold', 'soft_threshold']) ?? null,
  };
}

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

// Normalize feature importance data from various possible formats
// Source: feature_importance.json
// Output shape: { name: string, importance: number }
// Maps item.feature → name (NOT feature)
const normalizeFeatureImportance = (data) => {
  if (!data || !Array.isArray(data)) {
    return [];
  }

  return data.map((item, index) => {
    if (typeof item === 'string') {
      return { name: item, importance: null };
    }
    
    if (typeof item === 'object' && item !== null) {
      // Source: feature_importance.json uses 'feature' key
      // Map to 'name' for consistency
      const name = item.feature !== undefined ? item.feature :
                   item.name !== undefined ? item.name :
                   item.key !== undefined ? item.key :
                   String(item);
      
      const importance = item.importance !== undefined ? item.importance :
                        item.gain !== undefined ? item.gain :
                        item.weight !== undefined ? item.weight : null;
      
      // DO NOT return 'feature' field, only 'name'
      return { name, importance };
    }
    
    return { name: String(item), importance: null };
  }).filter(item => item.name);
};

// Normalize KS drift data from object map format
// Input: { "feature_name": { "ks_stat": number, "p_value": number } }
// Output: [{ "feature": string, "score": number }] sorted descending by score
const normalizeKSDrift = (ksData) => {
  if (!ksData || typeof ksData !== 'object' || Array.isArray(ksData)) {
    return [];
  }

  const entries = Object.entries(ksData)
    .map(([feature, value]) => {
      // Value should be an object with ks_stat
      if (typeof value === 'object' && value !== null && typeof value.ks_stat === 'number') {
        return {
          feature,
          score: value.ks_stat,
        };
      }
      return null;
    })
    .filter(item => item !== null);

  // Sort descending by score
  return entries.sort((a, b) => b.score - a.score);
};

// Normalize PSI drift data from object map format
// Input: { "feature_name": number }
// Output: [{ "feature": string, "psi": number }] sorted descending by psi
const normalizePSIDrift = (psiData) => {
  if (!psiData || typeof psiData !== 'object' || Array.isArray(psiData)) {
    return [];
  }

  const entries = Object.entries(psiData)
    .map(([feature, value]) => {
      // Value should be a number
      if (typeof value === 'number') {
        return {
          feature,
          psi: value,
        };
      }
      return null;
    })
    .filter(item => item !== null);

  // Sort descending by psi
  return entries.sort((a, b) => b.psi - a.psi);
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

// Merge threshold from threshold.json into normalized model (metadata.json has priority)
function mergeThreshold(normalizedModel, thresholdData) {
  if (!thresholdData || typeof thresholdData !== 'object') {
    return;
  }

  // Extract threshold value
  const extractedThreshold = thresholdData.threshold !== undefined ? thresholdData.threshold :
                             thresholdData.value !== undefined ? thresholdData.value :
                             (typeof thresholdData === 'number' ? thresholdData : null);

  if (typeof extractedThreshold !== 'number' || isNaN(extractedThreshold)) {
    return;
  }

  // metadata.json has priority
  if (normalizedModel.threshold === null || normalizedModel.threshold === undefined) {
    normalizedModel.threshold = extractedThreshold;
    console.log(`[Model] Threshold injected from threshold.json into normalized metadata: ${extractedThreshold}`);
  } else {
    console.log(`[Model] Threshold skipped from threshold.json (metadata.json already has threshold: ${normalizedModel.threshold})`);
  }
}

// Normalize feature importance from feature_importance.json
// STRICT: ONLY source is feature_importance.json with random_forest_importance and xgboost_importance
// NO fallback to feature_list.json or drift data
function normalizeFeatureImportanceFromFile(featureImportanceData) {
  let randomForestImportance = [];
  let xgboostImportance = [];

  if (!featureImportanceData || typeof featureImportanceData !== 'object' || Array.isArray(featureImportanceData)) {
    console.log(`[Model] feature_importance.json not found — feature importance unavailable`);
    return { randomForestImportance: [], xgboostImportance: [] };
  }

  // Extract Random Forest importance
  const rfData = featureImportanceData.random_forest_importance || [];
  if (Array.isArray(rfData) && rfData.length > 0) {
    randomForestImportance = normalizeFeatureImportance(rfData);
    // Sort descending by importance
    randomForestImportance.sort((a, b) => {
      const aVal = a.importance !== null ? a.importance : -1;
      const bVal = b.importance !== null ? b.importance : -1;
      return bVal - aVal;
    });
  }

  // Extract XGBoost importance
  const xgbData = featureImportanceData.xgboost_importance || [];
  if (Array.isArray(xgbData) && xgbData.length > 0) {
    xgboostImportance = normalizeFeatureImportance(xgbData);
    // Sort descending by importance
    xgboostImportance.sort((a, b) => {
      const aVal = a.importance !== null ? a.importance : -1;
      const bVal = b.importance !== null ? b.importance : -1;
      return bVal - aVal;
    });
  }

  console.log(`[Model] Feature importance loaded: RF=${randomForestImportance.length}, XGB=${xgboostImportance.length}`);

  if (randomForestImportance.length === 0 && xgboostImportance.length === 0) {
    console.log(`[Model] feature_importance.json found but no importance data (expected random_forest_importance or xgboost_importance)`);
  }

  return { randomForestImportance, xgboostImportance };
}

// Normalize drift report from drift_report.json
function normalizeDriftReport(driftReport) {
  let ksDrift = [];
  let psiDrift = [];
  let summary = null;

  if (!driftReport || typeof driftReport !== 'object' || Array.isArray(driftReport)) {
    return { ksDrift: [], psiDrift: [], summary: null };
  }

  // KS drift: object map { "feature_name": { "ks_stat": number, "p_value": number } }
  if (driftReport.ks && typeof driftReport.ks === 'object' && !Array.isArray(driftReport.ks)) {
    ksDrift = normalizeKSDrift(driftReport.ks);
  }

  // PSI drift: object map { "feature_name": number }
  if (driftReport.psi && typeof driftReport.psi === 'object' && !Array.isArray(driftReport.psi)) {
    psiDrift = normalizePSIDrift(driftReport.psi);
  }

  // Summary: pass through as-is (read-only, no computation)
  if (driftReport.summary && typeof driftReport.summary === 'object') {
    summary = driftReport.summary;
  }

  return { ksDrift, psiDrift, summary };
}

// Normalize model metadata from various possible formats
// Source: metadata.json
// Maps snake_case → camelCase explicitly
const normalizeModelMetadata = (metadata) => {
  if (!metadata || typeof metadata !== 'object') {
    return {
      modelVersion: null,
      modelName: null,
      algorithm: null,
      trainedAt: null,
      trainingWindow: null,
      featureCount: null,
      threshold: null,
    };
  }

  // Explicit snake_case → camelCase mapping
  // model_version → modelVersion
  const modelVersion = metadata.model_version !== undefined ? metadata.model_version :
                      metadata.version !== undefined ? metadata.version : null;
  if (modelVersion === null) {
    console.warn('[Model] metadata.json missing model_version');
  }

  // model_name → modelName
  const modelName = metadata.model_name !== undefined ? metadata.model_name :
                   metadata.name !== undefined ? metadata.name : null;

  // algorithm (direct)
  const algorithm = metadata.algorithm !== undefined ? metadata.algorithm : null;

  // trained_at → trainedAt
  const trainedAt = metadata.trained_at !== undefined ? metadata.trained_at :
                    metadata.trainedAt !== undefined ? metadata.trainedAt :
                    metadata.train_date !== undefined ? metadata.train_date :
                    metadata.training_date !== undefined ? metadata.training_date : null;
  if (trainedAt === null) {
    console.warn('[Model] metadata.json missing trained_at');
  }

  // training_window → trainingWindow
  const trainingWindow = metadata.training_window !== undefined ? metadata.training_window :
                        metadata.trainingWindow !== undefined ? metadata.trainingWindow :
                        metadata.window_minutes !== undefined ? metadata.window_minutes : null;
  if (trainingWindow === null) {
    console.warn('[Model] metadata.json missing training_window');
  }

  // feature_count → featureCount
  const featureCount = metadata.feature_count !== undefined ? metadata.feature_count :
                      metadata.featureCount !== undefined ? metadata.featureCount : null;
  if (featureCount === null) {
    console.warn('[Model] metadata.json missing feature_count');
  }

  // threshold (direct)
  const threshold = metadata.threshold !== undefined ? metadata.threshold : null;

  return {
    modelVersion,
    modelName,
    algorithm,
    trainedAt,
    trainingWindow,
    featureCount,
    threshold,
  };
};

// Main function to get current model data from MinIO
// FAILS LOUD if any file is missing or invalid
export const getCurrentModel = async () => {
  const BUCKET = 'models';

  // Resolve active model version from MinIO
  const VERSION = await resolveCurrentModelVersion();
  console.log(`🔍 Loading model artifacts: models/${VERSION}/`);

  // Assert bucket exists
  await assertBucketExists(BUCKET);

  // Load required JSON files (fail if any missing)
  const metadata = await loadJSONFromMinIO_STRICT(BUCKET, `${VERSION}/metadata.json`);
  const driftReport = await loadJSONFromMinIO_STRICT(BUCKET, `${VERSION}/drift_report.json`);

  // Load optional files
  const featureImportanceData = await loadJSONFromMinIO_OPTIONAL(BUCKET, `${VERSION}/feature_importance.json`);
  const featureList = await loadJSONFromMinIO_OPTIONAL(BUCKET, `${VERSION}/feature_list.json`);
  const thresholdData = await loadJSONFromMinIO_OPTIONAL(BUCKET, `${VERSION}/threshold.json`);

  // Normalize metadata
  const normalizedModel = normalizeModelMetadata(metadata);

  // Merge threshold (metadata.json has priority)
  mergeThreshold(normalizedModel, thresholdData);

  // Normalize feature importance (ONLY from feature_importance.json)
  // feature_list.json is completely ignored for importance
  const { randomForestImportance, xgboostImportance } = normalizeFeatureImportanceFromFile(featureImportanceData);

  // Normalize drift report
  const { ksDrift, psiDrift, summary } = normalizeDriftReport(driftReport);

  // Drift timestamps: drift_report.json does NOT provide timestamps
  // Set to null explicitly (no fabrication)
  if (!driftReport.generatedAt && !driftReport.timestamp && 
      !driftReport.created_at && !driftReport.createdAt) {
    console.warn('[Model] drift_report.json does not provide timestamps');
  }

  // Log success summary
  console.log(`✅ Model ${VERSION} loaded successfully`, {
    rfFeatures: randomForestImportance.length,
    xgbFeatures: xgboostImportance.length,
    ks: ksDrift.length,
    psi: psiDrift.length
  });

  // Return CLEAN structure with ONLY canonical fields
  // Source: metadata.json, feature_importance.json, drift_report.json
  return {
    // Model metadata (canonical camelCase fields ONLY)
    // Source: metadata.json
    modelVersion: normalizedModel.modelVersion || VERSION,
    modelName: normalizedModel.modelName,
    trainedAt: normalizedModel.trainedAt,
    trainingWindow: normalizedModel.trainingWindow,
    algorithm: normalizedModel.algorithm,
    featureCount: normalizedModel.featureCount,
    threshold: normalizedModel.threshold,

    // Feature importance (from feature_importance.json ONLY)
    // Structure: { name: string, importance: number }
    featureImportance: {
      randomForest: randomForestImportance,
      xgboost: xgboostImportance
    },

    // Drift data (nested structure)
    // Source: drift_report.json
    drift: {
      summary: summary || null,
      ks: ksDrift,
      psi: psiDrift,
      // Timestamps not provided by ML pipeline
      drift_analysis_timestamp: null,
      drift_timestamp: null,
      analysis_timestamp: null,
      drift_timestamp_note: 'Timestamps not provided by ML pipeline (drift_report.json)'
    },
  };
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
