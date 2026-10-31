FROM python:3.10-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Skipped when the modules/heatmap submodule is not checked out.
COPY --from=heatmap . /opt/heatmap
RUN if [ -f /opt/heatmap/pyproject.toml ]; then pip install --no-cache-dir /opt/heatmap; fi

COPY . .

CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8000"]
