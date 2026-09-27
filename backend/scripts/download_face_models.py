"""Fetch pinned OpenCV Zoo models for fully local face matching during image build."""
import hashlib
from pathlib import Path
from urllib.request import urlopen

MODELS = {
    "face_detection_yunet_2023mar.onnx": ("face_detection_yunet", "8f2383e4dd3cfbb4553ea8718107fc0423210dc964f9f4280604804ed2552fa4"),
    "face_recognition_sface_2021dec.onnx": ("face_recognition_sface", "0ba9fbfa01b5270c96627c4ef784da859931e02f04419c829e83484087c34e79"),
}
target = Path(__file__).resolve().parents[1] / "face_models"
target.mkdir(exist_ok=True)
for filename, (folder, expected) in MODELS.items():
    path = target / filename
    if path.exists() and hashlib.sha256(path.read_bytes()).hexdigest() == expected:
        continue
    url = f"https://media.githubusercontent.com/media/opencv/opencv_zoo/main/models/{folder}/{filename}"
    with urlopen(url, timeout=90) as response:
        data = response.read()
    if hashlib.sha256(data).hexdigest() != expected:
        raise RuntimeError(f"Model checksum mismatch: {filename}")
    path.write_bytes(data)
for folder in {folder for folder, _ in MODELS.values()}:
    license_path = target / f"LICENSE-{folder}.txt"
    if not license_path.exists():
        with urlopen(f"https://raw.githubusercontent.com/opencv/opencv_zoo/main/models/{folder}/LICENSE", timeout=30) as response:
            license_path.write_bytes(response.read())
