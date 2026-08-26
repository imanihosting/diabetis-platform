#!/usr/bin/env bash
# Provision PostgreSQL 17 + TimescaleDB + pgvector on Ubuntu 26.04 (resolute)
set -euo pipefail

PG_VERSION=17
export DEBIAN_FRONTEND=noninteractive

log() { echo "=== $* ==="; }

log "1/9 base packages"
apt-get update -qq
apt-get install -y -qq curl gnupg2 ca-certificates lsb-release apt-transport-https ufw >/dev/null

log "2/9 PGDG repo"
install -d -m 0755 /usr/share/keyrings
curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc \
  | gpg --dearmor -o /usr/share/keyrings/pgdg.gpg
echo "deb [signed-by=/usr/share/keyrings/pgdg.gpg] http://apt.postgresql.org/pub/repos/apt resolute-pgdg main" \
  > /etc/apt/sources.list.d/pgdg.list

log "3/9 TimescaleDB repo"
curl -fsSL https://packagecloud.io/timescale/timescaledb/gpgkey \
  | gpg --dearmor -o /usr/share/keyrings/timescaledb.gpg
echo "deb [signed-by=/usr/share/keyrings/timescaledb.gpg] https://packagecloud.io/timescale/timescaledb/ubuntu/ resolute main" \
  > /etc/apt/sources.list.d/timescaledb.list

apt-get update -qq

log "4/9 install postgresql-${PG_VERSION} + extensions"
apt-get install -y -qq \
  "postgresql-${PG_VERSION}" \
  "postgresql-client-${PG_VERSION}" \
  "postgresql-contrib-${PG_VERSION}" \
  "postgresql-${PG_VERSION}-pgvector" \
  "timescaledb-2-postgresql-${PG_VERSION}" \
  timescaledb-tools >/dev/null

log "5/9 timescaledb-tune"
timescaledb-tune --quiet --yes --pg-config "/usr/lib/postgresql/${PG_VERSION}/bin/pg_config" \
  --conf-path "/etc/postgresql/${PG_VERSION}/main/postgresql.conf" || true

log "6/9 network + tuning config"
CONF_D="/etc/postgresql/${PG_VERSION}/main/conf.d"
install -d -m 0755 "$CONF_D"
cat > "${CONF_D}/10-diabetes-platform.conf" <<'EOF'
# Managed by diabetes-platform provisioning. Edit here, not postgresql.conf.
listen_addresses = '*'
port = 5432
max_connections = 200

# Logging
log_min_duration_statement = 500
log_checkpoints = on
log_connections = on
log_disconnections = on
log_line_prefix = '%m [%p] %q%u@%d '
log_timezone = 'UTC'
timezone = 'UTC'

# Safety / retention
password_encryption = 'scram-sha-256'
EOF

log "7/9 pg_hba"
HBA="/etc/postgresql/${PG_VERSION}/main/pg_hba.conf"
if ! grep -q 'diabetes-platform' "$HBA"; then
cat >> "$HBA" <<'EOF'

# --- diabetes-platform: application access from the private LAN ---
host    all             all             10.10.0.0/16            scram-sha-256
EOF
fi

log "8/9 restart postgres"
systemctl enable postgresql >/dev/null 2>&1 || true
systemctl restart postgresql
sleep 3
systemctl is-active postgresql

log "9/9 firewall"
ufw allow 22/tcp >/dev/null 2>&1 || true
ufw allow from 10.10.0.0/16 to any port 5432 proto tcp >/dev/null 2>&1 || true
ufw --force enable >/dev/null 2>&1 || true
ufw status numbered || true

log "versions"
sudo -u postgres psql -tAc "select version();"
