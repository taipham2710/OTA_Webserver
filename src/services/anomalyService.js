import axios from 'axios';
import { config } from '../config/index.js';
import { AppError } from '../utils/errors.js';
import { buildFeatureVector } from './featureAggregationService.js';
import { getModelInfo } from './modelService.js';

// NOTE: Backend does not compute anomaly.
// It delegates inference to the ML service via /predict.
// Feature aggregation prepares the full feature vector from multiple data sources.
// 
// ML Ops best practice: Always return consistent API contract with threshold as number.
export const getAnomalyAnalysis = async (deviceId) => {
  // Get threshold from model metadata (with fallback to 0.5)
  let thresholdFromModel = 0.5; // Safe default
  let modelMetadata = {
    name: 'xgboost',
    version: 'v1.0',
    thresholdSource: 'default',
  };
  try {
    const modelInfo = await getModelInfo();
    if (modelInfo) {
      if (typeof modelInfo.threshold === 'number') {
        thresholdFromModel = modelInfo.threshold;
      }
      // Extract model metadata
      modelMetadata = {
        name: modelInfo.name || modelInfo.model_name || 'xgboost',
        version: modelInfo.version || modelInfo.model_version || 'v1.0',
        thresholdSource: modelInfo.threshold ? 'model-metadata' : 'default',
      };
    }
  } catch (modelError) {
    console.warn(`Could not fetch model threshold, using default 0.5: ${modelError.message}`);
  }

  try {
    // Build full feature vector from metrics, logs, and OTA data
    let featureVector = {};
    try {
      featureVector = await buildFeatureVector(deviceId);
    } catch (featureError) {
      // If feature aggregation fails, return safe default
      console.warn(`Failed to build feature vector for anomaly analysis: ${featureError.message}`);
      return {
        isAnomaly: false,
        anomalyScore: null,
        threshold: thresholdFromModel, // Always return number
        features: {}, // Empty features on error
      };
    }

    // Prepare request body for FastAPI /predict endpoint with full feature vector
    const requestBody = {
      data: featureVector,
    };

    const response = await axios.post(`${config.inference.api}/predict`, requestBody, {
      timeout: 10000,
      headers: {
        'Content-Type': 'application/json',
      },
    });

    // Map FastAPI response to backend domain model
    const inferenceResult = response.data;
    const prediction = inferenceResult.prediction ?? inferenceResult.pred ?? null;
    const prob = inferenceResult.probability ?? inferenceResult.prob ?? inferenceResult.score ?? null;
    
    // Get threshold from inference result or model metadata or default
    const threshold = inferenceResult.threshold ?? thresholdFromModel ?? 0.5;

    // Enforce API contract: threshold MUST always be a number
    const result = {
      isAnomaly: prediction === 1,
      anomalyScore: prob,
      threshold: typeof threshold === 'number' ? threshold : 0.5,
      features: featureVector, // Include features for explanation engine
      model: modelMetadata, // Include model metadata for MLOps traceability
    };

    return result;
  } catch (error) {
    // NOTE: Always return valid API contract even on error
    if (error.response) {
      // 4xx or 5xx response - return safe default
      console.warn(`Inference service error: ${error.response.status} - ${error.response.data?.message || error.message}`);
      return {
        isAnomaly: false,
        anomalyScore: null,
        threshold: thresholdFromModel, // Always return number
        features: {}, // Empty features on error
        model: modelMetadata,
      };
    } else if (error.request) {
      // Network error or timeout - return safe default
      console.warn('Inference service unavailable or timeout');
      return {
        isAnomaly: false,
        anomalyScore: null,
        threshold: thresholdFromModel, // Always return number
        features: {}, // Empty features on error
        model: modelMetadata,
      };
    } else {
      // Other error - return safe default
      console.warn(`Failed to get anomaly analysis: ${error.message}`);
      return {
        isAnomaly: false,
        anomalyScore: null,
        threshold: thresholdFromModel, // Always return number
        features: {}, // Empty features on error
        model: modelMetadata,
      };
    }
  }
};

