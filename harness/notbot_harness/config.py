"""Validated configuration and private, platform-appropriate runtime paths."""

from __future__ import annotations

import os
import secrets
from pathlib import Path
from urllib.parse import urlparse

from platformdirs import user_data_path
from pydantic import BaseModel, Field, SecretStr, field_validator


class Settings(BaseModel):
    data_dir: Path = Field(default_factory=lambda: user_data_path("notbot", appauthor=False))
    host: str = "127.0.0.1"
    port: int = Field(default=8787, ge=1, le=65535)
    model_url: str = "http://127.0.0.1:11434/v1"
    model: str = "llama3.2:3b"
    brave_search_api_key: SecretStr = Field(default=SecretStr(""), exclude=True)
    searxng_url: str = ""
    model_key: str = "ollama"
    context_tokens: int = Field(default=8192, ge=2048, le=131072)
    output_tokens: int = Field(default=1024, ge=128, le=8192)
    max_turns: int = Field(default=8, ge=1, le=50)
    max_active_seconds: float = Field(default=300, gt=0, le=3600)
    request_timeout: float = Field(default=60, gt=0, le=300)
    queue_limit: int = Field(default=100, ge=1, le=1000)
    approval_seconds: int = 86400
    remote_tls: bool = False
    desktop_control: bool = False
    deskhand_path: str = ""

    @field_validator("model_url")
    @classmethod
    def validate_url(cls, value: str) -> str:
        parsed = urlparse(value)
        if (
            parsed.scheme not in {"http", "https"}
            or not parsed.hostname
            or parsed.username
            or parsed.password
            or parsed.query
            or parsed.fragment
        ):
            raise ValueError(
                "Model URL must be an HTTP(S) URL without credentials, query or fragment"
            )
        return value.rstrip("/")

    @field_validator("searxng_url")
    @classmethod
    def validate_searxng_url(cls, value: str) -> str:
        value = value.strip()
        if value:
            return cls.validate_url(value)
        return ""

    @property
    def web_search_provider(self) -> str | None:
        if self.searxng_url:
            return "SearXNG"
        if self.brave_search_api_key.get_secret_value().strip():
            return "Brave Search"
        return None

    @classmethod
    def from_env(cls) -> Settings:
        mapping = {
            "data_dir": "DATA_DIR",
            "host": "HOST",
            "port": "PORT",
            "model_url": "MODEL_URL",
            "model": "MODEL",
            "searxng_url": "SEARXNG_URL",
            "brave_search_api_key": "BRAVE_SEARCH_API_KEY",
            "model_key": "MODEL_KEY",
            "context_tokens": "CONTEXT_TOKENS",
            "output_tokens": "OUTPUT_TOKENS",
            "max_turns": "MAX_TURNS",
            "max_active_seconds": "MAX_ACTIVE_SECONDS",
            "request_timeout": "REQUEST_TIMEOUT",
            "queue_limit": "QUEUE_LIMIT",
            "remote_tls": "REMOTE_TLS",
        }
        return cls(
            **{
                key: os.environ[f"NOTBOT_{suffix}"]
                for key, suffix in mapping.items()
                if f"NOTBOT_{suffix}" in os.environ
            }
        )

    def initialise(self) -> str:
        if self.output_tokens >= self.context_tokens // 2:
            raise ValueError("Output reserve must be less than half the context window")
        if self.host not in {"127.0.0.1", "localhost", "::1"} and not self.remote_tls:
            raise ValueError(
                "Remote binding requires NOTBOT_REMOTE_TLS=true and a TLS reverse proxy"
            )
        self.data_dir = self.data_dir.expanduser().resolve()
        self.data_dir.mkdir(parents=True, exist_ok=True, mode=0o700)
        self.data_dir.chmod(0o700)
        path = self.data_dir / "access.token"
        try:
            fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        except FileExistsError:
            pass
        else:
            with os.fdopen(fd, "w") as stream:
                stream.write(secrets.token_urlsafe(32))
        path.chmod(0o600)
        token = path.read_text().strip()
        if len(token) < 32:
            raise ValueError("Invalid access.token; restore a valid credential before starting")
        return token
