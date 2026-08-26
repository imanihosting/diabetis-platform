# Database VM

Host for PostgreSQL 17, TimescaleDB, and pgvector.

| | |
|---|---|
| Address | `10.10.5.185` |
| SSH user | `support` |
| Database | `diabetes` |
| Application role | `diabetes_app` |
| Port | `5432` (restricted to the private LAN and the VPN client subnet) |

## Credentials

Not stored in this repository. The application reads them from the repo-root
`.env`, which is gitignored — copy `.env.example` and fill it in from the team
password manager.

Reachability note: the VMs sit on `10.10.0.0/16`, but developer machines arrive
over the VPN from `192.168.3.0/24`. Firewall and `pg_hba.conf` rules need both
ranges, or a healthy database will still refuse developer connections.

## Provisioning

`scripts/provision-db.sh` rebuilds this host from a clean Ubuntu 26.04 install.
See [infra/README.md](../infra/README.md) for what it installs and which
guarantees the schema enforces.
