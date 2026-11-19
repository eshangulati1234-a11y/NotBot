"""Read one public web page as plain text, safely.

The model may only open pages that a search returned (or that the user typed), the address is
checked before anything is requested, and the connection goes to the address we checked so a
hostile DNS answer cannot redirect it to a private network.
"""

from __future__ import annotations

import asyncio
import ipaddress
import re
import socket
from collections.abc import Awaitable, Callable
from html import unescape
from html.parser import HTMLParser
from urllib.parse import urljoin, urlsplit

import httpx

FETCH_LIMIT = 3
MAX_BYTES = 512_000
MAX_TEXT = 60_000
PREVIEW = 6_000
TIMEOUT = 10
MAX_REDIRECTS = 3
TEXT_TYPES = (
    "text/html",
    "application/xhtml+xml",
    "text/plain",
    "text/markdown",
    "application/json",
)
USER_AGENT = "Notbot/0.1 (local assistant; reads a page the user asked about)"

Resolver = Callable[[str], Awaitable[list[str]]]


class FetchError(ValueError):
    """A reason the page could not be read, written for the person using the app."""


def blocked_address(value: str) -> bool:
    try:
        address = ipaddress.ip_address(value)
    except ValueError:
        return True
    if isinstance(address, ipaddress.IPv6Address) and address.ipv4_mapped:
        address = address.ipv4_mapped
    return (
        address.is_private
        or address.is_loopback
        or address.is_link_local
        or address.is_multicast
        or address.is_reserved
        or address.is_unspecified
        or (
            isinstance(address, ipaddress.IPv4Address)
            and address in ipaddress.ip_network("100.64.0.0/10")
        )
    )


def normalise(url: str) -> str:
    parts = urlsplit(url.strip())
    return parts._replace(fragment="", netloc=parts.netloc.lower()).geturl().rstrip("/")


def check_url(url: str) -> tuple[str, str]:
    """Return (url, host) when the address is an ordinary public https page."""
    if len(url) > 2000 or any(c.isspace() or ord(c) < 32 for c in url):
        raise FetchError("That is not a usable web address.")
    parts = urlsplit(url)
    if parts.scheme != "https":
        raise FetchError("Only https pages can be opened.")
    if not parts.hostname or parts.username or parts.password:
        raise FetchError("That web address is not allowed.")
    if parts.port not in {None, 443}:
        raise FetchError("Only the standard https port is allowed.")
    host = parts.hostname.lower()
    if host == "localhost" or host.endswith((".local", ".internal", ".localhost")):
        raise FetchError("Pages on this computer or a private network cannot be opened.")
    return parts._replace(fragment="").geturl(), host


async def resolve(host: str) -> list[str]:
    try:
        ipaddress.ip_address(host)
        return [host]
    except ValueError:
        pass
    try:
        infos = await asyncio.get_running_loop().getaddrinfo(host, 443, type=socket.SOCK_STREAM)
    except OSError:
        raise FetchError("That site could not be found.") from None
    return list(dict.fromkeys(info[4][0] for info in infos))


class ReadablePage(HTMLParser):
    SKIP = {"script", "style", "noscript", "svg", "nav", "footer", "template", "iframe", "form"}
    BLOCK = {
        "p",
        "div",
        "section",
        "article",
        "main",
        "br",
        "tr",
        "table",
        "ul",
        "ol",
        "blockquote",
    }

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.lines: list[str] = []
        self.title = ""
        self._line: list[str] = []
        self._skip = 0
        self._pre = 0
        self._in_title = False

    def _flush(self) -> None:
        text = "".join(self._line)
        self._line = []
        text = text.rstrip() if self._pre else " ".join(text.split())
        if text:
            self.lines.append(text)

    def handle_starttag(self, tag: str, attrs) -> None:
        if tag in self.SKIP:
            self._skip += 1
            return
        if self._skip:
            return
        if tag == "title":
            self._in_title = True
        elif tag in {"h1", "h2", "h3", "h4", "h5", "h6"}:
            self._flush()
            self._line.append("#" * int(tag[1]) + " ")
        elif tag == "li":
            self._flush()
            self._line.append("- ")
        elif tag == "pre":
            self._flush()
            self._pre += 1
        elif tag in self.BLOCK:
            self._flush()

    def handle_endtag(self, tag: str) -> None:
        if tag in self.SKIP:
            self._skip = max(0, self._skip - 1)
            return
        if self._skip:
            return
        if tag == "title":
            self._in_title = False
        elif tag == "pre":
            self._flush()
            self._pre = max(0, self._pre - 1)
        elif tag in self.BLOCK or tag in {"h1", "h2", "h3", "h4", "h5", "h6", "li"}:
            self._flush()

    def handle_data(self, data: str) -> None:
        if self._in_title:
            self.title += data
        elif not self._skip:
            self._line.append(data)


def readable(body: str, content_type: str) -> tuple[str, str]:
    if "html" not in content_type:
        return "", body.strip()
    parser = ReadablePage()
    parser.feed(body)
    parser.close()
    parser._flush()
    text = "\n".join(parser.lines)
    return " ".join(unescape(parser.title).split())[:200], re.sub(r"\n{3,}", "\n\n", text).strip()


async def fetch(
    url: str,
    *,
    resolver: Resolver = resolve,
    transport: httpx.AsyncBaseTransport | None = None,
) -> dict:
    """Open one page. `transport` exists so tests can run without a network."""
    current = url
    for _hop in range(MAX_REDIRECTS + 1):
        current, host = check_url(current)
        addresses = await resolver(host)
        if not addresses or any(blocked_address(item) for item in addresses):
            raise FetchError("Pages on this computer or a private network cannot be opened.")
        target = current
        extensions: dict = {}
        headers = {
            "User-Agent": USER_AGENT,
            "Accept": "text/html,text/plain,text/markdown,*/*;q=0.1",
        }
        if transport is None:
            # Connect to the address we just checked, but keep the real name for TLS and routing.
            pinned = addresses[0]
            literal = f"[{pinned}]" if ":" in pinned else pinned
            parts = urlsplit(current)
            target = parts._replace(netloc=literal).geturl()
            headers["Host"] = host
            extensions["sni_hostname"] = host
        try:
            async with (
                asyncio.timeout(TIMEOUT),
                httpx.AsyncClient(
                    trust_env=False, follow_redirects=False, transport=transport
                ) as client,
                client.stream("GET", target, headers=headers, extensions=extensions) as response,
            ):
                if response.status_code in {301, 302, 303, 307, 308}:
                    location = response.headers.get("location")
                    if not location:
                        raise FetchError("The page redirected without saying where.")
                    current = urljoin(current, location)
                    continue
                if response.status_code in {401, 403}:
                    raise FetchError("The site refused to show this page to Notbot.")
                if response.status_code == 404:
                    raise FetchError("That page does not exist any more (404).")
                if response.status_code == 429:
                    raise FetchError("The site is limiting requests. Try again later.")
                if response.status_code >= 400:
                    raise FetchError(f"The site returned an error ({response.status_code}).")
                content_type = (
                    response.headers.get("content-type", "").split(";")[0].strip().lower()
                )
                if content_type not in TEXT_TYPES:
                    raise FetchError("That address is not a text page, so it was not opened.")
                body = bytearray()
                async for chunk in response.aiter_bytes():
                    body.extend(chunk)
                    if len(body) > MAX_BYTES:
                        break
                encoding = response.encoding or "utf-8"
        except (TimeoutError, httpx.TimeoutException):
            raise FetchError("The page took too long to load.") from None
        except httpx.HTTPError:
            raise FetchError("The page could not be reached.") from None
        text_in = bytes(body[:MAX_BYTES]).decode(encoding, errors="replace")
        title, text = readable(text_in, content_type)
        if not text:
            raise FetchError("The page has no readable text.")
        return {
            "url": current,
            "title": title,
            "text": text[:MAX_TEXT],
            "truncated": len(text) > MAX_TEXT or len(body) > MAX_BYTES,
        }
    raise FetchError("The page redirected too many times.")
