from collections import defaultdict
from math import asin, cos, exp, radians, sin, sqrt

import numpy as np


def cosine(left, right):
    return float(np.clip(left @ right, -1, 1))


def distance_km(lat1, lon1, lat2, lon2):
    lat1, lon1, lat2, lon2 = map(radians, [lat1, lon1, lat2, lon2])
    a = sin((lat2 - lat1) / 2)**2 + cos(lat1) * cos(lat2) * sin((lon2 - lon1) / 2)**2
    return 12742 * asin(sqrt(min(1, max(0, a))))


def normalized(value):
    return value.casefold().strip() if value else ""


def attributes_score(left, right):
    scores = []
    for key in left.keys() & right.keys():
        a = {normalized(v) for v in left[key].split(",")} - {"", "unknown"}
        b = {normalized(v) for v in right[key].split(",")} - {"", "unknown"}
        if a and b:
            scores.append(len(a & b) / len(a | b))
    return sum(scores) / len(scores) if scores else None


def rank(request, candidates, photos):
    metadata = {r.petId: r for r in request.references or []}
    by_pet = defaultdict(list)
    for photo in photos:
        reference = metadata.get(photo.pet_id)
        if reference and reference.photoIds is not None and photo.photo_id not in reference.photoIds:
            continue
        by_pet[photo.pet_id].append(photo)
    matches = []
    for pet_id, views in by_pet.items():
        reference = metadata.get(pet_id)
        geo = appearance = time = None
        if reference:
            if reference.missingSince and request.observedAt:
                elapsed_days = (request.observedAt - reference.missingSince).total_seconds() / 86400
                if elapsed_days < 0:
                    continue
                time = exp(-elapsed_days / 30)
            if reference.latitude is not None and request.latitude is not None:
                distance = distance_km(reference.latitude, reference.longitude,
                                       request.latitude, request.longitude)
                if distance > request.radiusKm:
                    continue
                geo = max(0, 1 - distance / request.radiusKm)
            appearance = attributes_score(request.attributes, reference.attributes)

        pairs = []
        for candidate in candidates:
            observed_species = normalized(request.species or candidate.species)
            view_scores = []
            for view in views:
                species = normalized((reference.species if reference else None) or view.species)
                if all(s not in {"", "unknown"} for s in (observed_species, species)) and observed_species != species:
                    continue
                if candidate.pet_id == pet_id or candidate.photo_id == view.photo_id:
                    continue
                view_scores.append((cosine(candidate.vector, view.vector), view.photo_id))
            if view_scores:
                view_scores.sort(key=lambda pair: (-pair[0], pair[1]))
                top = view_scores[:2] if request.aggregation == "topTwoMean" else view_scores[:1]
                pairs.append((sum(s for s, _ in top) / len(top), candidate.photo_id, top[0][1]))
        if not pairs:
            continue
        visual, candidate_id, photo_id = min(pairs, key=lambda p: (-p[0], p[1], p[2]))
        components = {"visual": (visual + 1) / 2, "geographic": geo,
                      "attributes": appearance, "time": time}
        weighted = [(components[k], w) for k, w in (("visual", .55), ("geographic", .20),
                    ("attributes", .15), ("time", .10)) if components[k] is not None]
        combined = sum(v * w for v, w in weighted) / sum(w for _, w in weighted)
        matches.append({"petId": pet_id, "matchingPhotoId": photo_id, "candidatePhotoId": candidate_id,
                        "visualSimilarity": visual, "combinedScore": combined, "components": components,
                        "matchStatus": "possible"})
    return sorted(matches, key=lambda m: (-m["combinedScore"], -m["visualSimilarity"], m["petId"]))[:request.topK]
