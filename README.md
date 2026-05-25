# Irrigation Card

[![Build](https://github.com/kratochj/hassio-irrigation-card/actions/workflows/build.yml/badge.svg)](https://github.com/kratochj/hassio-irrigation-card/actions/workflows/build.yml)
[![HACS Validation](https://github.com/kratochj/hassio-irrigation-card/actions/workflows/hacs-validate.yml/badge.svg)](https://github.com/kratochj/hassio-irrigation-card/actions/workflows/hacs-validate.yml)

Home Assistant Lovelace card for controlling [ESPHome Sprinkler](https://esphome.io/components/sprinkler/) systems.

<img src="https://raw.githubusercontent.com/kratochj/hassio-irrigation-card/main/docs/images/screenshot.png" alt="Irrigation Card Screenshot" width="50%">

## Features

- Auto-discovery of sprinkler entities from HA device registry
- Localization: English and Czech (auto-detected from HA settings)
- Per-valve control: on/off toggle, enable/disable for cycle, run duration adjustment
- Cycle controls: start, stop, pause, resume
- Settings: auto-advance, reverse, standby toggles; multiplier, repeat sliders
- Status display: controller status, progress bar, time remaining
- Visual config editor with device picker
- Responsive design using HA Material Design components

---

## Support

If you find this integration useful, consider supporting its development:

- ⭐️ Give this repository a star!
- 🛠️ Contribute code or report issues.
- 💸 [Become a GitHub Sponsor](https://github.com/sponsors/kratochj)
- ☕ [Support me on ko-fi](https://ko-fi.com/kratochj)

---

## Installation

### HACS (Recommended)

1. Add this repository to HACS as a custom repository
2. Install "Irrigation Card"
3. Refresh your browser

### Manual

1. Download `irrigation-card.js` from the [latest release](../../releases/latest)
2. Copy to `config/www/irrigation-card.js`
3. Add resource in HA: Settings > Dashboards > Resources > Add `/local/irrigation-card.js` (JavaScript Module)

## Configuration

### Minimal (auto-discovery)

```yaml
type: custom:irrigation-card
device_id: f4a459c55f0f033b1f72b4815e602d9e
title: Irrigation
```

Select the device in the visual editor — the `device_id` is filled automatically. The card auto-discovers all controller switches, valve switches, enable switches, duration numbers, and status sensors from the device.

### Full manual configuration

```yaml
type: custom:irrigation-card
title: Irrigation
device_id: f4a459c55f0f033b1f72b4815e602d9e

# Override auto-discovered controller entities
main_switch: switch.start_stop_resume_b
auto_advance_switch: switch.auto_advance_b
reverse_switch: switch.reverse_b
pause_button: button.pause_b

# Status sensors
status_sensor: sensor.status_b
progress_sensor: sensor.progress_b
time_remaining_sensor: sensor.time_remaining_b

# Manual valve definitions (overrides auto-discovery)
valves:
  - name: Zone 1
    valve_switch: switch.irrigation_node_sprinklers_zone_1
    enable_switch: switch.enable_sprinklers_zone_1
    run_duration: number.sprinklers_zone_1
  - name: Dripline
    valve_switch: switch.irrigation_node_dripline
    enable_switch: switch.enable_dripline
    run_duration: number.dripline

# Display options (all default to true except compact)
show_controls: true
show_settings: true
compact: false
```

### Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `device_id` | string | — | HA device ID for auto-discovery |
| `title` | string | — | Card title |
| `main_switch` | string | auto | Start/stop/resume switch entity |
| `auto_advance_switch` | string | auto | Auto-advance switch entity |
| `reverse_switch` | string | auto | Reverse switch entity |
| `pause_button` | string | auto | Pause button entity |
| `status_sensor` | string | auto | Status sensor entity |
| `progress_sensor` | string | auto | Progress % sensor entity |
| `time_remaining_sensor` | string | auto | Time remaining sensor entity |
| `valves` | list | auto | Manual valve definitions |
| `show_controls` | boolean | true | Show cycle control buttons |
| `show_settings` | boolean | true | Show settings toggles/sliders |
| `compact` | boolean | false | Hide duration controls |

Either `device_id`, `valves`, or `main_switch` must be provided.

## ESPHome Setup

For a complete guide on setting up the ESPHome sprinkler controller (hardware, firmware config, entity mapping), see **[ESPHome Setup Guide](docs/esphome-setup.md)**.

For entity naming rules and localization constraints, see **[Entity Naming & Auto-Discovery](docs/entity-naming.md)**.

## Troubleshooting

Open the browser developer console (F12) and run:

```js
irrigationCardDebug()       // enable debug logging
irrigationCardDebug(false)  // disable debug logging
```

This logs entity discovery details, service calls (switch/button/number), and card render state to help diagnose configuration or connectivity issues.

## Development

```bash
npm install
npm start       # watch mode + dev server on port 5000
npm run build   # production build
```

For development, add `http://<your-ip>:5000/irrigation-card.js` as a resource in HA (type: JavaScript Module).
