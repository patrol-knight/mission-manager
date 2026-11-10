import { create } from "zustand";

const HISTORY_SEC = 300;
const MAX_EVENTS = 100;

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
  /** null until the router has been asked. */
  zenoh_connected: boolean | null;
  zenoh_session: string | null;
  reconnects: number;
}

export interface CommandRtt {
  t: number;
  device_id: string;
  command: string;
  rtt_ms: number;
}

/** Device clock minus this backend's, from a time_probe round trip; good to ±rtt_ms/2. */
export interface ClockSample {
  t: number;
  device_id: string;
  offset_ms: number;
  rtt_ms: number;
}

export interface LinkEvent {
  t: number;
  kind: "disconnect" | "reconnect" | "gap";
  device_id: string;
  stream?: string;
  gap_ms?: number;
  downtime_s?: number;
}

/** Backend traffic per second: network in/out and to browsers over the UI WebSocket. */
export interface Traffic {
  ui_kbps: number;
  rx_kbps?: number;
  tx_kbps?: number;
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
  commands: CommandRtt[];
  clocks: ClockSample[];
  events: LinkEvent[];
  traffic: Traffic | null;
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
  commands: Record<string, CommandRtt[]>;
  clocks: Record<string, ClockSample[]>;
  /** Newest first. */
  events: LinkEvent[];
  traffic: Timed<Traffic>[];
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
  commands: {},
  clocks: {},
  events: [],
  traffic: [],
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
      const commands = { ...s.commands };
      for (const c of w.commands) {
        commands[c.device_id] = trim([...(commands[c.device_id] ?? []), c], w.t);
      }
      const clocks = { ...s.clocks };
      for (const c of w.clocks) {
        clocks[c.device_id] = trim([...(clocks[c.device_id] ?? []), c], w.t);
      }
      const events = [...[...w.events].reverse(), ...s.events].slice(0, MAX_EVENTS);
      const traffic = w.traffic ? trim([...s.traffic, { t: w.t, value: w.traffic }], w.t) : s.traffic;
      return { streams, pings, commands, clocks, events, traffic, links: w.links, status: w.status };
    }),
  addWsRtt: (rtt) =>
    set((s) => {
      const now = Date.now() / 1000;
      return { wsRtt: trim([...s.wsRtt, { t: now, value: rtt }], now) };
    }),
}));
