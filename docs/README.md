# Diabetes Platform Work Pack

This folder contains the first build pack for the Type 2 diabetes platform.

The carried-forward direction is:

- PostgreSQL is the primary database.
- Next.js, React, and TypeScript power the web product.
- NestJS is the core backend.
- Python and FastAPI power the metabolic intelligence service.
- TimescaleDB handles dense time-series data such as CGM readings.
- pgvector stores semantic observations, explanations, and retrieved knowledge.
- Redis handles queues, caching, and short-lived coordination.
- S3-compatible storage holds imported documents, device exports, and generated reports.
- FHIR-oriented integration keeps health data portable and clinician-facing.
- The product must be differentiated as a causal Type 2 diabetes platform, not a standard tracker.

## Files

- [Technical Architecture](./technical-architecture.md)
- [Data Model](./data-model.md)
- [Build Roadmap](./build-roadmap.md)

## Product Thesis

Most diabetes tools track what happened. This platform should help a person understand what their own body is likely doing, what remains uncertain, and what safe next observation or behavior experiment could reduce that uncertainty.

The product primitive is not "log glucose." It is:

> Turn everyday diabetes data into personal, testable metabolic evidence.

