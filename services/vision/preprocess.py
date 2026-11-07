import base64
import binascii
from io import BytesIO

from PIL import Image, ImageOps, UnidentifiedImageError


MAX_BYTES = 8 * 1024 * 1024
MAX_ENCODED = 4 * ((MAX_BYTES + 2) // 3)
MAX_PIXELS = 24_000_000


def decode(encoded):
    if len(encoded) > MAX_ENCODED:
        raise ValueError("Photo exceeds 8 MiB")
    try:
        raw = base64.b64decode(encoded, validate=True)
    except (binascii.Error, ValueError) as exc:
        raise ValueError("Invalid base64 image") from exc
    if not raw or len(raw) > MAX_BYTES:
        raise ValueError("Invalid image size")
    return raw


def prepare(raw):
    try:
        with Image.open(BytesIO(raw), formats=["JPEG", "PNG", "WEBP"]) as image:
            width, height = image.size
            if min(width, height) < 32 or width * height > MAX_PIXELS:
                raise ValueError("Image must be at least 32 pixels per side and at most 24 megapixels")
            if getattr(image, "is_animated", False):
                raise ValueError("Animated images require a single still frame")
            image.verify()
        with Image.open(BytesIO(raw)) as image:
            return ImageOps.exif_transpose(image).convert("RGB")
    except (UnidentifiedImageError, Image.DecompressionBombError, OSError, SyntaxError) as exc:
        raise ValueError("Invalid or unsupported JPEG, PNG or WebP image") from exc
