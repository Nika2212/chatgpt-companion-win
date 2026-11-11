export interface Coordinates {
  x: number;
  y: number;
}

export interface TrayCallbacks {
  onToggle: () => void;
  onQuit: () => void;
}
