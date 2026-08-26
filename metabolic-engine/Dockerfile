# Build context is the metabolic-engine directory:
#
#   docker build -f metabolic-engine/Dockerfile metabolic-engine

FROM python:3.12-slim AS build
WORKDIR /app
ENV PIP_DISABLE_PIP_VERSION_CHECK=1 PIP_NO_CACHE_DIR=1

# Install dependencies from the manifest alone, so editing engine code does
# not reinstall numpy/pandas/scipy.
COPY pyproject.toml ./
RUN python -m venv /opt/venv \
 && /opt/venv/bin/pip install --upgrade pip \
 && mkdir -p app && touch app/__init__.py \
 && /opt/venv/bin/pip install .

FROM python:3.12-slim AS runtime
ENV PATH="/opt/venv/bin:$PATH" \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1
WORKDIR /app

COPY --from=build /opt/venv /opt/venv
COPY app ./app

RUN useradd --create-home --uid 1001 engine
USER engine
EXPOSE 8000

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]

# --- test -------------------------------------------------------------------
FROM build AS test
ENV PATH="/opt/venv/bin:$PATH" PYTHONUNBUFFERED=1
WORKDIR /app
COPY pyproject.toml ./
COPY app ./app
COPY tests ./tests
RUN /opt/venv/bin/pip install -e ".[dev]"
CMD ["python", "-m", "pytest", "-q"]
