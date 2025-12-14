import { getModelInfo } from '../services/modelService.js';

export const getModelInfoHandler = async (req, res, next) => {
  try {
    const modelInfo = await getModelInfo();

    res.json({
      success: true,
      data: modelInfo,
    });
  } catch (error) {
    next(error);
  }
};

