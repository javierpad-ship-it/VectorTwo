#!/usr/bin/env bash
# Corre los humos SQL (scripts/humo-*.sql) contra la base ya migrada y FALLA si alguno tiene un caso en falso.
#
# Los humos están escritos para leerse a ojo (`ok = t` / `fallos = 0`); este runner los lee por máquina. Un humo se da por malo si:
#   * psql no pudo ejecutarlo (exit distinto de 0);
#   * imprime una fila de resultado en falso: una línea que termina en `| f` o que es solo `f`;
#   * su resumen dice `fallos > 0` o `sin_resultado > 0` (línea `comprobaciones | fallos | sin_resultado`);
#   * imprime un `ERROR:` que no esté tolerado (ver abajo), o
#   * no imprime ningún veredicto (ni resumen ni columna `ok`): un humo mudo no prueba nada.
#
# Tolerancias, explícitas y cortas (todo lo demás es estricto):
#   * HUMOS_CON_ERRORES_ESPERADOS: humos antiguos de bloques `begin … rollback` cuyo resultado esperado ES un error (checks, FK,
#     permisos). Se tolera `ERROR:`, pero siguen valiendo las filas en falso.
#   * HUMOS_OMITIDOS: humos que no se pueden correr solos. `humo-0018` pide un fixture de M7 que no está en el repo; se omite con
#     aviso (sus comprobaciones de permisos las repiten las pruebas de tests/integracion/).
# Un humo nuevo (p. ej. humo-0035) entra solo, por el glob, y se juzga con las reglas estrictas.
#
# Uso:
#   scripts/correr-humos.sh                  # todos los humos
#   scripts/correr-humos.sh scripts/humo-0034.sql ...
# Conexión: igual que scripts/validar-migraciones-local.sh (DATABASE_URL, PGHOST o clúster local); la base debe estar migrada
# (corre antes scripts/validar-migraciones-local.sh). Los humos escriben datos de prueba dentro de una transacción que termina en
# `rollback`; no los corras contra un Supabase (el candado de host de lib-pg.sh lo impide).
set -uo pipefail

cd "$(dirname "$0")/.."
# shellcheck source=scripts/lib-pg.sh
source scripts/lib-pg.sh
vt_resolver_conexion

HUMOS_CON_ERRORES_ESPERADOS=(humo-0019-0020 humo-0021 humo-0024)
HUMOS_OMITIDOS=(humo-0018)

export PGOPTIONS="${PGOPTIONS:-} -c client_min_messages=warning"
SALIDA_DIR="$(mktemp -d)"
trap 'rm -rf "$SALIDA_DIR"' EXIT

esta_en() {
  local x="$1"
  shift
  local y
  for y in "$@"; do [ "$x" = "$y" ] && return 0; done
  return 1
}

if [ "$#" -gt 0 ]; then
  archivos=("$@")
else
  shopt -s nullglob
  archivos=(scripts/humo-*.sql)
fi
if [ "${#archivos[@]}" -eq 0 ]; then
  echo "ERROR: no hay humos que correr" >&2
  exit 1
fi

# La base tiene que existir y estar migrada.
if ! vt_psql -Atc "select to_regclass('public.compras') is not null" 2>/dev/null | grep -q t; then
  echo "ERROR: la base '$VT_DB' no existe o no esta migrada. Corre antes scripts/validar-migraciones-local.sh" >&2
  exit 2
fi

malos=0
total=0
omitidos=0
for f in "${archivos[@]}"; do
  nombre="$(basename "$f" .sql)"
  if esta_en "$nombre" "${HUMOS_OMITIDOS[@]}"; then
    echo "OMITIDO  $nombre (necesita un fixture que no esta en el repo)"
    omitidos=$((omitidos + 1))
    continue
  fi
  total=$((total + 1))
  out="$SALIDA_DIR/$nombre.out"
  inicio=$(date +%s)
  vt_psql_archivo "$f" >"$out" 2>&1
  rc=$?
  fin=$(date +%s)
  motivos=()

  [ "$rc" -ne 0 ] && motivos+=("psql termino con codigo $rc")

  filas_f="$(grep -nE '(\|[[:space:]]*f[[:space:]]*$)|(^[[:space:]]*f[[:space:]]*$)' "$out" || true)"
  [ -n "$filas_f" ] && motivos+=("casos en falso:"$'\n'"$filas_f")

  resumen="$(awk '/comprobaciones[[:space:]]*\|[[:space:]]*fallos/ { getline; getline; print; exit }' "$out")"
  if [ -n "$resumen" ]; then
    fallos="$(echo "$resumen" | awk -F'|' '{gsub(/[[:space:]]/, "", $2); print $2}')"
    sinres="$(echo "$resumen" | awk -F'|' '{gsub(/[[:space:]]/, "", $3); print $3}')"
    [ "${fallos:-0}" != 0 ] && motivos+=("resumen: fallos = $fallos")
    [ "${sinres:-0}" != 0 ] && motivos+=("resumen: sin_resultado = $sinres")
  elif ! grep -qE '(\|[[:space:]]*ok[[:space:]]*$)|(^[[:space:]]*ok[[:space:]]*$)|fallos' "$out"; then
    motivos+=("no imprime ningun veredicto (ni resumen ni columna ok)")
  fi

  if ! esta_en "$nombre" "${HUMOS_CON_ERRORES_ESPERADOS[@]}"; then
    errores="$(grep -n 'ERROR:' "$out" | head -5 || true)"
    [ -n "$errores" ] && motivos+=("errores de SQL no esperados:"$'\n'"$errores")
  fi

  if [ "${#motivos[@]}" -eq 0 ]; then
    printf 'OK       %s (%ss)\n' "$nombre" "$((fin - inicio))"
  else
    malos=$((malos + 1))
    printf 'FALLA    %s (%ss)\n' "$nombre" "$((fin - inicio))"
    for m in "${motivos[@]}"; do echo "$m" | cut -c1-240 | sed 's/^/           /'; done
  fi
done

echo
echo "Humos: $total corridos, $((total - malos)) bien, $malos con fallos, $omitidos omitidos."
if [ "$malos" -gt 0 ]; then
  exit 1
fi
