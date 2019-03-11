import { Vault } from "@padloc/core/lib/vault.js";
import { Group } from "@padloc/core/lib/group.js";
import { Org } from "@padloc/core/lib/org.js";
import { localize as $l } from "@padloc/core/lib/locale.js";
import { app } from "../init.js";
import { element, html, property, query } from "./base.js";
import { Dialog } from "./dialog.js";
import { LoadingButton } from "./loading-button.js";
import { Input } from "./input.js";
import "./icon.js";
import "./group-item.js";

type InputType = { vault: Vault | null; org: Org };

@element("pl-vault-dialog")
export class VaultDialog extends Dialog<InputType, void> {
    @property()
    org: Org | null = null;

    @property()
    vault: Vault | null = null;

    @query("#nameInput")
    private _nameInput: Input;

    @query("#saveButton")
    private _saveButton: LoadingButton;

    private _selection = new Map<string, { selected: boolean; readonly: boolean }>();

    private _getCurrentSelection(): Map<string, { selected: boolean; readonly: boolean }> {
        const selection = new Map<string, { selected: boolean; readonly: boolean }>();

        if (!this.org) {
            return selection;
        }

        const groups = [this.org.everyone, ...this.org.groups];

        for (const group of groups) {
            const v = this.vault && group.vaults.find(v => v.id === this.vault!.id);
            selection.set(group.id, {
                selected: !!v,
                readonly: !!v && v.readonly
            });
        }

        selection.set(this.org.admins.id, { selected: true, readonly: false });

        return selection;
    }

    private get _hasChanged() {
        if (!this.org || !this._nameInput) {
            return false;
        }

        const current = this._getCurrentSelection();
        const selected = this._selection;

        const groupsChanged = [this.org!.admins, this.org!.everyone, ...this.org!.groups].some(({ id }) => {
            const c = current.get(id)!;
            const s = selected.get(id)!;
            return c.selected !== s.selected || c.readonly !== s.readonly;
        });

        const nameChanged = this.vault ? this.vault.name !== this._nameInput.value : !!this._nameInput.value;

        return this._selection.size && this._nameInput.value && (groupsChanged || nameChanged);
    }

    show({ vault, org }: InputType): Promise<void> {
        this.vault = vault;
        this.org = org;
        this._selection = this._getCurrentSelection();
        return super.show();
    }

    _toggleSelected(group: Group) {
        this._selection.get(group.id)!.selected = !this._selection.get(group.id)!.selected;
        this.requestUpdate();
    }

    // _toggleReadonly(group: Group) {
    //     this._selection.get(group.id)!.readonly = !this._selection.get(group.id)!.readonly;
    // }

    private async _save() {
        if (this._saveButton.state === "loading") {
            return;
        }

        this._saveButton.start();

        // Make sure admin group has access
        this._selection.set(this.org!.admins.id, { selected: true, readonly: false });

        const groups = [...this._selection.entries()]
            .filter(([, { selected }]) => selected)
            .map(([id, { readonly }]) => ({ id, readonly }));

        try {
            if (this.vault) {
                await app.updateVault(this.vault, name, groups);
            } else {
                await app.createVault(this._nameInput.value, this.org!, groups);
            }

            this._saveButton.success();
            this.done();
        } catch (e) {
            this._saveButton.fail();
            throw e;
        }

        this.requestUpdate();
    }

    shouldUpdate() {
        return !!this.org;
    }

    renderContent() {
        const org = this.org!;
        const groups = [org.admins, org.everyone, ...org.groups];

        return html`
            <style>
                .inner {
                    background: var(--color-quaternary);
                }

                .input-wrapper {
                    font-weight: bold;
                    font-size: 120%;
                }

                pl-toggle-button {
                    display: block;
                    padding: 0 15px 0 0;
                }
            </style>

            <div class="input-wrapper item">
                <pl-icon icon="vault"></pl-icon>
                <pl-input
                    id="nameInput"
                    .placeholder=${$l("Enter Vault Name")}
                    .value=${this.vault ? this.vault.name : ""}
                    @input=${() => this.requestUpdate()}
                ></pl-input>
            </div>

            ${groups.map(
                group => html`
                    <pl-toggle-button
                        ?disabled=${group.id === org.admins.id}
                        class="item tap"
                        reverse
                        @click=${() => this._toggleSelected(group)}
                        .active=${this._selection.get(group.id)!.selected}
                    >
                        <pl-group-item .group=${group}></pl-group-item>
                    </pl-toggle-button>
                `
            )}

            <div class="actions">
                <pl-loading-button
                    class="tap primary"
                    id="saveButton"
                    ?disabled=${!this._hasChanged}
                    @click=${this._save}
                >
                    ${$l("Save")}
                </pl-loading-button>

                <button class="tap" @click=${this.dismiss}>${$l("Cancel")}</button>
            </div>
        `;
    }
}
