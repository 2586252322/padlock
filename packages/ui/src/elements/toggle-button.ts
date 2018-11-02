import { shared, mixins } from "../styles";
import { BaseElement, element, html, property, query } from "./base.js";
import { Toggle } from "./toggle.js";

@element("pl-toggle-button")
export class ToggleButton extends BaseElement {
    @property({ reflect: true })
    active: boolean = false;
    @property({ reflect: true })
    reverse: boolean = false;
    @property()
    label: string = "";

    @query("pl-toggle")
    _toggle: Toggle;

    render() {
        const { active, label } = this;
        return html`
        ${shared}

        <style>

            :host {
                display: inline-block;
                font-size: inherit;
                height: var(--row-height);
                padding: 0 15px;
            }

            button {
                display: flex;
                width: 100%;
                align-items: center;
                height: 100%;
                padding: 0;
                line-height: normal;
                text-align: left;
            }

            button > div {
                flex: 1;
                ${mixins.ellipsis()}
            }

            :host(:not([reverse])) button > div {
                padding-left: 0.5em;
            }

            :host([reverse]) button > div {
                padding-right: 0.5em;
            }

            :host([reverse]) button {
                flex-direction: row-reverse;
            }

            pl-toggle {
                display: inline-block;
                pointer-events: none;
            }
        </style>

        <button @click=${() => this.toggle()}>

            <pl-toggle .active="${active}" @change=${() => (this.active = this._toggle.active)}"></pl-toggle>

            <div>${label}</div>

        </button>
`;
    }

    toggle() {
        this._toggle.toggle();
    }
}
