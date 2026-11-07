"""Durable, derived photo embeddings. Application state lives in SpacetimeDB."""

import sqlite3
from contextlib import closing
from dataclasses import dataclass
from pathlib import Path

import numpy as np


MODEL = "facebook/dinov2-base"
PREPROCESSING = "exif-rgb-cls-v1"
DIMENSIONS = 768


class PhotoConflict(ValueError):
    pass


def normalize(vector):
    vector = np.asarray(vector, dtype="<f4")
    if vector.shape != (DIMENSIONS,) or not np.all(np.isfinite(vector)):
        raise ValueError("Invalid embedding")
    norm = np.linalg.norm(vector)
    if not np.isfinite(norm) or norm <= 0:
        raise ValueError("Empty embedding")
    return vector / norm


@dataclass
class Photo:
    photo_id: str
    digest: str
    pet_id: str | None
    view: str
    species: str | None
    animal_count: int | None
    vector: np.ndarray


class VectorStore:
    def __init__(self, path):
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with closing(self.connect()) as db, db:
            db.execute("PRAGMA journal_mode=WAL")
            db.execute("""CREATE TABLE IF NOT EXISTS embeddings (
                photo_id TEXT PRIMARY KEY, digest TEXT NOT NULL, pet_id TEXT,
                view TEXT NOT NULL, species TEXT, animal_count INTEGER,
                model TEXT NOT NULL, preprocessing TEXT NOT NULL, vector BLOB NOT NULL
            )""")
            db.execute("CREATE INDEX IF NOT EXISTS by_pet ON embeddings(pet_id)")

    def connect(self):
        return sqlite3.connect(self.path, timeout=10)

    @staticmethod
    def unpack(row):
        return Photo(*row[:-1], np.frombuffer(row[-1], dtype="<f4"))

    def get(self, photo_id):
        with closing(self.connect()) as db:
            row = db.execute("""SELECT photo_id,digest,pet_id,view,species,animal_count,vector
                FROM embeddings WHERE photo_id=? AND model=? AND preprocessing=?""",
                (photo_id, MODEL, PREPROCESSING)).fetchone()
        return self.unpack(row) if row else None

    def put(self, photo):
        vector = normalize(photo.vector).astype("<f4").tobytes()
        with closing(self.connect()) as db, db:
            db.execute("BEGIN IMMEDIATE")
            cursor = db.execute("""INSERT INTO embeddings VALUES(?,?,?,?,?,?,?,?,?)
                ON CONFLICT(photo_id) DO UPDATE SET
                animal_count=COALESCE(excluded.animal_count,embeddings.animal_count),
                species=COALESCE(excluded.species,embeddings.species),view=excluded.view,
                model=excluded.model,preprocessing=excluded.preprocessing,vector=excluded.vector
                WHERE embeddings.digest=excluded.digest AND embeddings.pet_id IS excluded.pet_id
                RETURNING animal_count""",
                (photo.photo_id, photo.digest, photo.pet_id, photo.view, photo.species,
                 photo.animal_count, MODEL, PREPROCESSING, vector))
            row = cursor.fetchone()
            if row is None:
                raise PhotoConflict("Photo ID already belongs to different content or pet")
            return row[0]

    def references(self, pet_ids=None):
        sql = """SELECT photo_id,digest,pet_id,view,species,animal_count,vector
                 FROM embeddings WHERE pet_id IS NOT NULL AND animal_count=1
                 AND model=? AND preprocessing=?"""
        args = [MODEL, PREPROCESSING]
        if pet_ids is not None:
            if not pet_ids:
                return []
            sql += " AND pet_id IN (" + ",".join("?" for _ in pet_ids) + ")"
            args.extend(pet_ids)
        with closing(self.connect()) as db:
            return [self.unpack(row) for row in db.execute(sql, args)]

    def delete(self, photo_id):
        with closing(self.connect()) as db, db:
            db.execute("DELETE FROM embeddings WHERE photo_id=?", (photo_id,))
