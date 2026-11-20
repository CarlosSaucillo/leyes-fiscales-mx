#!/bin/zsh
# Sube los cambios del buscador a GitHub (CarlosSaucillo/leyes-fiscales-mx).
clear
echo "=== Subir leyes fiscales a GitHub ==="
echo ""
echo "Solo la PRIMERA vez pedirá 'Password': PEGA tu token de GitHub (ghp_...)."
echo "Al pegar no se ve nada: es normal. Luego presiona Enter."
echo "La Mac lo guarda en el Llavero y las siguientes veces ya no lo pide."
echo ""
cd "$(dirname "$0")" || { echo "No encontré la carpeta"; read; exit 1; }
# El usuario va en la dirección para que el Llavero use la cuenta CarlosSaucillo
# (y no la otra cuenta de GitHub guardada en esta Mac).
git remote set-url origin https://CarlosSaucillo@github.com/CarlosSaucillo/leyes-fiscales-mx.git
git push origin main
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
