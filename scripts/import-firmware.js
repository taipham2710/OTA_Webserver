import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

import { getDb } from '../src/clients/mongodb.js';
import { getMinioClient } from '../src/clients/minio.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// --- Simple CLI args parser ---
function getArg(name) {
  const index = process.argv.indexOf(`--${name}`);
  return index !== -1 ? process.argv[index + 1] : null;
}

const version = getArg('version');
const deviceType = getArg('device');
const filePath = getArg('file');
const notes = getArg('notes') || '';

if (!version || !deviceType || !filePath) {
  console.error(`
Usage:
node scripts/import-firmware.js \\
  --version <version> \\
  --device <deviceType> \\
  --file <path_to_bin> \\
  [--notes "release notes"]
`);
  process.exit(1);
}

// --- Validate file ---
if (!fs.existsSync(filePath)) {
  console.error(`Firmware file not found: ${filePath}`);
  process.exit(1);
}

const fileBuffer = fs.readFileSync(filePath);
const fileSize = fileBuffer.length;

// --- Compute checksum ---
const checksum = crypto
  .createHash('sha256')
  .update(fileBuffer)
  .digest('hex');

// --- MinIO upload ---
const minioClient = getMinioClient();
const bucket = 'firmware';
const objectKey = `${deviceType}/${version}.bin`;

try {
  await minioClient.putObject(bucket, objectKey, fileBuffer);
  console.log(`Uploaded firmware to MinIO: ${bucket}/${objectKey}`);
} catch (err) {
  console.error('Failed to upload firmware to MinIO:', err.message);
  process.exit(1);
}

// --- Insert MongoDB metadata ---
const db = await getDb();
const firmwares = db.collection('firmwares');

const firmwareDoc = {
  version,
  deviceType,
  filename: path.basename(filePath),
  checksum: `sha256:${checksum}`,
  size: fileSize,
  storage: {
    type: 'minio',
    bucket,
    objectKey,
  },
  status: 'available',
  releaseNotes: notes,
  createdAt: new Date(),
  createdBy: 'import-script',
};

try {
  await firmwares.insertOne(firmwareDoc);
  console.log('Firmware metadata inserted into MongoDB');
} catch (err) {
  if (err.code === 11000) {
    console.error('Firmware already exists (version + deviceType)');
  } else {
    console.error('Failed to insert firmware metadata:', err.message);
  }
  process.exit(1);
}

console.log('✅ Firmware import completed successfully');
process.exit(0);
