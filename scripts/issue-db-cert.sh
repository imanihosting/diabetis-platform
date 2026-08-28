#!/usr/bin/env bash
# Give PostgreSQL a certificate this platform's clients can verify.
#
#   scp scripts/issue-db-cert.sh support@10.10.5.185:/tmp/
#   ssh support@10.10.5.185 'sudo bash /tmp/issue-db-cert.sh'
#
# Creates an internal CA and one server certificate, installs them, and points
# PostgreSQL at them. Idempotent by refusal: it will not overwrite an existing
# certificate, so reissuing means deleting the old one deliberately.
#
# Why an internal CA rather than Let's Encrypt. Every client of this database
# is ours — two containers and a migration runner on the private network — so
# public trust buys nothing, and paying for it would mean a third party in the
# trust path of a health record, a token on the database host, an outbound
# dependency, and a ninety-day renewal that fails quietly. A CA we issue for
# ten years has none of those. The cost is that the CA certificate has to reach
# three clients, which it does: infra/db/ca.crt is committed, because a CA
# certificate is a public trust anchor and not a secret.
#
# The CA private key stays here, root-only, and signs one thing. If this host is
# lost, reissue and replace infra/db/ca.crt — there is no revocation
# infrastructure and for one certificate there does not need to be.
set -euo pipefail

SSL_DIR=/etc/postgresql/ssl
CA_DIR=/etc/postgresql/ca
FQDN="${FQDN:-medical-db}"
IP="${IP:-10.10.5.185}"
PG="${PG:-17}"

log() { echo "=== $* ==="; }
[[ $EUID -eq 0 ]] || { echo "run as root" >&2; exit 2; }

if [[ -f "$SSL_DIR/server.crt" ]]; then
  echo "$SSL_DIR/server.crt exists; refusing to overwrite. Remove it to reissue." >&2
  exit 3
fi

log "1/6 directories"
install -d -m 0700 -o root -g root "$CA_DIR"
install -d -m 0750 -o postgres -g postgres "$SSL_DIR"

log "2/6 certificate authority (10 years)"
openssl req -x509 -new -nodes -newkey rsa:4096 -sha256 -days 3650 \
  -subj "/O=Wellovue/CN=Wellovue Internal CA" \
  -keyout "$CA_DIR/ca.key" -out "$CA_DIR/ca.crt" 2>/dev/null
chmod 0600 "$CA_DIR/ca.key"
chmod 0644 "$CA_DIR/ca.crt"

log "3/6 server key and request"
openssl req -new -nodes -newkey rsa:2048 -sha256 \
  -subj "/O=Wellovue/CN=$FQDN" \
  -keyout "$SSL_DIR/server.key" -out "$CA_DIR/server.csr" 2>/dev/null

log "4/6 sign, for both the name and the address"
# The name is what clients verify against: node-postgres only tells Node which
# host to check when the host is not an IP (pg/lib/connection.js), so an
# address in DATABASE_URL can never reach verify-full whatever the certificate
# says. The IP SAN is there anyway for psql and psycopg, which do match it, and
# so that a client connecting by address still gets a certificate about itself.
cat > "$CA_DIR/server.ext" <<EXT
subjectAltName = DNS:$FQDN, IP:$IP
basicConstraints = CA:FALSE
keyUsage = digitalSignature, keyEncipherment
extendedKeyUsage = serverAuth
EXT
openssl x509 -req -in "$CA_DIR/server.csr" \
  -CA "$CA_DIR/ca.crt" -CAkey "$CA_DIR/ca.key" -CAcreateserial \
  -days 1825 -sha256 -extfile "$CA_DIR/server.ext" \
  -out "$SSL_DIR/server.crt" 2>/dev/null

log "5/6 permissions PostgreSQL will accept"
# It refuses to start if the key is group- or world-readable, so this is
# checked here rather than discovered on the next restart.
chown postgres:postgres "$SSL_DIR/server.key" "$SSL_DIR/server.crt"
chmod 0600 "$SSL_DIR/server.key"
chmod 0644 "$SSL_DIR/server.crt"
sudo -u postgres test -r "$SSL_DIR/server.key"
openssl verify -CAfile "$CA_DIR/ca.crt" "$SSL_DIR/server.crt"

log "6/6 point PostgreSQL at it and reload"
# A drop-in rather than an edit: include_dir sits near the end of
# postgresql.conf, after the packaged ssl_cert_file, so this wins. Deleting
# this one file reverts to the snakeoil certificate.
cat > "/etc/postgresql/$PG/main/conf.d/20-ssl.conf" <<CONF
# Managed by scripts/issue-db-cert.sh. Delete to fall back to snakeoil.
ssl = on
ssl_cert_file = '$SSL_DIR/server.crt'
ssl_key_file = '$SSL_DIR/server.key'
CONF
systemctl reload "postgresql@$PG-main"
sleep 1

echo ""
openssl x509 -in "$SSL_DIR/server.crt" -noout -subject -issuer -enddate
openssl x509 -in "$SSL_DIR/server.crt" -noout -ext subjectAltName
echo ""
echo "Copy this into infra/db/ca.crt — it is what every client must trust:"
cat "$CA_DIR/ca.crt"
