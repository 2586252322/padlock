import { Vault } from "@padloc/core/lib/vault.js";
import { Group } from "@padloc/core/lib/group.js";
import { Org } from "@padloc/core/lib/org.js";
import { localize as $l } from "@padloc/core/lib/locale.js";
import { mixins } from "../styles";
import { app } from "../init.js";
import { prompt } from "../dialog.js";
import { element, html, property, query } from "./base.js";
import { Dialog } from "./dialog.js";
import { LoadingButton } from "./loading-button.js";
import { Input } from "./input.js";
import "./icon.js";
import "./group-item.js";
import "./toggle.js";

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

    private _selection = new Map<string, { read: boolean; write: boolean }>();

    private _getCurrentSelection(): Map<string, { read: boolean; write: boolean }> {
        const selection = new Map<string, { read: boolean; write: boolean }>();

        if (!this.org) {
            return selection;
        }

        const groups = [this.org.everyone, ...this.org.groups];

        for (const group of groups) {
            const v = this.vault && group.vaults.find(v => v.id === this.vault!.id);
            selection.set(group.id, {
                read: !!v,
                write: !!v && !v.readonly
            });
        }

        selection.set(this.org.admins.id, { read: true, write: true });

        return selection;
    }

    private get _hasChanged() {
        if (!this.org || !this._nameInput) {
            return false;
        }

        const current = this._getCurrentSelection();
        const selection = this._selection;

        const groupsChanged = [this.org!.admins, this.org!.everyone, ...this.org!.groups].some(({ id }) => {
            const c = current.get(id)!;
            const s = selection.get(id)!;
            return c.read !== s.read || c.write !== s.write;
        });

        const nameChanged = this.vault ? this.vault.name !== this._nameInput.value : !!this._nameInput.value;

        return this._selection.size && this._nameInput.value && (groupsChanged || nameChanged);
    }

    async show({ vault, org }: InputType): Promise<void> {
        this.vault = vault;
        this.org = org;
        this._selection = this._getCurrentSelection();
        await this.updateComplete;
        this._nameInput.value = this.vault ? this.vault.name : "";
        return super.show();
    }

    _toggleGroup(group: Group) {
        const { read } = this._selection.get(group.id)!;
        this._selection.set(group.id, read ? { read: false, write: false } : { read: true, write: true });
        this.requestUpdate();
    }

    _toggleRead(group: Group, event?: Event) {
        if (event) {
            event.stopImmediatePropagation();
        }

        const selection = this._selection.get(group.id)!;
        selection.read = !selection.read;
        if (!selection.read) {
            selection.write = false;
        }

        this.requestUpdate();
    }

    _toggleWrite(group: Group, event?: Event) {
        if (event) {
            event.stopImmediatePropagation();
        }

        const selection = this._selection.get(group.id)!;
        selection.write = !selection.write;
        if (selection.write) {
            selection.read = true;
        }

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
        this._selection.set(this.org!.admins.id, { read: true, write: true });

        const groups = [...this._selection.entries()]
            .filter(([, { read }]) => read)
            .map(([id, { write }]) => ({ id, readonly: !write }));

        try {
            if (this.vault) {
                await app.updateVault(this.vault, this._nameInput.value, groups);
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

    private async _deleteVault() {
        this.open = false;
        const deleted = await prompt(
            $l(
                "Are you sure you want to delete this vault? " +
                    "All the data stored in it will be lost! " +
                    "This action can not be undone."
            ),
            {
                type: "destructive",
                title: $l("Delete Vault"),
                placeholder: $l("Type 'DELETE' to confirm"),
                validate: async val => {
                    if (val !== "DELETE") {
                        throw $l("Type 'DELETE' to confirm");
                    }

                    await app.deleteVault(this.vault!);

                    return val;
                }
            }
        );

        if (deleted) {
            this.done();
        } else {
            this.open = true;
        }
    }

    shouldUpdate() {
        return !!this.org;
    }

    renderContent() {
        const org = this.org!;
        const groups = [org.admins, org.everyone, ...org.groups];
        const isAdmin = org.isAdmin(app.account!);

        return html`
            <style>
                .inner {
                    background: var(--color-quaternary);
                }

                pl-toggle-button {
                    display: block;
                    padding: 0 15px 0 0;
                }

                .delete-button {
                    color: var(--color-negative);
                    font-size: var(--font-size-default);
                }

                .subheader {
                    margin: 8px;
                    font-weight: bold;
                    font-size: var(--font-size-tiny);
                    display: flex;
                    align-items: flex-end;
                    padding: 0 8px;
                }

                .subheader > * {
                }

                .subheader .permission {
                    width: 50px;
                    text-align: center;
                    ${mixins.ellipsis()}
                }

                .item {
                    display: flex;
                    align-items: center;
                }

                .item pl-toggle {
                    margin-right: 14px;
                }
            </style>

            <header>
                <pl-icon icon="vault"></pl-icon>
                <pl-input
                    id="nameInput"
                    class="flex"
                    .placeholder=${$l("Enter Vault Name")}
                    .readonly=${!isAdmin}
                    @input=${() => this.requestUpdate()}
                ></pl-input>
                <pl-icon
                    icon="delete"
                    class="delete-button tap"
                    ?hidden=${!isAdmin}
                    @click=${this._deleteVault}
                ></pl-icon>
            </header>

            <div class="subheader">
                <div class="flex"></div>
                <div class="permission">${$l("read")}</div>
                <div class="permission">${$l("write")}</div>
            </div>

            ${groups.map(
                group => html`
                    <div
                        ?disabled=${group.id === org.admins.id || !isAdmin}
                        class="item tap"
                        @click=${() => this._toggleGroup(group)}
                    >
                        <pl-group-item .group=${group} class="flex"></pl-group-item>
                        <pl-toggle
                            .active=${this._selection.get(group.id)!.read}
                            @click=${(e: Event) => this._toggleRead(group, e)}
                        ></pl-toggle>
                        <pl-toggle
                            .active=${this._selection.get(group.id)!.write}
                            @click=${(e: Event) => this._toggleWrite(group, e)}
                        ></pl-toggle>
                    </div>
                `
            )}

            <div class="actions" ?hidden=${!isAdmin}>
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
