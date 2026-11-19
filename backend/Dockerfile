FROM python:3.10-slim

WORKDIR /app

COPY pyproject.toml .
# Dependency groups need pip >= 25.1.
RUN pip install --no-cache-dir -U "pip>=25.1" && pip install --no-cache-dir --group app

COPY . .

CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8000"]
