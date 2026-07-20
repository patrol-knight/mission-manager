import { http } from "./httpClient";
import { deviceFromRaw, type Device, type RawDevice } from "../types/domain";

export async function listDevices(): Promise<Device[]> {
  const raw = await http.get<RawDevice[]>("/api/devices");
  return raw.map(deviceFromRaw);
}

export async function getDevice(deviceId: string): Promise<Device> {
  const raw = await http.get<RawDevice>(`/api/devices/${encodeURIComponent(deviceId)}`);
  return deviceFromRaw(raw);
}
