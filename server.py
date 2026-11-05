#!/usr/bin/env python3
"""Servidor local da aplicação de etiquetas. Usa apenas a biblioteca padrão."""

from __future__ import annotations

import base64
import json
import mimetypes
import os
import re
import threading
import webbrowser
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Optional
from urllib.parse import unquote, urlparse
from uuid import uuid4


ROOT = Path(__file__).resolve().parent
DATA_DIR = ROOT / "dados"
LOGOS_DIR = DATA_DIR / "logos"
COMPANIES_FILE = DATA_DIR / "empresas.json"
MAX_REQUEST_BYTES = 12 * 1024 * 1024
MAX_LOGO_BYTES = 2 * 1024 * 1024


def ensure_storage() -> None:
    DATA_DIR.mkdir(exist_ok=True)
    LOGOS_DIR.mkdir(exist_ok=True)
    if not COMPANIES_FILE.exists():
        COMPANIES_FILE.write_text("[]\n", encoding="utf-8")


def load_companies() -> list[dict]:
    ensure_storage()
    try:
        value = json.loads(COMPANIES_FILE.read_text(encoding="utf-8"))
        return value if isinstance(value, list) else []
    except (OSError, json.JSONDecodeError):
        return []


def format_cnpj(value: str) -> Optional[str]:
    positions = re.sub(r"[^0-9A-Za-z]", "", value).upper()
    if len(positions) != 14 or not positions[:12].isalnum() or not positions[12:].isdigit():
        return None
    return f"{positions[:2]}.{positions[2:5]}.{positions[5:8]}/{positions[8:12]}-{positions[12:14]}"


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def log_message(self, fmt: str, *args) -> None:
        # Mantém a janela do inicializador limpa.
        return

    def send_json(self, status: int, value: object) -> None:
        body = json.dumps(value, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:
        path = urlparse(self.path).path
        if path == "/api/companies":
            self.send_json(200, load_companies())
            return
        if path.startswith("/logos/"):
            filename = unquote(path.removeprefix("/logos/"))
            if not re.fullmatch(r"[a-f0-9]{32}\.png", filename):
                self.send_json(404, {"error": "Logo não encontrada."})
                return
            logo = LOGOS_DIR / filename
            if not logo.is_file():
                self.send_json(404, {"error": "Logo não encontrada."})
                return
            body = logo.read_bytes()
            self.send_response(200)
            self.send_header("Content-Type", "image/png")
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(body)
            return
        if path == "/":
            self.path = "/index.html"
        super().do_GET()

    def do_POST(self) -> None:
        if urlparse(self.path).path != "/api/companies":
            self.send_json(404, {"error": "Rota não encontrada."})
            return

        try:
            length = int(self.headers.get("Content-Length", "0"))
            if length <= 0 or length > MAX_REQUEST_BYTES:
                self.send_json(413, {"error": "O envio está vazio ou excede o limite permitido."})
                return
            payload = json.loads(self.rfile.read(length).decode("utf-8"))
            if not isinstance(payload, list):
                self.send_json(400, {"error": "Formato de cadastro inválido."})
                return

            old_companies = load_companies()
            old_logos = {
                item.get("logo", "").removeprefix("/logos/")
                for item in old_companies
                if isinstance(item, dict) and isinstance(item.get("logo"), str)
            }
            saved: list[dict] = []
            for item in payload:
                if not isinstance(item, dict):
                    continue
                company_id = str(item.get("id", "")).strip() or str(uuid4())
                name = str(item.get("name", "")).strip()
                cnpj = format_cnpj(str(item.get("cnpj", "")).strip())
                if not name or not cnpj:
                    self.send_json(400, {"error": "Preencha o nome e informe um CNPJ com 14 posições."})
                    return

                logo_path = item.get("logo")
                logo_data = item.get("logoData")
                if logo_data:
                    match = re.fullmatch(r"data:image/png;base64,([A-Za-z0-9+/=]+)", str(logo_data))
                    if not match:
                        self.send_json(400, {"error": "A logo deve ser um arquivo PNG válido."})
                        return
                    raw_logo = base64.b64decode(match.group(1), validate=True)
                    if len(raw_logo) > MAX_LOGO_BYTES or not raw_logo.startswith(b"\x89PNG\r\n\x1a\n"):
                        self.send_json(400, {"error": "A logo deve ser PNG e ter até 2 MB."})
                        return
                    filename = f"{uuid4().hex}.png"
                    (LOGOS_DIR / filename).write_bytes(raw_logo)
                    logo_path = f"/logos/{filename}"
                elif item.get("removeLogo"):
                    logo_path = None
                elif isinstance(logo_path, str) and not re.fullmatch(r"/logos/[a-f0-9]{32}\.png", logo_path):
                    logo_path = None

                saved.append({
                    "id": company_id,
                    "name": name,
                    "cnpj": cnpj,
                    "logo": logo_path if isinstance(logo_path, str) else None,
                })

            temporary = COMPANIES_FILE.with_suffix(".json.tmp")
            temporary.write_text(json.dumps(saved, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
            temporary.replace(COMPANIES_FILE)

            used_logos = {item["logo"].removeprefix("/logos/") for item in saved if item.get("logo")}
            for filename in old_logos - used_logos:
                if re.fullmatch(r"[a-f0-9]{32}\.png", filename):
                    try:
                        (LOGOS_DIR / filename).unlink(missing_ok=True)
                    except OSError:
                        pass

            self.send_json(200, saved)
        except (ValueError, json.JSONDecodeError, UnicodeDecodeError, OSError) as error:
            self.send_json(400, {"error": f"Não foi possível salvar os cadastros: {error}"})


def main() -> None:
    ensure_storage()
    server = None
    for port in range(8765, 8786):
        try:
            server = ThreadingHTTPServer(("127.0.0.1", port), Handler)
            break
        except OSError:
            continue
    if server is None:
        raise SystemExit("Não foi possível encontrar uma porta local livre entre 8765 e 8785.")

    address = f"http://127.0.0.1:{server.server_address[1]}"
    print(f"Etiquetas aberto em {address}")
    print("Para encerrar, feche esta janela.")
    threading.Timer(0.8, lambda: webbrowser.open(address)).start()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
