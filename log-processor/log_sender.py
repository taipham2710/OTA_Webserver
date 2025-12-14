import random
import time
from datetime import datetime, timedelta

import requests


SEVERITIES = ["INFO", "WARN", "ERROR"]


def generate_random_log(i):
    device_id = f"device-{random.randint(1, 5)}"
    base_time = datetime.utcnow() - timedelta(minutes=5)
    ts = base_time + timedelta(seconds=i * random.randint(1, 5))

    payload = {
        "device_id": device_id,
        "timestamp": ts.isoformat() + "Z",
        "log": f"Test log message {i} from {device_id}",
        "severity": random.choice(SEVERITIES),
        "sensor_temperature": round(random.uniform(20.0, 30.0), 2),
        "sensor_humidity": round(random.uniform(30.0, 60.0), 2),
    }

    if random.random() < 0.3:
        payload["sensor_voltage"] = round(random.uniform(3.0, 5.0), 2)

    return payload


def main():
    url = "http://localhost:4000/ingest"

    for i in range(50):
        payload = generate_random_log(i)
        try:
            resp = requests.post(url, json=payload, timeout=3)
            print(i, resp.status_code, resp.text)
        except Exception as exc:
            print(i, "ERROR", exc)
        time.sleep(0.1)


if __name__ == "__main__":
    main()

{
  "cells": [],
  "metadata": {
    "language_info": {
      "name": "python"
    }
  },
  "nbformat": 4,
  "nbformat_minor": 2
}