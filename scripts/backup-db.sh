#!/usr/bin/env bash
# Backup diario de la base agenda2 (lo corre deploy/agenda2-backup.service como
# el usuario postgres, que entra por socket sin contraseña).
#
#   DESTINO   carpeta de los backups (por defecto /var/backups/agenda2)
#   DIAS      cuántos días se guardan (por defecto 14)
#
# Restaurar (con la app parada):
#   sudo -u postgres pg_restore --clean --if-exists -d agenda2 /var/backups/agenda2/agenda2-AAAA-MM-DD-HHMM.dump
# Los roles no van en el dump: se crean con db/roles.sql.
# Copiá los backups fuera del VPS cada tanto (si se pierde el servidor, se pierden con él).
set -euo pipefail

DESTINO="${DESTINO:-/var/backups/agenda2}"
DIAS="${DIAS:-14}"
BASE="${BASE:-agenda2}"

umask 077
mkdir -p "$DESTINO"

archivo="$DESTINO/agenda2-$(date +%F-%H%M).dump"
pg_dump --format=custom --compress=9 --dbname="$BASE" --file="$archivo.tmp"
mv "$archivo.tmp" "$archivo"

find "$DESTINO" -maxdepth 1 -name 'agenda2-*.dump' -mtime "+$DIAS" -delete
echo "Backup listo: $archivo ($(du -h "$archivo" | cut -f1))"
