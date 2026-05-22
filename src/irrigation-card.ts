import { LitElement, html, nothing, PropertyValues } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { HomeAssistant, LovelaceCard } from "custom-card-helpers";
import { IrrigationCardConfig, ResolvedConfig } from "./types";
import { CARD_TAG, CARD_NAME, CARD_DESCRIPTION, CARD_VERSION, EDITOR_TAG } from "./const";
import {
  discoverEntities,
  discoverEntitiesAsync,
  getControllerStatus,
  entityState,
  entityNumericValue,
} from "./utils/entity-helpers";
import { localize } from "./localize";
import { enableDebug, disableDebug, logRender } from "./utils/logger";
import { cardStyles } from "./styles";

import "./components/valve-row";
import "./components/cycle-controls";
import "./components/settings-panel";

@customElement(CARD_TAG)
export class IrrigationCard extends LitElement implements LovelaceCard {
  @property({ attribute: false }) public hass!: HomeAssistant;
  @state() private _config!: IrrigationCardConfig;
  @state() private _resolved: ResolvedConfig = { valves: [] };
  private _asyncDiscoveryDone = false;

  static styles = cardStyles;

  public static async getConfigElement() {
    await import("./editor");
    return document.createElement(EDITOR_TAG);
  }

  public static getStubConfig() {
    return {
      type: `custom:${CARD_TAG}`,
      title: "Irrigation",
    };
  }

  public setConfig(config: IrrigationCardConfig): void {
    if (!config.device_id && !config.valves?.length && !config.main_switch) {
      throw new Error(localize(undefined, "card.error_no_config"));
    }
    this._config = config;
    this._asyncDiscoveryDone = false;
  }

  public getCardSize(): number {
    return 2 + this._resolved.valves.length;
  }

  protected shouldUpdate(changedProps: PropertyValues): boolean {
    if (changedProps.has("_config") || changedProps.has("_resolved"))
      return true;
    if (changedProps.has("hass")) {
      const oldHass = changedProps.get("hass") as HomeAssistant | undefined;
      if (!oldHass) return true;
      // Trigger async discovery on first hass update if not done
      if (!this._asyncDiscoveryDone) {
        this._runAsyncDiscovery();
      }
      const relevantEntities = this._getRelevantEntities(this._resolved);
      return relevantEntities.some(
        (id) => oldHass.states[id] !== this.hass.states[id],
      );
    }
    return false;
  }

  protected updated(changedProps: PropertyValues): void {
    super.updated(changedProps);
    if (changedProps.has("_config") && this.hass) {
      // Try sync discovery first
      this._resolved = discoverEntities(this.hass, this._config);
      // If sync didn't find valves, trigger async
      if (
        this._resolved.valves.length === 0 &&
        this._config.device_id &&
        !this._asyncDiscoveryDone
      ) {
        this._runAsyncDiscovery();
      }
    }
  }

  private async _runAsyncDiscovery(): Promise<void> {
    if (this._asyncDiscoveryDone || !this.hass || !this._config) return;
    this._asyncDiscoveryDone = true;
    const resolved = await discoverEntitiesAsync(this.hass, this._config);
    this._resolved = resolved;
  }

  protected render() {
    if (!this._config || !this.hass) return nothing;

    const status = getControllerStatus(this.hass, this._resolved);
    const showControls = this._config.show_controls !== false;
    const showSettings = this._config.show_settings !== false;

    logRender("irrigation-card", `status=${status}, valves=${this._resolved.valves.length}`, {
      resolved: this._resolved,
    });

    if (this._resolved.valves.length === 0 && !this._resolved.main_switch) {
      return html`
        <ha-card>
          <div class="not-configured">
            ${localize(this.hass, "card.not_configured")}
          </div>
        </ha-card>
      `;
    }

    const timeRemaining = entityState(
      this.hass,
      this._resolved.time_remaining_sensor,
    );
    const progress = entityNumericValue(
      this.hass,
      this._resolved.progress_sensor,
    );

    return html`
      <ha-card>
        ${this._config.title
          ? html`
              <div class="card-header">
                <span class="title">${this._config.title}</span>
                <span class="status-badge ${status}">${status}</span>
              </div>
            `
          : nothing}
        ${showControls
          ? html`
              <irrigation-cycle-controls
                .hass=${this.hass}
                .resolved=${this._resolved}
              ></irrigation-cycle-controls>
            `
          : nothing}
        ${status !== "idle" && (timeRemaining || progress !== undefined)
          ? html`
              <div class="cycle-info">
                ${timeRemaining
                  ? html`<span class="time-remaining">${timeRemaining}</span>`
                  : nothing}
                ${progress !== undefined
                  ? html`
                      <div class="progress-bar">
                        <div
                          class="fill"
                          style="width: ${100 - progress}%"
                        ></div>
                      </div>
                    `
                  : nothing}
              </div>
            `
          : nothing}
        <div class="valves">
          ${this._resolved.valves.map(
            (valve) => html`
              <irrigation-valve-row
                .hass=${this.hass}
                .valve=${valve}
                .multiplier=${entityNumericValue(
                  this.hass,
                  this._resolved.multiplier,
                ) ?? 1}
                .compact=${this._config.compact || false}
              ></irrigation-valve-row>
            `,
          )}
        </div>
        ${showSettings
          ? html`
              <irrigation-settings-panel
                .hass=${this.hass}
                .resolved=${this._resolved}
              ></irrigation-settings-panel>
            `
          : nothing}
      </ha-card>
    `;
  }

  private _getRelevantEntities(resolved: ResolvedConfig): string[] {
    const entities: string[] = [];
    const push = (id?: string) => {
      if (id) entities.push(id);
    };
    push(resolved.main_switch);
    push(resolved.auto_advance_switch);
    push(resolved.reverse_switch);
    push(resolved.pause_button);
    push(resolved.queue_enable_switch);
    push(resolved.standby_switch);
    push(resolved.multiplier);
    push(resolved.repeat);
    push(resolved.status_sensor);
    push(resolved.progress_sensor);
    push(resolved.time_remaining_sensor);
    for (const v of resolved.valves) {
      entities.push(v.valve_switch);
      push(v.enable_switch);
      push(v.run_duration);
    }
    return entities;
  }
}

// Register for card picker
(window as unknown as Record<string, unknown[]>).customCards =
  (window as unknown as Record<string, unknown[]>).customCards || [];
(window as unknown as Record<string, unknown[]>).customCards.push({
  type: CARD_TAG,
  name: CARD_NAME,
  description: CARD_DESCRIPTION,
  preview: true,
});

// Console banner
console.info(
  `%c ${CARD_NAME.toUpperCase()} %c v${CARD_VERSION} `,
  "color: white; background: #4CAF50; font-weight: bold; padding: 2px 6px; border-radius: 4px 0 0 4px;",
  "color: white; background: #333; font-weight: bold; padding: 2px 6px; border-radius: 0 4px 4px 0;",
);

// Register global debug toggle: call irrigationCardDebug() in browser console
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(window as any).irrigationCardDebug = (enable = true) => {
  if (enable) {
    enableDebug();
  } else {
    disableDebug();
  }
};
