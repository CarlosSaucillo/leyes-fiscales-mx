#!/bin/zsh
# Abre el buscador de legislación fiscal en tu navegador (doble clic).
# Deja esta ventana abierta mientras lo usas; ciérrala para apagarlo.
cd "$(dirname "$0")" || exit 1
PUERTO=8000
clear
echo "=== Buscador de legislación fiscal ==="
echo ""
echo "Abriendo http://localhost:$PUERTO en tu navegador…"
echo "Deja esta ventana abierta mientras lo usas. Para apagarlo, ciérrala."
echo ""
(sleep 1 && open "http://localhost:$PUERTO") &
python3 scripts/servidor.py $PUERTO
