"""Bounded public search through operator-configured providers."""

import asyncio
import json
import re
from datetime import UTC, datetime
from html import unescape
from html.parser import HTMLParser
from urllib.parse import urlsplit

import httpx

BRAVE_URL = "https://api.search.brave.com/res/v1/web/search"
MAX_RESPONSE_BYTES = 256_000
SEARCH_LIMIT = 4


class PlainText(HTMLParser):
    def __init__(self):
        super().__init__()
        self.parts: list[str] = []

    def handle_data(self, data: str) -> None:
        self.parts.append(data)


def plain_text(value: object, limit: int) -> str:
    if not isinstance(value, str):
        return ""
    parser = PlainText()
    parser.feed(value[:4096])
    parser.close()
    return " ".join(unescape(" ".join(parser.parts)).split())[:limit]


def job_result_kind(title: str, link: str) -> str:
    """Identify high-confidence individual listings and common index pages."""
    url = urlsplit(link)
    path = url.path.lower()
    if re.search(r"/(?:job|jobs/view)/\d+(?:/|$)|/jobs/view/[^/]+-\d+(?:/|$)", path):
        return "posting"
    if re.search(r"/(?:jobs|job)/(?:[^/]+/)?(?:\d{5,}|[0-9a-f-]{36})(?:/|$)", path):
        return "posting"
    if (url.hostname or "").endswith(".myworkdayjobs.com") and re.search(
        r"/job/(?:[^/]+/)*[^/]+_[a-z]*\d+(?:/|$)", path
    ):
        return "posting"
    if url.hostname in {"jobs.lever.co", "jobs.ashbyhq.com"} and re.search(
        r"/[0-9a-f-]{36}(?:/|$)", path
    ):
        return "posting"
    if (
        (url.hostname or "").endswith(".indeed.com")
        and path == "/viewjob"
        and re.search(r"(?:^|&)jk=[^&]+", url.query)
    ):
        return "posting"
    if (
        re.search(
            r"\b(?:vacancies|positions available|jobs and work|\d[\d,]*\+? jobs)\b", title, re.I
        )
        or re.search(r"\bjobs in\b|^\s*\d[\d,]*\+?\s+.{0,65}\bjobs\b", title, re.I)
        or re.search(r"(?:^|/)(?:q-[^/]+-jobs|search|job-search|[^/]+-jobs(?:-|/|$))", path)
    ):
        return "search_page"
    return "unverified"


def early_career(title: str) -> str:
    role = title.split("|", 1)[0].lower()
    if re.search(r"\b(?:senior|sr\.?|staff|principal|lead|head|director)\b", role):
        return "senior"
    if re.search(r"\b(?:junior|graduate|entry[- ]level|new grad|associate)\b", role):
        return "early_career"
    return "unspecified"


async def search(
    key: str,
    *,
    query: str,
    country: str | None,
    freshness: str | None,
    searxng_url: str = "",
    job_research: bool = False,
    junior_only: bool = False,
) -> dict:
    provider = "SearXNG" if searxng_url else "Brave Search"
    headers = {"Accept": "application/json"}
    params: dict[str, str | int] = {"q": query}
    if searxng_url:
        endpoint = searxng_url + "/search"
        params.update(format="json", categories="general")
        if country and country != "ALL":
            params["language"] = "en-" + ("UK" if country == "GB" else country)
        if freshness in {"pd", "pw", "pm", "py"}:
            params["time_range"] = {"pd": "day", "pw": "week", "pm": "month", "py": "year"}[
                freshness
            ]
    else:
        endpoint = BRAVE_URL
        headers["X-Subscription-Token"] = key
        params.update(count=10, text_decorations="false")
        if country:
            params["country"] = country
        if freshness:
            params["freshness"] = freshness
    try:
        async with (
            asyncio.timeout(10),
            httpx.AsyncClient(trust_env=False, follow_redirects=False) as client,
            client.stream("GET", endpoint, params=params, headers=headers) as response,
        ):
            if response.status_code == 429:
                raise ValueError(f"{provider} rate limit reached. Try again later.")
            if response.status_code in {401, 403}:
                if searxng_url:
                    raise ValueError(
                        "SearXNG refused the request. Check that JSON output is enabled and the instance allows access."
                    )
                raise ValueError("Brave Search rejected the API key or subscription.")
            response.raise_for_status()
            body = bytearray()
            async for chunk in response.aiter_bytes():
                body.extend(chunk)
                if len(body) > MAX_RESPONSE_BYTES:
                    raise ValueError(f"{provider} returned too much data.")
    except (TimeoutError, httpx.TimeoutException):
        raise ValueError(f"{provider} timed out.") from None
    except httpx.HTTPError:
        raise ValueError(f"{provider} is unavailable.") from None

    try:
        payload = json.loads(body)
        entries = payload["results"] if searxng_url else payload.get("web", {}).get("results", [])
        if not isinstance(entries, list):
            raise TypeError
    except (ValueError, AttributeError, KeyError, TypeError, RecursionError):
        raise ValueError(f"{provider} returned an invalid result.") from None

    if searxng_url and not entries and payload.get("unresponsive_engines"):
        raise ValueError(
            "SearXNG returned no results and reported upstream search engine failures."
        )

    found = []
    seen: set[str] = set()
    for item in entries:
        if not isinstance(item, dict):
            continue
        raw_url = item.get("url")
        if (
            not isinstance(raw_url, str)
            or len(raw_url) > 384
            or any(c.isspace() or c == "\\" or ord(c) < 32 for c in raw_url)
        ):
            continue
        try:
            url = urlsplit(raw_url)
            if (
                url.scheme != "https"
                or not url.hostname
                or url.username
                or url.password
                or url.port not in {None, 443}
            ):
                continue
            # Remove fragments for deduplication. Preserve query parameters for navigation.
            link = url._replace(fragment="").geturl()
        except ValueError:
            continue
        title = plain_text(item.get("title"), 100)
        if not title or link in seen:
            continue
        seniority = early_career(title) if job_research else None
        if junior_only and seniority == "senior":
            continue
        seen.add(link)
        found.append(
            {
                "title": title,
                "url": link,
                "excerpt": plain_text(item.get("content" if searxng_url else "description"), 320),
            }
        )
        published = plain_text(
            item.get("publishedDate") if searxng_url else item.get("page_age") or item.get("age"),
            40,
        )
        if published:
            found[-1]["published"] = published
        if job_research:
            found[-1].update(kind=job_result_kind(title, link), seniority=seniority)
        elif len(found) == 5:
            break
    if job_research:
        order = {"posting": 0, "unverified": 1, "search_page": 2}
        found.sort(key=lambda item: (order[item["kind"]], item["seniority"] != "early_career"))
    return {
        "provider": provider,
        "checked_at": datetime.now(UTC).isoformat(),
        "results": found[:5],
    }
