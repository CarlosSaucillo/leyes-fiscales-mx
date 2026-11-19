#!/usr/bin/env python3
"""Servidor local para probar el buscador (sirve la carpeta web/).

A diferencia de `python3 -m http.server`, le pide al navegador que revise siempre si hay
archivos nuevos (Cache-Control: no-cache). Así, después de actualizar el código o los datos,
basta con recargar la página.

Uso:  python3 scripts/servidor.py [puerto]
"""
import functools
import http.server
import sys
from pathlib import Path

WEB = Path(__file__).resolve().parent.parent / "web"


class SinCache(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-cache")
        super().end_headers()

    def log_message(self, formato, *args):  # sin ruido en la terminal
        pass


if __name__ == "__main__":
    puerto = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
    manejador = functools.partial(SinCache, directory=str(WEB))
    with http.server.ThreadingHTTPServer(("127.0.0.1", puerto), manejador) as srv:
        print(f"Buscador en http://localhost:{puerto}  (Ctrl+C para apagar)")
        srv.serve_forever()
