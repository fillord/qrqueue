from typing import Annotated, ClassVar
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from pydantic import AfterValidator, BaseModel, StringConstraints, model_validator


def valid_timezone(value: str) -> str:
    try:
        ZoneInfo(value)
    except (ZoneInfoNotFoundError, ValueError):
        raise ValueError("Unknown timezone")
    return value


def valid_password(value: str) -> str:
    if not 8 <= len(value.encode('utf-8')) <= 72:
        raise ValueError("Password must contain 8 to 72 UTF-8 bytes")
    return value


Name = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=200)]
Timezone = Annotated[str, AfterValidator(valid_timezone)]
Password = Annotated[str, AfterValidator(valid_password)]
Color = Annotated[str, StringConstraints(pattern=r'^#[0-9a-fA-F]{6}$')]
Prefix = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=10)]


class PatchModel(BaseModel):
    """Omission leaves a field alone; only explicitly nullable fields accept null."""
    nullable_fields: ClassVar[frozenset[str]] = frozenset()

    @model_validator(mode='before')
    @classmethod
    def reject_invalid_nulls(cls, data):
        if isinstance(data, dict):
            for field, value in data.items():
                if field in cls.model_fields and value is None and field not in cls.nullable_fields:
                    raise ValueError(f'{field} cannot be null')
        return data
