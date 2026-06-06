export type Waypoint = {
  id: string;
  x: number;
  y: number;
  yaw: number;
};

export type Mode = "off" | "modify" | "delete";

export type RobotPose = {
  x: number;
  y: number;
  yaw: number;
  lat?: number;
  lon?: number;
  speed?: number;
};

export type MapInfo = {
  width: number;
  height: number;
  resolution: number;
  origin: { x: number; y: number };
};

export type MapData = {
  image: HTMLCanvasElement;
  info: MapInfo;
};

export type PathPoint = { x: number; y: number };

export type PathData = {
  points: PathPoint[];
  frameId: string;
};

export type ValidateRequest = { x: number; y: number };
export type ValidateResponse = { valid: boolean; lanelet_id?: number };

export type RouteWaypoint = { x: number; y: number };

export type RouteResponse = {
  ok: boolean;
  route?: GeoJSON.Feature<GeoJSON.LineString>;
};

export type WsMsgRobotPose = {
  type: "robot_pose";
  payload: RobotPose;
};

export type WsMsgPath = {
  type: "path";
  payload: { points: PathPoint[]; frame_id: string };
};

export type WsMsgMap = {
  type: "map";
  payload: {
    width: number;
    height: number;
    resolution: number;
    origin_x: number;
    origin_y: number;
    data: number[];
  };
};

export type WsMessage = WsMsgRobotPose | WsMsgPath | WsMsgMap;

export type ConnectionStatus = "connecting" | "connected" | "disconnected";
