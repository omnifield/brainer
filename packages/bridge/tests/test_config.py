"""Env-only settings: optional ROOM_ID (single vs auto mode), ws-url derivation, ASCII-handle guard."""

from __future__ import annotations

import pytest

from bridge.config import ConfigError, Settings


def test_room_id_optional_defaults_to_auto_mode(monkeypatch):
    monkeypatch.delenv("ROOM_ID", raising=False)
    s = Settings()  # no longer raises — empty ROOM_ID means auto-discovery
    assert s.room_id == ""
    assert s.single_room is False


def test_room_id_set_is_single_room_mode(monkeypatch):
    monkeypatch.setenv("ROOM_ID", "7")
    s = Settings()
    assert s.room_id == "7"
    assert s.single_room is True


def test_defaults_applied(monkeypatch):
    monkeypatch.delenv("CHATER_URL", raising=False)
    monkeypatch.delenv("AGENT_HANDLE", raising=False)
    monkeypatch.delenv("ROOM_ID", raising=False)
    monkeypatch.delenv("ROOMS_POLL_S", raising=False)
    s = Settings()
    assert s.chater_url == "http://chater:8020"
    assert s.agent_handle == "claude"
    assert s.rooms_poll_s == 10.0


def test_ws_url_for_derives_scheme_and_path(monkeypatch):
    monkeypatch.setenv("CHATER_URL", "http://chater:8020")
    assert Settings().ws_url_for(42) == "ws://chater:8020/chater/rooms/42/ws"

    monkeypatch.setenv("CHATER_URL", "https://chat.example.com/")
    assert Settings().ws_url_for("42") == "wss://chat.example.com/chater/rooms/42/ws"


def test_trailing_slash_stripped(monkeypatch):
    monkeypatch.setenv("CHATER_URL", "http://chater:8020/")
    assert Settings().chater_url == "http://chater:8020"


def test_non_ascii_handle_rejected(monkeypatch):
    monkeypatch.setenv("AGENT_HANDLE", "клод")
    with pytest.raises(ConfigError):
        Settings()
