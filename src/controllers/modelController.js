import { getModelInfo } from '../services/modelService.js';

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
    // This should not happen since getModelInfo() returns null instead of throwing
    // But keep error handling for safety
    next(error);
  }
};

