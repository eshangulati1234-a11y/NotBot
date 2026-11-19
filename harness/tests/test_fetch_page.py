"""Opening a page is read-only, bounded, and cannot reach private networks."""

import httpx
import pytest

from notbot_harness import fetch_page
from notbot_harness.fetch_page import FetchError, blocked_address, check_url, fetch, normalise

HTML = """<html><head><title>Run Claude Code programmatically</title><style>x{}</style></head>
<body><nav>Menu Home</nav><h1>Headless</h1><p>Use <code>claude -p</code> to run.</p>
<ul><li>First</li><li>Second</li></ul><pre>claude -p "hi"
  --allowedTools Read</pre><script>steal()</script><footer>Copyright</footer></body></html>"""


async def public(_host):
    return ["93.184.216.34"]


def answer(body=HTML, status=200, content_type="text/html; charset=utf-8", headers=None):
    def handler(request):
        return httpx.Response(
            status, text=body, headers={"content-type": content_type, **(headers or {})}
        )

    return httpx.MockTransport(handler)


@pytest.mark.parametrize(
    "value,expected",
    [
        ("127.0.0.1", True),
        ("10.1.2.3", True),
        ("192.168.0.9", True),
        ("169.254.169.254", True),
        ("100.64.0.1", True),
        ("::1", True),
        ("::ffff:127.0.0.1", True),
        ("93.184.216.34", False),
        ("not-an-ip", True),
    ],
)
def test_blocked_addresses(value, expected):
    assert blocked_address(value) is expected


@pytest.mark.parametrize(
    "url",
    [
        "http://example.com/a",
        "https://user:pw@example.com/",
        "https://example.com:8443/",
        "https://localhost/",
        "https://printer.local/",
        "file:///etc/passwd",
        "https://exa mple.com/",
    ],
)
def test_unsafe_addresses_are_refused(url):
    with pytest.raises(FetchError):
        check_url(url)


def test_normalise_ignores_fragment_case_and_trailing_slash():
    assert normalise("https://Example.com/a/#top") == normalise("https://example.com/a")


@pytest.mark.asyncio
async def test_reads_text_without_scripts_or_navigation():
    page = await fetch("https://docs.example.com/headless", resolver=public, transport=answer())
    assert page["title"] == "Run Claude Code programmatically"
    text = page["text"]
    assert "# Headless" in text and "- First" in text and "--allowedTools Read" in text
    assert "steal()" not in text and "Menu Home" not in text and "Copyright" not in text
    assert page["truncated"] is False


@pytest.mark.asyncio
async def test_private_resolution_is_refused_before_any_request():
    async def internal(_host):
        return ["10.0.0.5"]

    def boom(_request):
        raise AssertionError("must not connect")

    with pytest.raises(FetchError, match="private"):
        await fetch(
            "https://sneaky.example.com/", resolver=internal, transport=httpx.MockTransport(boom)
        )


@pytest.mark.asyncio
async def test_redirect_to_private_address_is_refused():
    seen = []

    async def resolver(host):
        seen.append(host)
        return ["127.0.0.1"] if host == "evil.internal.example" else ["93.184.216.34"]

    def handler(request):
        return httpx.Response(302, headers={"location": "https://evil.internal.example/x"})

    with pytest.raises(FetchError, match="private"):
        await fetch(
            "https://ok.example.com/", resolver=resolver, transport=httpx.MockTransport(handler)
        )
    assert seen == ["ok.example.com", "evil.internal.example"]


@pytest.mark.asyncio
async def test_redirect_to_http_is_refused_and_loops_stop():
    def to_http(_request):
        return httpx.Response(302, headers={"location": "http://example.com/"})

    with pytest.raises(FetchError, match="https"):
        await fetch(
            "https://a.example.com/", resolver=public, transport=httpx.MockTransport(to_http)
        )

    def forever(request):
        return httpx.Response(302, headers={"location": str(request.url) + "x"})

    with pytest.raises(FetchError, match="too many"):
        await fetch(
            "https://a.example.com/", resolver=public, transport=httpx.MockTransport(forever)
        )


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "kwargs,message",
    [
        ({"status": 404}, "404"),
        ({"status": 403}, "refused"),
        ({"status": 429}, "limiting"),
        ({"status": 500}, "error"),
        ({"content_type": "application/pdf"}, "not a text page"),
        ({"body": "<html><script>x</script></html>"}, "no readable text"),
    ],
)
async def test_failures_say_what_happened(kwargs, message):
    with pytest.raises(FetchError, match=message):
        await fetch("https://a.example.com/", resolver=public, transport=answer(**kwargs))


@pytest.mark.asyncio
async def test_large_pages_are_cut_and_flagged(monkeypatch):
    monkeypatch.setattr(fetch_page, "MAX_TEXT", 100)
    big = "<p>" + "word " * 500 + "</p>"
    page = await fetch("https://a.example.com/", resolver=public, transport=answer(body=big))
    assert len(page["text"]) == 100 and page["truncated"] is True
