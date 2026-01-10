#!/bin/sh
set -eu

# Run database migrations first
echo "Running Medusa database migrations..."
corepack enable >/dev/null 2>&1 || true
npx medusa db:migrate || {
  echo "Database migrations failed. Continuing anyway..." >&2
}

should_seed="${RUN_SEED:-false}"
admin_email="${MEDUSA_ADMIN_EMAIL:-}"
admin_password="${MEDUSA_ADMIN_PASSWORD:-}"
seed_marker="/server/.seeded"

if [ "$should_seed" = "true" ]; then
  if [ -z "$admin_email" ] || [ -z "$admin_password" ]; then
    echo "MEDUSA_ADMIN_EMAIL and MEDUSA_ADMIN_PASSWORD must be set when RUN_SEED=true" >&2
    exit 1
  fi

  if [ ! -f "$seed_marker" ]; then
    echo "Running Medusa seed script..."
    corepack enable >/dev/null 2>&1 || true
    yarn seed
    echo "Creating Medusa admin user..."
    npx medusa user --email "$admin_email" --password "$admin_password"
    touch "$seed_marker"
  else
    echo "Seed marker found at $seed_marker, skipping seed and admin creation."
  fi
fi

exec "$@"
