import { LitElement, html, css, nothing, PropertyValues } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { HomeAssistant } from "custom-card-helpers";
import { ResolvedValve } from "../types";
import {
  entityState,
  entityNumericValue,
  entityAttributes,
  callSwitchService,
  callNumberService,
} from "../utils/entity-helpers";
import { localize } from "../localize";
import { logRender } from "../utils/logger";
import { cardStyles } from "../styles";

@customElement("irrigation-valve-row")
export class IrrigationValveRow extends LitElement {
  @property({ attribute: false }) public hass!: HomeAssistant;
  @property({ attribute: false }) public valve!: ResolvedValve;
  @property({ type: Number }) public multiplier = 1;
  @property({ type: Boolean }) public compact = false;

  // Optimistic duration value — shown immediately after +/- click,
  // cleared when HA state catches up.
  @state() private _optimisticDuration: number | undefined;

  // Per-second tick to redraw the progress bar while the valve is running.
  @state() private _tick = 0;
  private _tickInterval?: number;

  connectedCallback(): void {
    super.connectedCallback();
    this._tickInterval = window.setInterval(() => {
      if (entityState(this.hass, this.valve?.valve_switch) === "on") {
        this._tick++;
      }
    }, 1000);
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    if (this._tickInterval !== undefined) {
      clearInterval(this._tickInterval);
      this._tickInterval = undefined;
    }
  }

  static styles = [
    cardStyles,
    css`
      .duration-btn {
        background: none;
        border: none;
        cursor: pointer;
        padding: 4px;
        border-radius: 50%;
        color: var(--primary-text-color);
        display: inline-flex;
        align-items: center;
        justify-content: center;
      }
      .duration-btn:hover {
        background: var(--divider-color);
      }
      .duration-btn ha-icon {
        --mdc-icon-size: 18px;
      }
    `,
  ];

  protected shouldUpdate(changedProps: PropertyValues): boolean {
    if (
      changedProps.has("valve") ||
      changedProps.has("compact") ||
      changedProps.has("multiplier") ||
      changedProps.has("_optimisticDuration") ||
      changedProps.has("_tick")
    )
      return true;
    if (changedProps.has("hass")) {
      const oldHass = changedProps.get("hass") as HomeAssistant | undefined;
      if (!oldHass) return true;
      const entities = [
        this.valve.valve_switch,
        this.valve.enable_switch,
        this.valve.run_duration,
      ].filter(Boolean) as string[];
      const changed = entities.some(
        (id) => oldHass.states[id] !== this.hass.states[id],
      );
      // Clear optimistic value when HA state catches up
      if (changed && this._optimisticDuration !== undefined) {
        const realValue = entityNumericValue(this.hass, this.valve.run_duration);
        if (realValue === this._optimisticDuration) {
          this._optimisticDuration = undefined;
        }
      }
      return changed;
    }
    return false;
  }

  protected render() {
    const isOn = entityState(this.hass, this.valve.valve_switch) === "on";
    const isEnabled = this.valve.enable_switch
      ? entityState(this.hass, this.valve.enable_switch) !== "off"
      : true;
    const realDuration = entityNumericValue(this.hass, this.valve.run_duration);
    const duration = this._optimisticDuration ?? realDuration;

    logRender("valve-row", this.valve.name, {
      valve_switch: this.valve.valve_switch,
      enable_switch: this.valve.enable_switch,
      run_duration: this.valve.run_duration,
      isOn,
      isEnabled,
      duration,
      optimistic: this._optimisticDuration,
    });

    return html`
      <div class="valve-row">
        <ha-icon
          class="valve-icon ${isOn ? "active" : ""}"
          .icon=${this.valve.icon}
        ></ha-icon>
        <div class="valve-info">
          <div class="valve-name">${this.valve.name}</div>
          ${isOn
            ? html`<div class="valve-status">
                ${localize(this.hass, "valve.running")}
              </div>`
            : nothing}
          ${isOn && duration && duration > 0
            ? html`<div class="progress-bar">
                <div
                  class="fill"
                  style="width: ${100 - this._valveProgress(duration)}%"
                ></div>
              </div>`
            : nothing}
        </div>
        ${this.valve.run_duration && !this.compact
          ? html`
              <div class="valve-duration">
                <button
                  class="duration-btn"
                  @click=${(e: Event) => {
                    e.stopPropagation();
                    this._adjustDuration(-1);
                  }}
                >
                  <ha-icon icon="mdi:minus"></ha-icon>
                </button>
                <span>${duration ?? "?"} ${localize(this.hass, "valve.min")}</span>
                <button
                  class="duration-btn"
                  @click=${(e: Event) => {
                    e.stopPropagation();
                    this._adjustDuration(1);
                  }}
                >
                  <ha-icon icon="mdi:plus"></ha-icon>
                </button>
              </div>
            `
          : nothing}
        ${this.valve.enable_switch
          ? html`
              <ha-switch
                .checked=${isEnabled}
                @change=${this._toggleEnable}
                title=${localize(this.hass, "valve.include_in_cycle")}
              ></ha-switch>
            `
          : nothing}
        <ha-switch
          .checked=${isOn}
          @change=${this._toggleValve}
        ></ha-switch>
      </div>
    `;
  }

  private _toggleValve(): void {
    const isOn = entityState(this.hass, this.valve.valve_switch) === "on";
    callSwitchService(this.hass, this.valve.valve_switch, !isOn);
  }

  private _toggleEnable(): void {
    if (!this.valve.enable_switch) return;
    const isEnabled =
      entityState(this.hass, this.valve.enable_switch) !== "off";
    callSwitchService(this.hass, this.valve.enable_switch, !isEnabled);
  }

  // Compute per-valve progress (0-100) from the valve switch's last_changed
  // timestamp and the configured run_duration (minutes) × multiplier.
  // Repeat is not factored in: the valve switch toggles off/on between
  // repeats, so last_changed resets and the bar restarts per segment.
  private _valveProgress(duration: number | undefined): number {
    if (!duration || duration <= 0) return 0;
    const state = this.hass.states[this.valve.valve_switch];
    if (!state || !state.last_changed) return 0;
    const startedAt = new Date(state.last_changed).getTime();
    if (!Number.isFinite(startedAt)) return 0;
    const elapsedSeconds = (Date.now() - startedAt) / 1000;
    const multiplier = this.multiplier > 0 ? this.multiplier : 1;
    const totalSeconds = duration * 60 * multiplier;
    return Math.min(100, Math.max(0, (elapsedSeconds / totalSeconds) * 100));
  }

  private _adjustDuration(delta: number): void {
    if (!this.valve.run_duration) return;
    const current =
      this._optimisticDuration ??
      entityNumericValue(this.hass, this.valve.run_duration);
    if (current === undefined) return;
    const attrs = entityAttributes(this.hass, this.valve.run_duration);
    const min = (attrs.min as number) ?? 0;
    const max = (attrs.max as number) ?? 60;
    const step = (attrs.step as number) ?? 1;
    const newVal = Math.min(max, Math.max(min, current + delta * step));
    this._optimisticDuration = newVal;
    callNumberService(this.hass, this.valve.run_duration, newVal);
  }
}
