#!/bin/sh
set -eu

node scripts/init-db.mjs
exec "$@"
