from pydantic import BaseModel, ConfigDict


class WireModel(BaseModel):
    # Responses carry every field: mark them required in the output schema.
    model_config = ConfigDict(json_schema_serialization_defaults_required=True)
