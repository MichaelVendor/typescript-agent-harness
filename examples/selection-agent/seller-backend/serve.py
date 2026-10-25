#!/usr/bin/env python3
"""本地模拟店铺。只监听本机，发布结果写到 live.json，供买家页面读取。"""

import json
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parent
LIVE = ROOT / "live.json"
PORT = 7455


def store_notes(sku: str, title: str) -> dict:
    # 与 lib/case-state.ts 的 storeDraft 保持同一句说明。
    return {
        "imageNote": "演示图，不是商品照片",
        "germanTitle": title,
        "germanNote": "标题用搜索页原文，没有另写卖点",
        "gtin": f"DEMO-{sku}",
        "gtinNote": "演示编码，不是 GS1 GTIN",
        "vatNote": "演示店铺，未登记真实德国 VAT",
        "inboundNote": "演示已建单，件数未填，不会发往亚马逊仓库",
        "adsNote": "未投放。没有预算，不创建广告",
    }


def product_image(sku: str) -> str | None:
    path = ROOT / "images.json"
    if not path.exists():
        return None
    url = json.loads(path.read_text(encoding="utf-8")).get(sku)
    if isinstance(url, str) and url.startswith("https://") and ("media-amazon.com" in url or "ssl-images-amazon.com" in url):
        return url
    return None


def listing_from(body: dict) -> dict:
    sku = str(body.get("sku", "")).strip()
    title = str(body.get("title", "")).strip()
    category = str(body.get("category", "")).strip()
    ship = str(body.get("ship", "")).strip()
    price = body.get("priceEur")
    bullets = body.get("bullets", [])
    if not sku or len(sku) > 40 or any(ch not in "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-" for ch in sku):
        raise ValueError("sku 无效")
    if not title or len(title) > 500:
        raise ValueError("标题无效")
    if not category or len(category) > 80:
        raise ValueError("类目无效")
    if ship not in ("FBA", "自发货"):
        raise ValueError("配送无效")
    if isinstance(price, bool) or not isinstance(price, (int, float)) or not (0 < price < 100000):
        raise ValueError("售价无效")
    if not isinstance(bullets, list) or len(bullets) > 8:
        raise ValueError("卖点无效")
    clean = []
    for line in bullets:
        text = str(line).strip()
        if not text or len(text) > 300:
            raise ValueError("卖点无效")
        clean.append(text)
    image = product_image(sku)
    return {
        "status": "已上架",
        "sku": sku,
        "title": title,
        "priceEur": round(float(price), 2),
        "category": category,
        "ship": ship,
        "bullets": clean,
        **({"image": image} if image else {}),
        **store_notes(sku, title),
    }


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def _json(self, payload: dict, status: int = 200) -> None:
        raw = json.dumps(payload, ensure_ascii=False).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def do_GET(self):
        if self.path.split("?", 1)[0] == "/live.json" and not LIVE.exists():
            self._json({"status": "未上架"})
            return
        super().do_GET()

    def do_POST(self):
        if self.path.split("?", 1)[0] != "/publish":
            self.send_error(404)
            return
        length = int(self.headers.get("Content-Length", "0") or "0")
        if length <= 0 or length > 20000:
            self._json({"ok": False, "error": "请求无效"}, 400)
            return
        try:
            body = json.loads(self.rfile.read(length).decode())
            listing = listing_from(body)
        except (ValueError, json.JSONDecodeError, UnicodeDecodeError) as error:
            self._json({"ok": False, "error": str(error) if isinstance(error, ValueError) else "请求无效"}, 400)
            return
        LIVE.write_text(json.dumps(listing, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        self._json({"ok": True, **listing})


if __name__ == "__main__":
    ThreadingHTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
