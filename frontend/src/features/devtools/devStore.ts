import { create } from "zustand";

export const HISTORY_SEC = 300;

export interface StreamWindow {
  device_id: string;
  stream: string;
  count: number;
  rate_hz: number;
  expected_hz: number | null;
  kbps: number;
  payload_kb_mean: number | null;
  payload_kb_max: number | null;
  interval_ms_mean: number | null;
  jitter_ms: number | null;
  interval_ms_max: number | null;
  latency_ms_p50: number | null;
  latency_ms_max: number | null;
  gaps: number;
  gap_ms_max: number | null;
  total_gaps: number;
  silent_s: number | null;
}

export interface PingResult {
  t: number;
  device_id: string;
  ip: string;
  rtt_ms: number | null;
  lost: boolean;
}

export interface DeviceLink {
  device_id: string;
  ip: string | null;
  zenoh_connected: boolean;
  zenoh_session: string | null;
  reconnects: number;
}

export interface DevStatus {
  recording: string | null;
  started_at: string | null;
  ping_error: string | null;
  manual_ips: Record<string, string>;
}

export interface DevWindow {
  t: number;
  streams: StreamWindow[];
  pings: PingResult[];
  links: DeviceLink[];
  status: DevStatus;
}

export interface Timed<T> {
  t: number;
  value: T;
}

interface DevState {
  connected: boolean;
  status: DevStatus | null;
  links: DeviceLink[];
  /** `${device}|${stream}` -> windows, oldest first. */
  streams: Record<string, Timed<StreamWindow>[]>;
  pings: Record<string, PingResult[]>;
  wsRtt: Timed<number>[];
  setConnected: (connected: boolean) => void;
  addWindow: (window: DevWindow) => void;
  addWsRtt: (rtt: number) => void;
}

function trim<T extends { t: number }>(items: T[], now: number): T[] {
  const cutoff = now - HISTORY_SEC;
  const first = items.findIndex((item) => item.t >= cutoff);
  return first <= 0 ? items : items.slice(first);
}

export const useDevStore = create<DevState>((set) => ({
  connected: false,
  status: null,
  links: [],
  streams: {},
  pings: {},
  wsRtt: [],
  setConnected: (connected) => set({ connected }),
  addWindow: (w) =>
    set((s) => {
      const streams = { ...s.streams };
      for (const row of w.streams) {
        const key = `${row.device_id}|${row.stream}`;
        streams[key] = trim([...(streams[key] ?? []), { t: w.t, value: row }], w.t);
      }
      const pings = { ...s.pings };
      for (const ping of w.pings) {
        pings[ping.device_id] = trim([...(pings[ping.device_id] ?? []), ping], w.t);
      }
      return { streams, pings, links: w.links, status: w.status };
    }),
  addWsRtt: (rtt) =>
    set((s) => {
      const now = Date.now() / 1000;
      return { wsRtt: trim([...s.wsRtt, { t: now, value: rtt }], now) };
    }),
}));
