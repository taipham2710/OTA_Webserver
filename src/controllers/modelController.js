import { getModelInfo, getCurrentModel, getModelArtifactsStatus } from '../services/modelService.js';

// NOTE: This is a metadata-only endpoint. It returns model information
// from the inference service. If the inference service is unavailable,
// it returns success:true with data:null (does not block server startup).
export const getModelInfoHandler = async (req, res, next) => {
  try {
    const modelInfo = await getModelInfo();

    // Return success:true with data (or null if unavailable)
    res.json({
      success: true,
      data: modelInfo,
    });
  } catch (error) {
    // Stability: never fail the UI due to missing model artifacts.
    console.warn(`getModelInfoHandler failed: ${error.message}`);
    res.json({
      success: true,
      data: null,
    });
  }
};

// NOTE: Returns current model data from MinIO storage.
// Resolves active version from models/current file.
// Reads metadata.json, drift_report.json, and optional feature_importance.json.
// Returns normalized structure that frontend can render without modification.
// FAILS LOUD if any required file is missing or invalid.
export const getCurrentModelHandler = async (req, res, next) => {
  try {
    // Load and normalize model data from MinIO
    // Version is resolved from models/current file
    // This will throw if any file is missing or invalid
    const modelData = await getCurrentModel();

    // Return success with normalized data structure
    res.json({
      success: true,
      data: modelData,
    });
  } catch (error) {
    // Propagate error - fail loud with HTTP 500
    const statusCode = error.statusCode || 500;
    const message = error.message || 'Model artifacts not available';
    
    console.error(`getCurrentModelHandler failed: ${message}`);
    
    res.status(statusCode).json({
      success: false,
      error: 'Model artifacts not available',
      details: message,
    });
  }
};

// NOTE: Read-only endpoint for operational UI artifact checklist.
// Returns existence booleans only (no parsing/interpretation).
export const getModelArtifactsHandler = async (req, res, next) => {
  try {
    const status = await getModelArtifactsStatus();
    res.json({
      success: true,
      data: status,
    });
  } catch (error) {
    next(error);
  }
};
