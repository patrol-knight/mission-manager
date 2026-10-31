export interface WebrtcRow {
  device_id: string;
  state: string;
  bitrate_kbps: number | null;
  fps: number | null;
  width: number | null;
  height: number | null;
  packets_received: number | null;
  packets_lost: number | null;
  loss_pct: number | null;
  jitter_ms: number | null;
  rtt_ms: number | null;
  frames_decoded: number | null;
  frames_dropped: number | null;
  freeze_count: number | null;
  freeze_s: number | null;
  nack_count: number | null;
  pli_count: number | null;
  jitter_buffer_ms: number | null;
  available_kbps: number | null;
  local_candidate: string | null;
  remote_candidate: string | null;
}

type Stat = Record<string, unknown>;

function num(stat: Stat | undefined, key: string): number | null {
  const value = stat?.[key];
  return typeof value === "number" ? value : null;
}

function candidate(stat: Stat | undefined): string | null {
  if (!stat) return null;
  const address = stat.address ?? stat.ip;
  return `${stat.candidateType ?? "?"} ${address ?? ""}:${stat.port ?? ""}`.trim();
}

function delta(now: number | null, before: number | null): number | null {
  return now !== null && before !== null ? now - before : null;
}

/** Turns cumulative getStats() counters into per-interval rows. */
export class WebrtcStatsSampler {
  private prev: { t: number; inbound: Stat } | null = null;
  private readonly deviceId: string;

  constructor(deviceId: string) {
    this.deviceId = deviceId;
  }

  sample(report: RTCStatsReport, state: string): WebrtcRow {
    const stats = [...report.values()] as Stat[];
    const byId = new Map(stats.map((s) => [s.id as string, s]));
    const inbound = stats.find((s) => s.type === "inbound-rtp" && s.kind === "video");
    const transport = stats.find((s) => s.type === "transport");
    const pair =
      (transport && byId.get(transport.selectedCandidatePairId as string)) ??
      stats.find((s) => s.type === "candidate-pair" && s.nominated && s.state === "succeeded");

    const t = performance.now() / 1000;
    const prev = this.prev;
    const dt = prev ? t - prev.t : null;
    const d = (key: string) => (prev && inbound ? delta(num(inbound, key), num(prev.inbound, key)) : null);

    const bytes = d("bytesReceived");
    const received = d("packetsReceived");
    const lost = d("packetsLost");
    const bufferDelay = d("jitterBufferDelay");
    const emitted = d("jitterBufferEmittedCount");
    const rtt = num(pair, "currentRoundTripTime");
    const available = num(pair, "availableIncomingBitrate");
    const jitter = num(inbound, "jitter");

    if (inbound) this.prev = { t, inbound };

    return {
      device_id: this.deviceId,
      state,
      bitrate_kbps: bytes !== null && dt ? (bytes * 8) / 1000 / dt : null,
      fps: num(inbound, "framesPerSecond"),
      width: num(inbound, "frameWidth"),
      height: num(inbound, "frameHeight"),
      packets_received: num(inbound, "packetsReceived"),
      packets_lost: num(inbound, "packetsLost"),
      loss_pct: received !== null && lost !== null && received + lost > 0 ? (100 * Math.max(lost, 0)) / (received + lost) : null,
      jitter_ms: jitter !== null ? jitter * 1000 : null,
      rtt_ms: rtt !== null ? rtt * 1000 : null,
      frames_decoded: num(inbound, "framesDecoded"),
      frames_dropped: num(inbound, "framesDropped"),
      freeze_count: num(inbound, "freezeCount"),
      freeze_s: num(inbound, "totalFreezesDuration"),
      nack_count: num(inbound, "nackCount"),
      pli_count: num(inbound, "pliCount"),
      jitter_buffer_ms: bufferDelay !== null && emitted ? (1000 * bufferDelay) / emitted : null,
      available_kbps: available !== null ? available / 1000 : null,
      local_candidate: candidate(pair && byId.get(pair.localCandidateId as string)),
      remote_candidate: candidate(pair && byId.get(pair.remoteCandidateId as string)),
    };
  }
}
