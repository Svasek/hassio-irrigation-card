# Entity Naming & Auto-Discovery

This document explains how the Irrigation Card discovers ESPHome entities and which naming rules you must follow.

## How Auto-Discovery Works

When you configure the card with a `device_id`, it fetches all entities belonging to that device and matches them by **pattern** against multiple name sources (in priority order):

1. **`original_name`** — the integration-reported name from ESPHome YAML (fetched via WebSocket entity registry API)
2. **`friendly_name`** — the display name in HA (may be changed by the user)
3. **`entity_id`** — the HA entity identifier (regex fallback)

All names are stripped of the device name prefix before matching.

Controller entities (main switch, auto advance, status, etc.) are matched using **regex patterns**. Valve-related entities (enable switches, run durations) use **heuristic name similarity** — the card looks for keywords and matches them to the corresponding valve by name proximity.

> **Renaming entities in the Home Assistant UI is safe.** The card uses `original_name` (the name defined in your ESPHome YAML) as the primary match source. Since `original_name` is immutable from HA's perspective, renaming an entity's `friendly_name` in the UI won't break auto-discovery. The `friendly_name` and `entity_id` serve as fallbacks if `original_name` is unavailable.
>
> The `original_name` is fetched asynchronously via the WebSocket entity registry API on first load. If the fetch fails (e.g. network issue), the card falls back to synchronous discovery using `friendly_name` and `entity_id`, and retries the WS fetch after 60 seconds.

## Naming Rules Reference

### Controller Entities — Must Match Regex

These entity names are matched by regex against `original_name`, `friendly_name` (both with device prefix stripped), and `entity_id`. The **ESPHome YAML name** must contain the required keyword in English.

> **Tip:** Since the card uses `original_name` (the ESPHome YAML name) as the primary match source, you can freely rename these entities in the Home Assistant UI to localized names. The original English keyword is preserved and used for matching.

| Entity | Regex Pattern | Example Name | Notes |
|--------|--------------|--------------|-------|
| Main switch | `start.*stop|main` | "Main Irrigation" | Must contain "main" or "start…stop" |
| Auto advance | `auto.?advance` | "Auto Advance Irrigation" | Must contain "auto advance" |
| Reverse | `reverse` | "Irrigation Reverse" | Must contain "reverse" |
| Pause | `pause` | "Pause" | Must contain "pause" |
| Multiplier | `multiplier` | "Irrigation Multiplier" | Must contain "multiplier" |
| Repeat | `repeat` | "Irrigation Repeat" | Must contain "repeat" |
| Status | `status` | "Status" | Must contain "status" |
| Time remaining | `time.?remaining` | "Time Remaining" | Must contain "time remaining" |
| Progress | `progress` | "Progress %" | Must contain "progress" |
| Enable switch | `^enable\s` or `enable_` in entity_id | "Enable Sprinklers 1" | Must start with "Enable " or have `enable_` in entity_id |
| Queue | `queue` | "Queue" | Must contain "queue" |
| Standby | `standby` | "Standby" | Must contain "standby" |

### Status Sensor Values — Normalization

The status sensor text value is passed through `toLowerCase()` and normalized. The card recognizes three specific non-running states; **any other value is treated as "running"**:

| Value | Meaning | Localizable? |
|-------|---------|-------------|
| `Idle` | Controller idle, show Start button | **No** — must be exactly "Idle" (case-insensitive) |
| `Paused` | Cycle paused, show Resume/Stop buttons | **No** — must be exactly "Paused" (case-insensitive) |
| `Standby` | Standby mode | **No** — must be exactly "Standby" (case-insensitive) |
| _anything else_ | Treated as **running** — show Pause/Stop buttons | N/A — any unrecognized value (e.g. "Running", "Zone 1 Active", "Běží") maps to running |

> **Note:** You don't need to publish exactly "Running" from your ESPHome relays — any value that isn't "Idle", "Paused", or "Standby" will be interpreted as running. However, using "Running" is still recommended for clarity. The values "Idle", "Paused", and "Standby" **must** be in English (case-insensitive).

### Valve & Zone Names — Freely Localizable

Valve names (the `valve_switch:` name in ESPHome) are discovered by **exclusion** — any switch that is not a controller entity (main, auto advance, reverse, enable, etc.) is treated as a valve. The name itself can be in any language.

Enable switches and run duration numbers are matched to their valve by **name similarity** using a multi-strategy approach:

1. **Name containment** — the candidate's `original_name` or `friendly_name` contains the valve's display name
2. **Original name fallback** — if the valve was renamed in HA, the card matches via the valve's `original_name` against candidate names
3. **Entity ID keywords** — keywords from the valve's `entity_id` are matched against candidates
4. **Specific keywords** — the last 2 words from the valve's `entity_id` (e.g. `zone_1`) are matched

So if your valve is "Postřik 1" in ESPHome, the enable switch should contain "Postřik 1" in its name (e.g. "Enable Postřik 1"). Even if you rename the valve in HA to "Trávník", the card will still match via the original ESPHome name.

### Other Freely Localizable Names

These entity names are not matched by regex and can be in any language:

| Entity | Why It's Free |
|--------|--------------|
| `friendly_name` (ESPHome device) | Only used as display prefix, stripped before matching |
| Zone/valve names | Matched by exclusion, not by keyword |
| Run duration suffix | Matched to valve by name similarity |
| Main valve relay name | Internal relay, card doesn't use it |
| Relay names | Internal relays, card doesn't use them |
| Restart button | Excluded by `restart|connection|firmware` pattern (won't be treated as valve) |

## ESPHome Substitutions Example

Here's how to set up substitutions with correct naming. The ❌ names must contain the English keyword in the **ESPHome YAML** — but once created, **you can rename them in the HA UI** to any language (the card matches via `original_name`):

```yaml
substitutions:
  friendly_name: "My Irrigation"         # ✅ freely localizable
  main_switch_prefix: "Main"             # ❌ must contain "main"
  auto_advance_prefix: "Auto Advance"    # ❌ must contain "auto advance"
  reverse_suffix: "Reverse"              # ❌ must contain "reverse"
  multiplier_suffix: "Multiplier"        # ❌ must contain "multiplier"
  repeat_suffix: "Repeat"                # ❌ must contain "repeat"
  enable_prefix: "Enable"                # ❌ must start with "Enable"
  pause_name: "Pause"                    # ❌ must contain "pause"
  status_name: "Status"                  # ❌ must contain "status"
  time_remaining_name: "Time Remaining"  # ❌ must contain "time remaining"
  progress_name: "Progress %"            # ❌ must contain "progress"
  run_duration_suffix: "Run Duration"    # ✅ freely localizable
  zone_1_name: "Sprinklers Zone 1"       # ✅ freely localizable
  zone_2_name: "Dripline"                # ✅ freely localizable
  main_valve_name: "Main Valve"          # ✅ freely localizable
  relay_suffix: "Relay"                  # ✅ freely localizable
  status_active: "Running"               # ✅ recommended, but any non-idle/paused/standby value = running
  restart_name: "Restart"                # ✅ freely localizable
```

## Troubleshooting

**Card doesn't find my entities:**
1. Check that ESPHome YAML names contain the required English keywords (see table above) — these become `original_name` and are the primary match source
2. Check entity_id — the card also matches against it as a fallback
3. Enable card debug logging (`irrigationCardDebug()` in browser console) to see which entities are found, which `original_name` values are cached, and which patterns are tested
4. If the card shows entities as "not found" briefly on first load, this is normal — the WebSocket registry fetch is async and the card will re-render once it completes

**Enable switches not matched to valves:**
- The enable switch's ESPHome YAML name must contain the valve name. E.g. valve "Sprinklers 1" → enable "Enable Sprinklers 1"
- Both `original_name`, `friendly_name`, and `entity_id` are checked using multiple strategies
- Even if you rename entities in HA UI, matching works via the original ESPHome names

**Status shows wrong state:**
- The status sensor value is lowercased and normalized — only "idle", "paused", and "standby" are recognized as non-running states; any other value is treated as running
- If Pause/Stop controls appear unexpectedly, check that your status sensor publishes exactly **Idle** (not a zone name or custom text) when the controller is not running
- Use **Idle**, **Paused**, or **Standby** for non-running states (must be English, case-insensitive). "Running" is recommended but any other value also maps to running
