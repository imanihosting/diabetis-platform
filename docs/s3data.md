# Object Storage

MinIO, S3-compatible. Holds meal photos, device exports, imported documents,
and generated clinician packets. Postgres stores only the object key.

| | |
|---|---|
| API endpoint | `http://10.10.5.240:9000` |
| Console | `http://10.10.5.240:9001` |
| SSH user | `support` |
| Bucket | `medicaldata` |
| Key prefix | `diabetes-platform/` |

## Credentials

Not stored in this repository. The application reads them from the repo-root
`.env`, which is gitignored — copy `.env.example` and fill it in from the team
password manager.

The platform authenticates with a **scoped service account**, not the MinIO
root account. This instance is shared with unrelated buckets
(`coolify-backups`, `blaquesoulstudio`), and the service account's policy
grants access to `medicaldata` alone — it is denied the others.

Everything the platform writes is namespaced under `diabetes-platform/` and
partitioned by user id. Object keys are opaque UUIDs and the bucket is not
public; browsers receive short-lived presigned URLs, never raw keys.
