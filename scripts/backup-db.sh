#!/usr/bin/env bash
# Backup diario de la BD del turnero. Pensado para cron en el host que corre Docker.
# Uso: ./scripts/backup-db.sh [dir_destino]   (default: ./backups)
#
# Restaurar un backup:
#   docker exec -i turnero_db pg_restore -U turnero_user -d turnero --clean < archivo.dump
set -euo pipefail
DEST="${1:-$(dirname "$0")/../backups}"
mkdir -p "$DEST"
STAMP=$(date +%Y%m%d_%H%M%S)
docker exec turnero_db pg_dump -U turnero_user -d turnero --format=custom \
    > "$DEST/turnero_$STAMP.dump"
# Retención: conserva los últimos 30 backups
ls -1t "$DEST"/turnero_*.dump 2>/dev/null | tail -n +31 | xargs -r rm --
echo "[backup] OK → $DEST/turnero_$STAMP.dump"
