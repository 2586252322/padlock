import { app } from "../init.js";
import { shared } from "../styles";
import { element, html, listen } from "./base.js";
import { View } from "./view.js";
import "./vault.js";

@element("pl-vaults")
export class Vaults extends View {
    @listen("unlock", app)
    _refresh() {
        this.requestUpdate();
    }

    render() {
        return html`
            ${shared}

            <style>
                :host {
                    display: flex;
                }

                pl-vault {
                    width: 100%;
                    max-width: 350px;
                    margin-right: 8px;
                    flex: 1;
                }

                .add-vault {
                    margin-top: 68px;
                    flex: 1;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    border-radius: var(--border-radius);
                    color: var(--color-tertiary);
                    border: solid 2px;
                    opacity: 0.7;
                    margin-right: 5px;
                }

                .add-vault > pl-icon {
                    width: 100px;
                    height: 100px;
                    font-size: 200%;
                }
            </style>

            ${app.vaults.map(
                vault => html`
                    <pl-vault .vault=${vault}></pl-vault>
                `
            )}

            <div class="add-vault tap">
                <pl-icon icon="add"></pl-icon>
            </div>
        `;
    }
}
