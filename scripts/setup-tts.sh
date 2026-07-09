#!/usr/bin/env bash
# Descarga el binario Piper (TTS neuronal) + un modelo de voz en español a vendor/tts/.
# Deja listas las rutas para PIPER_BIN / PIPER_MODEL.
#
# Uso:  bash scripts/setup-tts.sh [voz]
#   bash scripts/setup-tts.sh                       # descarga la voz por defecto (sharvard)
#   bash scripts/setup-tts.sh es_AR-daniela-high    # descarga otra voz de la lista
#   bash scripts/setup-tts.sh list                  # solo muestra las voces disponibles
#
# ── Voces en español disponibles (Piper) ─────────────────────────────
#   España (es_ES):
#     es_ES-sharvard-medium   multi-voz: 0=hombre, 1=mujer  (por defecto; usa PIPER_SPEAKER)
#     es_ES-davefx-medium     hombre
#     es_ES-carlfm-x_low      hombre (calidad baja, más liviano)
#     es_ES-mls_9972-low      hombre (calidad baja)
#     es_ES-mls_10246-low     hombre (calidad baja)
#   México (es_MX):
#     es_MX-claude-high       mujer (alta calidad)
#     es_MX-ald-medium        hombre
#   Argentina (es_AR):
#     es_AR-daniela-high      mujer (alta calidad)
# ─────────────────────────────────────────────────────────────────────
set -euo pipefail

VOZ="${1:-es_ES-sharvard-medium}"

if [ "$VOZ" = "list" ] || [ "$VOZ" = "--list" ]; then
  awk '/^# ── Voces/{f=1;next} f&&/^# ─/{exit} f{sub(/^# ?/,"");print}' "$0"
  exit 0
fi

RAIZ="$(cd "$(dirname "$0")/.." && pwd)"
DEST="$RAIZ/vendor/tts"
MODELOS="$DEST/models"
PIPER_VER="2023.11.14-2"
PIPER_URL="https://github.com/rhasspy/piper/releases/download/${PIPER_VER}/piper_linux_x86_64.tar.gz"

# La ruta en HuggingFace se deriva del id de la voz: es_ES-sharvard-medium -> es/es_ES/sharvard/medium
IFS='-' read -r LOCALE NAME QUALITY <<< "$VOZ"
LANG="${LOCALE%%_*}"
MODEL_BASE="https://huggingface.co/rhasspy/piper-voices/resolve/main/$LANG/$LOCALE/$NAME/$QUALITY"
MODEL_FILE="$VOZ.onnx"

mkdir -p "$DEST" "$MODELOS"

echo "==> Descargando Piper ($PIPER_VER)…"
curl -fL "$PIPER_URL" -o "$DEST/piper.tar.gz"
tar -xzf "$DEST/piper.tar.gz" -C "$DEST"        # crea $DEST/piper/piper
rm -f "$DEST/piper.tar.gz"

echo "==> Descargando modelo de voz ($MODEL_FILE)…"
curl -fL "$MODEL_BASE/$MODEL_FILE"      -o "$MODELOS/$MODEL_FILE"
curl -fL "$MODEL_BASE/$MODEL_FILE.json" -o "$MODELOS/$MODEL_FILE.json"

echo ""
echo "Listo. Añade a tu .env:"
echo "  TTS_ENGINE=piper"
echo "  PIPER_BIN=$DEST/piper/piper"
echo "  PIPER_MODEL=$MODELOS/$MODEL_FILE"
if [ "$NAME" = "sharvard" ]; then
  echo "  PIPER_SPEAKER=1          # sharvard tiene 2 voces; la 1 es la femenina"
fi
echo "  PIPER_LENGTH_SCALE=1.25  # ritmo (mayor = más lento)"
echo "  PIPER_SENTENCE_SILENCE=0.4"
