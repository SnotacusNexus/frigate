type PtzFeature = "pt" | "zoom" | "pt-r" | "zoom-r" | "zoom-a" | "pt-r-fov";

export type CameraPtzInfo = {
  name: string;
  features: PtzFeature[];
  presets: string[];
};

export type CameraPtzPosition = {
  pan: number;
  tilt: number;
  zoom: number;
};
