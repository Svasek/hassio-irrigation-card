import { HomeAssistant } from "custom-card-helpers";
import { DEFAULT_VALVE_ICON } from "../const";
import { IrrigationCardConfig, ResolvedConfig, ResolvedValve } from "../types";
import { logDiscovery, logServiceCall } from "./logger";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type HassAny = any;

/**
 * Module-level cache for original_name values fetched via WS API.
 * hass.entities[id].original_name is undefined for ESPHome entities,
 * but the WS entity registry list does return it.
 */
const originalNameCache = new Map<string, string>();
const cachedDeviceEntityIds = new Map<string, Set<string>>();
let registryPromise: Promise<RegistryEntry[]> | null = null;
let registryFailedAt = 0;

/** Clear cached entries for a device so they don't accumulate when configs change. */
export function clearDeviceCache(deviceId: string): void {
  const ids = cachedDeviceEntityIds.get(deviceId);
  if (ids) {
    for (const id of ids) originalNameCache.delete(id);
    cachedDeviceEntityIds.delete(deviceId);
  }
}

/**
 * Discover entities from a HA device.
 * Uses hass.entities (entity registry) to find entities belonging to a device.
 * Falls back to WebSocket call if hass.entities is not available.
 */
export function discoverEntities(
  hass: HomeAssistant,
  config: IrrigationCardConfig,
): ResolvedConfig {
  const resolved: ResolvedConfig = { valves: [] };

  // If explicit valves are configured, use them directly
  if (config.valves && config.valves.length > 0) {
    resolved.valves = config.valves.map((v) => ({
      name: v.name || friendlyName(hass, v.valve_switch) || v.valve_switch,
      valve_switch: v.valve_switch,
      enable_switch: v.enable_switch,
      run_duration: v.run_duration,
      icon: v.icon || DEFAULT_VALVE_ICON,
    }));
  }

  // Copy explicit controller overrides
  resolved.main_switch = config.main_switch;
  resolved.auto_advance_switch = config.auto_advance_switch;
  resolved.reverse_switch = config.reverse_switch;
  resolved.pause_button = config.pause_button;
  resolved.queue_enable_switch = config.queue_enable_switch;
  resolved.standby_switch = config.standby_switch;
  resolved.multiplier = config.multiplier;
  resolved.repeat = config.repeat;
  resolved.status_sensor = config.status_sensor;
  resolved.progress_sensor = config.progress_sensor;
  resolved.time_remaining_sensor = config.time_remaining_sensor;

  // Auto-discover from device if device_id is set
  if (config.device_id) {
    const deviceEntities = getDeviceEntities(hass, config.device_id);
    logDiscovery(`Device ${config.device_id}: found ${deviceEntities.length} entities (sync)`, deviceEntities);
    if (deviceEntities.length > 0) {
      autoDiscoverFromDevice(hass, deviceEntities, resolved, config);
    }
  }

  logDiscovery("Resolved config", resolved);
  return resolved;
}

/**
 * Async version of entity discovery that uses WebSocket API as fallback.
 * Call this once after config is set, store the result.
 * Skips the WS fetch when all discovery targets (valves + controller fields)
 * are explicitly configured, avoiding unnecessary round-trips.
 */
// Controller fields that autoDiscoverFromDevice can fill in.
// When all of these (+ valves) are explicitly set, the WS fetch is unnecessary.
const DISCOVERABLE_FIELDS: (keyof IrrigationCardConfig)[] = [
  "main_switch", "auto_advance_switch", "reverse_switch", "pause_button",
  "queue_enable_switch", "standby_switch", "multiplier", "repeat",
  "status_sensor", "progress_sensor", "time_remaining_sensor",
];

export async function discoverEntitiesAsync(
  hass: HomeAssistant,
  config: IrrigationCardConfig,
): Promise<ResolvedConfig> {
  // Skip WS fetch when nothing needs auto-discovery:
  // no device_id, or all discovery targets are explicitly configured
  const fullyConfigured = !!config.valves?.length &&
    DISCOVERABLE_FIELDS.every((f) => config[f]);
  if (!config.device_id || fullyConfigured) {
    return discoverEntities(hass, config);
  }

  // Populate original_name cache before discovery so matchesFriendlyName
  // can use integration-reported names on the first run (avoids flash of
  // incomplete content). The in-flight promise is shared so concurrent
  // callers (multiple cards) deduplicate into a single WS request.
  // Throws on WS failure so the card can schedule a retry.
  const registry = await fetchEntityRegistry(hass);

  // Populate originalNameCache only for this device's entities.
  // Clear previous entries for this device first to remove stale entity_ids.
  const prevIds = cachedDeviceEntityIds.get(config.device_id);
  if (prevIds) {
    for (const id of prevIds) originalNameCache.delete(id);
  }
  const newIds = new Set<string>();
  for (const entry of registry) {
    if (entry.device_id === config.device_id) {
      newIds.add(entry.entity_id);
      if (entry.original_name) {
        originalNameCache.set(entry.entity_id, entry.original_name);
      }
    }
  }
  cachedDeviceEntityIds.set(config.device_id, newIds);
  logDiscovery(`originalNameCache: ${newIds.size} entities for device ${config.device_id}`);

  // Build resolved config from explicit values only, then run a single
  // autoDiscoverFromDevice pass with WS-derived entities.  This avoids
  // the double-discovery that would happen if we called discoverEntities
  // (which runs its own sync device discovery internally).
  const resolved: ResolvedConfig = { valves: [] };
  if (config.valves && config.valves.length > 0) {
    resolved.valves = config.valves.map((v) => ({
      name: v.name || friendlyName(hass, v.valve_switch) || v.valve_switch,
      valve_switch: v.valve_switch,
      enable_switch: v.enable_switch,
      run_duration: v.run_duration,
      icon: v.icon || DEFAULT_VALVE_ICON,
    }));
  }
  resolved.main_switch = config.main_switch;
  resolved.auto_advance_switch = config.auto_advance_switch;
  resolved.reverse_switch = config.reverse_switch;
  resolved.pause_button = config.pause_button;
  resolved.queue_enable_switch = config.queue_enable_switch;
  resolved.standby_switch = config.standby_switch;
  resolved.multiplier = config.multiplier;
  resolved.repeat = config.repeat;
  resolved.status_sensor = config.status_sensor;
  resolved.progress_sensor = config.progress_sensor;
  resolved.time_remaining_sensor = config.time_remaining_sensor;

  const deviceEntities = Array.from(newIds);
  logDiscovery(`Device ${config.device_id}: found ${deviceEntities.length} entities (async/WS)`, deviceEntities);
  if (deviceEntities.length > 0) {
    autoDiscoverFromDevice(hass, deviceEntities, resolved, config);
  }
  logDiscovery("Resolved config (async)", resolved);

  return resolved;
}

interface RegistryEntry {
  entity_id: string;
  device_id: string;
  original_name?: string;
}

/**
 * Fetch entity registry via WS API. Returns the full registry so callers
 * can filter by device_id and populate originalNameCache themselves.
 * Caches the in-flight promise so concurrent callers share a single WS request.
 * The promise is cleared after successful resolve so the full array can be GC'd
 * and subsequent calls fetch fresh data (picking up registry changes).
 * On failure the rejected promise is cached with REGISTRY_RETRY_MS TTL.
 */
export const REGISTRY_RETRY_MS = 60_000;

function fetchEntityRegistry(hass: HomeAssistant): Promise<RegistryEntry[]> {
  if (registryPromise && registryFailedAt && Date.now() - registryFailedAt >= REGISTRY_RETRY_MS) {
    registryPromise = null;
    registryFailedAt = 0;
  }
  if (!registryPromise) {
    registryPromise = (async () => {
      try {
        const registry: RegistryEntry[] =
          await (hass as HassAny).callWS({
            type: "config/entity_registry/list",
          });
        registryFailedAt = 0;
        // Clear cached promise so the full array can be GC'd after callers
        // extract per-device data. Next call will fetch fresh registry.
        registryPromise = null;
        logDiscovery(`Entity registry fetched: ${registry.length} entries`);
        return registry;
      } catch (err) {
        console.warn("irrigation-card: Failed to fetch entity registry:", err);
        registryFailedAt = Date.now();
        throw err;
      }
    })();
  }
  return registryPromise;
}

function getDeviceEntities(
  hass: HomeAssistant,
  deviceId: string,
): string[] {
  // Try hass.entities (entity registry, available in newer HA)
  const entities = (hass as HassAny).entities;
  if (entities && typeof entities === "object") {
    return Object.keys(entities).filter(
      (eid) => entities[eid]?.device_id === deviceId,
    );
  }
  return [];
}

function autoDiscoverFromDevice(
  hass: HomeAssistant,
  entityIds: string[],
  resolved: ResolvedConfig,
  config: IrrigationCardConfig,
): void {
  const switches = entityIds.filter((id) => id.startsWith("switch."));
  const numbers = entityIds.filter((id) => id.startsWith("number."));
  const sensors = entityIds.filter((id) => id.startsWith("sensor."));
  const buttons = entityIds.filter((id) => id.startsWith("button."));

  logDiscovery("Entity breakdown", { switches, numbers, sensors, buttons });

  // Controller-level entities (only fill in what's not explicitly configured)
  if (!config.main_switch) {
    resolved.main_switch = switches.find((id) =>
      matchesFriendlyName(hass, id, /start.*stop|main/i),
    );
  }
  if (!config.auto_advance_switch) {
    resolved.auto_advance_switch = switches.find((id) =>
      matchesFriendlyName(hass, id, /auto.?advance/i),
    );
  }
  if (!config.reverse_switch) {
    resolved.reverse_switch = switches.find((id) =>
      matchesFriendlyName(hass, id, /reverse/i),
    );
  }
  if (!config.pause_button) {
    resolved.pause_button = buttons.find((id) =>
      matchesFriendlyName(hass, id, /pause/i),
    );
  }
  if (!config.queue_enable_switch) {
    resolved.queue_enable_switch = switches.find((id) =>
      matchesFriendlyName(hass, id, /queue/i),
    );
  }
  if (!config.standby_switch) {
    resolved.standby_switch = switches.find((id) =>
      matchesFriendlyName(hass, id, /standby/i),
    );
  }
  if (!config.multiplier) {
    resolved.multiplier = numbers.find((id) =>
      matchesFriendlyName(hass, id, /multiplier/i),
    );
  }
  if (!config.repeat) {
    resolved.repeat = numbers.find((id) =>
      matchesFriendlyName(hass, id, /repeat/i),
    );
  }

  // Status sensors
  if (!config.status_sensor) {
    resolved.status_sensor = sensors.find((id) =>
      matchesFriendlyName(hass, id, /status/i),
    );
  }
  if (!config.progress_sensor) {
    resolved.progress_sensor = sensors.find((id) =>
      matchesFriendlyName(hass, id, /progress/i),
    );
  }
  if (!config.time_remaining_sensor) {
    resolved.time_remaining_sensor = sensors.find((id) =>
      matchesFriendlyName(hass, id, /time.?remaining/i),
    );
  }

  // Valves: auto-discover only if not explicitly configured
  if (!config.valves || config.valves.length === 0) {
    resolved.valves = discoverValves(hass, switches, numbers, resolved);
  }
}

function discoverValves(
  hass: HomeAssistant,
  switches: string[],
  numbers: string[],
  resolved: ResolvedConfig,
): ResolvedValve[] {
  // Controller-level entity IDs to exclude from valve detection
  const controllerIds = new Set(
    [
      resolved.main_switch,
      resolved.auto_advance_switch,
      resolved.reverse_switch,
      resolved.queue_enable_switch,
      resolved.standby_switch,
    ].filter(Boolean),
  );

  // Enable switches to exclude (they'll be matched to valves)
  const enableSwitches = switches.filter(
    (id) =>
      matchesFriendlyName(hass, id, /^enable\s/i) || id.includes("enable_"),
  );
  const enableSet = new Set(enableSwitches);

  // Also exclude restart switch and similar non-valve switches
  const excludePatterns = /restart|connection|firmware/i;

  // Valve switches: switches that are not controller, not enable, not utility
  const valveSwitches = switches.filter(
    (id) =>
      !controllerIds.has(id) &&
      !enableSet.has(id) &&
      !matchesFriendlyName(hass, id, excludePatterns),
  );

  return valveSwitches.map((valveSwitch) => {
    const fname = friendlyName(hass, valveSwitch) || valveSwitch;
    const name = stripDevicePrefix(hass, valveSwitch, fname);

    // Find matching enable switch by friendly_name or entity_id similarity
    const enableSwitch = findMatchingEntity(hass, enableSwitches, name, valveSwitch);

    // Find matching run duration number entity
    const runDuration = findMatchingEntity(hass, numbers, name, valveSwitch);

    return {
      name,
      valve_switch: valveSwitch,
      enable_switch: enableSwitch,
      run_duration: runDuration,
      icon: DEFAULT_VALVE_ICON,
    };
  });
}

/**
 * Find a matching entity from candidates by original_name, friendly_name,
 * or entity_id similarity. Tries multiple strategies:
 * 1.  Original or friendly name of candidate contains the valve display name
 * 1b. When valve was renamed, match via valve's originalName against candidate names
 * 2.  Entity ID keyword matching (extract common keywords from valve switch entity_id)
 * 3.  Specific keyword matching (last 2 words like "zone_1")
 */
function findMatchingEntity(
  hass: HomeAssistant,
  candidates: string[],
  valveDisplayName: string,
  valveSwitchId: string,
): string | undefined {
  // Strategy 1: original or friendly name of candidate contains the valve display name
  const target = valveDisplayName.toLowerCase().trim();
  if (target) {
    const match1 = candidates.find((id) => {
      const orig = (originalName(hass, id) || "").toLowerCase();
      const friendly = (friendlyName(hass, id) || "").toLowerCase();
      return orig.includes(target) || friendly.includes(target);
    });
    if (match1) {
      logDiscovery(`Match for "${valveSwitchId}": "${match1}" (strategy: name match)`);
      return match1;
    }
  }

  // Strategy 1b: when valve was renamed by the user, the candidate's
  // original_name won't contain the new display name. Fall back to
  // matching via the valve's original (integration-reported) name.
  const valveOriginal = originalName(hass, valveSwitchId);
  if (valveOriginal) {
    const valveOrigStripped = stripDevicePrefix(hass, valveSwitchId, valveOriginal).toLowerCase().trim();
    if (valveOrigStripped && valveOrigStripped !== valveDisplayName.toLowerCase()) {
      const match1b = candidates.find((id) => {
        const candOrig = stripDevicePrefix(hass, id, originalName(hass, id) || "").toLowerCase();
        const candFriendly = stripDevicePrefix(hass, id, friendlyName(hass, id) || "").toLowerCase();
        return candOrig.includes(valveOrigStripped) || candFriendly.includes(valveOrigStripped);
      });
      if (match1b) {
        logDiscovery(`Match for "${valveSwitchId}": "${match1b}" (strategy: original_name)`);
        return match1b;
      }
    }
  }

  // Strategy 2: extract zone/valve identifier from entity_id and match
  // e.g. switch.irrigation_node_sprinklers_zone_1 -> ["sprinklers", "zone", "1"]
  // number.sprinklers_zone_1 -> ["sprinklers", "zone", "1"]
  const valveIdPart = valveSwitchId.split(".")[1] || "";
  // Remove common prefixes like "irrigation_node_"
  const valveKeywords = valveIdPart
    .replace(/^irrigation_node_/, "")
    .split("_")
    .filter((w) => w.length > 0);

  if (valveKeywords.length === 0) return undefined;

  const match2 = candidates.find((candidateId) => {
    const candidateIdPart = candidateId.split(".")[1] || "";
    // Check if all valve keywords appear in candidate entity_id
    return valveKeywords.every((kw) => candidateIdPart.includes(kw));
  });
  if (match2) {
    logDiscovery(`Match for "${valveSwitchId}": "${match2}" (strategy: entity_id keywords [${valveKeywords}])`);
    return match2;
  }

  // Strategy 3: match just the most specific keywords (last 2 words like "zone_1")
  if (valveKeywords.length >= 2) {
    const specificKeywords = valveKeywords.slice(-2);
    const match3 = candidates.find((candidateId) => {
      const candidateIdPart = candidateId.split(".")[1] || "";
      return specificKeywords.every((kw) => candidateIdPart.includes(kw));
    });
    if (match3) {
      logDiscovery(`Match for "${valveSwitchId}": "${match3}" (strategy: specific keywords [${specificKeywords}])`);
    } else {
      logDiscovery(`No match found for "${valveSwitchId}" among`, candidates);
    }
    return match3;
  }

  logDiscovery(`No match found for "${valveSwitchId}" among`, candidates);
  return undefined;
}

/**
 * Strip the device name prefix from a friendly name.
 * e.g. "Irrigation-Ctrl-Unit-B Sprinklers - zone 1" → "Sprinklers - zone 1"
 */
function stripDevicePrefix(
  hass: HomeAssistant,
  entityId: string,
  fname: string,
): string {
  const entities = (hass as HassAny).entities;
  if (!entities?.[entityId]?.device_id) return fname;

  const devices = (hass as HassAny).devices;
  if (!devices) return fname;

  const device = devices[entities[entityId].device_id];
  // Use user-renamed device name if available, since HA composes
  // friendly_name from the effective name (name_by_user || name)
  const deviceName = device?.name_by_user || device?.name;
  if (!deviceName) return fname;
  if (fname.startsWith(deviceName)) {
    return fname.slice(deviceName.length).replace(/^\s+/, "");
  }
  return fname;
}

function matchesFriendlyName(
  hass: HomeAssistant,
  entityId: string,
  pattern: RegExp,
): boolean {
  const orig = stripDevicePrefix(hass, entityId, originalName(hass, entityId) || "");
  const friendly = stripDevicePrefix(hass, entityId, friendlyName(hass, entityId) || "");
  return pattern.test(orig) || pattern.test(friendly) || pattern.test(entityId);
}

/**
 * Get the original (integration-reported) name for an entity.
 * Returns undefined if the original name is not available, letting
 * callers fall back to friendlyName() or other sources.
 */
function originalName(
  hass: HomeAssistant,
  entityId: string,
): string | undefined {
  const entities = (hass as HassAny).entities;
  const entry = entities?.[entityId];
  // 1. Try hass.entities (undefined for ESPHome, but works for other integrations)
  if (entry?.original_name) return entry.original_name;
  // 2. Try WS-based cache (works for ESPHome)
  return originalNameCache.get(entityId);
}

export function friendlyName(
  hass: HomeAssistant,
  entityId: string,
): string | undefined {
  const state = hass.states[entityId];
  return state?.attributes?.friendly_name;
}

export function entityState(
  hass: HomeAssistant,
  entityId: string | undefined,
): string | undefined {
  if (!entityId) return undefined;
  return hass.states[entityId]?.state;
}

export function entityNumericValue(
  hass: HomeAssistant,
  entityId: string | undefined,
): number | undefined {
  const state = entityState(hass, entityId);
  if (state === undefined || state === "unavailable" || state === "unknown")
    return undefined;
  const val = parseFloat(state);
  return isNaN(val) ? undefined : val;
}

export function entityAttributes(
  hass: HomeAssistant,
  entityId: string | undefined,
): Record<string, unknown> {
  if (!entityId) return {};
  return (hass.states[entityId]?.attributes as Record<string, unknown>) || {};
}

export function callSwitchService(
  hass: HomeAssistant,
  entityId: string,
  turnOn: boolean,
): void {
  const service = turnOn ? "turn_on" : "turn_off";
  logServiceCall("switch", service, { entity_id: entityId });
  hass.callService("switch", service, {
    entity_id: entityId,
  });
}

export function callButtonPress(
  hass: HomeAssistant,
  entityId: string,
): void {
  logServiceCall("button", "press", { entity_id: entityId });
  hass.callService("button", "press", {
    entity_id: entityId,
  });
}

export function callNumberService(
  hass: HomeAssistant,
  entityId: string,
  value: number,
): void {
  logServiceCall("number", "set_value", { entity_id: entityId, value });
  hass.callService("number", "set_value", {
    entity_id: entityId,
    value,
  });
}

export function getControllerStatus(
  hass: HomeAssistant,
  resolved: ResolvedConfig,
): string {
  // Prefer status sensor if available
  if (resolved.status_sensor) {
    const status = entityState(hass, resolved.status_sensor);
    if (status && status !== "unavailable" && status !== "unknown") {
      const normalized = status.toLowerCase();
      // Only recognize known non-running states; anything else means running
      if (["idle", "paused", "standby"].includes(normalized)) {
        return normalized;
      }
      return "running";
    }
  }

  if (
    resolved.standby_switch &&
    entityState(hass, resolved.standby_switch) === "on"
  ) {
    return "standby";
  }

  if (
    resolved.main_switch &&
    entityState(hass, resolved.main_switch) === "on"
  ) {
    return "running";
  }

  return "idle";
}
