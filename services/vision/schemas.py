from typing import Annotated, Literal

from pydantic import AwareDatetime, BaseModel, ConfigDict, Field, StringConstraints, model_validator

from preprocess import MAX_ENCODED


Identifier = Annotated[str, StringConstraints(pattern=r"^[a-zA-Z0-9_.:-]+$", min_length=1, max_length=180)]
Text = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=256)]


class Input(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)


class Embed(Input):
    photoId: Identifier
    imageBase64: str = Field(min_length=1, max_length=MAX_ENCODED)
    petId: Identifier | None = None
    view: Literal["front", "left", "right", "marking", "other"] = "other"
    animalCount: int | None = Field(None, ge=0, le=100, strict=True)
    species: Text | None = None


class Compare(Input):
    leftPhotoId: Identifier
    rightPhotoId: Identifier


class Metadata(Input):
    latitude: float | None = Field(None, ge=-90, le=90)
    longitude: float | None = Field(None, ge=-180, le=180)
    species: Text | None = None
    attributes: dict[Text, Text] = Field(default_factory=dict, max_length=32)

    @model_validator(mode="after")
    def coordinates(self):
        if (self.latitude is None) != (self.longitude is None):
            raise ValueError("Supply both coordinates together")
        return self


class Reference(Metadata):
    petId: Identifier
    photoIds: set[Identifier] | None = Field(None, max_length=1000)
    missingSince: AwareDatetime | None = None


class Search(Metadata):
    candidatePhotoIds: list[Identifier] = Field(min_length=1, max_length=20)
    includeUnreviewed: bool = False
    references: list[Reference] | None = Field(None, max_length=500)
    radiusKm: float = Field(50, gt=0, le=20050)
    topK: int = Field(5, ge=1, le=100)
    aggregation: Literal["max", "topTwoMean"] = "max"
    observedAt: AwareDatetime | None = None

    @model_validator(mode="after")
    def distinct_ids(self):
        pet_ids = [r.petId for r in self.references or []]
        if len(set(pet_ids)) != len(pet_ids):
            raise ValueError("Supply one reference record per pet")
        return self
