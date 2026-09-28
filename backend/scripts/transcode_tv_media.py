#!/usr/bin/env python3
"""Convert ready TV videos stored in PostgreSQL to broadly supported H.264 MP4."""

import argparse
import asyncio
import json
import subprocess
import sys
import tempfile
from pathlib import Path

from sqlalchemy import delete, select

# Allow direct execution with `python scripts/transcode_tv_media.py`.
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.db import async_session_factory
from app.media import TV_MEDIA_CHUNK_BYTES
from app.models.tv_media import TVMedia, TVMediaChunk


def video_codec(path: Path) -> str:
    result = subprocess.run(
        [
            "ffprobe", "-v", "error", "-select_streams", "v:0",
            "-show_entries", "stream=codec_name", "-of", "json", str(path),
        ],
        check=True,
        capture_output=True,
        text=True,
        timeout=60,
    )
    streams = json.loads(result.stdout).get("streams", [])
    if not streams or not streams[0].get("codec_name"):
        raise RuntimeError("В файле не найден видеопоток")
    return str(streams[0]["codec_name"])


def transcode(source: Path, target: Path) -> None:
    subprocess.run(
        [
            "ffmpeg", "-nostdin", "-y", "-v", "error", "-i", str(source),
            "-map", "0:v:0", "-map", "0:a?",
            "-vf", "scale=w='min(1920,iw)':h='min(1080,ih)':force_original_aspect_ratio=decrease,"
                   "scale=trunc(iw/2)*2:trunc(ih/2)*2",
            "-c:v", "libx264", "-preset", "veryfast", "-crf", "23",
            "-profile:v", "main", "-level", "4.1", "-pix_fmt", "yuv420p",
            "-maxrate", "8M", "-bufsize", "16M",
            "-c:a", "aac", "-b:a", "128k", "-ac", "2",
            "-movflags", "+faststart", str(target),
        ],
        check=True,
        timeout=60 * 30,
    )
    if video_codec(target) != "h264":
        raise RuntimeError("FFmpeg не создал H.264-видео")


async def write_source(db, media_id, path: Path) -> None:
    chunks = await db.stream_scalars(
        select(TVMediaChunk.data)
        .where(TVMediaChunk.media_id == media_id)
        .order_by(TVMediaChunk.chunk_index)
    )
    with path.open("wb") as output:
        async for chunk in chunks:
            output.write(chunk)


async def replace_chunks(db, media: TVMedia, path: Path) -> None:
    await db.execute(delete(TVMediaChunk).where(TVMediaChunk.media_id == media.id))
    size = path.stat().st_size
    with path.open("rb") as source:
        index = 0
        while chunk := source.read(TV_MEDIA_CHUNK_BYTES):
            db.add(TVMediaChunk(media_id=media.id, chunk_index=index, data=chunk))
            index += 1
    media.mime_type = "video/mp4"
    media.size_bytes = size
    media.uploaded_bytes = size


async def main(apply: bool, media_id: str | None) -> None:
    async with async_session_factory() as db:
        query = select(TVMedia).where(
            TVMedia.is_ready.is_(True), TVMedia.mime_type.like("video/%")
        ).order_by(TVMedia.created_at)
        if media_id:
            query = query.where(TVMedia.id == media_id)
        videos = list((await db.scalars(query)).all())
        if not videos:
            raise SystemExit("Подходящие ролики не найдены")

        for media in videos:
            with tempfile.TemporaryDirectory(prefix="tv-media-") as directory:
                source = Path(directory) / "source"
                target = Path(directory) / "converted.mp4"
                await write_source(db, media.id, source)
                codec = video_codec(source)
                if codec == "h264":
                    print(f"SKIP  {media.title}: уже H.264", flush=True)
                    continue
                print(f"{'APPLY' if apply else 'WOULD CONVERT'}  {media.title}: {codec} → H.264", flush=True)
                if not apply:
                    continue
                transcode(source, target)
                old_size = media.size_bytes
                await replace_chunks(db, media, target)
                await db.commit()
                print(
                    f"DONE  {media.title}: {old_size / 1024 / 1024:.1f} → "
                    f"{media.size_bytes / 1024 / 1024:.1f} МБ",
                    flush=True,
                )


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--apply", action="store_true", help="Записать H.264 обратно в базу")
    parser.add_argument("--media-id", help="Обработать только один UUID")
    arguments = parser.parse_args()
    asyncio.run(main(arguments.apply, arguments.media_id))
