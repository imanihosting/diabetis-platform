# Metabolic Intelligence Service

FastAPI service that owns the platform's scientific computation.

## What it owns

- Pattern detection
- Prediction generation and confidence scoring
- Causal analysis and hypothesis ranking
- Experiment design support and result analysis
- Model accountability

## What it does not own

Application state, user workflows, permissions, or clinical decisions. Those
belong to the NestJS backend.

## The safety flow

```
Raw data → quantitative model → structured finding (confidence + evidence)
        → optional LLM phrasing → human-readable explanation
```

A language model may only rephrase a finding that already exists. It must never
create one. Every finding carries an effect estimate, a confidence, a sample
count, and explicit limitations.

## Running locally

```bash
python3 -m venv .venv && source .venv/bin/activate
pip install -e ".[dev]"
uvicorn app.main:app --reload --port 8000
```

Configuration is read from the repo-root `.env`.

## Tests

```bash
pytest
```
