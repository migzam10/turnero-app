#!/usr/bin/env bash
# ============================================================================
#  Genera las builds de Chrome Web Store de las dos extensiones del Turnero.
#
#  Para cada extension produce DOS salidas con el MISMO contenido:
#    build/<Nombre>/                  -> carpeta para "Cargar descomprimida"
#                                        (chrome://extensions, modo desarrollador)
#    store-zips/<Nombre>-store.zip    -> archivo que se sube a la Web Store
#
#  Probar SIEMPRE la carpeta de build/, no la carpeta fuente: la fuente lleva
#  "key" y (en el Injector) "host_permissions" que la build de tienda no tiene,
#  asi que la fuente puede funcionar y la build fallar. Ver LEEME_EXTENSION.txt.
#
#  Uso:  bash extension/deploy/build-store.sh [Biofile-Injector|Biofile-Sync]
#        sin argumento construye las dos.
# ============================================================================
set -euo pipefail

DEPLOY_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SRC_ROOT="$(dirname "$DEPLOY_DIR")"
BUILD_DIR="$DEPLOY_DIR/build"
ZIP_DIR="$DEPLOY_DIR/store-zips"

EXTENSIONES=("${@:-}")
if [ -z "${EXTENSIONES[0]}" ]; then
    EXTENSIONES=("Biofile-Injector" "Biofile-Sync")
fi

mkdir -p "$ZIP_DIR"

for NOMBRE in "${EXTENSIONES[@]}"; do
    SRC="$SRC_ROOT/$NOMBRE"
    OUT="$BUILD_DIR/$NOMBRE"
    ZIP="$ZIP_DIR/$NOMBRE-store.zip"

    if [ ! -f "$SRC/manifest.json" ]; then
        echo "[ERROR] No existe $SRC/manifest.json" >&2
        exit 1
    fi

    echo "=== $NOMBRE ==="
    rm -rf "$OUT"
    mkdir -p "$OUT"

    # --- Archivos de runtime -------------------------------------------------
    # Se copia solo lo que la extension necesita para correr. Quedan fuera a
    # proposito: config.example.js e icon.svg (material del repo, no del paquete)
    # y cualquier .png que no sea un icono declarado (capturas de la tienda,
    # que viven en store-assets/).
    for f in "$SRC"/*.js "$SRC"/*.html "$SRC"/*.css; do
        [ -e "$f" ] || continue
        case "$(basename "$f")" in
            config.example.js) continue ;;
        esac
        cp "$f" "$OUT/"
    done
    for icono in icon16.png icon48.png icon128.png; do
        [ -e "$SRC/$icono" ] && cp "$SRC/$icono" "$OUT/"
    done

    # --- config.js en blanco -------------------------------------------------
    # NUNCA se copia el config.js local: puede tener la IP y el secreto de un
    # cliente. Se regenera desde config.example.js con los valores vaciados;
    # cada terminal los pone en el engranaje del popup.
    python3 - "$SRC/config.example.js" "$OUT/config.js" <<'PY'
import re, sys
src, dst = sys.argv[1], sys.argv[2]
txt = open(src, encoding="utf-8").read()
for clave in ("SERVER_URL", "EXTENSION_SECRET"):
    txt = re.sub(rf"({clave}\s*:\s*)'[^']*'", rf"\1''", txt)
open(dst, "w", encoding="utf-8").write(txt)
PY

    # --- manifest de tienda --------------------------------------------------
    #  - "key": lo asigna Google al publicar; si va incluido, la subida falla.
    #  - Injector: se quita host_permissions ("http://*/*" es un permiso amplio
    #    que complica la revision). El fetch del popup al servidor funciona por
    #    las cabeceras CORS que ya manda app/server.js. El Sync SI lo conserva
    #    porque el suyo es acotado a biofile.com.co.
    python3 - "$SRC/manifest.json" "$OUT/manifest.json" "$NOMBRE" <<'PY'
import collections, json, sys
src, dst, nombre = sys.argv[1], sys.argv[2], sys.argv[3]
m = json.load(open(src, encoding="utf-8"), object_pairs_hook=collections.OrderedDict)
m.pop("key", None)
if nombre == "Biofile-Injector":
    m.pop("host_permissions", None)
with open(dst, "w", encoding="utf-8") as fh:
    json.dump(m, fh, indent=2, ensure_ascii=False)
    fh.write("\n")
print("  version:", m["version"])
for cs in m.get("content_scripts", []):
    print("  matches:", ", ".join(cs["matches"]))
PY

    # --- Validaciones --------------------------------------------------------
    # Fallan antes de generar el zip, no despues de subirlo.
    python3 - "$OUT" <<'PY'
import json, re, sys, pathlib
out = pathlib.Path(sys.argv[1])
m = json.load(open(out / "manifest.json", encoding="utf-8"))
assert "key" not in m, "el manifest conserva 'key'"
cfg = (out / "config.js").read_text(encoding="utf-8")
for clave in ("SERVER_URL", "EXTENSION_SECRET"):
    valor = re.search(rf"{clave}\s*:\s*'([^']*)'", cfg)
    assert valor and valor.group(1) == "", f"{clave} no quedo vacio en config.js"
for archivo in m.get("content_scripts", [{}])[0].get("js", []) + [m.get("background", {}).get("service_worker")]:
    assert not archivo or (out / archivo).exists(), f"falta {archivo}"
for icono in m.get("icons", {}).values():
    assert (out / icono).exists(), f"falta {icono}"
PY

    # --- Zip plano (sin carpeta raiz, sin .DS_Store) -------------------------
    rm -f "$ZIP"
    ( cd "$OUT" && zip -q -X -r "$ZIP" . -x ".*" "__MACOSX/*" )

    echo "  carpeta : $OUT"
    echo "  zip     : $ZIP  ($(du -h "$ZIP" | cut -f1 | tr -d ' '))"
    echo "  archivos: $(find "$OUT" -type f | wc -l | tr -d ' ')"
    echo
done

echo "Listo. Para PROBAR antes de subir:"
echo "  chrome://extensions -> Modo desarrollador -> Cargar descomprimida"
echo "  -> elegir la carpeta dentro de $BUILD_DIR"
