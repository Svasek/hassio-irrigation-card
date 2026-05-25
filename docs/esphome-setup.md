# ESPHome Sprinkler Setup Guide

This guide shows how to set up an ESPHome sprinkler controller that works with the Irrigation Card.

> **Complete example:** Download the full ESPHome config file: [irrigation-ctrl-unit-b.yaml](examples/irrigation-ctrl-unit-b.yaml)
>
> **Entity naming rules:** See [Entity Naming & Auto-Discovery](entity-naming.md) for which names can be localized and which must stay in English.

## Overview

The ESPHome [Sprinkler component](https://esphome.io/components/sprinkler/) provides a full irrigation controller with:
- Multiple valve zones with individual run durations
- Auto-advance through zones in a cycle
- Pause/resume support
- Enable/disable individual zones from the cycle
- Reverse cycle order
- Cycle multiplier and repeat count
- Status, progress, and time remaining sensors

## Hardware

This example uses an **ESP8266** (ESP-01 1M) board with a 5-channel relay module. Adapt GPIO pins to your hardware.

| Relay | GPIO | Zone |
|-------|------|------|
| IN1 | GPIO16 | Sprinklers - zone 1 |
| IN2 | GPIO5 | Sprinklers - zone 2 |
| IN3 | GPIO4 | Sprinklers - zone 3 |
| IN4 | GPIO0 | Sprinklers - zone 4 |
| IN5 | GPIO14 | Dripline |
| Pump | GPIO2 | Pump relay |

> **Note:** All relay pins use `inverted: true` for active-low relay modules.

## ESPHome Configuration

### Substitutions

Customize zone names and the unit identifier at the top of the config. The `unit_id` allows running multiple controllers (A, B, C, ...).

```yaml
substitutions:
  unit_id: B
  devicename_unit_id: b
  zone_1_name: Sprinklers - zone 1
  zone_2_name: Sprinklers - zone 2
  zone_3_name: Sprinklers - zone 3
  zone_4_name: Sprinklers - zone 4
  zone_5_name: Dripline
  software_version: 2022 10 18  v11
  sensor_update_frequency: 120s
  zone_1_valve_id: valve_0
  zone_2_valve_id: valve_1
  zone_3_valve_id: valve_2
  zone_4_valve_id: valve_3
  zone_5_valve_id: valve_4
  esphome_name: irrigation-ctrl-unit-$devicename_unit_id
  esphome_comment: Five Valve Irrigation Control - $unit_id
  esphome_project_name: kratochj.Four Valve Irrigation Control - $unit_id
  esphome_project_version: $software_version
  devicename: irrigation_valve_controller_unit_$devicename_unit_id
  upper_devicename: Five Valve Irrigation Ctrl - $unit_id
  uom: Min
```

### Board, WiFi and Base Config

```yaml
esp8266:
  board: esp01_1m

esphome:
  name: $esphome_name
  friendly_name: $upper_devicename
  comment: $esphome_comment
  project:
    name: $esphome_project_name
    version: $esphome_project_version
  on_boot:
    priority: -100
    then:
      - text_sensor.template.publish:
          id: valve_status_$devicename_unit_id
          state: "Idle"

# WiFi connection, replace these with values for your WiFi.
wifi:
  ssid: !secret wifi_ssid
  password: !secret wifi_password

# Enable logging
logger:

# Enable Home Assistant API with encryption
api:
  encryption:
    key: !secret api_enc_key

# Enable over-the-air updates.
ota:
  - platform: esphome
    password: !secret ota_password

# Enable Web server.
web_server:
  port: 80

time:
  - platform: homeassistant
    id: homeassistant_time
```

### Sprinkler Controller

This is the core component. It creates the main switch, auto-advance, reverse, and per-valve switches.

Modern ESPHome (2024.2+) supports **inline number entities** for run duration, multiplier, and repeat — eliminating the need for separate `number: platform: template` blocks and the boot-time multiplier hack.

#### Inline Number Entities vs. Old Approach

| Property | Purpose | Replaces |
|----------|---------|----------|
| `run_duration_number:` | Per-valve run duration (number entity) | Separate `number: platform: template` with lambda |
| `multiplier_number:` | Cycle time multiplier (number entity) | `on_boot` → `sprinkler.set_multiplier: 60` hack |
| `repeat_number:` | Cycle repeat count (number entity) | Not available before |

All these entities support `restore_value: true`, so values persist across reboots — no more boot-time hacks needed.

> **Why the multiplier×60 hack is no longer needed:** Older configs used `run_duration: 5s` (seconds) and then applied `sprinkler.set_multiplier: 60` on boot to convert display values to minutes. This was fragile — if the boot handler didn't run or ran too late, durations would be wrong. With `run_duration_number:`, you set `initial_value` directly in minutes and the multiplier becomes a real proportional multiplier (0.1–3.0×).

```yaml
sprinkler:
  - id: $devicename
    main_switch:
      name: "Start/Stop/Resume ($unit_id)"
      id: main_switch
    auto_advance_switch:
      name: "Auto Advance ($unit_id)"
      icon: "mdi:page-next-outline"
      restore_mode: RESTORE_DEFAULT_ON
    reverse_switch:
      name: "Reverse ($unit_id)"
      icon: "mdi:undo-variant"
    multiplier_number:
      name: "Multiplier ($unit_id)"
      icon: "mdi:multiplication"
      initial_value: 1.0
      min_value: 0.1
      max_value: 3.0
      step: 0.1
      restore_value: true
    repeat_number:
      name: "Repeat ($unit_id)"
      icon: "mdi:repeat"
      initial_value: 0
      min_value: 0
      max_value: 5
      step: 1
      restore_value: true
    valve_open_delay: 1s
    pump_start_pump_delay: 2s
    pump_stop_valve_delay: 2s
```

> **Pump timing delays:** `pump_start_pump_delay` adds a delay between opening a valve and starting the pump (protects the pump from dry-running). `pump_stop_valve_delay` adds a delay between stopping the pump and closing the valve (allows pressure to drop). Both are optional but recommended when using a pump relay.

```yaml
    valves:
      - valve_switch:
          name: $zone_1_name
          icon: "mdi:sprinkler-variant"
        enable_switch:
          name: Enable $zone_1_name
          icon: "mdi:check-circle-outline"
        pump_switch_id: ${devicename}_pump
        run_duration_number:
          name: "$zone_1_name Run Duration"
          unit_of_measurement: $uom
          icon: "mdi:timer-outline"
          initial_value: 15
          min_value: 1
          max_value: 60
          step: 1
          restore_value: true
        valve_switch_id: ${devicename}_1
      - valve_switch:
          name: $zone_2_name
          icon: "mdi:sprinkler-variant"
        enable_switch:
          name: Enable $zone_2_name
          icon: "mdi:check-circle-outline"
        pump_switch_id: ${devicename}_pump
        run_duration_number:
          name: "$zone_2_name Run Duration"
          unit_of_measurement: $uom
          icon: "mdi:timer-outline"
          initial_value: 15
          min_value: 1
          max_value: 60
          step: 1
          restore_value: true
        valve_switch_id: ${devicename}_2
```

Repeat for each zone, adjusting names and `initial_value` / `max_value` as needed.

> **Note:** The extended format (with `name:` and `icon:`) for `valve_switch:`, `enable_switch:`, `auto_advance_switch:`, and `reverse_switch:` requires ESPHome 2024.2+. Older versions only accept a plain string name.

### Status Sensors

These template sensors expose controller state to HA — the Irrigation Card uses them for status display, progress bar, and time remaining.

> **Important:** The status sensor must publish exactly **Running**, **Paused**, **Idle**, or **Standby** (case-insensitive). The card matches these values verbatim — any other text (e.g. zone names) will prevent Pause/Stop controls from appearing.

```yaml
text_sensor:
  # Valve Status (updated by valve switches on_turn_on/off)
  - platform: template
    id: valve_status_$devicename_unit_id
    name: "Status ($unit_id)"
    update_interval: never
    icon: "mdi:information-variant"

  # Time Remaining
  - platform: template
    id: time_remaining_$devicename_unit_id
    name: "Time Remaining ($unit_id)"
    update_interval: $sensor_update_frequency
    icon: "mdi:timer-sand"
    lambda: |-
      int seconds = round(id($devicename).time_remaining_current_operation().value_or(0));
      int days = seconds / (24 * 3600);
      seconds = seconds % (24 * 3600);
      int hours = seconds / 3600;
      seconds = seconds % 3600;
      int minutes = seconds / 60;
      seconds = seconds % 60;
      std::string result;
      if (days) result += std::to_string(days) + "d ";
      if (hours) result += std::to_string(hours) + "h ";
      if (minutes) result += std::to_string(minutes) + "m ";
      result += std::to_string(seconds) + "s";
      return result;

  # Progress Percent
  - platform: template
    id: progress_percent_$devicename_unit_id
    name: "Progress % ($unit_id)"
    update_interval: $sensor_update_frequency
    icon: "mdi:progress-clock"
    lambda: |-
      uint32_t total = id($devicename).total_cycle_time_enabled_valves();
      auto rep = id($devicename).repeat();
      if (rep.has_value()) {
        total *= (rep.value() + 1);
      }
      if (total == 0) {
        return std::string("0");
      }
      uint32_t remaining = id($devicename).time_remaining_current_operation().value_or(0);
      int progress = round(((float)(total - remaining) / (float)total) * 100.0f);
      if (progress < 0) progress = 0;
      if (progress > 100) progress = 100;
      return std::to_string(progress);
```

> **API changes:** Newer ESPHome uses `time_remaining_current_operation()` (total cycle remaining) instead of the older `time_remaining_active_valve()` (single valve remaining). The progress calculation also uses `total_cycle_time_enabled_valves()` for accurate whole-cycle progress including repeats.

### Pause Button

```yaml
button:
  - platform: template
    id: sprinkler_pause
    name: "Pause ($unit_id)"
    icon: "mdi:pause"
    on_press:
      then:
        - text_sensor.template.publish:
            id: valve_status_$devicename_unit_id
            state: "Paused"
        - sprinkler.pause: $devicename
```

### Valve Relay Switches

Each relay switch is `internal: true` (hidden from HA) and updates the status sensor on turn on/off.

```yaml
switch:
  - platform: gpio
    name: Relay Board Pin IN1
    restore_mode: RESTORE_DEFAULT_OFF
    internal: true
    id: ${devicename}_1
    on_turn_on:
      - text_sensor.template.publish:
          id: valve_status_$devicename_unit_id
          state: "Running"
    on_turn_off:
      - text_sensor.template.publish:
          id: valve_status_$devicename_unit_id
          state: "Idle"
    pin:
      number: GPIO16
      inverted: true
```

Repeat for each relay/zone with the appropriate GPIO pin and zone name.

Don't forget the pump relay:

```yaml
  - platform: gpio
    restore_mode: RESTORE_DEFAULT_OFF
    internal: true
    id: ${devicename}_pump
    pin:
      number: GPIO2
      inverted: true
```

## Entities Created in Home Assistant

After flashing, the following entities appear in HA (assuming `unit_id: B`):

| Entity | Type | Purpose |
|--------|------|---------|
| `switch.start_stop_resume_b` | switch | Start/stop/resume cycle |
| `switch.auto_advance_b` | switch | Auto-advance through zones |
| `switch.reverse_b` | switch | Reverse cycle order |
| `number.multiplier_b` | number | Cycle time multiplier (0.1–3.0×) |
| `number.repeat_b` | number | Cycle repeat count (0–5) |
| `button.pause_b` | button | Pause active cycle |
| `switch.sprinklers_zone_1..4` | switch | Per-zone on/off |
| `switch.dripline` | switch | Dripline on/off |
| `switch.enable_sprinklers_zone_1..4` | switch | Include zone in cycle |
| `switch.enable_dripline` | switch | Include dripline in cycle |
| `number.sprinklers_zone_1_run_duration..4` | number | Zone run duration (1–60 min) |
| `number.dripline_run_duration` | number | Dripline run duration (1–60 min) |
| `sensor.status_b` | sensor | Controller status (Idle/Running/Paused/Standby) |
| `sensor.progress_b` | sensor | Cycle progress (0–100%) |
| `sensor.time_remaining_b` | sensor | Time remaining |

## Irrigation Card Configuration

Once the ESPHome device is in HA, configure the Irrigation Card:

### Visual Editor

1. Add the Irrigation Card to your dashboard
2. Select your ESPHome device from the dropdown
3. All entities are auto-discovered — no manual configuration needed

### YAML (minimal)

```yaml
type: custom:irrigation-card
device_id: <your-device-id>
title: Irrigation
```

The `device_id` is automatically filled when using the visual editor.

## Multiple Controllers

To run multiple irrigation controllers, create separate ESPHome configs with different `unit_id` values (A, B, C, ...). Add a separate Irrigation Card for each device on your dashboard.
