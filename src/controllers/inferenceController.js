import { inferenceProxy } from '../services/inferenceProxyService.js';

const sendUpstream = (res, upstream) => {
  const status = upstream?.status || 502;
  const data = upstream?.data;

  if (data && typeof data === 'object') {
    return res.status(status).json(data);
  }
  return res.status(status).send(data ?? '');
};

export const inferenceHealthHandler = async (req, res) => {
  const upstream = await inferenceProxy.health();
  return sendUpstream(res, upstream);
};

export const inferenceReadyHandler = async (req, res) => {
  const upstream = await inferenceProxy.ready();
  return sendUpstream(res, upstream);
};

export const inferenceMetadataHandler = async (req, res) => {
  const upstream = await inferenceProxy.metadata();
  return sendUpstream(res, upstream);
};

export const inferencePredictHandler = async (req, res) => {
  // Contract: POST /predict { data: <opaque payload> }
  const body = req.body;
  const upstream = await inferenceProxy.predict(body);
  return sendUpstream(res, upstream);
};

