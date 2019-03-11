import { Org, OrgMember } from "@padloc/core/lib/org.js";
import { Group } from "@padloc/core/lib/group.js";
import { localize as $l } from "@padloc/core/lib/locale.js";
import { app } from "../init.js";
import { element, html, property, query } from "./base.js";
import { Dialog } from "./dialog.js";
import { LoadingButton } from "./loading-button.js";
import { Input } from "./input.js";
import "./toggle-button.js";
import "./member-item.js";

type InputType = { group: Group | null; org: Org };

@element("pl-group-dialog")
export class GroupDialog extends Dialog<InputType, void> {
    @property()
    group: Group | null = null;

    @property()
    org: Org | null = null;

    @query("#saveButton")
    private _saveButton: LoadingButton;

    @query("#nameInput")
    private _nameInput: Input;

    private _selectedMembers = new Set<string>();

    private _getCurrentMembers(): Set<string> {
        const members = new Set<string>();

        if (!this.group || !this.org) {
            return members;
        }

        for (const member of this.org.getMembersForGroup(this.group!)) {
            members.add(member.id);
        }

        return members;
    }

    private get _hasChanged() {
        if (!this._nameInput) {
            return false;
        }
        const currentMembers = this._getCurrentMembers();
        const membersChanged =
            this._selectedMembers.size !== currentMembers.size ||
            [...this._selectedMembers.values()].some(group => !currentMembers.has(group));

        const nameChanged = this.group ? this.group.name !== this._nameInput.value : !!this._nameInput.value;

        return this._selectedMembers.size && this._nameInput.value && (membersChanged || nameChanged);
    }

    async show({ org, group }: InputType): Promise<void> {
        this.org = org;
        this.group = group;
        this._selectedMembers = this._getCurrentMembers();
        await super.show();
        await this.updateComplete;
        if (group) {
            setTimeout(() => this._nameInput.focus(), 100);
        }
    }

    _toggleMember(member: OrgMember) {
        if (this._selectedMembers.has(member.id)) {
            this._selectedMembers.delete(member.id);
        } else {
            this._selectedMembers.add(member.id);
        }

        this.requestUpdate();
    }

    private async _save() {
        if (this._saveButton.state === "loading") {
            return;
        }

        this._saveButton.start();

        try {
            const org = this.org!.clone();
            await org.unlock(app.account!);

            const members = [...this._selectedMembers.values()].map(id => org.getMember({ id }));

            if (this.group) {
                const group = org.getGroup(this.group.id)!;
                group.name = this._nameInput.value;
                await group.unlock(org.admins);
                await group.updateAccessors([org.admins, ...members]);
            } else {
                await org.createGroup(this._nameInput.value, members);
            }

            await app.updateOrg(org, org);
            this._saveButton.success();
            this.done();
        } catch (e) {
            this._saveButton.fail();
            throw e;
        }
    }

    shouldUpdate() {
        return !!this.org;
    }

    renderContent() {
        const members = this.org!.members;

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
                <pl-icon icon="group"></pl-icon>
                <pl-input
                    id="nameInput"
                    .placeholder=${$l("Enter Group Name")}
                    .value=${this.group ? this.group.name : ""}
                    @input=${() => this.requestUpdate()}
                ></pl-input>
            </div>

            ${members.map(
                member => html`
                    <pl-toggle-button
                        class="item tap"
                        reverse
                        @click=${() => this._toggleMember(member)}
                        .active=${this._selectedMembers.has(member.id)}
                    >
                        <pl-member-item .member=${member}></pl-member-item>
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
