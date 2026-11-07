import base64
import tempfile
import unittest
from io import BytesIO
from pathlib import Path

import numpy as np
from fastapi.testclient import TestClient
from PIL import Image

from main import create_app
from preprocess import prepare
from vector_store import DIMENSIONS


def picture(color="red", size=(64, 64)):
    out = BytesIO()
    Image.new("RGB", size, color).save(out, format="PNG")
    return base64.b64encode(out.getvalue()).decode()


class TestEncoder:
    def __init__(self):
        self.calls = 0

    def encode(self, image):
        self.calls += 1
        vector = np.zeros(DIMENSIONS, dtype=np.float32)
        vector[:3] = image.getpixel((0, 0))
        return vector


class ServiceTest(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.index = Path(temp.name) / "index.sqlite"
        self.encoder = TestEncoder()
        self.app = create_app(self.index, self.encoder, "secret")
        self.client = self.enterContext(TestClient(self.app, headers={"Authorization": "Bearer secret"}))

    def embed(self, photo_id, color="red", **metadata):
        return self.client.post("/v1/images/embed", json={
            "photoId": photo_id, "imageBase64": picture(color), **metadata})

    def search(self, *photo_ids, **fields):
        response = self.client.post("/v1/pets/search", json={"candidatePhotoIds": photo_ids, **fields})
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()

    def test_multi_angle_ranking_unknowns_and_filters(self):
        for photo, color, pet in [("side", "blue", "max"), ("face", "red", "max"),
                                  ("other", "green", "other"), ("cat", "red", "cat")]:
            self.assertEqual(self.embed(photo, color, petId=pet, animalCount=1,
                                        species="cat" if pet == "cat" else "dog").status_code, 200)
        self.embed("seen", "red", animalCount=1, species="dog")
        matches = self.search("seen")["candidates"]
        self.assertEqual([m["petId"] for m in matches], ["max", "other"])
        self.assertEqual(matches[0]["matchingPhotoId"], "face")
        self.assertEqual(matches[0]["visualSimilarity"], 1)
        self.assertIsNone(matches[0]["components"]["geographic"])
        self.assertEqual(matches[0]["combinedScore"], 1)
        two_views = self.search("seen", aggregation="topTwoMean")["candidates"][0]
        self.assertEqual(two_views["matchingPhotoId"], "face")
        self.assertEqual(two_views["visualSimilarity"], .5)
        refs = [{"petId": "max", "missingSince": "2026-11-01T12:00:00Z", "latitude": 1, "longitude": 2}]
        self.assertFalse(self.search("seen", references=refs, observedAt="2026-10-01T00:00:00Z")["candidates"])
        self.assertFalse(self.search("seen", references=refs, latitude=40, longitude=2)["candidates"])
        match = self.search("seen", references=refs, latitude=1, longitude=2,
                            observedAt="2026-11-02T13:00:00Z")["candidates"][0]
        self.assertLess(match["combinedScore"], 1)
        self.assertEqual(match["components"]["geographic"], 1)
        self.assertFalse(self.search("seen", references=[])["candidates"])

    def test_report_scoped_reference_photos(self):
        self.embed("history", "red", petId="p", animalCount=1)
        self.embed("current", "blue", petId="p", animalCount=1)
        self.embed("somebody-else", "red", petId="other", animalCount=1)
        self.embed("seen", "red", animalCount=1)
        allowed = [{"petId": "p", "photoIds": ["current", "somebody-else"]}]
        for method in ("max", "topTwoMean"):
            results = self.search("seen", references=allowed, aggregation=method)["candidates"]
            self.assertEqual(len(results), 1)
            self.assertEqual(results[0]["matchingPhotoId"], "current")
            self.assertEqual(results[0]["visualSimilarity"], 0)
        self.assertEqual(self.search("seen", references=[{"petId": "p", "photoIds": []}])["candidates"], [])

    def test_multiple_unknown_animals_and_manual_clearance(self):
        self.embed("ref", petId="p", animalCount=1)
        self.embed("unconfirmed")
        self.embed("two", animalCount=2)
        result = self.search("unconfirmed", "two")
        self.assertEqual(result["candidates"], [])
        self.assertEqual(result["reviewPhotoIds"], ["unconfirmed", "two"])
        compare = {"leftPhotoId": "ref", "rightPhotoId": "two"}
        self.assertIsNone(self.client.post("/v1/images/compare", json=compare).json()["visualSimilarity"])
        self.embed("unconfirmed", animalCount=1)
        self.assertTrue(self.search("unconfirmed")["candidates"])

    def test_idempotency_durability_and_source_removal(self):
        self.embed("one", petId="p", animalCount=1)
        self.assertEqual(self.embed("one", petId="p").json()["reviewRequired"], False)
        self.assertEqual(self.encoder.calls, 1)
        self.assertEqual(self.embed("one", "blue", petId="p").status_code, 409)
        self.assertEqual(self.embed("one", petId="q").status_code, 409)
        self.embed("report", animalCount=1)
        with TestClient(create_app(self.index, TestEncoder(), "secret"),
                        headers={"Authorization": "Bearer secret"}) as restarted:
            payload = {"leftPhotoId": "one", "rightPhotoId": "report"}
            self.assertEqual(restarted.post("/v1/images/compare", json=payload).json()["visualSimilarity"], 1)
            for _ in range(2):
                self.assertEqual(restarted.delete("/v1/images/one").status_code, 204)
            self.assertEqual(restarted.post("/v1/images/compare", json=payload).status_code, 404)

    def test_invalid_images_and_authentication(self):
        self.assertEqual(self.client.get("/health", headers={"Authorization": ""}).status_code, 200)
        self.assertEqual(self.client.post("/v1/images/embed", content="bad",
                                          headers={"Authorization": ""}).status_code, 401)
        for encoded in ["bad%%", base64.b64encode(b"not a picture").decode(), picture(size=(16, 64))]:
            response = self.client.post("/v1/images/embed", json={"imageBase64": encoded, "photoId": "invalid"})
            self.assertEqual(response.status_code, 422)
            self.assertNotIn(encoded, response.text)
        response = self.client.post("/v1/pets/search", json={"candidatePhotoIds": ["x"], "latitude": 1})
        self.assertEqual(response.status_code, 422)
        self.assertEqual(self.encoder.calls, 0)

    def test_exif_orientation(self):
        out = BytesIO()
        original = Image.new("L", (64, 32))
        exif = original.getexif()
        exif[274] = 6
        original.save(out, format="JPEG", exif=exif)
        image = prepare(out.getvalue())
        self.assertEqual(image.size, (32, 64))
        self.assertEqual(image.mode, "RGB")


if __name__ == "__main__":
    unittest.main()
