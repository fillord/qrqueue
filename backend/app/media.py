"""Shared media transfer settings for uploads and ranged TV playback."""

TV_MEDIA_CHUNK_BYTES = 512 * 1024  # Below nginx's default 1 MB request-body limit.
