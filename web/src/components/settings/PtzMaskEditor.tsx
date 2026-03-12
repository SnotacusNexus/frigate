import React, { useCallback, useEffect, useMemo, useState, useRef } from "react";
import useSWR, { useSWRConfig } from "swr";
import axios from "axios";
import { toast } from "sonner";
import { FaAngleLeft, FaAngleRight, FaAngleUp, FaAngleDown } from "react-icons/fa";
import { MdZoomIn, MdZoomOut } from "react-icons/md";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import Heading from "../ui/heading";
import { Separator } from "../ui/separator";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import PolygonCanvas from "./PolygonCanvas";
import PolygonEditControls from "./PolygonEditControls";
import ActivityIndicator from "../indicators/activity-indicator";
import { CameraPtzPosition } from "@/types/ptz";
import { Polygon } from "@/types/canvas";
import { usePtzCommand } from "@/api/ws";
import { Toaster } from "../ui/sonner";
import { useTranslation } from "react-i18next";
import {
  flattenPoints,
  interpolatePoints,
} from "@/utils/canvasUtil";

export type PtzMaskPolygon = Polygon & {
  ptzPosition?: CameraPtzPosition;
  ptzRange?: {
    pan_min?: number;
    pan_max?: number;
    tilt_min?: number;
    tilt_max?: number;
  };
};

type PtzRangeKey = "pan_min" | "pan_max" | "tilt_min" | "tilt_max";

type PtzMaskEditorProps = {
  camera: string;
  polygons?: PtzMaskPolygon[];
  setPolygons: React.Dispatch<React.SetStateAction<PtzMaskPolygon[]>>;
  activePolygonIndex?: number;
  scaledWidth?: number;
  scaledHeight?: number;
  isLoading: boolean;
  setIsLoading: React.Dispatch<React.SetStateAction<boolean>>;
  onSave?: () => void;
  onCancel?: () => void;
  snapPoints: boolean;
  setSnapPoints: React.Dispatch<React.SetStateAction<boolean>>;
  containerRef?: React.RefObject<HTMLDivElement>;
  activeLine?: number;
};

export default function PtzMaskEditor({
  camera,
  polygons,
  setPolygons,
  activePolygonIndex,
  scaledWidth,
  scaledHeight,
  isLoading,
  setIsLoading,
  onSave,
  onCancel,
  snapPoints,
  setSnapPoints,
  containerRef: externalContainerRef,
  activeLine,
}: PtzMaskEditorProps) {
  const { t } = useTranslation(["views/settings"]);
  const { mutate: updateConfig } = useSWRConfig();
  const internalContainerRef = useRef<HTMLDivElement>(null);
  const containerRef = externalContainerRef || internalContainerRef;
  
  const [currentPtzPosition, setCurrentPtzPosition] = useState<CameraPtzPosition | null>(null);
  const [hoveredPolygonIndex] = useState<number | null>(null);

  const fetchPtzPosition = useCallback(async () => {
    try {
      const response = await axios.get<CameraPtzPosition>(`${camera}/ptz/position`);
      setCurrentPtzPosition(response.data);
    } catch (error) {
      console.error("Failed to fetch PTZ position:", error);
    }
  }, [camera]);

  useEffect(() => {
    fetchPtzPosition();
    const interval = setInterval(fetchPtzPosition, 2000);
    return () => clearInterval(interval);
  }, [fetchPtzPosition]);

  const { send: sendPtz } = usePtzCommand(camera);

  const handleMoveLeft = useCallback(() => {
    sendPtz("MOVE_LEFT");
    setTimeout(fetchPtzPosition, 500);
  }, [sendPtz, fetchPtzPosition]);

  const handleMoveRight = useCallback(() => {
    sendPtz("MOVE_RIGHT");
    setTimeout(fetchPtzPosition, 500);
  }, [sendPtz, fetchPtzPosition]);

  const handleMoveUp = useCallback(() => {
    sendPtz("MOVE_UP");
    setTimeout(fetchPtzPosition, 500);
  }, [sendPtz, fetchPtzPosition]);

  const handleMoveDown = useCallback(() => {
    sendPtz("MOVE_DOWN");
    setTimeout(fetchPtzPosition, 500);
  }, [sendPtz, fetchPtzPosition]);

  const handleZoomIn = useCallback(() => {
    sendPtz("ZOOM_IN");
    setTimeout(fetchPtzPosition, 500);
  }, [sendPtz, fetchPtzPosition]);

  const handleZoomOut = useCallback(() => {
    sendPtz("ZOOM_OUT");
    setTimeout(fetchPtzPosition, 500);
  }, [sendPtz, fetchPtzPosition]);

  const capturePtzPosition = useCallback(() => {
    if (activePolygonIndex !== undefined && polygons && currentPtzPosition) {
      const updatedPolygons = [...polygons] as PtzMaskPolygon[];
      updatedPolygons[activePolygonIndex] = {
        ...updatedPolygons[activePolygonIndex],
        ptzPosition: { ...currentPtzPosition },
        ptzRange: updatedPolygons[activePolygonIndex].ptzRange || {},
      };
      setPolygons(updatedPolygons);
      toast.success(t("ptzMask.capturedSuccess") || "PTZ position captured", {
        position: "top-center",
      });
    }
  }, [activePolygonIndex, polygons, currentPtzPosition, setPolygons, t]);

  const updatePtzRange = useCallback(
    (key: PtzRangeKey, value: number) => {
      if (activePolygonIndex !== undefined && polygons) {
        const updatedPolygons = [...polygons] as PtzMaskPolygon[];
        updatedPolygons[activePolygonIndex] = {
          ...updatedPolygons[activePolygonIndex],
          ptzRange: {
            ...(updatedPolygons[activePolygonIndex].ptzRange || {}),
            [key]: value,
          },
        };
        setPolygons(updatedPolygons);
      }
    },
    [activePolygonIndex, polygons, setPolygons],
  );

  const activePolygon = useMemo(() => {
    if (polygons && activePolygonIndex !== undefined) {
      return polygons[activePolygonIndex];
    }
    return null;
  }, [polygons, activePolygonIndex]);

  const saveToConfig = useCallback(async () => {
    if (!scaledWidth || !scaledHeight || !polygons || !camera) {
      return;
    }

    const closeThreshold = Math.max(scaledWidth, scaledHeight) * 0.05;

    const validPolygons: PtzMaskPolygon[] = [];
    const invalidPolygons: string[] = [];

    polygons.forEach((polygon) => {
      if (!polygon.isFinished) {
        return;
      }

      if (polygon.points.length < 3) {
        invalidPolygons.push(polygon.name || "ptz_mask");
        return;
      }

      const firstPoint = polygon.points[0];
      const lastPoint = polygon.points[polygon.points.length - 1];
      const distance = Math.sqrt(
        Math.pow((firstPoint[0] - lastPoint[0]) * scaledWidth, 2) +
        Math.pow((firstPoint[1] - lastPoint[1]) * scaledHeight, 2)
      );

      if (distance > closeThreshold) {
        invalidPolygons.push(polygon.name || "ptz_mask");
        return;
      }

      validPolygons.push(polygon);
    });

    if (invalidPolygons.length > 0) {
      toast.error(
        t("ptzMask.invalidPolygons", {
          polygons: invalidPolygons.join(", "),
        }) || `Invalid polygons (not closed or insufficient points): ${invalidPolygons.join(", ")}`,
        { position: "top-center" }
      );
      setIsLoading(false);
      return;
    }

    if (validPolygons.length === 0) {
      toast.error(
        t("ptzMask.noValidPolygons", {
        }) || "No valid polygons to save",
        { position: "top-center" }
      );
      setIsLoading(false);
      return;
    }

    const queryParams = new URLSearchParams();

    validPolygons.forEach((polygon) => {
      if (!polygon.isFinished) {
        return;
      }

      const coordinates = flattenPoints(
        interpolatePoints(polygon.points, scaledWidth, scaledHeight, 1, 1),
      ).join(",");

      const maskName = polygon.name || "ptz_mask";

      queryParams.append(
        `cameras.${camera}.motion.ptz_masks.${maskName}.coordinates`,
        coordinates,
      );

      if (polygon.ptzRange?.pan_min !== undefined) {
        queryParams.append(
          `cameras.${camera}.motion.ptz_masks.${maskName}.pan_min`,
          polygon.ptzRange.pan_min.toString(),
        );
      }

      if (polygon.ptzRange?.pan_max !== undefined) {
        queryParams.append(
          `cameras.${camera}.motion.ptz_masks.${maskName}.pan_max`,
          polygon.ptzRange.pan_max.toString(),
        );
      }

      if (polygon.ptzRange?.tilt_min !== undefined) {
        queryParams.append(
          `cameras.${camera}.motion.ptz_masks.${maskName}.tilt_min`,
          polygon.ptzRange.tilt_min.toString(),
        );
      }

      if (polygon.ptzRange?.tilt_max !== undefined) {
        queryParams.append(
          `cameras.${camera}.motion.ptz_masks.${maskName}.tilt_max`,
          polygon.ptzRange.tilt_max.toString(),
        );
      }
    });

    axios
      .put(`/config/set?${queryParams.toString()}`, {
        requires_restart: 0,
      })
      .then((res) => {
        if (res.status === 200) {
          toast.success(t("ptzMask.saveSuccess") || "PTZ masks saved successfully", {
            position: "top-center",
          });
          updateConfig("config");
        } else {
          toast.error(
            t("toast.save.error.title", {
              errorMessage: res.statusText,
              ns: "common",
            }),
            {
              position: "top-center",
            },
          );
        }
      })
      .catch((error) => {
        const errorMessage =
          error.response?.data?.message ||
          error.response?.data?.detail ||
          "Unknown error";
        toast.error(t("toast.save.error.title", { errorMessage, ns: "common" }), {
          position: "top-center",
        });
      })
      .finally(() => {
        setIsLoading(false);
      });
  }, [camera, polygons, scaledWidth, scaledHeight, updateConfig, setIsLoading, t]);

  return (
    <>
      <Toaster position="top-center" closeButton={true} />
      <div className="flex flex-col gap-4">
        <PtzPositionDisplay
          position={currentPtzPosition}
          onRefresh={fetchPtzPosition}
        />
        
        <PtzControlButtons
          onMoveLeft={handleMoveLeft}
          onMoveRight={handleMoveRight}
          onMoveUp={handleMoveUp}
          onMoveDown={handleMoveDown}
          onZoomIn={handleZoomIn}
          onZoomOut={handleZoomOut}
        />

        <Separator className="bg-secondary" />

        {scaledWidth && scaledHeight ? (
          <div className="relative">
            <PolygonCanvas
              containerRef={containerRef}
              camera={camera}
              width={scaledWidth}
              height={scaledHeight}
              polygons={polygons || []}
              setPolygons={(newPolygons) => setPolygons(newPolygons as PtzMaskPolygon[])}
              activePolygonIndex={activePolygonIndex}
              hoveredPolygonIndex={hoveredPolygonIndex}
              selectedZoneMask={["ptz_mask"]}
              activeLine={activeLine}
              snapPoints={snapPoints}
            />
            <div className="absolute bottom-4 left-1/2 -translate-x-1/2">
              <PtzOverlayControls
                onMoveLeft={handleMoveLeft}
                onMoveRight={handleMoveRight}
                onMoveUp={handleMoveUp}
                onMoveDown={handleMoveDown}
                onZoomIn={handleZoomIn}
                onZoomOut={handleZoomOut}
              />
            </div>
          </div>
        ) : (
          <ActivityIndicator />
        )}

        {activePolygonIndex !== undefined && (
          <>
            <Separator className="bg-secondary" />
            
            <div className="flex flex-col gap-2">
              <Button
                onClick={capturePtzPosition}
                disabled={!currentPtzPosition}
                className="w-full"
              >
                {t("ptzMask.capturePosition") || "Capture Current PTZ Position"}
              </Button>

              {activePolygon?.ptzPosition && (
                <div className="text-sm text-muted-foreground">
                  <div>
                    {t("ptzMask.capturedPosition") || "Captured Position"}:{" "}
                    Pan: {activePolygon.ptzPosition.pan.toFixed(2)},{" "}
                    Tilt: {activePolygon.ptzPosition.tilt.toFixed(2)},{" "}
                    Zoom: {activePolygon.ptzPosition.zoom.toFixed(2)}
                  </div>
                </div>
              )}
            </div>

            <Separator className="bg-secondary" />

            <div className="flex flex-col gap-4">
              <Heading as="h4">
                {t("ptzMask.ptzRange") || "PTZ Range (Tolerance)"}
              </Heading>
              
              <div className="flex flex-col gap-2">
                <label className="text-sm">
                  {t("ptzMask.panRange") || "Pan Range"}
                </label>
                <div className="flex gap-2">
                  <div className="flex-1">
                    <Input
                      type="number"
                      step="0.1"
                      value={activePolygon?.ptzRange?.pan_min ?? ""}
                      onChange={(e) => updatePtzRange("pan_min", parseFloat(e.target.value) || 0)}
                      placeholder="Min"
                    />
                  </div>
                  <div className="flex-1">
                    <Input
                      type="number"
                      step="0.1"
                      value={activePolygon?.ptzRange?.pan_max ?? ""}
                      onChange={(e) => updatePtzRange("pan_max", parseFloat(e.target.value) || 0)}
                      placeholder="Max"
                    />
                  </div>
                </div>
              </div>

              <div className="flex flex-col gap-2">
                <label className="text-sm">
                  {t("ptzMask.tiltRange") || "Tilt Range"}
                </label>
                <div className="flex gap-2">
                  <div className="flex-1">
                    <Input
                      type="number"
                      step="0.1"
                      value={activePolygon?.ptzRange?.tilt_min ?? ""}
                      onChange={(e) => updatePtzRange("tilt_min", parseFloat(e.target.value) || 0)}
                      placeholder="Min"
                    />
                  </div>
                  <div className="flex-1">
                    <Input
                      type="number"
                      step="0.1"
                      value={activePolygon?.ptzRange?.tilt_max ?? ""}
                      onChange={(e) => updatePtzRange("tilt_max", parseFloat(e.target.value) || 0)}
                      placeholder="Max"
                    />
                  </div>
                </div>
              </div>
            </div>
          </>
        )}

        {polygons && activePolygonIndex !== undefined && (
          <div className="flex w-full flex-row justify-between text-sm">
            <div className="my-1 inline-flex">
              {t("masksAndZones.motionMasks.point", {
                count: polygons[activePolygonIndex].points.length,
              })}
            </div>
            <PolygonEditControls
              polygons={polygons}
              setPolygons={(newPolygons) => setPolygons(newPolygons as PtzMaskPolygon[])}
              activePolygonIndex={activePolygonIndex}
              snapPoints={snapPoints}
              setSnapPoints={setSnapPoints}
            />
          </div>
        )}

        <Separator className="bg-secondary" />

        <div className="flex flex-row gap-2">
          <Button
            className="flex flex-1"
            aria-label={t("button.cancel", { ns: "common" })}
            onClick={onCancel}
          >
            {t("button.cancel", { ns: "common" })}
          </Button>
          <Button
            variant="select"
            aria-label={t("button.save", { ns: "common" })}
            disabled={isLoading}
            className="flex flex-1"
            onClick={() => {
              setIsLoading(true);
              saveToConfig();
              if (onSave) {
                onSave();
              }
            }}
          >
            {isLoading ? (
              <div className="flex flex-row items-center gap-2">
                <ActivityIndicator />
                <span>{t("button.saving", { ns: "common" })}</span>
              </div>
            ) : (
              t("button.save", { ns: "common" })
            )}
          </Button>
        </div>
      </div>
    </>
  );
}

function PtzPositionDisplay({
  position,
  onRefresh,
}: {
  position: CameraPtzPosition | null;
  onRefresh: () => void;
}) {
  const { t } = useTranslation(["views/settings"]);
  
  return (
    <div className="flex items-center justify-between rounded-lg bg-secondary p-3">
      <div className="flex flex-col gap-1">
        <div className="text-sm font-medium">
          {t("ptzMask.currentPosition") || "Current PTZ Position"}
        </div>
        {position ? (
          <div className="flex gap-4 text-xs text-muted-foreground">
            <span>Pan: {position.pan.toFixed(2)}</span>
            <span>Tilt: {position.tilt.toFixed(2)}</span>
            <span>Zoom: {position.zoom.toFixed(2)}</span>
          </div>
        ) : (
          <div className="text-xs text-muted-foreground">Loading...</div>
        )}
      </div>
      <Button variant="outline" size="sm" onClick={onRefresh}>
        {t("ptzMask.refresh") || "Refresh"}
      </Button>
    </div>
  );
}

interface PtzControlButtonsProps {
  onMoveLeft: () => void;
  onMoveRight: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
}

function PtzControlButtons({
  onMoveLeft,
  onMoveRight,
  onMoveUp,
  onMoveDown,
  onZoomIn,
  onZoomOut,
}: PtzControlButtonsProps) {
  const { t } = useTranslation(["views/live"]);

  return (
    <div className="flex flex-col items-center gap-2">
      <div className="flex items-center gap-2">
        {true && (
          <>
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="outline"
                    size="icon"
                    onClick={onMoveLeft}
                    aria-label={t("ptz.move.left.label") || "Move Left"}
                  >
                    <FaAngleLeft />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  <p>{t("ptz.move.left.label") || "Move Left"}</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>

            <div className="flex flex-col gap-1">
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="outline"
                      size="icon"
                      onClick={onMoveUp}
                      aria-label={t("ptz.move.up.label") || "Move Up"}
                    >
                      <FaAngleUp />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>{t("ptz.move.up.label") || "Move Up"}</p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="outline"
                      size="icon"
                      onClick={onMoveDown}
                      aria-label={t("ptz.move.down.label") || "Move Down"}
                    >
                      <FaAngleDown />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>{t("ptz.move.down.label") || "Move Down"}</p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </div>

            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="outline"
                    size="icon"
                    onClick={onMoveRight}
                    aria-label={t("ptz.move.right.label") || "Move Right"}
                  >
                    <FaAngleRight />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  <p>{t("ptz.move.right.label") || "Move Right"}</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </>
        )}
      </div>

      {true && (
        <div className="flex gap-2">
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="outline"
                  size="icon"
                  onClick={onZoomIn}
                  aria-label={t("ptz.zoom.in.label") || "Zoom In"}
                >
                  <MdZoomIn />
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <p>{t("ptz.zoom.in.label") || "Zoom In"}</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="outline"
                  size="icon"
                  onClick={onZoomOut}
                  aria-label={t("ptz.zoom.out.label") || "Zoom Out"}
                >
                  <MdZoomOut />
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <p>{t("ptz.zoom.out.label") || "Zoom Out"}</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
      )}
    </div>
  );
}

const PtzOverlayControls = React.memo(function PtzOverlayControls({
  onMoveLeft,
  onMoveRight,
  onMoveUp,
  onMoveDown,
  onZoomIn,
  onZoomOut,
}: PtzControlButtonsProps) {
  const { t } = useTranslation(["views/live"]);

  return (
    <div className="flex flex-col items-center gap-2 rounded-lg bg-black/60 p-3 backdrop-blur-sm">
      <div className="flex items-center gap-2">
        {true && (
          <>
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="secondary"
                    size="icon"
                    onClick={onMoveLeft}
                    aria-label={t("ptz.move.left.label") || "Move Left"}
                  >
                    <FaAngleLeft />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  <p>{t("ptz.move.left.label") || "Move Left"}</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>

            <div className="flex flex-col gap-1">
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="secondary"
                      size="icon"
                      onClick={onMoveUp}
                      aria-label={t("ptz.move.up.label") || "Move Up"}
                    >
                      <FaAngleUp />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>{t("ptz.move.up.label") || "Move Up"}</p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="secondary"
                      size="icon"
                      onClick={onMoveDown}
                      aria-label={t("ptz.move.down.label") || "Move Down"}
                    >
                      <FaAngleDown />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>{t("ptz.move.down.label") || "Move Down"}</p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </div>

            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="secondary"
                    size="icon"
                    onClick={onMoveRight}
                    aria-label={t("ptz.move.right.label") || "Move Right"}
                  >
                    <FaAngleRight />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  <p>{t("ptz.move.right.label") || "Move Right"}</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </>
        )}
      </div>

      {true && (
        <div className="flex gap-2">
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="secondary"
                  size="icon"
                  onClick={onZoomIn}
                  aria-label={t("ptz.zoom.in.label") || "Zoom In"}
                >
                  <MdZoomIn />
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <p>{t("ptz.zoom.in.label") || "Zoom In"}</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="secondary"
                  size="icon"
                  onClick={onZoomOut}
                  aria-label={t("ptz.zoom.out.label") || "Zoom Out"}
                >
                  <MdZoomOut />
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <p>{t("ptz.zoom.out.label") || "Zoom Out"}</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
      )}
    </div>
  );
});

interface PtzMaskCanvasProps {
  camera: string;
  width: number;
  height: number;
  polygons: PtzMaskPolygon[];
  setPolygons: React.Dispatch<React.SetStateAction<PtzMaskPolygon[]>>;
  activePolygonIndex?: number;
  activeLine?: number;
  snapPoints: boolean;
}

export function PtzMaskCanvas({
  camera,
  width,
  height,
  polygons,
  setPolygons,
  activePolygonIndex,
  activeLine,
  snapPoints,
}: PtzMaskCanvasProps) {
  const { t } = useTranslation(["views/settings"]);
  const [currentPtzPosition, setCurrentPtzPosition] = useState<CameraPtzPosition | null>(null);
  const [hoveredPolygonIndex] = useState<number | null>(null);

  const fetchPtzPosition = useCallback(async () => {
    try {
      const response = await axios.get<CameraPtzPosition>(`${camera}/ptz/position`);
      setCurrentPtzPosition(response.data);
    } catch (error) {
      console.error("Failed to fetch PTZ position:", error);
    }
  }, [camera]);

  useEffect(() => {
    fetchPtzPosition();
    const interval = setInterval(fetchPtzPosition, 2000);
    return () => clearInterval(interval);
  }, [fetchPtzPosition]);

  const { send: sendPtz } = usePtzCommand(camera);

  const handleMoveLeft = useCallback(() => {
    sendPtz("MOVE_LEFT");
    setTimeout(fetchPtzPosition, 500);
  }, [sendPtz, fetchPtzPosition]);

  const handleMoveRight = useCallback(() => {
    sendPtz("MOVE_RIGHT");
    setTimeout(fetchPtzPosition, 500);
  }, [sendPtz, fetchPtzPosition]);

  const handleMoveUp = useCallback(() => {
    sendPtz("MOVE_UP");
    setTimeout(fetchPtzPosition, 500);
  }, [sendPtz, fetchPtzPosition]);

  const handleMoveDown = useCallback(() => {
    sendPtz("MOVE_DOWN");
    setTimeout(fetchPtzPosition, 500);
  }, [sendPtz, fetchPtzPosition]);

  const handleZoomIn = useCallback(() => {
    sendPtz("ZOOM_IN");
    setTimeout(fetchPtzPosition, 500);
  }, [sendPtz, fetchPtzPosition]);

  const handleZoomOut = useCallback(() => {
    sendPtz("ZOOM_OUT");
    setTimeout(fetchPtzPosition, 500);
  }, [sendPtz, fetchPtzPosition]);

  const localContainerRef = useRef<HTMLDivElement>(null);

  return (
    <div className="relative size-full">
      <PolygonCanvas
        containerRef={localContainerRef}
        camera={camera}
        width={width}
        height={height}
        polygons={polygons}
        setPolygons={(newPolygons) => setPolygons(newPolygons as PtzMaskPolygon[])}
        activePolygonIndex={activePolygonIndex}
        hoveredPolygonIndex={hoveredPolygonIndex}
        selectedZoneMask={["ptz_mask"]}
        activeLine={activeLine}
        snapPoints={snapPoints}
      />
      <div className="absolute bottom-4 left-1/2 -translate-x-1/2">
        <PtzOverlayControls
          onMoveLeft={handleMoveLeft}
          onMoveRight={handleMoveRight}
          onMoveUp={handleMoveUp}
          onMoveDown={handleMoveDown}
          onZoomIn={handleZoomIn}
          onZoomOut={handleZoomOut}
        />
      </div>
      <div className="absolute top-4 right-4 rounded-lg bg-black/60 p-2 backdrop-blur-sm">
        <div className="flex flex-col gap-1 text-xs text-white">
          <div className="font-medium">{t("ptzMask.currentPosition") || "Current PTZ Position"}</div>
          {currentPtzPosition ? (
            <div className="text-muted-foreground">
              <span>Pan: {currentPtzPosition.pan.toFixed(2)}</span>
              <span className="ml-2">Tilt: {currentPtzPosition.tilt.toFixed(2)}</span>
              <span className="ml-2">Zoom: {currentPtzPosition.zoom.toFixed(2)}</span>
            </div>
          ) : (
            <div className="text-muted-foreground">Loading...</div>
          )}
        </div>
      </div>
    </div>
  );
}

type PtzMaskEditPaneMinimalProps = {
  camera: string;
  polygons?: PtzMaskPolygon[];
  setPolygons: React.Dispatch<React.SetStateAction<PtzMaskPolygon[]>>;
  activePolygonIndex?: number;
  scaledWidth?: number;
  scaledHeight?: number;
  isLoading: boolean;
  setIsLoading: React.Dispatch<React.SetStateAction<boolean>>;
  onSave?: () => void;
  onCancel?: () => void;
  snapPoints: boolean;
  setSnapPoints: React.Dispatch<React.SetStateAction<boolean>>;
};

export function PtzMaskEditPaneMinimal({
  camera,
  polygons,
  setPolygons,
  activePolygonIndex,
  scaledWidth,
  scaledHeight,
  isLoading,
  setIsLoading,
  onSave,
  onCancel,
  snapPoints,
  setSnapPoints,
}: PtzMaskEditPaneMinimalProps) {
  const { t } = useTranslation(["views/settings"]);
  const { mutate: updateConfig } = useSWRConfig();
  const [currentPtzPosition, setCurrentPtzPosition] = useState<CameraPtzPosition | null>(null);

  const fetchPtzPosition = useCallback(async () => {
    try {
      const response = await axios.get<CameraPtzPosition>(`${camera}/ptz/position`);
      setCurrentPtzPosition(response.data);
    } catch (error) {
      console.error("Failed to fetch PTZ position:", error);
    }
  }, [camera]);

  useEffect(() => {
    fetchPtzPosition();
    const interval = setInterval(fetchPtzPosition, 2000);
    return () => clearInterval(interval);
  }, [fetchPtzPosition]);

  const capturePtzPosition = useCallback(() => {
    if (activePolygonIndex !== undefined && polygons && currentPtzPosition) {
      const updatedPolygons = [...polygons] as PtzMaskPolygon[];
      updatedPolygons[activePolygonIndex] = {
        ...updatedPolygons[activePolygonIndex],
        ptzPosition: { ...currentPtzPosition },
        ptzRange: updatedPolygons[activePolygonIndex].ptzRange || {},
      };
      setPolygons(updatedPolygons);
      toast.success(t("ptzMask.capturedSuccess") || "PTZ position captured", {
        position: "top-center",
      });
    }
  }, [activePolygonIndex, polygons, currentPtzPosition, setPolygons, t]);

  const activePolygon = useMemo(() => {
    if (polygons && activePolygonIndex !== undefined) {
      return polygons[activePolygonIndex];
    }
    return null;
  }, [polygons, activePolygonIndex]);

  const saveToConfig = useCallback(async () => {
    if (!scaledWidth || !scaledHeight || !polygons || !camera) {
      return;
    }

    const closeThreshold = Math.max(scaledWidth, scaledHeight) * 0.05;

    const validPolygons: PtzMaskPolygon[] = [];
    const invalidPolygons: string[] = [];

    polygons.forEach((polygon) => {
      if (!polygon.isFinished) {
        return;
      }

      if (polygon.points.length < 3) {
        invalidPolygons.push(polygon.name || "ptz_mask");
        return;
      }

      const firstPoint = polygon.points[0];
      const lastPoint = polygon.points[polygon.points.length - 1];
      const distance = Math.sqrt(
        Math.pow((firstPoint[0] - lastPoint[0]) * scaledWidth, 2) +
        Math.pow((firstPoint[1] - lastPoint[1]) * scaledHeight, 2)
      );

      if (distance > closeThreshold) {
        invalidPolygons.push(polygon.name || "ptz_mask");
        return;
      }

      validPolygons.push(polygon);
    });

    if (invalidPolygons.length > 0) {
      toast.error(
        t("ptzMask.invalidPolygons", {
          polygons: invalidPolygons.join(", "),
        }) || `Invalid polygons (not closed or insufficient points): ${invalidPolygons.join(", ")}`,
        { position: "top-center" }
      );
      setIsLoading(false);
      return;
    }

    if (validPolygons.length === 0) {
      toast.error(
        t("ptzMask.noValidPolygons", {
        }) || "No valid polygons to save",
        { position: "top-center" }
      );
      setIsLoading(false);
      return;
    }

    const queryParams = new URLSearchParams();

    validPolygons.forEach((polygon) => {
      if (!polygon.isFinished) {
        return;
      }

      const coordinates = flattenPoints(
        interpolatePoints(polygon.points, scaledWidth, scaledHeight, 1, 1),
      ).join(",");

      const maskName = polygon.name || "ptz_mask";

      queryParams.append(
        `cameras.${camera}.motion.ptz_masks.${maskName}.coordinates`,
        coordinates,
      );

      if (polygon.ptzRange?.pan_min !== undefined) {
        queryParams.append(
          `cameras.${camera}.motion.ptz_masks.${maskName}.pan_min`,
          polygon.ptzRange.pan_min.toString(),
        );
      }

      if (polygon.ptzRange?.pan_max !== undefined) {
        queryParams.append(
          `cameras.${camera}.motion.ptz_masks.${maskName}.pan_max`,
          polygon.ptzRange.pan_max.toString(),
        );
      }

      if (polygon.ptzRange?.tilt_min !== undefined) {
        queryParams.append(
          `cameras.${camera}.motion.ptz_masks.${maskName}.tilt_min`,
          polygon.ptzRange.tilt_min.toString(),
        );
      }

      if (polygon.ptzRange?.tilt_max !== undefined) {
        queryParams.append(
          `cameras.${camera}.motion.ptz_masks.${maskName}.tilt_max`,
          polygon.ptzRange.tilt_max.toString(),
        );
      }
    });

    axios
      .put(`/config/set?${queryParams.toString()}`, {
        requires_restart: 0,
      })
      .then((res) => {
        if (res.status === 200) {
          toast.success(t("ptzMask.saveSuccess") || "PTZ masks saved successfully", {
            position: "top-center",
          });
          updateConfig("config");
        } else {
          toast.error(
            t("toast.save.error.title", {
              errorMessage: res.statusText,
              ns: "common",
            }),
            {
              position: "top-center",
            },
          );
        }
      })
      .catch((error) => {
        const errorMessage =
          error.response?.data?.message ||
          error.response?.data?.detail ||
          "Unknown error";
        toast.error(t("toast.save.error.title", { errorMessage, ns: "common" }), {
          position: "top-center",
        });
      })
      .finally(() => {
        setIsLoading(false);
      });
  }, [camera, polygons, scaledWidth, scaledHeight, updateConfig, setIsLoading, t]);

  return (
    <>
      <Toaster position="top-center" closeButton={true} />
      <div className="flex flex-col gap-4">
        <Heading as="h3">{t("ptzMask.editor") || "PTZ Mask Editor"}</Heading>

        <div className="flex items-center justify-between rounded-lg bg-secondary p-3">
          <div className="flex flex-col gap-1">
            <div className="text-sm font-medium">
              {t("ptzMask.currentPosition") || "Current PTZ Position"}
            </div>
            {currentPtzPosition ? (
              <div className="flex gap-4 text-xs text-muted-foreground">
                <span>Pan: {currentPtzPosition.pan.toFixed(2)}</span>
                <span>Tilt: {currentPtzPosition.tilt.toFixed(2)}</span>
                <span>Zoom: {currentPtzPosition.zoom.toFixed(2)}</span>
              </div>
            ) : (
              <div className="text-xs text-muted-foreground">Loading...</div>
            )}
          </div>
          <Button variant="outline" size="sm" onClick={fetchPtzPosition}>
            {t("ptzMask.refresh") || "Refresh"}
          </Button>
        </div>

        {activePolygonIndex !== undefined && (
          <>
            <Separator className="bg-secondary" />

            <div className="flex flex-col gap-2">
              <Button
                onClick={capturePtzPosition}
                disabled={!currentPtzPosition}
                className="w-full"
              >
                {t("ptzMask.capturePosition") || "Capture Current PTZ Position"}
              </Button>

              {activePolygon?.ptzPosition && (
                <div className="text-sm text-muted-foreground">
                  <div>
                    {t("ptzMask.capturedPosition") || "Captured Position"}:{" "}
                    Pan: {activePolygon.ptzPosition.pan.toFixed(2)},{" "}
                    Tilt: {activePolygon.ptzPosition.tilt.toFixed(2)},{" "}
                    Zoom: {activePolygon.ptzPosition.zoom.toFixed(2)}
                  </div>
                </div>
              )}
            </div>

            <Separator className="bg-secondary" />

            <div className="flex flex-col gap-4">
              <Heading as="h4">
                {t("ptzMask.ptzRange") || "PTZ Range (Tolerance)"}
              </Heading>

              <div className="flex flex-col gap-2">
                <label className="text-sm">
                  {t("ptzMask.panRange") || "Pan Range"}
                </label>
                <div className="flex gap-2">
                  <div className="flex-1">
                    <Input
                      type="number"
                      step="0.1"
                      value={activePolygon?.ptzRange?.pan_min ?? ""}
                      onChange={(e) => {
                        if (activePolygonIndex !== undefined && polygons) {
                          const updatedPolygons = [...polygons] as PtzMaskPolygon[];
                          updatedPolygons[activePolygonIndex] = {
                            ...updatedPolygons[activePolygonIndex],
                            ptzRange: {
                              ...(updatedPolygons[activePolygonIndex].ptzRange || {}),
                              pan_min: parseFloat(e.target.value) || 0,
                            },
                          };
                          setPolygons(updatedPolygons);
                        }
                      }}
                      placeholder="Min"
                    />
                  </div>
                  <div className="flex-1">
                    <Input
                      type="number"
                      step="0.1"
                      value={activePolygon?.ptzRange?.pan_max ?? ""}
                      onChange={(e) => {
                        if (activePolygonIndex !== undefined && polygons) {
                          const updatedPolygons = [...polygons] as PtzMaskPolygon[];
                          updatedPolygons[activePolygonIndex] = {
                            ...updatedPolygons[activePolygonIndex],
                            ptzRange: {
                              ...(updatedPolygons[activePolygonIndex].ptzRange || {}),
                              pan_max: parseFloat(e.target.value) || 0,
                            },
                          };
                          setPolygons(updatedPolygons);
                        }
                      }}
                      placeholder="Max"
                    />
                  </div>
                </div>
              </div>

              <div className="flex flex-col gap-2">
                <label className="text-sm">
                  {t("ptzMask.tiltRange") || "Tilt Range"}
                </label>
                <div className="flex gap-2">
                  <div className="flex-1">
                    <Input
                      type="number"
                      step="0.1"
                      value={activePolygon?.ptzRange?.tilt_min ?? ""}
                      onChange={(e) => {
                        if (activePolygonIndex !== undefined && polygons) {
                          const updatedPolygons = [...polygons] as PtzMaskPolygon[];
                          updatedPolygons[activePolygonIndex] = {
                            ...updatedPolygons[activePolygonIndex],
                            ptzRange: {
                              ...(updatedPolygons[activePolygonIndex].ptzRange || {}),
                              tilt_min: parseFloat(e.target.value) || 0,
                            },
                          };
                          setPolygons(updatedPolygons);
                        }
                      }}
                      placeholder="Min"
                    />
                  </div>
                  <div className="flex-1">
                    <Input
                      type="number"
                      step="0.1"
                      value={activePolygon?.ptzRange?.tilt_max ?? ""}
                      onChange={(e) => {
                        if (activePolygonIndex !== undefined && polygons) {
                          const updatedPolygons = [...polygons] as PtzMaskPolygon[];
                          updatedPolygons[activePolygonIndex] = {
                            ...updatedPolygons[activePolygonIndex],
                            ptzRange: {
                              ...(updatedPolygons[activePolygonIndex].ptzRange || {}),
                              tilt_max: parseFloat(e.target.value) || 0,
                            },
                          };
                          setPolygons(updatedPolygons);
                        }
                      }}
                      placeholder="Max"
                    />
                  </div>
                </div>
              </div>
            </div>
          </>
        )}

        {polygons && activePolygonIndex !== undefined && (
          <div className="flex w-full flex-row justify-between text-sm">
            <div className="my-1 inline-flex">
              {t("masksAndZones.motionMasks.point", {
                count: polygons[activePolygonIndex].points.length,
              })}
            </div>
            <PolygonEditControls
              polygons={polygons}
              setPolygons={(newPolygons) => setPolygons(newPolygons as PtzMaskPolygon[])}
              activePolygonIndex={activePolygonIndex}
              snapPoints={snapPoints}
              setSnapPoints={setSnapPoints}
            />
          </div>
        )}

        <Separator className="bg-secondary" />

        <div className="flex flex-row gap-2">
          <Button
            className="flex flex-1"
            aria-label={t("button.cancel", { ns: "common" })}
            onClick={onCancel}
          >
            {t("button.cancel", { ns: "common" })}
          </Button>
          <Button
            variant="select"
            aria-label={t("button.save", { ns: "common" })}
            disabled={isLoading}
            className="flex flex-1"
            onClick={() => {
              setIsLoading(true);
              saveToConfig();
              if (onSave) {
                onSave();
              }
            }}
          >
            {isLoading ? (
              <div className="flex flex-row items-center gap-2">
                <ActivityIndicator />
                <span>{t("button.saving", { ns: "common" })}</span>
              </div>
            ) : (
              t("button.save", { ns: "common" })
            )}
          </Button>
        </div>
      </div>
    </>
  );
}
