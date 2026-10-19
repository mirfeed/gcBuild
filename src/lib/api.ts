/** Client for the local gcsim bridge (server/gcsim.ts, served by Vite). */

export interface GcsimStatus {
  installed: boolean;
  path: string;
  version: string;
  release: { tag?: string; published?: string };
}

type Stat4 = { min: number; max: number; mean: number; sd: number };

/** The parts of gcsim's result JSON the app uses. */
export interface SimResult {
  sim_version: string;
  config_file: string;
  character_details: { name: string; element: string; stats: number[] }[];
  statistics: {
    iterations: number;
    duration: Stat4;
    dps: Stat4;
    total_damage: Stat4;
    warnings: Record<string, boolean>;
    failed_actions: Record<string, Stat4>[];
    character_dps: Stat4[];
    source_dps: { sources: Record<string, Stat4> }[];
    source_reactions: { sources?: Record<string, Stat4> }[];
    total_source_energy: { sources: Record<string, Stat4> }[];
    end_stats: { ending_energy: Stat4 }[];
    field_time: Stat4[];
    character_actions?: { sources: Record<string, Stat4> }[];
    target_aura_uptime?: { sources: Record<string, Stat4> }[];
  };
}

export interface SampleLog {
  char_index: number;
  ended: number;
  event: string;
  frame: number;
  logs: Record<string, unknown>;
  msg: string;
}

export interface Sample {
  config: string;
  initial_character: string;
  character_details: { name: string; element: string; stats?: number[] }[];
  seed: string;
  logs: SampleLog[];
}

export interface RunResponse {
  result: SimResult;
  sample: Sample;
  log: string;
}

export interface ErStats {
  char: string;
  bursts: number;
  needed: { p50: number; p80: number; max: number };
  current: number | null;
  additional: number;
}

async function call<T>(route: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api/gcsim/${route}`, body === undefined
      ? undefined
      : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  } catch {
    throw new Error('Local gcsim bridge unreachable. Run the app with `npm run dev` (or `npm run preview`).');
  }
  const text = await res.text();
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(res.ok ? 'Unexpected response from the gcsim bridge.' : `gcsim bridge error ${res.status}`);
  }
  if (!res.ok) throw new Error((data as { error?: string }).error ?? `gcsim bridge error ${res.status}`);
  return data as T;
}

export const gcsim = {
  status: () => call<GcsimStatus>('status'),
  download: () => call<GcsimStatus>('download', {}),
  run: (config: string) => call<RunResponse>('run', { config }),
  erCalc: (config: string, samples = 24) => call<ErStats[]>('ercalc', { config, samples }),
  optimize: (config: string) => call<{ config: string; log: string }>('optimize', { config }),
};
