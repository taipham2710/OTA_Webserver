import { getDevices, getDeviceById, assignFirmwareToDevice, reportDeviceFirmware, retryOTAForDevice } from '../services/deviceService.js';
import { validateDeviceId, validateQueryParams } from '../utils/validators.js';
import { AppError } from '../utils/errors.js';

export const getDevicesHandler = async (req, res, next) => {
  try {
    const queryParams = validateQueryParams(req.query);
    
    // Add additional query params that validateQueryParams doesn't handle
    if (req.query.status) {
      queryParams.status = req.query.status;
    }
    if (req.query.skip) {
      queryParams.skip = parseInt(req.query.skip, 10);
    }

    const devices = await getDevices(queryParams);

    res.json({
      success: true,
      data: devices,
      count: devices.length,
    });
  } catch (error) {
    next(error);
  }
};

export const getDeviceByIdHandler = async (req, res, next) => {
  try {
    const deviceId = validateDeviceId(req.params.id);
    const device = await getDeviceById(deviceId);

    res.json({
      success: true,
      data: device,
    });
  } catch (error) {
    next(error);
  }
};

export const assignFirmwareToDeviceHandler = async (req, res, next) => {
  console.log('--- Assign Firmware Request Received ---');
  console.log('Request Params:', req.params);
  console.log('Request Body:', req.body);
  try {
    const { deviceId } = req.params;
    const { firmwareVersion } = req.body;
    
    console.log('Extracted deviceId:', deviceId);
    console.log('Extracted firmwareVersion:', firmwareVersion);

    if (!deviceId || typeof deviceId !== 'string') {
      throw new AppError('Device ID is required', 400);
    }

    if (!firmwareVersion || typeof firmwareVersion !== 'string') {
      throw new AppError('Firmware version is required', 400);
    }

    const updatedDevice = await assignFirmwareToDevice(deviceId, firmwareVersion);

    res.json({
      success: true,
      data: updatedDevice,
      message: 'Firmware assigned successfully',
    });
  } catch (error) {
    next(error);
  }
};

export const reportDeviceFirmwareHandler = async (req, res, next) => {
  try {
    const { deviceId } = req.params;
    const { reportedFirmwareVersion, otaStatus } = req.body;

    if (!deviceId || typeof deviceId !== 'string') {
      throw new AppError('Device ID is required', 400);
    }

    if (!reportedFirmwareVersion || typeof reportedFirmwareVersion !== 'string') {
      throw new AppError('reportedFirmwareVersion is required', 400);
    }

    const updatedDevice = await reportDeviceFirmware(deviceId, reportedFirmwareVersion, otaStatus);

    res.json({
      success: true,
      data: updatedDevice,
      message: 'Firmware report received',
    });
  } catch (error) {
    next(error);
  }
};

export const retryOTAForDeviceHandler = async (req, res, next) => {
  try {
    const { deviceId } = req.params;

    if (!deviceId || typeof deviceId !== 'string') {
      throw new AppError('Device ID is required', 400);
    }

    const updatedDevice = await retryOTAForDevice(deviceId);

    res.json({
      success: true,
      data: updatedDevice,
      message: 'OTA retry initiated successfully',
    });
  } catch (error) {
    next(error);
  }
};