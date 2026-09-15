/**
 * Response projection.
 *
 * The REST API returns generous records - a single GPU catalogue entry carries around fifty
 * fields (marketing copy, chip specs, comparison prices). Handing all of that to a model
 * spends the context the actual task needs, so every list tool projects to the fields a
 * decision is made on. Tool descriptions say so, and point at the REST API for the rest.
 */

type Rec = Record<string, unknown>;

function pick(src: unknown, keys: readonly string[]): Rec {
  const out: Rec = {};
  if (!src || typeof src !== 'object') return out;
  for (const k of keys) {
    const v = (src as Rec)[k];
    if (v !== undefined) out[k] = v;
  }
  return out;
}

const GPU_KEYS = [
  'id', 'name', 'architecture', 'vramGb', 'hourlyPrice', 'liveRentablePrice', 'offers',
  'demandStatus', 'availability', 'totalGpus', 'availableGpus', 'rentalMode', 'contactEmail',
  'cardCount', 'fp16Tflops', 'idealFor',
] as const;

const NODE_KEYS = [
  'id', 'hostname', 'arch', 'gpuModel', 'totalGpus', 'usedGpus', 'availableGpus', 'vramGb',
  'cpuCores', 'rentableRamGb', 'rentableStorageGb', 'cudaVersion', 'nvidiaDriverVersion',
  'hourlyRate', 'queueDepth', 'catalogId',
] as const;

const TEMPLATE_KEYS = [
  'id', 'name', 'description', 'dockerImage', 'category', 'architectures',
  'minComputeCapability', 'webUiEnabled', 'webUiPort', 'tags',
] as const;

const INSTANCE_KEYS = [
  'id', 'status', 'deployPhase', 'nodeId', 'template', 'isByoImage', 'gpuCount', 'cpuCores',
  'ramGb', 'diskSizeGb', 'shmSizeGb', 'bandwidthMbps', 'hourlyRate', 'computeHourlyRate',
  'extraPortFee', 'allowedPorts', 'webUiEnabled', 'webUiPort', 'createdAt', 'hasFailureLog',
] as const;

const NODE_SUMMARY_KEYS = ['id', 'hostname', 'gpuModel', 'arch', 'cudaVersion'] as const;

export function projectGpu(g: unknown): Rec {
  return pick(g, GPU_KEYS);
}

export function projectNode(n: unknown): Rec {
  return pick(n, NODE_KEYS);
}

export function projectTemplate(t: unknown): Rec {
  return pick(t, TEMPLATE_KEYS);
}

/** Instance record plus the machine's public label - never its real hostname or address. */
export function projectInstance(i: unknown): Rec {
  const out = pick(i, INSTANCE_KEYS);
  const node = (i as Rec | undefined)?.['node'];
  if (node) out['node'] = pick(node, NODE_SUMMARY_KEYS);
  const exposures = (i as Rec | undefined)?.['exposures'];
  if (Array.isArray(exposures) && exposures.length > 0) {
    out['exposures'] = exposures.map((e) =>
      pick(e, ['id', 'protocol', 'containerPort', 'publicPort', 'endpoint'] as const)
    );
  }
  const portAccess = (i as Rec | undefined)?.['portAccess'];
  if (portAccess) out['portAccess'] = portAccess;
  return out;
}

export function projectVaultEntry(f: unknown): Rec {
  return pick(f, ['name', 'size', 'modifiedAt', 'type'] as const);
}
