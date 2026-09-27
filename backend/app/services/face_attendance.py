"""Local face descriptors and encrypted, temporary enrollment review photos."""
import base64
import binascii
import hashlib
import threading
from functools import lru_cache
from pathlib import Path

import cv2
import numpy as np
from cryptography.fernet import Fernet, InvalidToken

from app.config import settings
from app.services.errors import ServiceError

MODEL_DIR = Path(__file__).resolve().parents[2] / "face_models"
MAX_IMAGE_BYTES = 1_500_000
_model_lock = threading.Lock()


@lru_cache(maxsize=1)
def _models():
    detector_path = MODEL_DIR / "face_detection_yunet_2023mar.onnx"
    recognizer_path = MODEL_DIR / "face_recognition_sface_2021dec.onnx"
    if not detector_path.is_file() or not recognizer_path.is_file():
        raise ServiceError("face_model_unavailable", 503)
    try:
        return (cv2.FaceDetectorYN.create(str(detector_path), "", (320, 320), score_threshold=0.85),
                cv2.FaceRecognizerSF.create(str(recognizer_path), ""))
    except cv2.error as exc:
        raise ServiceError("face_model_unavailable", 503) from exc


def _cipher() -> Fernet:
    # Changing ATTENDANCE_SECRET requires re-enrolling faces and resetting codes.
    key = hashlib.sha256(b"qrqueue:attendance:face:v1:" + settings.attendance_signing_secret.encode()).digest()
    return Fernet(base64.urlsafe_b64encode(key))


def encode_template(vector: np.ndarray) -> bytes:
    return _cipher().encrypt(np.asarray(vector, dtype=np.float32).tobytes())


def decode_template(ciphertext: bytes) -> np.ndarray:
    try:
        vector = np.frombuffer(_cipher().decrypt(ciphertext), dtype=np.float32)
    except (InvalidToken, ValueError) as exc:
        raise ServiceError("face_template_unavailable", 503) from exc
    if vector.size != 128:
        raise ServiceError("face_template_unavailable", 503)
    return vector


def encode_review_photo(image_b64: str) -> bytes:
    """Keep only the detected face with some context, encrypted until review."""
    try:
        raw = base64.b64decode(image_b64, validate=True)
        if not 1000 <= len(raw) <= MAX_IMAGE_BYTES:
            raise ValueError("image size")
        image = cv2.imdecode(np.frombuffer(raw, np.uint8), cv2.IMREAD_COLOR)
        if image is None:
            raise ValueError("image decode")
        height, width = image.shape[:2]
        if width < 240 or height < 240 or width * height > 2_500_000:
            raise ValueError("image dimensions")
        with _model_lock:
            detector, _ = _models()
            detector.setInputSize((width, height))
            _, faces = detector.detect(image)
        if faces is None or len(faces) != 1:
            raise ServiceError("face_count_invalid", 422)
        x, y, face_width, face_height = faces[0][:4]
        if min(face_width, face_height) < 100:
            raise ServiceError("face_too_small", 422)
        margin = int(max(face_width, face_height) * 0.45)
        left, top = max(0, int(x) - margin), max(0, int(y) - margin)
        right = min(width, int(x + face_width) + margin)
        bottom = min(height, int(y + face_height) + margin)
        crop = image[top:bottom, left:right]
        scale = min(1.0, 640 / max(crop.shape[:2]))
        if scale < 1:
            crop = cv2.resize(crop, None, fx=scale, fy=scale, interpolation=cv2.INTER_AREA)
        ok, encoded = cv2.imencode(".jpg", crop, [cv2.IMWRITE_JPEG_QUALITY, 82])
        if not ok:
            raise ValueError("image encode")
        return _cipher().encrypt(encoded.tobytes())
    except (ValueError, binascii.Error, cv2.error) as exc:
        raise ServiceError("invalid_face_image", 422) from exc


def decode_review_photo(ciphertext: bytes) -> bytes:
    try:
        return _cipher().decrypt(ciphertext)
    except InvalidToken as exc:
        raise ServiceError("face_review_photo_unavailable", 503) from exc


def face_descriptor(image_b64: str) -> np.ndarray:
    try:
        raw = base64.b64decode(image_b64, validate=True)
    except (ValueError, binascii.Error) as exc:
        raise ServiceError("invalid_face_image", 422) from exc
    if not 1000 <= len(raw) <= MAX_IMAGE_BYTES:
        raise ServiceError("invalid_face_image", 422)
    try:
        image = cv2.imdecode(np.frombuffer(raw, np.uint8), cv2.IMREAD_COLOR)
    except cv2.error as exc:
        raise ServiceError("invalid_face_image", 422) from exc
    if image is None:
        raise ServiceError("invalid_face_image", 422)
    height, width = image.shape[:2]
    if width < 240 or height < 240 or width * height > 2_500_000:
        raise ServiceError("invalid_face_image", 422)
    try:
        with _model_lock:
            detector, recognizer = _models()
            detector.setInputSize((width, height))
            _, faces = detector.detect(image)
            if faces is None or len(faces) != 1:
                raise ServiceError("face_count_invalid", 422)
            face = faces[0]
            if min(face[2], face[3]) < 100:
                raise ServiceError("face_too_small", 422)
            vector = recognizer.feature(recognizer.alignCrop(image, face)).reshape(-1).astype(np.float32)
    except cv2.error as exc:
        raise ServiceError("invalid_face_image", 422) from exc
    norm = np.linalg.norm(vector)
    if not np.isfinite(norm) or norm == 0:
        raise ServiceError("invalid_face_image", 422)
    return vector / norm


def capture_descriptor(images: list[str]) -> np.ndarray:
    if not 2 <= len(images) <= 3:
        raise ServiceError("face_capture_count_invalid", 422)
    vectors = [face_descriptor(image) for image in images]
    if any(float(np.dot(vectors[0], item)) < 0.48 for item in vectors[1:]):
        raise ServiceError("face_capture_inconsistent", 422)
    average = np.mean(vectors, axis=0)
    return average / np.linalg.norm(average)


def similarity(one: np.ndarray, other: np.ndarray) -> float:
    return float(np.dot(one, other))
