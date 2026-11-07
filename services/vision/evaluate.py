"""Evaluate held-out, labeled photos with the serving preprocessor and ranking logic."""

import argparse
import hashlib
import json
from collections import defaultdict
from pathlib import Path
from urllib.request import Request, urlopen

from dinov2 import DinoEncoder, REVISION
from matching import rank
from preprocess import MAX_BYTES, prepare
from schemas import Search
from vector_store import MODEL, PREPROCESSING, Photo


def ratio(n, d):
    return n / d if d else None


def metrics(rows, threshold):
    known = [row for row in rows if row["known"]]
    absent = [row for row in rows if not row["known"]]
    negatives = [score for row in rows for score in row["unrelatedScores"]]
    result = {"queries": len(rows), "known": len(known), "absent": len(absent),
              "recallAt1": ratio(sum(r["rank"] == 1 for r in known), len(known)),
              "recallAt3": ratio(sum(r["rank"] is not None and r["rank"] <= 3 for r in known), len(known))}
    if threshold is not None:
        result["knownMatchAlertRate"] = ratio(
            sum(r["correctScore"] is not None and r["correctScore"] >= threshold for r in known), len(known))
        result["unrelatedFalsePositiveRate"] = ratio(sum(s >= threshold for s in negatives), len(negatives))
        result["absentFalseAlertRate"] = ratio(sum(r["bestScore"] >= threshold for r in absent), len(absent))
    return result


def evaluate(entries, threshold, aggregation):
    gallery = [photo for row, photo in entries if row["split"] == "gallery"]
    enrolled = {photo.pet_id for photo in gallery}
    if not gallery or not any(row["split"] == "query" for row, _ in entries):
        raise ValueError("Include gallery and query photographs")
    if len(enrolled) > 100:
        raise ValueError("Use up to 100 enrolled identities per evaluation gallery")
    rows = []
    groups = defaultdict(list)
    for row, photo in entries:
        if row["split"] == "gallery":
            continue
        request = Search(candidatePhotoIds=[photo.photo_id], topK=100, aggregation=aggregation)
        matches = rank(request, [photo], gallery)
        identity = row["petId"]
        ids = [m["petId"] for m in matches]
        result = {"photoId": photo.photo_id, "known": identity in enrolled,
                  "rank": ids.index(identity) + 1 if identity in ids else None,
                  "correctScore": matches[ids.index(identity)]["combinedScore"] if identity in ids else None,
                  "bestScore": matches[0]["combinedScore"] if matches else 0,
                  "unrelatedScores": [m["combinedScore"] for m in matches if m["petId"] != identity]}
        rows.append(result)
        for tag in row.get("conditions", []):
            groups[tag].append(result)
    return {"model": MODEL, "revision": REVISION, "preprocessing": PREPROCESSING,
            "aggregation": aggregation, "threshold": threshold, "overall": metrics(rows, threshold),
            "byCondition": {tag: metrics(group, threshold) for tag, group in groups.items()}, "queries": rows}


def load(manifest, fetch=False):
    encoder = DinoEncoder()
    entries, ids, digests = [], set(), set()
    for row in json.loads(manifest.read_text(encoding="utf-8")):
        if row["split"] not in ("gallery", "query") or not row["petId"] or row["photoId"] in ids:
            raise ValueError("Invalid split, identity or duplicate photo ID")
        ids.add(row["photoId"])
        if "file" in row:
            with (manifest.parent / row["file"]).open("rb") as source:
                raw = source.read(MAX_BYTES + 1)
        else:
            if not fetch or not row["imageUrl"].startswith("https://"):
                raise ValueError("Supply local file paths or enable HTTPS image downloads with --fetch")
            request = Request(row["imageUrl"], headers={"User-Agent": "PawSafe-Vision-Eval/1.0"})
            with urlopen(request, timeout=30) as response:
                raw = response.read(MAX_BYTES + 1)
        digest = hashlib.sha256(raw).hexdigest()
        if len(raw) > MAX_BYTES or digest in digests:
            raise ValueError("Oversized or duplicate image in evaluation manifest")
        digests.add(digest)
        with prepare(raw) as image:
            vector = encoder.encode(image)
        pet_id = row["petId"] if row["split"] == "gallery" else None
        entries.append((row, Photo(row["photoId"], digest, pet_id, "other", row.get("species"), 1, vector)))
    return entries


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("manifest", type=Path)
    parser.add_argument("--fetch", action="store_true", help="Download the manifest's labeled HTTPS photos")
    parser.add_argument("--threshold", type=float, help="Evaluate a proposed combined-score cutoff in [0,1]")
    args = parser.parse_args()
    if args.threshold is not None and not 0 <= args.threshold <= 1:
        parser.error("--threshold must be in [0,1]")
    entries = load(args.manifest, args.fetch)
    print(json.dumps([evaluate(entries, args.threshold, mode) for mode in ("max", "topTwoMean")], indent=2))
