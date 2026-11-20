#!/bin/zsh
# Sube los cambios del buscador a GitHub (CarlosSaucillo/leyes-fiscales-mx).
clear
echo "=== Subir leyes fiscales a GitHub ==="
echo ""
echo "Cuando pida 'Password' PEGA tu token de GitHub (ghp_...)."
echo "Al pegar no se ve nada: es normal. Luego presiona Enter."
echo ""
cd "$(dirname "$0")" || { echo "No encontré la carpeta"; read; exit 1; }
# Se ignora la cuenta guardada en el llavero (es otra cuenta de GitHub) para que pida la de CarlosSaucillo.
git -c credential.helper= push https://CarlosSaucillo@github.com/CarlosSaucillo/leyes-fiscales-mx.git main
if [ $? -eq 0 ]; then
  echo ""
  echo "✅ ¡Listo! Los cambios ya están en GitHub."
  echo "Si Cloudflare Pages ya está conectado, el sitio se actualiza solo en 1-2 minutos."
else
  echo ""
  echo "❌ Algo falló. Toma captura de esta ventana y muéstrasela a Claude."
fi
echo ""
echo "(Puedes cerrar esta ventana)"
read
