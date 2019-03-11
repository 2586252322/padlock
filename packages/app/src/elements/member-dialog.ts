import { Group, GroupID } from "@padloc/core/lib/group.js";
import { Org, OrgMember } from "@padloc/core/lib/org.js";
import { localize as $l } from "@padloc/core/lib/locale.js";
import { app } from "../init.js";
import { confirm } from "../dialog.js";
import { element, html, property, query } from "./base.js";
import { Dialog } from "./dialog.js";
import { LoadingButton } from "./loading-button.js";
import "./icon.js";
import "./toggle-button.js";
import "./group-item.js";
import "./member-item.js";

type InputType = { member: OrgMember; org: Org };

@element("pl-member-dialog")
export class MemberDialog extends Dialog<InputType, void> {
    @property()
    org: Org | null = null;

    @property()
    member: OrgMember | null = null;

    @query("#saveButton")
    private _saveButton: LoadingButton;

    private _selection = new Set<GroupID>();

    private _getCurrentSelection() {
        return this.org && this.member
            ? new Set(this.org.getGroupsForMember(this.member).map(g => g.id))
            : new Set<GroupID>();
    }

    private get _hasChanged() {
        if (!this.org || !this.member) {
            return false;
        }

        const current = this._getCurrentSelection();
        const selected = this._selection;

        return current.size !== selected.size || [...selected.values()].some(id => !current.has(id));
    }

    async show({ member, org }: InputType): Promise<void> {
        this.member = member;
        this.org = org;
        this._selection = this._getCurrentSelection();
        await this.updateComplete;
        return super.show();
    }

    _toggleSelected(group: Group) {
        if (this._selection.has(group.id)) {
            this._selection.delete(group.id);
        } else {
            this._selection.add(group.id);
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

        try {
            await app.updateMember(this.org!, this.member!, [...this._selection]);
            this._saveButton.success();
            this.done();
        } catch (e) {
            this._saveButton.fail();
            this.requestUpdate();
            throw e;
        }
    }

    private async _removeMember() {
        this.open = false;
        const confirmed = await confirm(
            $l("Are you sure you want to remove this member from this organization?"),
            $l("Remove"),
            $l("Cancel"),
            {
                type: "destructive",
                title: $l("Remove Member"),
                placeholder: $l("Type 'DELETE' to confirm")
            }
        );
        this.open = true;

        if (confirmed) {
            this._saveButton.start();

            try {
                await app.removeMember(this.org!, this.member!);

                this._saveButton.success();
                this.done();
            } catch (e) {
                this._saveButton.fail();
                throw e;
            }
        }
    }

    shouldUpdate() {
        return !!this.org && !!this.member;
    }

    renderContent() {
        const org = this.org!;
        const member = this.member!;
        const groups = [org.everyone, org.admins, ...org.groups];
        const isAdmin = org.isAdmin(app.account!);
        const memberIsOwner = org.isOwner(member);

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
            </style>

            <header>
                <pl-member-item .member=${member} class="flex"></pl-member-item>
                <pl-icon
                    icon="delete"
                    class="delete-button tap"
                    ?hidden=${!isAdmin}
                    @click=${this._removeMember}
                ></pl-icon>
            </header>

            ${groups.map(
                group => html`
                    <pl-toggle-button
                        ?disabled=${!isAdmin ||
                            group.id === org.everyone.id ||
                            (group.id === org.admins.id && memberIsOwner)}
                        class="item tap"
                        reverse
                        @click=${() => this._toggleSelected(group)}
                        .active=${this._selection.has(group.id)}
                    >
                        <pl-group-item .group=${group}></pl-group-item>
                    </pl-toggle-button>
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
