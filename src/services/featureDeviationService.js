// ============================================================================
// FEATURE DEVIATION SERVICE
// ============================================================================
// Computes feature deviations from training baseline (operational analysis)
// NOT model explainability - uses training statistics (feature_stats.json)
//
// Architecture:
// - Load feature_stats.json from MinIO (same model artifact directory)
// - Compare current feature vector with training statistics (mean, p95, p99)
// - Compute deviation metrics (z-score or relative-to-p95)
// - Return top-N most deviating features (deterministic)
//
// This is operational deviation analysis, not ML model explainability.
// ============================================================================

import { getMinioClient } from '../clients/minio.js';
import { AppError } from '../utils/errors.js';

// Resolve current model version from MinIO (duplicated from modelService.js for independence)
async function resolveCurrentModelVersion() {
  const BUCKET = 'models';
  const CURRENT_OBJECT = 'current';

  const client = getMinioClient();
  
  // Check if current object exists
  try {
    await client.statObject(BUCKET, CURRENT_OBJECT);
  } catch (error) {
    if (error.code === 'NoSuchKey' || error.code === 'NotFound') {
      throw new AppError('models/current not found', 500);
    }
    throw new AppError(`Error checking MinIO object ${BUCKET}/${CURRENT_OBJECT}: ${error.message}`, 500);
  }

  // Load current object
  let dataStream;
  try {
    dataStream = await client.getObject(BUCKET, CURRENT_OBJECT);
  } catch (error) {
    throw new AppError(`Error reading MinIO object ${BUCKET}/${CURRENT_OBJECT}: ${error.message}`, 500);
  }

  // Read stream chunks
  const chunks = [];
  try {
    for await (const chunk of dataStream) {
      chunks.push(chunk);
    }
  } catch (error) {
    throw new AppError(`Error reading stream from ${BUCKET}/${CURRENT_OBJECT}: ${error.message}`, 500);
  }

  const version = Buffer.concat(chunks).toString('utf-8').trim();

  if (!version) {
    throw new AppError('models/current is empty', 500);
  }

  // Validate version folder exists
  try {
    await client.statObject(BUCKET, `${version}/metadata.json`);
  } catch (error) {
    if (error.code === 'NoSuchKey' || error.code === 'NotFound') {
      throw new AppError(`Model version folder not found: models/${version}/`, 500);
    }
    throw error;
  }

  return version;
}

// Optional JSON loader from MinIO (duplicated from modelService.js for independence)
async function loadJSONFromMinIO_OPTIONAL(bucket, objectPath) {
  const client = getMinioClient();

  // Check if object exists
  try {
    await client.statObject(bucket, objectPath);
  } catch (error) {
    if (error.code === 'NoSuchKey' || error.code === 'NotFound') {
      console.log(`[MinIO] Optional object not found: ${bucket}/${objectPath}`);
      return null;
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
}

/**
 * Compute feature deviations from training baseline
 * @param {Object} featureVector - Current feature vector used for inference
 * @param {number} topN - Number of top deviations to return (default: 10)
 * @returns {Promise<Object>} Deviations object with top deviations array
 */
export const computeFeatureDeviations = async (featureVector, topN = 10) => {
  if (!featureVector || typeof featureVector !== 'object') {
    return { deviations: [] };
  }

  try {
    // Resolve current model version
    const version = await resolveCurrentModelVersion();
    
    // Load feature_stats.json from MinIO (optional - may not exist for all models)
    const BUCKET = 'models';
    const featureStats = await loadJSONFromMinIO_OPTIONAL(BUCKET, `${version}/feature_stats.json`);
    
    if (!featureStats || typeof featureStats !== 'object') {
      // Feature stats not available - return empty deviations
      console.warn(`[FeatureDeviation] feature_stats.json not found for model ${version}`);
      return { deviations: [] };
    }

    // Compute deviations for each feature
    const deviations = [];
    
    for (const [featureName, currentValue] of Object.entries(featureVector)) {
      // Skip _present flags (they are not numeric features)
      if (featureName.endsWith('_present')) {
        continue;
      }

      // Get training statistics for this feature
      const stats = featureStats[featureName];
      if (!stats || typeof stats !== 'object') {
        continue;
      }

      const trainingMean = typeof stats.mean === 'number' ? stats.mean : null;
      const trainingStd = typeof stats.std === 'number' ? stats.std : null;
      const trainingP95 = typeof stats.p95 === 'number' ? stats.p95 : null;

      if (trainingMean === null || trainingStd === null || trainingP95 === null) {
        continue;
      }

      // Skip if current value is not a number
      if (typeof currentValue !== 'number' || !Number.isFinite(currentValue)) {
        continue;
      }

      // Compute deviation score (z-score: (value - mean) / std)
      const deviationScore = trainingStd > 0 
        ? (currentValue - trainingMean) / trainingStd
        : 0;

      // Use p95 as reference value (more interpretable than mean for outliers)
      const reference = trainingP95;

      // Determine severity based on deviation score
      let severity = 'low';
      const absDeviation = Math.abs(deviationScore);
      if (absDeviation >= 3.0) {
        severity = 'high';
      } else if (absDeviation >= 2.0) {
        severity = 'medium';
      }

      // Generate human-readable explanation
      let explanation = '';
      if (currentValue > trainingP95) {
        explanation = `${featureName} is above normal range (current: ${currentValue.toFixed(2)}, normal p95: ${reference.toFixed(2)})`;
      } else if (currentValue < trainingMean - 2 * trainingStd) {
        explanation = `${featureName} is below normal range (current: ${currentValue.toFixed(2)}, normal mean: ${trainingMean.toFixed(2)})`;
      } else {
        explanation = `${featureName} is within normal range`;
      }

      deviations.push({
        feature: featureName,
        current_value: currentValue,
        reference: reference,
        deviation_score: deviationScore,
        severity: severity,
        explanation: explanation,
      });
    }

    // Sort by absolute deviation score (descending) and take top N
    deviations.sort((a, b) => Math.abs(b.deviation_score) - Math.abs(a.deviation_score));
    const topDeviations = deviations.slice(0, topN);

    return {
      deviations: topDeviations,
    };

  } catch (error) {
    // Non-blocking: log error but return empty deviations
    console.warn(`[FeatureDeviation] Failed to compute deviations: ${error.message}`);
    return { deviations: [] };
  }
};
