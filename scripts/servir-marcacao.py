# -*- coding: utf-8 -*-
"""Serve o visualizador 3D e recebe os pontos que o Michel marcar.

    python scripts/servir-marcacao.py    ->  http://localhost:8102
"""
import http.server, json, os, socketserver

AQUI = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
QUARTO = os.path.join(AQUI, "quarto")
PAGINA = os.path.join(AQUI, "tela", "marcar-3d.html")
PORTA = 8102


class Servo(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **k):
        super().__init__(*a, directory=QUARTO, **k)

    def log_message(self, *a):
        pass

    def do_GET(self):
        if self.path in ("/", "/index.html"):
            corpo = open(PAGINA, "rb").read()
            self.send_response(200)
            self.send_header("content-type", "text/html; charset=utf-8")
            self.send_header("content-length", str(len(corpo)))
            self.end_headers()
            self.wfile.write(corpo)
            return
        super().do_GET()

    def do_POST(self):
        if self.path != "/salvar-marcas":
            return self.send_error(404)
        n = int(self.headers.get("content-length", 0))
        d = json.loads(self.rfile.read(n) or b"{}")
        dest = os.path.join(QUARTO, "casa", "marcas-3d.json")
        json.dump(d, open(dest, "w", encoding="utf-8"), indent=1, ensure_ascii=False)
        print("  %d ponto(s) gravados" % len(d.get("marcas", [])))
        for i, m in enumerate(d.get("marcas", []), 1):
            print("   %d. %s" % (i, m.get("nota") or "(sem nota)"))
        corpo = b'{"ok":true}'
        self.send_response(200)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(corpo)))
        self.end_headers()
        self.wfile.write(corpo)


socketserver.TCPServer.allow_reuse_address = True
print("  abra:  http://localhost:%d" % PORTA)
print("  (ctrl+c aqui para parar)")
with socketserver.TCPServer(("127.0.0.1", PORTA), Servo) as s:
    s.serve_forever()
