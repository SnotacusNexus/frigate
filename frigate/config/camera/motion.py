import logging
from typing import Annotated, Any, Optional, Union

from pydantic import Field, field_serializer, model_validator

from ..base import FrigateBaseModel

__all__ = ["MotionConfig", "PtzMaskConfig", "check_ptz_mask_collisions"]

logger = logging.getLogger(__name__)


def check_ptz_mask_collisions(
    ptz_masks: dict[str, PtzMaskConfig]
) -> list[dict]:
    """
    Check for overlapping pan/tilt ranges between PTZ masks.

    Args:
        ptz_masks: Dictionary of PTZ mask configurations keyed by mask ID.

    Returns:
        List of collision dictionaries with:
        - mask1: First mask ID
        - mask2: Second mask ID
        - overlap_type: "pan", "tilt", or "both"
        - overlap_pan: (min_overlap, max_overlap) if pan overlaps
        - overlap_tilt: (min_overlap, max_overlap) if tilt overlaps
    """
    collisions = []
    mask_ids = list(ptz_masks.keys())

    for i, mask1_id in enumerate(mask_ids):
        mask1 = ptz_masks[mask1_id]

        for mask2_id in mask_ids[i + 1 :]:
            mask2 = ptz_masks[mask2_id]

            if mask1.spherical_coords != mask2.spherical_coords:
                continue

            pan_overlap = None
            tilt_overlap = None
            overlap_types = []

            if (
                mask1.pan_min is not None
                and mask1.pan_max is not None
                and mask2.pan_min is not None
                and mask2.pan_max is not None
            ):
                pan_min_overlap = max(mask1.pan_min, mask2.pan_min)
                pan_max_overlap = min(mask1.pan_max, mask2.pan_max)
                if pan_min_overlap < pan_max_overlap:
                    pan_overlap = (pan_min_overlap, pan_max_overlap)
                    overlap_types.append("pan")

            if (
                mask1.tilt_min is not None
                and mask1.tilt_max is not None
                and mask2.tilt_min is not None
                and mask2.tilt_max is not None
            ):
                tilt_min_overlap = max(mask1.tilt_min, mask2.tilt_min)
                tilt_max_overlap = min(mask1.tilt_max, mask2.tilt_max)
                if tilt_min_overlap < tilt_max_overlap:
                    tilt_overlap = (tilt_min_overlap, tilt_max_overlap)
                    overlap_types.append("tilt")

            if overlap_types:
                collisions.append({
                    "mask1": mask1_id,
                    "mask2": mask2_id,
                    "overlap_type": "both" if len(overlap_types) == 2 else overlap_types[0],
                    "overlap_pan": pan_overlap,
                    "overlap_tilt": tilt_overlap,
                })

    return collisions


class PtzMaskConfig(FrigateBaseModel):
    """Configuration for a PTZ-aware motion mask."""
    coordinates: str = Field(default="", title="Coordinates polygon for the motion mask.")
    pan_min: Optional[float] = Field(default=None, description="Minimum pan position (0-1)")
    pan_max: Optional[float] = Field(default=None, description="Maximum pan position (0-1)")
    tilt_min: Optional[float] = Field(default=None, description="Minimum tilt position (0-1)")
    tilt_max: Optional[float] = Field(default=None, description="Maximum tilt position (0-1)")
    spherical_coords: bool = Field(default=False, description="Use spherical coordinates (degrees) instead of relative (0-1)")
    rasterize_at_capture: bool = Field(default=False, description="Rasterize mask at capture time based on current PTZ position")


class MotionConfig(FrigateBaseModel):
    enabled: bool = Field(default=True, title="Enable motion on all cameras.")
    threshold: int = Field(
        default=30,
        title="Motion detection threshold (1-255).",
        ge=1,
        le=255,
    )
    lightning_threshold: float = Field(
        default=0.8, title="Lightning detection threshold (0.3-1.0).", ge=0.3, le=1.0
    )
    improve_contrast: bool = Field(default=True, title="Improve Contrast")
    contour_area: Optional[int] = Field(default=10, title="Contour Area")
    delta_alpha: float = Field(default=0.2, title="Delta Alpha")
    frame_alpha: float = Field(default=0.01, title="Frame Alpha")
    frame_height: Optional[int] = Field(default=100, title="Frame Height")
    mask: Union[str, list[str]] = Field(
        default="", title="Coordinates polygon for the motion mask."
    )
    mqtt_off_delay: int = Field(
        default=30,
        title="Delay for updating MQTT with no motion detected.",
    )
    enabled_in_config: Optional[bool] = Field(
        default=None, title="Keep track of original state of motion detection."
    )
    raw_mask: Union[str, list[str]] = ""
    ptz_masks: dict[str, PtzMaskConfig] = Field(default={}, title="PTZ-aware motion masks")
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

    @field_serializer("mask", when_used="json")
    def serialize_mask(self, value: Any, info):
        return self.raw_mask

    @field_serializer("raw_mask", when_used="json")
    def serialize_raw_mask(self, value: Any, info):
        return None

    @model_validator(mode="after")
    def check_ptz_mask_collisions(self):
        if self.ptz_masks:
            collisions = check_ptz_mask_collisions(self.ptz_masks)
            if collisions:
                for collision in collisions:
                    logger.warning(
                        f"PTZ mask collision detected: '{collision['mask1']}' overlaps with "
                        f"'{collision['mask2']}' ({collision['overlap_type']})"
                    )
        return self
