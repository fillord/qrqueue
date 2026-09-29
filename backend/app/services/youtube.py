"""Validate YouTube share links before persisting or exposing an embed ID."""

import re
from urllib.parse import parse_qs, urlsplit


VIDEO_ID = re.compile(r"^[A-Za-z0-9_-]{11}$")
PLAYLIST_ID = re.compile(r"^[A-Za-z0-9_-]{10,120}$")


def parse_youtube_url(value: str) -> tuple[str, str]:
    try:
        parsed = urlsplit(value.strip())
        host = parsed.hostname
        port = parsed.port
    except ValueError as exc:
        raise ValueError("Invalid YouTube URL") from exc
    if (parsed.scheme != "https" or parsed.username or parsed.password or port is not None
            or host not in {"youtube.com", "www.youtube.com", "m.youtube.com", "youtu.be"}):
        raise ValueError("Invalid YouTube URL")
    query = parse_qs(parsed.query)
    if host == "youtu.be":
        candidate = parsed.path.strip("/")
        kind = "youtube_video"
    elif parsed.path == "/playlist" or (parsed.path == "/watch" and "v" not in query and "list" in query):
        candidate = query.get("list", [""])[0]
        kind = "youtube_playlist"
    elif parsed.path == "/watch":
        candidate = query.get("v", [""])[0]
        kind = "youtube_video"
    elif re.fullmatch(r"/(?:shorts|live|embed)/[A-Za-z0-9_-]+/?", parsed.path):
        candidate = parsed.path.strip("/").split("/")[-1]
        kind = "youtube_video"
    else:
        raise ValueError("Invalid YouTube URL")
    if not (PLAYLIST_ID if kind == "youtube_playlist" else VIDEO_ID).fullmatch(candidate):
        raise ValueError("Invalid YouTube URL")
    return kind, candidate


def youtube_embed_url(kind: str, youtube_id: str) -> str:
    if kind == "youtube_video":
        return f"https://www.youtube.com/embed/{youtube_id}"
    return f"https://www.youtube.com/embed?listType=playlist&list={youtube_id}"
