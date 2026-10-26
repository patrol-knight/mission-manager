FROM python:3.10-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Optional: the "heatmap" build context is the heatmap repo (package heatmap-estimator), or an empty dir.
COPY --from=heatmap . /opt/heatmap
RUN if [ -f /opt/heatmap/pyproject.toml ]; then pip install --no-cache-dir /opt/heatmap; fi

COPY . .

CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8000"]
