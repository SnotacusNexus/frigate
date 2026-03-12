# PTZ Dynamic Masks Technical Specification

## 1. Executive Summary

The PTZ Dynamic Masks feature enables PTZ (Pan-Tilt-Zoom) cameras to use different motion masks at different camera positions. This addresses a fundamental limitation of static masks: when a PTZ camera moves to different preset positions, the fixed mask areas become irrelevant or create blind spots. This feature automatically switches between configured mask sets based on the camera's current pan, tilt, and zoom position, ensuring consistent and accurate motion detection across all PTZ camera positions.

## 2. Problem Statement

PTZ cameras present unique challenges for motion detection and mask configuration:

1. **Position-Dependent Masks**: A static mask configured for one PTZ preset position becomes ineffective when the camera moves to a different position. Areas that should be masked (e.g., trees, roads) in one position may be completely different from another position.

2. **Blind Spots**: When masks are not adjusted for different positions, motion in important areas may be missed, or conversely, unwanted motion may trigger false positives.

3. **Manual Configuration Burden**: Users currently must manually create separate mask configurations or disable masks entirely for PTZ cameras, resulting in either degraded motion detection or increased false positives.

4. **Limited Coverage**: Static masks cannot account for the full range of motion possible from a PTZ camera, especially when using presets or autotracking.

## 3. Proposed Solution

The PTZ Dynamic Masks feature provides automatic mask switching based on camera position:

1. **Position-Aware Masks**: Each mask can be associated with a PTZ position range (pan_min, pan_max, tilt_min, tilt_max). When the camera moves within those bounds, the corresponding mask becomes active.

2. **Position Capture**: Users can capture the current PTZ position while viewing the camera feed and associate it with a mask.

3. **Runtime Mask Switching**: The motion detection system continuously monitors PTZ position and dynamically applies the appropriate mask without requiring camera restarts.

4. **Tolerance Ranges**: Each mask can include tolerance ranges to provide smooth transitions between positions and account for minor position drift.

## 4. Technical Implementation

### 4.1 Backend Changes

#### 4.1.1 Configuration Models

**PtzMaskConfig** (frigate/config/camera/motion.py):
```python
class PtzMaskConfig(FrigateBaseModel):
    """Configuration for a PTZ-aware motion mask."""
    coordinates: str = Field(default="", title="Coordinates polygon for the motion mask.")
    pan_min: Optional[float] = Field(default=None, description="Minimum pan position (0-1)")
    pan_max: Optional[float] = Field(default=None, description="Maximum pan position (0-1)")
    tilt_min: Optional[float] = Field(default=None, description="Minimum tilt position (0-1)")
    tilt_max: Optional[float] = Field(default=None, description="Maximum tilt position (0-1)")
```

**MotionConfig** extension:
- Added `ptz_masks: dict[str, PtzMaskConfig]` field to store multiple PTZ-aware masks
- Masks are keyed by user-defined names for easy identification

**RuntimeMotionConfig** (frigate/config/config.py):
- Added `ptz_masks_rasterized: Optional[dict]` for pre-rendered mask arrays
- Added `ptz_masks_raw: Optional[dict]` for storing raw coordinate data
- Processor converts string coordinates to binary masks during config loading

#### 4.1.2 Motion Detection Integration

**ImprovedMotionDetector** (frigate/motion/improved_motion.py):

The motion detector receives PTZ metrics and updates the active mask:

```python
def update_ptz_mask(self) -> None:
    """Update the motion mask based on current PTZ position."""
    pan = self.ptz_metrics.pan.value
    tilt = self.ptz_metrics.tilt.value
    
    active_coords = get_active_masks(ptz_masks, pan, tilt)
    
    if active_coords:
        dynamic_mask = create_mask(self.frame_shape, active_coords)
        # Apply to detection pipeline
```

Key implementation details:
- Mask updates only occur when PTZ position changes significantly (>0.01 threshold)
- Multiple masks can be active simultaneously (OR logic)
- Masks without PTZ constraints are always active (global masks)

#### 4.1.3 Utility Functions

**get_active_masks** (frigate/util/image.py):
```python
def get_active_masks(ptz_masks: dict, pan: float, tilt: float) -> list:
    """
    Get masks that should be active based on PTZ position.
    
    Returns list of mask coordinate strings that are active for the current position.
    """
```

Logic:
1. Iterate through all configured PTZ masks
2. For each mask, check if PTZ constraints are defined
3. If no constraints, mask is always active (global mask)
4. If constraints exist, check if current pan/tilt falls within range
5. Return list of active mask coordinates

#### 4.1.4 PTZ Position Tracking

**PTZMetrics** (frigate/camera/__init__.py):

```python
class PTZMetrics:
    pan: Synchronized      # 0-1 range, 0.5 = center
    tilt: Synchronized    # 0-1 range, 0.5 = center
    zoom_level: Synchronized  # 0-1 range
    # ... additional fields
```

**OnvifController** (frigate/ptz/onvif.py):
- Updates PTZMetrics with current position during polling
- Supports absolute position queries via ONVIF GetStatus
- Falls back to relative position tracking when absolute unavailable

### 4.2 API Endpoints

#### 4.2.1 GET /api/{camera}/ptz/position

Returns the current PTZ position for a camera.

**Response**:
```json
{
  "pan": 0.5,
  "tilt": 0.3,
  "zoom": 0.0
}
```

**Implementation**: Route handler retrieves current values from PTZMetrics shared values.

#### 4.2.2 PUT /config/set

PTZ masks are saved via the existing config set endpoint using query parameters:

```
PUT /config/set?cameras.{camera}.motion.ptz_masks.{mask_name}.coordinates={coords}
PUT /config/set?cameras.{camera}.motion.ptz_masks.{mask_name}.pan_min={value}
PUT /config/set?cameras.{camera}.motion.ptz_masks.{mask_name}.pan_max={value}
PUT /config/set?cameras.{camera}.motion.ptz_masks.{mask_name}.tilt_min={value}
PUT /config/set?cameras.{camera}.motion.ptz_masks.{mask_name}.tilt_max={value}
```

**requires_restart**: 0 (dynamic update, no restart required)

### 4.3 Frontend Changes

#### 4.3.1 PTZ Mask Editor Component

**Location**: `web/src/components/settings/PtzMaskEditor.tsx`

**Features**:
1. **PTZ Controls Overlay**: D-pad controls for pan/tilt and zoom buttons
2. **Live Position Display**: Shows current pan, tilt, zoom values (auto-refresh every 2s)
3. **Position Capture**: Button to capture current PTZ position for selected mask
4. **Range Configuration**: Input fields for pan_min, pan_max, tilt_min, tilt_max
5. **Polygon Drawing**: Canvas-based mask drawing with standard editing controls

**PtzMaskPolygon Type**:
```typescript
type PtzMaskPolygon = Polygon & {
  ptzPosition?: CameraPtzPosition;
  ptzRange?: {
    pan_min?: number;
    pan_max?: number;
    tilt_min?: number;
    tilt_max?: number;
  };
};
```

#### 4.3.2 Save Workflow

1. User draws polygon on canvas
2. User positions camera using PTZ controls
3. User clicks "Capture Current PTZ Position"
4. User optionally adjusts tolerance ranges
5. On save, coordinates and PTZ ranges are serialized to config format

### 4.4 ONVIF Improvements

The PTZ Dynamic Masks feature builds upon ONVIF support:

1. **Position Tracking**: Uses existing ONVIF GetStatus for absolute position
2. **Fallback Handling**: Works with cameras that only support relative movement
3. **Polling**: Position is polled periodically and stored in PTZMetrics
4. **Preset Support**: PTZ masks can be associated with named presets

## 5. Configuration

### 5.1 config.yaml Example

```yaml
cameras:
  ptz_door:
    ffmpeg:
      inputs:
        - path: rtsp://camera/stream1
          roles:
            - detect
            - record
    detect:
      width: 1280
      height: 720
    motion:
      mask:
        - "0,0,100,0,100,100,0,100"  # Global mask (always applied)
      ptz_masks:
        door_preset:
          coordinates: "640,360,800,360,800,500,640,500"
          pan_min: 0.4
          pan_max: 0.6
          tilt_min: 0.4
          tilt_max: 0.6
        walkway_preset:
          coordinates: "100,200,400,200,400,400,100,400"
          pan_min: 0.1
          pan_max: 0.3
          tilt_min: 0.2
          tilt_max: 0.4
        global_trees:
          coordinates: "0,600,300,600,300,720,0,720"
          # No PTZ constraints - always applied
```

### 5.2 Configuration Options

| Option | Type | Description |
|--------|------|-------------|
| `coordinates` | string | Polygon coordinates (x1,y1,x2,y2,...) |
| `pan_min` | float | Minimum pan position (0-1) for mask activation |
| `pan_max` | float | Maximum pan position (0-1) for mask activation |
| `tilt_min` | float | Minimum tilt position (0-1) for mask activation |
| `tilt_max` | float | Maximum tilt position (0-1) for mask activation |

### 5.3 Position Mapping

- **pan**: 0.0 = far left, 0.5 = center, 1.0 = far right
- **tilt**: 0.0 = bottom, 0.5 = center, 1.0 = top
- **zoom**: 0.0 = minimum zoom, 1.0 = maximum zoom

Note: Actual ranges may vary by camera manufacturer. The UI displays normalized 0-1 values.

## 6. API Specification

### 6.1 GET /api/{camera}/ptz/position

**Description**: Returns the current PTZ position for a camera.

**Path Parameters**:
- `camera` (string): Name of the camera

**Response** (200 OK):
```json
{
  "pan": 0.5,
  "tilt": 0.3,
  "zoom": 0.0
}
```

**Error Responses**:
- 404: Camera not found or not a PTZ camera
- 500: Internal server error

### 6.2 PUT /config/set

**Description**: Set configuration values including PTZ masks.

**Query Parameters**:
- `cameras.{camera}.motion.ptz_masks.{name}.coordinates` - Mask polygon coordinates
- `cameras.{camera}.motion.ptz_masks.{name}.pan_min` - Minimum pan position
- `cameras.{camera}.motion.ptz_masks.{name}.pan_max` - Maximum pan position
- `cameras.{camera}.motion.ptz_masks.{name}.tilt_min` - Minimum tilt position
- `cameras.{camera}.motion.ptz_masks.{name}.tilt_max` - Maximum tilt position

**Request Body**:
```json
{
  "requires_restart": 0
}
```

**Response** (200 OK):
```json
{
  "success": true
}
```

### 6.3 GET /api/config

**Description**: Retrieve full configuration including PTZ masks.

**Response** (200 OK):
```json
{
  "cameras": {
    "ptz_door": {
      "motion": {
        "ptz_masks": {
          "door_preset": {
            "coordinates": "640,360,800,360,800,500,640,500",
            "pan_min": 0.4,
            "pan_max": 0.6,
            "tilt_min": 0.4,
            "tilt_max": 0.6
          }
        }
      }
    }
  }
}
```

## 7. User Interface

### 7.1 PTZ Mask Editor Workflow

1. **Access**: Navigate to Camera Settings > Motion Masks > PTZ Masks tab

2. **Canvas Area**: 
   - Live camera feed displayed on canvas
   - Existing PTZ masks shown as semi-transparent overlays
   - Different colors indicate different PTZ position ranges

3. **PTZ Controls**:
   - D-pad for pan/tilt movement
   - Zoom in/out buttons
   - Stop button to halt movement
   - Controls appear as overlay on canvas and as separate panel

4. **Position Display**:
   - Current pan, tilt, zoom values shown
   - Auto-refreshes every 2 seconds
   - Manual refresh button available

5. **Mask Creation**:
   - Click "Add Mask" to create new polygon
   - Draw polygon by clicking points on canvas
   - Close polygon to finish

6. **Position Capture**:
   - Select a mask polygon
   - Position camera to desired preset
   - Click "Capture Current PTZ Position"
   - Coordinates are automatically recorded

7. **Range Adjustment**:
   - After capture, optionally adjust tolerance ranges
   - Pan range: min/max values for pan position
   - Tilt range: min/max values for tilt position
   - Wider ranges = more tolerance for position drift

8. **Save**:
   - Click Save to persist configuration
   - Masks take effect immediately (no restart)

### 7.2 PTZ Controls Overlay

The PTZ controls overlay appears on the canvas when in PTZ mask editing mode:

```
    [Up]
[Left][Right]
    [Down]
    
 [Zoom-] [Zoom+]
    [Stop]
```

- Controls are semi-transparent
- Mouse down = start movement
- Mouse up = stop movement
- Touch support for mobile devices

### 7.3 Position Capture Display

When a position is captured, the UI displays:

```
Captured Position: Pan: 0.50, Tilt: 0.30, Zoom: 0.00
```

And allows manual adjustment of ranges:

```
PTZ Range (Tolerance)
Pan Range: [Min: 0.40 ] [Max: 0.60 ]
Tilt Range: [Min: 0.25 ] [Max: 0.35 ]
```

## 8. Future Enhancements

The following features were discussed during development but are not yet implemented:

### 8.1 360-Degree Panorama Support

**Description**: Support for PTZ cameras with 360-degree panoramic capability using spherical coordinates.

**Technical Approach**:
- Use theta (horizontal angle) and phi (vertical angle) instead of pan/tilt
- Implement coordinate transformation for spherical to Cartesian mapping
- Support continuous rotation beyond 0-1 range

**Challenges**:
- Camera厂商-specific coordinate systems
- Wraparound handling at 0/1 boundaries
- UI representation of spherical coordinates

### 8.2 Collision Detection

**Description**: Detect and warn about overlapping mask ranges that could cause conflicts.

**Technical Approach**:
- Implement range overlap detection algorithm
- Visual indicators for overlapping areas in UI
- Warning messages during save if overlaps detected

**Implementation**:
```python
def check_mask_overlaps(ptz_masks: dict) -> list[dict]:
    """Check for overlapping PTZ mask ranges."""
    overlaps = []
    mask_ids = list(ptz_masks.keys())
    for i, mask_id1 in enumerate(mask_ids):
        for mask_id2 in mask_ids[i+1:]:
            if ranges_overlap(ptz_masks[mask_id1], ptz_masks[mask_id2]):
                overlaps.append({
                    "mask1": mask_id1,
                    "mask2": mask_id2,
                    "overlap_type": "pan" | "tilt" | "both"
                })
    return overlaps
```

### 8.3 Automatic Mask Rasterization

**Description**: Automatically create masks at current position without manual drawing.

**Technical Approach**:
- Capture current frame from camera
- Apply edge detection or AI-based segmentation
- Automatically generate mask polygon from result

**Use Case**: Quickly mask out dynamic elements in current view without precise manual drawing.

### 8.4 Custom ONVIF Commands

**Description**: Allow camera-specific ONVIF commands for positions not in standard ONVIF profile.

**Technical Approach**:
- Configuration for custom PTZ commands per camera
- Support for manufacturer-specific SOAP requests
- Command templates with variable substitution

**Configuration**:
```yaml
onvif:
  custom_commands:
    preset_1:
      uri: "http://onvif.org/ver20/ptz/wsdl"
      action: "GotoPreset"
      params:
        ProfileToken: "main"
        PresetToken: "1"
```

### 8.5 Home Position Calibration

**Description**: Calibrate home/center position for more accurate absolute positioning.

**Technical Approach**:
- Guided calibration workflow
- Move to extremes and capture positions
- Build coordinate transformation matrix
- Store calibration data per camera

**Workflow**:
1. User initiates calibration
2. System prompts to move to known positions (home, far left, far right, etc.)
3. User confirms each position
4. System calculates transformation matrix
5. Apply calibration to all position readings

## 9. Compatibility

### 9.1 Supported Cameras

| Camera Type | Requirements | Status |
|-------------|--------------|--------|
| ONVIF PTZ | ONVIF support with PTZ service | Fully supported |
| Generic RTSP PTZ | External PTZ control | Requires custom integration |
| Fixed Cameras | N/A | Not applicable |

### 9.2 ONVIF Profile Requirements

- Profile G (PTZ)
- GetStatus command support preferred
- Fallback to relative movement if absolute unavailable

### 9.3 Software Requirements

- Frigate 0.14.0 or later (for dynamic config updates)
- Python 3.10+
- OpenCV for mask processing
- ONVIF library for camera communication

### 9.4 Browser Requirements

- Modern browsers with WebSocket support
- Tested on Chrome, Firefox, Safari, Edge
- Mobile Safari/Chrome for iOS/Android

## 10. Testing Plan

### 10.1 Unit Tests

**Configuration Tests**:
- Test PtzMaskConfig validation
- Test MotionConfig with PTZ masks
- Test RuntimeMotionConfig mask processing

**Utility Function Tests**:
- Test get_active_masks with various position ranges
- Test mask coordinate parsing
- Test edge cases (no constraints, full range, partial range)

**Motion Detector Tests**:
- Test mask switching on position change
- Test multiple active masks (OR logic)
- Test mask update performance

### 10.2 Integration Tests

**API Tests**:
- Test GET /api/{camera}/ptz/position returns correct format
- Test config set endpoint for PTZ masks
- Test config get returns PTZ masks correctly

**End-to-End Tests**:
- Configure PTZ camera with multiple masks
- Move camera through different positions
- Verify mask changes are applied correctly
- Verify motion detection respects active masks

### 10.3 Manual Testing Checklist

- [ ] Create new PTZ mask with coordinates
- [ ] Configure PTZ range (pan_min, pan_max, etc.)
- [ ] Capture PTZ position at different presets
- [ ] Verify masks switch when camera moves
- [ ] Verify global masks (no constraints) always apply
- [ ] Test save and reload configuration
- [ ] Test with multiple cameras
- [ ] Test PTZ controls in UI
- [ ] Test mobile/touch controls
- [ ] Test with ONVIF cameras without absolute position

### 10.4 Performance Testing

- Measure mask switching latency (<100ms target)
- Test with 10+ PTZ masks configured
- Test memory usage with rasterized masks
- Test CPU usage during rapid position changes

## 11. Troubleshooting

### 11.1 Common Issues

**Position Not Updating**:
- Check ONVIF connection status
- Verify camera supports PTZ status
- Check firewall rules for ONVIF port

**Masks Not Switching**:
- Verify PTZ masks have valid coordinates
- Check pan/tilt values are within configured ranges
- Ensure motion detection is enabled

**Performance Issues**:
- Reduce number of active PTZ masks
- Increase position change threshold
- Check ONVIF polling frequency

### 11.2 Debug Logging

Enable debug logging for troubleshooting:

```yaml
logger:
  default: info
  logs:
    frigate.motion: debug
    frigate.ptz: debug
    frigate.config: debug
```

### 11.3 Configuration Validation

Validate configuration using Frigate's config validator:
- Check for invalid coordinates
- Verify coordinate format (even number of values)
- Ensure ranges are valid (min < max)

## 12. Security Considerations

- PTZ credentials stored encrypted in config
- ONVIF TLS verification configurable
- API authentication required for all endpoints
- No sensitive data in logs

## 13. References

- [ONVIF PTZ Service Specification](https://www.onvif.org/specs/ptz/)
- [Frigate Motion Detection Documentation](https://docs.frigate.video/configuration/motion_detection)
- [Frigate ONVIF Integration](https://docs.frigate.video/configuration/onvif)

## 14. Version History

| Version | Date | Changes |
|---------|------|---------|
| 1.0 | 2024-01 | Initial specification |
| 1.1 | 2024-06 | Added frontend implementation details |
| 1.2 | 2025-03 | Updated API specs, added future enhancements |
