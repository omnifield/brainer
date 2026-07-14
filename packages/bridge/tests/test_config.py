"""Env-only settings: required ROOM_ID, ws-url derivation, ASCII-handle guard."""

from __future__ import annotations

import pytest

from bridge.config import ConfigError, Settings


def test_room_id_required(monkeypatch):
    monkeypatch.delenv("ROOM_ID", raising=False)
    with pytest.raises(ConfigError):
        Settings()


def test_defaults_applied(monkeypatch):
    monkeypatch.delenv("CHATER_URL", raising=False)
    monkeypatch.delenv("AGENT_HANDLE", raising=False)
    monkeypatch.setenv("ROOM_ID", "7")
    s = Settings()
    assert s.chater_url == "http://chater:8020"
    assert s.agent_handle == "claude"
    assert s.room_id == "7"


def test_ws_url_derives_scheme_and_path(monkeypatch):
    monkeypatch.setenv("ROOM_ID", "42")
    monkeypatch.setenv("CHATER_URL", "http://chater:8020")
    assert Settings().ws_url == "ws://chater:8020/chater/rooms/42/ws"

    monkeypatch.setenv("CHATER_URL", "https://chat.example.com/")
    assert Settings().ws_url == "wss://chat.example.com/chater/rooms/42/ws"


def test_trailing_slash_stripped(monkeypatch):
    monkeypatch.setenv("ROOM_ID", "1")
    monkeypatch.setenv("CHATER_URL", "http://chater:8020/")
    assert Settings().chater_url == "http://chater:8020"


def test_non_ascii_handle_rejected(monkeypatch):
    monkeypatch.setenv("ROOM_ID", "1")
    monkeypatch.setenv("AGENT_HANDLE", "клод")
    with pytest.raises(ConfigError):
        Settings()
