"""Fetch only the selected DogReID-1553 photos from its CC0 Images.zip using HTTP ranges."""
import io
import pathlib
import subprocess
import zipfile

ARCHIVE = "https://dataverse.harvard.edu/api/access/datafile/13652926"
ARCHIVE_SIZE = 1522193529  # DogReID-1553 V3 Images.zip
ROOT = pathlib.Path(__file__).resolve().parents[1] / ".demo-images" / "dogreid"
SELECTED = {
    "0062cada-a402-41bb-980e-6ae5e0672440": [
        "4f82f8da-1e3f-46f8-b48a-3a161d52cdf0",
        "6efb5b41-a90d-4833-b72a-3840bb0e9298",
        "ac31fe97-5ef0-414e-8911-8f1da9f5e0a9",
        "cd41e597-1c25-4120-a4dc-01fd7daabae1",
    ],
    "0072c0df-11b7-4ea9-8f41-d0a4d043c1c7": [
        "142def30-2012-42a0-9da9-2d700b59d2aa",
        "3a1ea585-ab17-43fb-a6e6-1466d7614eba",
        "6bd7aefa-7679-4688-9df2-a45d8a7e7fd1",
        "5f35e50b-e81a-41dc-90d1-59d0db4c43ce",
    ],
}


class RemoteZip(io.RawIOBase):
    def __init__(self):
        self.position = 0

    def seekable(self):
        return True

    def tell(self):
        return self.position

    def seek(self, offset, whence=0):
        self.position = offset if whence == 0 else self.position + offset if whence == 1 else ARCHIVE_SIZE + offset
        return self.position

    def read(self, length=-1):
        if length < 0:
            length = ARCHIVE_SIZE - self.position
        if not length:
            return b""
        end = min(ARCHIVE_SIZE - 1, self.position + length - 1)
        data = subprocess.check_output(["curl", "-fsSL", "--max-time", "60", "-r", f"{self.position}-{end}", ARCHIVE])
        if len(data) != end - self.position + 1:
            raise IOError("Dataset range response was incomplete")
        self.position += len(data)
        return data


def main():
    ROOT.mkdir(parents=True, exist_ok=True)
    required = [(dog, frame, ROOT / f"{dog}-{frame}.jpg") for dog, frames in SELECTED.items() for frame in frames]
    missing = [(dog, frame, path) for dog, frame, path in required if not path.exists()]
    if missing:
        with zipfile.ZipFile(RemoteZip()) as archive:
            for dog, frame, path in missing:
                name = f"Images/{dog}/{dog}-{frame}.jpg"
                data = archive.read(name)
                if len(data) < 100 or len(data) > 10_000_000 or not data.startswith(b"\xff\xd8"):
                    raise ValueError(f"Unexpected dataset image: {name}")
                path.write_bytes(data)
                print(f"Fetched {path.name}", flush=True)
    print(f"Ready: {len(required)} identity-labeled dog photos")


if __name__ == "__main__":
    main()
