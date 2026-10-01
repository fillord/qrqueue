from typing import Literal

from pydantic import BaseModel, Field, field_validator


class AssistantQuestion(BaseModel):
    message: str = Field(min_length=2, max_length=600)
    path: str = Field(default="/", max_length=160)
    locale: Literal["ru", "kk", "en"] = "ru"

    @field_validator("message")
    @classmethod
    def clean_message(cls, value: str) -> str:
        value = " ".join(value.split())
        if len(value) < 2:
            raise ValueError("message is empty")
        return value

    @field_validator("path")
    @classmethod
    def clean_path(cls, value: str) -> str:
        # The model only needs a route name. Query strings may contain tokens.
        path = value.split("?", 1)[0].split("#", 1)[0]
        return path if path.startswith("/") else "/"


class AssistantAnswer(BaseModel):
    answer: str
    source: Literal["gemini"] = "gemini"


class AssistantStatus(BaseModel):
    available: bool
