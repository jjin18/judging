"""Scrape Devpost gallery — list pages give title, team, url; project pages add description.

Run as CLI:
    python scrape_devpost.py https://hackathon.devpost.com [--limit 50]
"""
import asyncio
import re
import sys
from typing import AsyncIterator, Iterable
from urllib.parse import urljoin

import httpx
from bs4 import BeautifulSoup

UA = "Mozilla/5.0 (compatible; JudgingPlatform/1.0)"


def _norm_gallery_url(base: str) -> str:
    base = base.rstrip("/")
    if "/project-gallery" in base or "/submissions" in base:
        return base
    return base + "/project-gallery"


async def _fetch(client: httpx.AsyncClient, url: str) -> str:
    r = await client.get(url, headers={"User-Agent": UA}, follow_redirects=True, timeout=20)
    r.raise_for_status()
    return r.text


def _parse_gallery(html: str, base_url: str) -> list[dict]:
    soup = BeautifulSoup(html, "html.parser")
    cards = soup.select("a.link-to-software, .gallery-item a.block-wrapper-link")
    items: list[dict] = []
    seen: set[str] = set()
    for a in cards:
        href = a.get("href") or ""
        full = urljoin(base_url, href)
        if not full or full in seen:
            continue
        seen.add(full)
        title_el = a.select_one("h5") or a.select_one(".software-entry-name") or a.select_one("h6")
        title = title_el.get_text(strip=True) if title_el else None
        team_el = a.select_one(".user-profile-link") or a.select_one(".software-creators")
        team = team_el.get_text(" ", strip=True) if team_el else None
        tagline_el = a.select_one(".tagline") or a.select_one(".small-tagline")
        tagline = tagline_el.get_text(" ", strip=True) if tagline_el else None
        if title:
            items.append({"title": title, "team_name": team, "devpost_url": full, "description": tagline})
    return items


def _parse_pagination(html: str) -> int:
    soup = BeautifulSoup(html, "html.parser")
    pages = 1
    for link in soup.select("a.page-link, a.page, .pagination a"):
        text = link.get_text(strip=True)
        if text.isdigit():
            pages = max(pages, int(text))
    return pages


async def scrape_event(devpost_url: str, limit: int = 200) -> AsyncIterator[dict]:
    """Yields {"event": "page" | "project", ...} progress events."""
    gallery = _norm_gallery_url(devpost_url)
    async with httpx.AsyncClient() as client:
        first = await _fetch(client, gallery)
        total_pages = _parse_pagination(first)
        yield {"event": "page", "page": 1, "total": total_pages}
        items = _parse_gallery(first, gallery)
        for it in items:
            yield {"event": "project", **it}
            if (yield_count := len(items)) >= limit:
                return
        for p in range(2, total_pages + 1):
            url = f"{gallery}?page={p}"
            yield {"event": "page", "page": p, "total": total_pages}
            try:
                html = await _fetch(client, url)
            except httpx.HTTPError as e:
                yield {"event": "error", "page": p, "message": str(e)}
                continue
            for it in _parse_gallery(html, url):
                yield {"event": "project", **it}


async def scrape_to_list(devpost_url: str, limit: int = 200) -> list[dict]:
    out: list[dict] = []
    async for ev in scrape_event(devpost_url, limit=limit):
        if ev.get("event") == "project":
            out.append({k: v for k, v in ev.items() if k != "event"})
        if len(out) >= limit:
            break
    return out


def main(argv: list[str]) -> int:
    if len(argv) < 2:
        print("usage: scrape_devpost.py <url> [--limit N]")
        return 2
    url = argv[1]
    limit = 200
    if "--limit" in argv:
        i = argv.index("--limit")
        limit = int(argv[i + 1])
    items = asyncio.run(scrape_to_list(url, limit=limit))
    for it in items:
        print(f"{it.get('title', '?')}\t{it.get('team_name', '?')}\t{it.get('devpost_url', '?')}")
    print(f"\n[{len(items)} projects]", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
