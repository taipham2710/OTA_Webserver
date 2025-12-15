# OTA Webserver

A clean, minimal, production-ready OTA (Over-The-Air) webserver for IoT Edge Systems. This server integrates with MinIO (firmware storage), Elasticsearch (logs), InfluxDB (metrics), MongoDB (metadata), and FastAPI (anomaly detection).

## Features

- **Firmware Upload**: Upload firmware files to MinIO
- **Logs Viewer**: Query and view logs from Elasticsearch
- **Metrics Chart**: Visualize time-series metrics from InfluxDB
- **Anomaly Analysis**: Analyze device anomalies via FastAPI inference service
- **OTA Deployment**: Deploy OTA updates to devices (metadata stored in MongoDB)
- **Health Check**: Monitor service health status

## Architecture

```
/src
  /routes          - Express route definitions
  /controllers     - Request handlers
  /services        - Business logic layer
  /clients         - Service clients (MinIO, InfluxDB, MongoDB, Elasticsearch)
  /config          - Configuration management
  /utils           - Utility functions and error handlers
/public            - Static frontend pages (HTML/CSS/JS)
```

## Prerequisites

- Node.js 18+
- Access to:
  - MinIO instance
  - InfluxDB instance
  - MongoDB instance
  - Elasticsearch instance
  - FastAPI inference service

## Installation

1. Clone the repository:
```bash
git clone <repository-url>
cd OTAWebserver
```

2. Install dependencies:
```bash
npm install
```

3. Configure environment variables:
```bash
cp .env.example .env
```

Edit `.env` with your service endpoints and credentials:

```env
MINIO_ENDPOINT=localhost:9000
MINIO_ACCESS_KEY=minioadmin
MINIO_SECRET_KEY=minioadmin
MINIO_BUCKET=firmware
INFLUX_URL=http://localhost:8086
INFLUX_TOKEN=your-influx-token
INFLUX_ORG=your-org
INFLUX_BUCKET=metrics
MONGO_URI=mongodb://localhost:27017
MONGO_DB=ota
ES_ENDPOINT=http://localhost:9200
INFERENCE_API=http://localhost:8000
PORT=3000
```

4. Start the server:
```bash
npm start
```

For development with auto-reload:
```bash
npm run dev
```

The server will start on `http://localhost:3000`

## API Endpoints

### Health Check
- `GET /health` - Check service health status

### Firmware
- `POST /api/firmware/upload` - Upload firmware file to MinIO
  - Body: `multipart/form-data` with `firmware` file
  - Optional: `uploadedBy` field

### Logs
- `GET /api/logs` - Query logs from Elasticsearch
  - Query params:
    - `deviceId` (optional) - Filter by device ID
    - `level` (optional) - Filter by log level (DEBUG, INFO, WARN, ERROR)
    - `start` (optional) - Start date (ISO 8601)
    - `end` (optional) - End date (ISO 8601)
    - `limit` (optional) - Result limit (default: 100, max: 1000)

### Metrics
- `GET /api/metrics` - Query time-series metrics from InfluxDB
  - Query params:
    - `deviceId` (optional) - Filter by device ID
    - `measurement` (optional) - Measurement name (default: sensor_data)
    - `start` (optional) - Start date (ISO 8601)
    - `end` (optional) - End date (ISO 8601)
    - `limit` (optional) - Result limit (default: 100, max: 1000)

### Anomaly
- `GET /api/anomaly/:device_id` - Get anomaly analysis for a device
  - Path param: `device_id` - Device ID to analyze

### OTA
- `POST /api/ota/deploy` - Deploy OTA update
  - Body:
    ```json
    {
      "deviceId": "device-123",
      "firmwareVersion": "1.0.0",
      "firmwareUrl": "http://example.com/firmware.bin"
    }
    ```

## Frontend Pages

Access the dashboard at `http://localhost:3000`:

- **Dashboard** (`/`) - Main navigation page
- **Firmware Upload** (`/firmware.html`) - Upload firmware files
- **Logs Viewer** (`/logs.html`) - Query and view logs
- **Metrics Chart** (`/metrics.html`) - Visualize metrics
- **Anomaly Analysis** (`/anomaly.html`) - Analyze device anomalies

## Docker Deployment

1. Build the Docker image:
```bash
docker build -t ota-webserver .
```

2. Run the container:
```bash
docker run -d \
  --name ota-webserver \
  -p 3000:3000 \
  --env-file .env \
  ota-webserver
```

## Kubernetes Deployment

1. Create the ConfigMap:
```bash
kubectl apply -f k8s/configmap.yaml
```

2. Create the Secret (update `k8s/secret.yaml.example` with your values):
```bash
kubectl create secret generic ota-secrets \
  --from-literal=minio-access-key=your-key \
  --from-literal=minio-secret-key=your-secret \
  --from-literal=influx-token=your-token \
  --from-literal=mongo-uri=your-uri
```

3. Deploy the application:
```bash
kubectl apply -f k8s/deployment.yaml
kubectl apply -f k8s/service.yaml
kubectl apply -f k8s/ingress.yaml
```

4. Check deployment status:
```bash
kubectl get pods -l app=ota-webserver
kubectl get svc ota-webserver
```

## Testing

### Test Firmware Upload
```bash
curl -X POST http://localhost:3000/api/firmware/upload \
  -F "firmware=@test.bin" \
  -F "uploadedBy=test-user"
```

### Test Logs Query
```bash
curl "http://localhost:3000/api/logs?deviceId=device-123&limit=10"
```

### Test Metrics Query
```bash
curl "http://localhost:3000/api/metrics?deviceId=device-123&start=2024-01-01T00:00:00Z"
```

### Test Anomaly Analysis
```bash
curl http://localhost:3000/api/anomaly/device-123
```

### Test OTA Deploy
```bash
curl -X POST http://localhost:3000/api/ota/deploy \
  -H "Content-Type: application/json" \
  -d '{
    "deviceId": "device-123",
    "firmwareVersion": "1.0.0",
    "firmwareUrl": "http://example.com/firmware.bin"
  }'
```

### Test Health Check
```bash
curl http://localhost:3000/health
```

## Project Structure

```
OTAWebserver/
├── src/
│   ├── routes/           # Route definitions
│   ├── controllers/      # Request handlers
│   ├── services/         # Business logic
│   ├── clients/          # Service clients
│   ├── config/           # Configuration
│   └── utils/            # Utilities
├── public/               # Static frontend files
├── k8s/                  # Kubernetes manifests
├── index.js              # Main application entry
├── package.json          # Dependencies
├── Dockerfile            # Docker configuration
└── README.md             # This file
```

## Error Handling

All errors are handled centrally through the error handler middleware. Errors include:
- Input validation errors (400)
- Service unavailable errors (503)
- Internal server errors (500)

Error responses follow this format:
```json
{
  "error": {
    "message": "Error description",
    "statusCode": 400
  }
}
```

## Notes

- The server gracefully handles service unavailability during startup
- All service clients are singleton instances for efficiency
- Input validation is performed on all endpoints
- The MinIO bucket is automatically created if it doesn't exist
- MongoDB collections are created automatically on first use

## License

ISC
