FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    UV_SYSTEM_PYTHON=1 \
    UV_LINK_MODE=copy

WORKDIR /app

# Install uv (fast Python package manager)
RUN pip install --no-cache-dir uv==0.5.4

# Install dependencies first (better caching)
COPY pyproject.toml ./
RUN uv pip install --system -r pyproject.toml

# Copy the rest of the source code
COPY . .

EXPOSE 8000

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
