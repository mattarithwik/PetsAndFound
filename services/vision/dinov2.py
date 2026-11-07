import os
from threading import Lock

from vector_store import MODEL, normalize

REVISION = "f9e44c814b77203eaa57a6bdbbd535f21ede1415"


class DinoEncoder:
    def __init__(self):
        self.lock = Lock()
        self.model = None

    def encode(self, image):
        # Serialize model initialization and inference to bound accelerator memory.
        with self.lock:
            import torch
            from transformers import AutoImageProcessor, AutoModel

            if self.model is None:
                self.device = ("cuda" if torch.cuda.is_available() else
                               "mps" if torch.backends.mps.is_available() else "cpu")
                source = os.environ.get("DINO_MODEL_DIR") or MODEL
                options = {"revision": REVISION}
                self.processor = AutoImageProcessor.from_pretrained(source, use_fast=False, **options)
                self.model = AutoModel.from_pretrained(source, use_safetensors=True, **options).to(self.device).eval()
            inputs = self.processor(images=image, return_tensors="pt").to(self.device)
            with torch.inference_mode():
                cls_token = self.model(**inputs).last_hidden_state[0, 0]
            return normalize(cls_token.float().cpu().numpy())
