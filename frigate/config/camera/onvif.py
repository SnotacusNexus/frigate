from enum import Enum
from typing import Annotated, Optional, Union

from pydantic import Field, field_validator, model_validator

from ..base import FrigateBaseModel
from ..env import EnvString
from .objects import DEFAULT_TRACKED_OBJECTS

__all__ = ["OnvifConfig", "PtzAutotrackConfig", "ZoomingModeEnum"]


class ZoomingModeEnum(str, Enum):
    disabled = "disabled"
    absolute = "absolute"
    relative = "relative"


class PtzAutotrackConfig(FrigateBaseModel):
    enabled: bool = Field(default=False, title="Enable PTZ object autotracking.")
    calibrate_on_startup: bool = Field(
        default=False, title="Perform a camera calibration when Frigate starts."
    )
    zooming: ZoomingModeEnum = Field(
        default=ZoomingModeEnum.disabled, title="Autotracker zooming mode."
    )
    zoom_factor: float = Field(
        default=0.3,
        title="Zooming factor (0.1-0.75).",
        ge=0.1,
        le=0.75,
    )
    track: list[str] = Field(default=DEFAULT_TRACKED_OBJECTS, title="Objects to track.")
    required_zones: list[str] = Field(
        default_factory=list,
        title="List of required zones to be entered in order to begin autotracking.",
    )
    return_preset: str = Field(
        default="home",
        title="Name of camera preset to return to when object tracking is over.",
    )
    timeout: int = Field(
        default=10, title="Seconds to delay before returning to preset."
    )
    movement_weights: Optional[Union[str, list[str]]] = Field(
        default_factory=list,
        title="Internal value used for PTZ movements based on the speed of your camera's motor.",
    )
    enabled_in_config: Optional[bool] = Field(
        default=None, title="Keep track of original state of autotracking."
    )

    @field_validator("movement_weights", mode="before")
    @classmethod
    def validate_weights(cls, v):
        if v is None:
            return None

        if isinstance(v, str):
            weights = list(map(str, map(float, v.split(","))))
        elif isinstance(v, list):
            weights = [str(float(val)) for val in v]
        else:
            raise ValueError("Invalid type for movement_weights")

        if len(weights) != 6:
            raise ValueError(
                "movement_weights must have exactly 6 floats, remove this line from your config and run autotracking calibration"
            )

        return weights


class OnvifConfig(FrigateBaseModel):
    host: str = Field(default="", title="Onvif Host")
    port: int = Field(default=8000, title="Onvif Port")
    user: Optional[EnvString] = Field(default=None, title="Onvif Username")
    password: Optional[EnvString] = Field(default=None, title="Onvif Password")
    tls_insecure: bool = Field(default=False, title="Onvif Disable TLS verification")
    autotracking: PtzAutotrackConfig = Field(
        default_factory=PtzAutotrackConfig,
        title="PTZ auto tracking config.",
    )
    ignore_time_mismatch: bool = Field(
        default=False,
        title="Onvif Ignore Time Synchronization Mismatch Between Camera and Server",
    )
    home_position: Optional[dict] = Field(
        default=None,
        description="Home position: {pan, tilt, zoom}",
    )
    calibrate_on_startup: bool = Field(
        default=True,
        description="Home camera on Frigate startup",
    )
    horizontal_fov: float = Field(
        default=90.0,
        description="Camera horizontal field of view in degrees",
    )
    vertical_fov: float = Field(
        default=60.0,
        description="Camera vertical field of view in degrees",
    )
    pan_range: Annotated[tuple[float, float], Field(default=(-180, 180))] = (-180, 180)
    tilt_range: Annotated[tuple[float, float], Field(default=(-90, 90))] = (-90, 90)

    @model_validator(mode="after")
    def validate_ranges(self) -> "OnvifConfig":
        if self.pan_range[0] >= self.pan_range[1]:
            raise ValueError("pan_range[0] must be less than pan_range[1]")
        if self.tilt_range[0] >= self.tilt_range[1]:
            raise ValueError("tilt_range[0] must be less than tilt_range[1]")
        return self
