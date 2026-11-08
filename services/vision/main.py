import hashlib
import logging
import os
import secrets
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, Response
from fastapi.exceptions import RequestValidationError
from starlette.datastructures import Headers
from starlette.responses import JSONResponse

from dinov2 import DinoEncoder, REVISION
from matching import cosine, rank
from preprocess import MAX_ENCODED, decode, prepare
from schemas import Compare, Embed, Identifier, Search
from vector_store import MODEL, PREPROCESSING, Photo, PhotoConflict, VectorStore


class InternalRequests:
    """Authenticate before FastAPI parses image bytes; cap chunked requests as well."""

    def __init__(self, app, secret):
        self.app = app
        self.secret = secret

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http" or scope["path"] == "/health":
            return await self.app(scope, receive, send)
        expected = self.secret()
        authorization = Headers(scope=scope).get("authorization", "")
        if not expected:
            return await JSONResponse({"detail": "Service secret unconfigured"}, 503)(scope, receive, send)
        if not secrets.compare_digest(authorization.encode(), ("Bearer " + expected).encode()):
            return await JSONResponse({"detail": "Authentication required"}, 401)(scope, receive, send)
        if scope["method"] == "POST":
            body = bytearray()
            limit = MAX_ENCODED + 32768
            while True:
                event = await receive()
                if event["type"] == "http.disconnect":
                    return
                part = event.get("body", b"")
                if len(body) + len(part) > limit:
                    return await JSONResponse({"detail": "Request too large"}, 413)(scope, receive, send)
                body.extend(part)
                if not event.get("more_body", False):
                    break
            async def replay():
                nonlocal body
                event = {"type": "http.request", "body": bytes(body), "more_body": False}
                body = bytearray()
                return event
            return await self.app(scope, replay, send)
        return await self.app(scope, receive, send)


def create_app(index_path=None, encoder=None, secret=None):
    def configured_secret():
        return secret if secret is not None else os.environ.get("INTERNAL_SERVICE_SECRET")

    @asynccontextmanager
    async def lifespan(app):
        app.state.store = VectorStore(index_path or os.getenv("VISION_INDEX_PATH", "data/vision.sqlite3"))
        yield

    app = FastAPI(title="PawSafe Vision", version="1.0", lifespan=lifespan)
    app.add_middleware(InternalRequests, secret=configured_secret)
    encoder = encoder or DinoEncoder()

    @app.exception_handler(RequestValidationError)
    async def invalid(_, error):
        # Pydantic includes the input value by default, which could echo private images.
        details = [{"loc": e["loc"], "msg": e["msg"]} for e in error.errors()]
        return JSONResponse({"detail": details}, 422)

    @app.get("/health")
    def health():
        configured = bool(configured_secret())
        return JSONResponse({"status": "ok" if configured else "unconfigured", "model": MODEL,
                             "revision": REVISION, "modelLoaded": getattr(encoder, "model", None) is not None},
                            200 if configured else 503)

    def lookup(photo_id):
        photo = app.state.store.get(photo_id)
        if not photo:
            raise HTTPException(404, f"Photo has no current embedding: {photo_id}")
        return photo

    @app.post("/v1/images/embed")
    def embed(request: Embed):
        try:
            raw = decode(request.imageBase64)
            digest = hashlib.sha256(raw).hexdigest()
            cached = app.state.store.get(request.photoId)
            if cached and (cached.digest != digest or cached.pet_id != request.petId):
                raise PhotoConflict("Photo ID already belongs to different content or pet")
            if cached:
                vector = cached.vector
            else:
                image = prepare(raw)
                try:
                    vector = encoder.encode(image)
                except (ImportError, OSError, RuntimeError, ValueError) as exc:
                    logging.getLogger(__name__).exception("DINOv2 inference failed")
                    raise HTTPException(503, "Image encoder unavailable") from exc
                finally:
                    image.close()
            count = app.state.store.put(Photo(request.photoId, digest, request.petId, request.view,
                                              request.species, request.animalCount, vector))
        except PhotoConflict as exc:
            raise HTTPException(409, str(exc)) from exc
        except ValueError as exc:
            raise HTTPException(422, str(exc)) from exc
        return {"photoId": request.photoId, "modelVersion": MODEL, "modelRevision": REVISION,
                "preprocessingVersion": PREPROCESSING, "embeddingRef": f"dinov2:{PREPROCESSING}:{request.photoId}",
                "reviewRequired": count != 1}

    @app.delete("/v1/images/{photo_id}", status_code=204)
    def delete(photo_id: Identifier):
        app.state.store.delete(photo_id)
        return Response(status_code=204)

    @app.post("/v1/images/compare")
    def compare(request: Compare):
        left, right = lookup(request.leftPhotoId), lookup(request.rightPhotoId)
        review = left.animal_count != 1 or right.animal_count != 1
        return {"model": MODEL, "visualSimilarity": None if review else cosine(left.vector, right.vector),
                "reviewRequired": review}

    @app.post("/v1/pets/search")
    def search(request: Search):
        candidates = [lookup(photo_id) for photo_id in dict.fromkeys(request.candidatePhotoIds)]
        review_ids = [p.photo_id for p in candidates if p.animal_count != 1]
        eligible = [p for p in candidates if p.animal_count == 1]
        pet_ids = None if request.references is None else [r.petId for r in request.references]
        views = app.state.store.references(pet_ids) if eligible else []
        return {"model": MODEL, "modelRevision": REVISION, "reviewPhotoIds": review_ids,
                "candidates": rank(request, eligible, views)}

    return app


app = create_app()
