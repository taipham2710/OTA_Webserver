import { getModelInfo, getCurrentModel, getModelArtifactsStatus } from '../services/modelService.js';

// NOTE: This is a metadata-only endpoint. It returns model information
// from MinIO artifacts (metadata.json as source of truth). If unavailable,
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

// NOTE: Returns the current active model metadata payload from MinIO.
// Kept for compatibility; does not reinterpret ML semantics.
export const getCurrentModelHandler = async (req, res, next) => {
  try {
    const modelData = await getCurrentModel();

    res.json({
      success: true,
      data: modelData,
    });
  } catch (error) {
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
