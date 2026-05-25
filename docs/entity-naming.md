# Entity Naming & Auto-Discovery

This document explains how the Irrigation Card discovers ESPHome entities and which naming rules you must follow.

## How Auto-Discovery Works

When you configure the card with a `device_id`, it fetches all entities belonging to that device and matches them by **pattern** against `friendly_name` (with the device name prefix stripped) and `entity_id`.

Controller entities (main switch, auto advance, status, etc.) are matched using **regex patterns**. Valve-related entities (enable switches, run durations) use **heuristic name similarity** — the card looks for keywords and matches them to the corresponding valve by name proximity.

> **Important:** Renaming entities in the Home Assistant UI changes `friendly_name` and **may break auto-discovery**. The card matches against both the stripped `friendly_name` and the `entity_id`, so a rename won't break discovery if the `entity_id` still contains the expected keyword (e.g. `switch.auto_advance_b` still matches `/auto.?advance/i`). However, relying on entity_id matching is fragile — HA may regenerate entity IDs when devices are re-added.

## Naming Rules Reference

### Controller Entities — Must Match Regex

These entity names are matched by regex against `friendly_name` (device prefix stripped) and `entity_id`. The **ESPHome YAML name** must contain the required keyword in English.

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

### Status Sensor Values — Must Be English

The status sensor text value is passed through `toLowerCase()` and compared literally by the UI. The card only recognizes these exact values:

| Value | Meaning | Localizable? |
|-------|---------|-------------|
| `Idle` | Controller idle, show Start button | **No** — must be exactly "Idle" (case-insensitive) |
| `Running` | Cycle active, show Pause/Stop buttons | **No** — must be exactly "Running" (case-insensitive) |
| `Paused` | Cycle paused, show Resume/Stop buttons | **No** — must be exactly "Paused" (case-insensitive) |
| `Standby` | Standby mode | **No** — must be exactly "Standby" (case-insensitive) |

> **Warning:** If the status sensor reports a value the card doesn't recognize (e.g. localized text like "Běží" or zone-specific text like "Zone 1 Active"), the card will not show Pause/Stop controls. Always use the exact English values above in your ESPHome relay `on_turn_on` / `on_turn_off` handlers.

### Valve & Zone Names — Freely Localizable

Valve names (the `valve_switch:` name in ESPHome) are discovered by **exclusion** — any switch that is not a controller entity (main, auto advance, reverse, enable, etc.) is treated as a valve. The name itself can be in any language.

Enable switches and run duration numbers are matched to their valve by **name similarity** — the card checks if the candidate's name contains the valve name. So if your valve is "Postřik 1", the enable switch should contain "Postřik 1" in its name (e.g. "Enable Postřik 1").

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

Here's how to set up substitutions with correct naming. English keywords that the card requires are marked:

```yaml
substitutions:
  friendly_name: "Závlaha"              # ✅ freely localizable
  main_switch_prefix: "Main"            # ❌ must contain "main"
  auto_advance_prefix: "Auto Advance"   # ❌ must contain "auto advance"
  reverse_suffix: "Reverse"             # ❌ must contain "reverse"
  multiplier_suffix: "Multiplier"       # ❌ must contain "multiplier"
  repeat_suffix: "Repeat"              # ❌ must contain "repeat"
  enable_prefix: "Enable"              # ❌ must start with "Enable"
  pause_name: "Pause"                  # ❌ must contain "pause"
  status_name: "Status"                # ❌ must contain "status"
  time_remaining_name: "Time Remaining" # ❌ must contain "time remaining"
  progress_name: "Progress %"          # ❌ must contain "progress"
  run_duration_suffix: "Doba běhu"      # ✅ freely localizable
  zone_1_name: "Postřik 1"            # ✅ freely localizable
  zone_2_name: "Kapková 1"            # ✅ freely localizable
  main_valve_name: "Hlavní ventil"     # ✅ freely localizable
  relay_suffix: "Relé"                # ✅ freely localizable
  status_active: "Running"             # ❌ must be exactly "Running"
  restart_name: "Restartovat"          # ✅ freely localizable
```

## Troubleshooting

**Card doesn't find my entities:**
1. Check that entity names contain the required English keywords (see table above)
2. Check entity_id — the card also matches against it as a fallback
3. Enable card debug logging to see which entities are found and which patterns are tested

**Enable switches not matched to valves:**
- The enable switch name must contain the valve name. E.g. valve "Sprinklers 1" → enable "Enable Sprinklers 1"
- Both `friendly_name` and `entity_id` are checked for similarity

**Status shows wrong state:**
- The status sensor value is lowercased and compared verbatim — only exact `"running"` and `"paused"` activate Pause/Stop controls
- An unrecognized value (e.g. zone name, custom text) results in neither running nor paused state — controls won't appear
- Use exactly **Running**, **Paused**, **Idle**, or **Standby**
