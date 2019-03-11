import { localize as $l } from "@padloc/core/lib/locale.js";
import { Invite } from "@padloc/core/lib/invite.js";
import { Group } from "@padloc/core/lib/group.js";
import { shared, mixins } from "../styles";
import { dialog, prompt } from "../dialog.js";
import { app, router } from "../init.js";
import { element, html, property, query, observe } from "./base.js";
import { View } from "./view.js";
import { Input } from "./input.js";
import { VaultDialog } from "./vault-dialog.js";
import { GroupDialog } from "./group-dialog.js";
import "./member-item.js";
import "./group-item.js";
import "./vault-item.js";
import "./invite-item.js";
import "./icon.js";

@element("pl-org-view")
export class OrgView extends View {
    @property()
    orgId: string = "";

    @query("#filterMembersInput")
    private _filterMembersInput: Input;

    @dialog("pl-vault-dialog")
    private _vaultDialog: VaultDialog;

    @dialog("pl-group-dialog")
    private _groupDialog: GroupDialog;

    private get _org() {
        return app.getOrg(this.orgId);
    }

    @property()
    private _page: "members" | "groups" | "vaults" | "invites" = "members";

    @property()
    private _membersFilter: string = "";

    private _createInvite() {
        prompt($l("Please enter the email address of the person you would like to invite!"), {
            type: "email",
            title: $l("Invite New Member"),
            label: $l("Email Address"),
            confirmLabel: $l("Send Invite"),
            validate: async (email: string, input: Input) => {
                if (input.invalid) {
                    throw $l("Please enter a valid email address!");
                }

                if ([...this._org!.members].some(m => m.email === email)) {
                    throw $l("This user is already a member!");
                }

                const invite = await app.createInvite(this._org!, email);
                router.go(`invite/${invite.org!.id}/${invite.id}`);

                return email;
            }
        });
    }

    private _showInvite(invite: Invite) {
        router.go(`invite/${invite.org!.id}/${invite.id}`);
    }

    private async _createVault() {
        await this._vaultDialog.show({ org: this._org!, vault: null });
        this.requestUpdate();
    }

    private async _showGroup(group: Group) {
        await this._groupDialog.show({ org: this._org!, group });
        this.requestUpdate();
    }

    private async _createGroup() {
        await this._groupDialog.show({ org: this._org!, group: null });
        this.requestUpdate();
    }

    private async _showVault({ id }: { id: string }) {
        const vault = app.getVault(id) || (await app.api.getVault(id));
        await this._vaultDialog.show({ org: this._org!, vault: vault });
        this.requestUpdate();
    }

    private _updateMembersFilter() {
        this._membersFilter = this._filterMembersInput.value;
    }

    @observe("orgId")
    _resetMembersFilter() {
        this._membersFilter = this._filterMembersInput.value = "";
    }

    shouldUpdate() {
        return !!this._org;
    }

    render() {
        const org = this._org!;
        const isAdmin = org.isAdmin(app.account!);
        const invites = org.invites;
        const groups = [org.admins, org.everyone, ...org.groups];
        const vaults = org.vaults.map(v => app.getVault(v.id)!).filter(v => !!v);
        const memFilter = this._membersFilter.toLowerCase();
        const members = memFilter
            ? org.members.filter(
                  ({ name, email }) => email.toLowerCase().includes(memFilter) || name.toLowerCase().includes(memFilter)
              )
            : org.members;

        return html`
            ${shared}

            <style>
                :host {
                    display: flex;
                    flex-direction: column;
                }

                h1 {
                    text-align: center;
                }

                main {
                    flex: 1;
                    display: flex;
                    flex-direction: column;
                    background: var(--color-quaternary);
                    border-radius: var(--border-radius);
                }

                .wrapper {
                    position: relative;
                    width: 100%;
                    flex: 1;
                    max-width: 600px;
                    margin: 0 auto;
                }

                .tabs {
                    border-bottom: solid 2px #ddd;
                    background: var(--color-tertiary);
                    display: flex;
                    justify-content: center;
                }

                .tabs > * {
                    display: flex;
                    align-items: center;
                    padding: 10px 20px 10px 15px;
                }

                .tabs > *[active] {
                    font-weight: 600;
                    color: var(--color-highlight);
                    border-bottom: solid 2px;
                    margin-bottom: -2px;
                }

                .subview {
                    position: relative;
                    padding: 10px;
                    ${mixins.fullbleed()}
                    ${mixins.scroll()}
                }

                .search-wrapper {
                    display: flex;
                    align-items: center;
                }

                .search-wrapper pl-icon {
                    opacity: 0.5;
                    margin-left: 5px;
                }

                .search-wrapper pl-input {
                    font-size: var(--font-size-small);
                    height: auto;
                    flex: 1;
                    background: transparent;
                    padding-left: 5px;
                }

                .header {
                    background: white;
                }
            </style>

            <main>
                <div class="header">
                    <div class="tabs">
                        <div class="tap" ?active=${this._page === "members"} @click=${() => (this._page = "members")}>
                            <pl-icon icon="user"></pl-icon>
                            <div>${$l("Members")}</div>
                        </div>
                        <div class="tap" ?active=${this._page === "groups"} @click=${() => (this._page = "groups")}>
                            <pl-icon icon="group"></pl-icon>
                            <div>${$l("Groups")}</div>
                        </div>
                        <div class="tap" ?active=${this._page === "vaults"} @click=${() => (this._page = "vaults")}>
                            <pl-icon icon="vaults"></pl-icon>
                            <div>${$l("Vaults")}</div>
                        </div>
                        <div class="tap" ?active=${this._page === "invites"} @click=${() => (this._page = "invites")}>
                            <pl-icon icon="invite"></pl-icon>
                            <div>${$l("Invites")}</div>
                        </div>
                    </div>
                </div>

                <div class="wrapper">
                    <div ?hidden=${this._page !== "members"} class="subview">
                        <div class="search-wrapper item">
                            <pl-icon icon="search"></pl-icon>
                            <pl-input
                                id="filterMembersInput"
                                placeholder="${$l("Search...")}"
                                @input=${this._updateMembersFilter}
                            ></pl-input>
                        </div>
                        <ul>
                            ${members.map(
                                member => html`
                                    <li class="tap member">
                                        <pl-member-item .member=${member}></pl-member-item>
                                    </li>
                                `
                            )}
                        </ul>
                    </div>

                    <div ?hidden=${this._page !== "groups"} class="subview">
                        <ul>
                            ${groups.map(
                                group => html`
                                    <li @click=${() => this._showGroup(group)} class="item tap">
                                        <pl-group-item .group=${group}></pl-group-item>
                                    </li>
                                `
                            )}
                            <li class="centering padded tap" @click=${this._createGroup}>
                                <pl-icon icon="add"></pl-icon>
                                <div>${$l("New Group")}</div>
                            </li>
                        </ul>
                    </div>

                    <div ?hidden=${this._page !== "vaults"} class="subview">
                        <ul>
                            ${vaults.map(
                                vault => html`
                                    <li @click=${() => this._showVault(vault)} class="item tap">
                                        <pl-vault-item .vault=${vault}></pl-vault-item>
                                    </li>
                                `
                            )}
                            <li class="centering padded tap" @click=${this._createVault}>
                                <pl-icon icon="add"></pl-icon>
                                <div>${$l("New Vault")}</div>
                            </li>
                        </ul>
                    </div>

                    <div ?hidden=${this._page !== "invites"} class="subview">
                        <ul>
                            ${invites.map(
                                inv => html`
                                    <li class="tap" @click=${() => this._showInvite(inv)}>
                                        <pl-invite-item .invite=${inv}></pl-invite-item>
                                    </li>
                                `
                            )}
                        </ul>
                    </div>

                    <div class="fabs" ?hidden=${!isAdmin}>
                        <div class="flex"></div>

                        <pl-icon icon="invite" class="tap fab" @click=${() => this._createInvite()}></pl-icon>
                    </div>
                </div>
            </main>
        `;
    }
}
