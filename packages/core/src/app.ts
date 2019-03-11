import { EventEmitter } from "./event-target";
import { Storage, Storable } from "./storage";
import { Serializable } from "./encoding";
import { Invite, InvitePurpose } from "./invite";
import { Vault, VaultID } from "./vault";
import { Org, OrgID, OrgMember } from "./org";
import { Group, GroupID } from "./group";
import { VaultItem, Field, Tag, createVaultItem } from "./item";
import { Account } from "./account";
import { Auth, EmailVerificationPurpose } from "./auth";
import { Session } from "./session";
// import { Invite } from "./invite";
import {
    API,
    RequestEmailVerificationParams,
    CompleteEmailVerificationParams,
    CreateAccountParams,
    InitAuthParams,
    CreateSessionParams,
    RecoverAccountParams,
    GetInviteParams
    // CreateVaultParams
} from "./api";
import { Client } from "./client";
import { Sender } from "./transport";
import { localize as $l } from "./locale";
import { DeviceInfo, getDeviceInfo } from "./platform";
import { uuid, escapeRegex } from "./util";
import { Client as SRPClient } from "./srp";
import { ErrorCode } from "./error";
import { Attachment, AttachmentInfo } from "./attachment";

export class Stats extends Serializable {
    lastSync?: Date;

    fromRaw({ lastSync }: any) {
        Object.assign(this, {
            lastSync: new Date(lastSync)
        });
        return this;
    }
}

export class Settings extends Serializable {
    autoLock: boolean = true;
    autoLockDelay: number = 5;
    customServer: boolean = false;
    customServerUrl: string = "";
    syncInterval: number = 1;
}

function filterByString(fs: string, rec: VaultItem) {
    if (!fs) {
        return true;
    }
    const content = [rec.name, ...rec.fields.map(f => f.name)].join(" ").toLowerCase();
    return content.search(escapeRegex(fs.toLowerCase())) !== -1;
}

export interface ListItem {
    item: VaultItem;
    vault: Vault;
    section: string;
    firstInSection: boolean;
    lastInSection: boolean;
    warning?: boolean;
}

export interface FilterParams {
    vault?: Vault | null;
    tag?: Tag | null;
    text?: string;
}

export class AppState extends Storable {
    id = "app-state";
    settings = new Settings();
    stats = new Stats();
    device = new DeviceInfo();
    session: Session | null = null;
    account: Account | null = null;

    fromRaw({ settings, stats, device, session, account }: any) {
        this.settings.fromRaw(settings);
        this.stats.fromRaw(stats);
        this.device.fromRaw(device);
        this.session = new Session().fromRaw(session) || null;
        this.account = new Account().fromRaw(account) || null;
        return this;
    }
}

export class App extends EventEmitter {
    version = "3.0";
    api: API;
    state = new AppState();
    loaded = this.load();

    constructor(public storage: Storage, sender: Sender) {
        super();
        this.api = new Client(this.state, sender);
    }

    get settings() {
        return this.state.settings;
    }

    get account() {
        return this.state.account;
    }

    get locked() {
        return !this.account || !!this.account.locked;
    }

    get loggedIn() {
        return !!this.state.session;
    }

    get syncing() {
        return !!this._activeSyncPromises.size;
    }

    get syncComplete() {
        return Promise.all([...this._activeSyncPromises.values(), ...this._queuedSyncPromises.values()]);
    }

    get tags() {
        if (!this.mainVault) {
            return [];
        }
        const tags = this.mainVault.items.tags;
        for (const vault of this.vaults) {
            tags.push(...vault.items.tags);
        }
        return [...new Set(tags)];
    }

    get mainVault(): Vault | null {
        return (this.account && this._vaults.get(this.account.mainVault)) || null;
    }

    get vaults() {
        return [...this._vaults.values()]
            .filter(v => !v.archived)
            .sort((a, b) => {
                const nameA = a.toString();
                const nameB = b.toString();
                return b === this.mainVault || nameA > nameB ? 1 : a === this.mainVault || nameA < nameB ? -1 : 0;
            });
    }

    get orgs() {
        return [...this._orgs.values()];
    }

    get archivedVaults() {
        return [...this._vaults.values()].filter(v => !!v.archived);
    }

    get filter() {
        return this._filter;
    }

    set filter(filter: FilterParams) {
        this._filter = filter;
        this.dispatch("filter-changed", filter);
    }

    get items(): ListItem[] {
        const recentCount = 0;

        const { vault, tag, text } = this.filter;

        if (!this.mainVault) {
            return [];
        }
        let items: ListItem[] = [];

        for (const s of vault ? [vault] : this.vaults) {
            for (const item of s.items) {
                if ((!tag || item.tags.includes(tag)) && filterByString(text || "", item)) {
                    items.push({
                        vault: s,
                        item: item,
                        section: "",
                        firstInSection: false,
                        lastInSection: false
                    });
                }
            }
        }

        const recent = items
            .sort((a, b) => {
                return (b.item.lastUsed || b.item.updated).getTime() - (a.item.lastUsed || a.item.updated).getTime();
            })
            .slice(0, recentCount);

        items = items.slice(recentCount);

        items = recent.concat(
            items.sort((a, b) => {
                const x = a.item.name.toLowerCase();
                const y = b.item.name.toLowerCase();
                return x > y ? 1 : x < y ? -1 : 0;
            })
        );

        for (let i = 0, prev, curr; i < items.length; i++) {
            prev = items[i - 1];
            curr = items[i];

            curr.section =
                i < recentCount
                    ? $l("Recently Used")
                    : (curr.item && curr.item.name[0] && curr.item.name[0].toUpperCase()) || $l("No Name");

            curr.firstInSection = !prev || prev.section !== curr.section;
            prev && (prev.lastInSection = curr.section !== prev.section);
        }

        return items;
    }

    private _vaults = new Map<string, Vault>();
    private _orgs = new Map<string, Org>();
    private _filter: FilterParams = {};
    private _attachments = new Map<string, Attachment>();
    private _queuedSyncPromises = new Map<string, Promise<void>>();
    private _activeSyncPromises = new Map<string, Promise<void>>();

    async load() {
        try {
            await this.storage.get(this.state, this.state.id);
        } catch (e) {}
        this.state.device.fromRaw(getDeviceInfo());
        if (!this.state.device.id) {
            this.state.device.id = uuid();
        }
        await this.storage.save(this.state);

        // Try syncing account so user can unlock with new password in case it has changed
        if (this.account) {
            this.fetchAccount();
        }

        this.dispatch("load");
    }

    async unlock(password: string) {
        await this.account!.unlock(password);
        await this.loadOrgs();
        await this.loadVaults();
        this.dispatch("unlock");
        this.synchronize();
    }

    async lock() {
        this.account!.lock();
        this._vaults.clear();
        this.dispatch("lock");
    }

    // SESSION / ACCOUNT MANGAGEMENT

    async requestEmailVerification(email: string, purpose: EmailVerificationPurpose = "create_account") {
        return this.api.requestEmailVerification(new RequestEmailVerificationParams({ email, purpose }));
    }

    async completeEmailVerification(email: string, code: string) {
        return this.api.completeEmailVerification(new CompleteEmailVerificationParams({ email, code }));
    }

    async signup({
        email,
        password,
        name,
        verify,
        invite
    }: {
        email: string;
        password: string;
        name: string;
        verify: string;
        invite?: { id: string; vault: string };
    }) {
        const account = new Account();
        account.email = email;
        account.name = name;
        await account.initialize(password);

        const auth = new Auth(email);
        const authKey = await auth.getAuthKey(password);

        const srp = new SRPClient();
        await srp.initialize(authKey);

        auth.verifier = srp.v!;

        await this.api.createAccount(
            new CreateAccountParams({
                account,
                auth,
                verify,
                invite
            })
        );

        await this.login(email, password);
    }

    async login(email: string, password: string) {
        const { auth, B } = await this.api.initAuth(new InitAuthParams({ email }));
        const authKey = await auth.getAuthKey(password);

        const srp = new SRPClient();

        await srp.initialize(authKey);
        await srp.setB(B);

        this.state.session = await this.api.createSession(
            new CreateSessionParams({ account: auth.account, A: srp.A!, M: srp.M1! })
        );
        this.state.session.key = srp.K!;

        const account = (this.state.account = await this.api.getAccount());

        await account.unlock(password);

        const mainVault = await this.api.getVault(account.mainVault);
        if (!mainVault.accessors.length) {
            await mainVault.updateAccessors([account]);
            await this.api.updateVault(mainVault);
        }

        await this.synchronize();

        this.dispatch("login");
        this.dispatch("unlock");
        this.dispatch("account-changed", { account: this.account });
    }

    async logout() {
        await this._logout();
        this.dispatch("lock");
        this.dispatch("logout");
        this.dispatch("account-changed", { account: this.account });
    }

    private async _logout() {
        try {
            await this.api.revokeSession(this.state.session!.id);
        } catch (e) {}

        this.state.session = null;
        this.state.account = null;
        await this.storage.clear();
        this._vaults.clear();
    }

    async changePassword(password: string) {
        const account = this.account!;
        await account.setPassword(password);
        await this.updateAccount();
        const auth = new Auth(account.email);
        auth.account = account.id;
        const authKey = await auth.getAuthKey(password);
        const srp = new SRPClient();
        await srp.initialize(authKey);
        auth.verifier = srp.v!;
        await this.api.updateAuth(auth);
    }

    async fetchAccount() {
        const account = await this.api.getAccount();
        // TODO: public key change?
        if (this.account) {
            account.privateKey = this.account.privateKey;
        }
        this.state.account = account;
        this.storage.save(this.state);
        this.dispatch("account-changed", { account: this.account });
    }

    async updateAccount() {
        const account = await this.api.updateAccount(this.account!);
        // TODO: public key change?
        if (this.account) {
            account.privateKey = this.account.privateKey;
        }
        this.state.account = account;
        this.storage.save(this.state);
        this.dispatch("account-changed", { account: this.account });
    }

    async revokeSession(session: Session) {
        await this.api.revokeSession(session.id);
        await this.fetchAccount();
    }

    async recoverAccount({ email, password, verify }: { email: string; password: string; verify: string }) {
        await this._logout();

        const account = new Account();
        account.email = email;
        await account.initialize(password);

        const auth = new Auth(email);
        const authKey = await auth.getAuthKey(password);

        const srp = new SRPClient();
        await srp.initialize(authKey);

        auth.verifier = srp.v!;

        await this.api.recoverAccount(
            new RecoverAccountParams({
                account,
                auth,
                verify
            })
        );
    }

    // VAULTS

    getVault(id: string) {
        return this._vaults.get(id) || null;
    }

    async createVault(
        name: string,
        org: Org,
        groups: { id: GroupID; readonly: boolean }[] = [{ id: org.admins.id, readonly: false }]
    ): Promise<Vault> {
        let vault = new Vault();
        vault.name = name;
        vault.org = { id: org.id, name: org.name };
        vault = await this.api.createVault(vault);
        await this.updateOrg(org.id, async (org: Org) => {
            await org.unlock(this.account!);

            if (!groups.some(g => g.id === org.admins.id)) {
                groups.push({ id: org.admins.id, readonly: false });
            }

            groups.forEach(({ id, readonly }) => org.getGroup(id)!.vaults.push({ id: vault.id, readonly }));

            const unlockingGroups = org.getGroupsForVault(vault);
            await org.verifyAll(unlockingGroups);
            await vault.updateAccessors(unlockingGroups);
            await this.api.updateVault(vault);
        });
        await this.synchronize();

        this.dispatch("vault-created", { vault });
        return vault;
    }

    async updateVault(vault: Vault, name: string, groups: { id: GroupID; readonly: boolean }[]) {
        if (!vault.org) {
            return "Cannot update vaults that are not part of an org!";
        }

        await this.updateOrg(vault.org.id, async (org: Org) => {
            if (!groups.some(g => g.id === org.admins.id)) {
                groups.push({ id: org.admins.id, readonly: false });
            }

            for (const group of [org.admins, org.everyone, ...org.groups]) {
                // remove previous vault entry
                group.vaults = group.vaults.filter(v => v.id !== vault.id);
                // update vault entry
                const selection = groups.find(g => g.id === group.id);
                if (selection) {
                    group.vaults.push({ id: vault.id, readonly: selection.readonly });
                }
            }
        });

        await this.syncVault(vault, this.getOrg(vault.org.id)!.admins, vault => (vault.name = name));
    }

    // async archiveVault({ id }: { id: VaultID }): Promise<void> {
    //     const vault = this.getVault(id)!;
    //     await Promise.all([...vault.vaults].map(v => this.archiveVault(v)));
    //     vault.archived = true;
    //     vault.updated = new Date();
    //     await this.syncVault(vault, false);
    // }
    //
    // async unarchiveVault(vault: Vault | VaultInfo): Promise<void> {
    //     await this.reinitializeVault(vault);
    // }

    async loadVaults() {
        if (!this.account) {
            return;
        }

        this._vaults.clear();

        const vault = await this.storage.get(Vault, this.account.mainVault);
        await vault.unlock(this.account!);
        this._vaults.set(this.account.mainVault, vault);

        for (const org of this.orgs) {
            for (const { id, group } of org.getVaultsForMember(this.account)) {
                await group.unlock(this.account);
                try {
                    const vault = await this.storage.get(Vault, id);
                    await vault.unlock(group);
                    this._vaults.set(id, vault);
                } catch (e) {
                    console.error("Failed to load vault: ", e);
                }
            }
        }
    }

    async saveVault(vault: Vault): Promise<void> {
        await vault.commit();
        this._vaults.set(vault.id, vault);
        await this.storage.save(vault);
    }

    async deleteVault(vault: Vault) {
        await this.api.deleteVault(vault.id);
        await this.synchronize();
    }

    async syncVault(vault: { id: VaultID }, group?: Group, transform?: (vault: Vault) => any): Promise<Vault> {
        return this._queueSync(vault, (vault: { id: VaultID }) => this._syncVault(vault, group, transform));
    }

    async syncVaults() {
        if (!this.account) {
            return;
        }

        const promises = [this.syncVault({ id: this.account.mainVault })] as Promise<any>[];

        for (const org of this.orgs) {
            for (const vault of org.getVaultsForMember(this.account)) {
                promises.push(this.syncVault(vault));
            }
        }

        await Promise.all(promises);
    }

    async unlockVault(vault: Vault, group?: Group) {
        const account = this.account!;
        const org = vault.org && this.getOrg(vault.org.id);
        if (org) {
            if (!group) {
                group = org.getUnlockingGroupForVault(vault, account)!;
            }
            await group.unlock(account);
            await vault.unlock(group);
        } else {
            await vault.unlock(account);
        }
    }

    hasWritePermissions(vault: Vault) {
        if (!vault.org) {
            return true;
        }

        const org = this.getOrg(vault.org.id)!;

        return org
            .getGroupsForMember(this.account!)
            .some(group => group.vaults.some(v => v.id === vault.id && !v.readonly));
    }

    async _syncVault({ id }: { id: VaultID }, group?: Group, transform?: (vault: Vault) => any): Promise<Vault | null> {
        const localVault = this.getVault(id);
        let remoteVault: Vault;
        let result: Vault;

        try {
            remoteVault = await this.api.getVault(id);
            await this.unlockVault(remoteVault, group);
        } catch (e) {
            if (e.code === ErrorCode.NOT_FOUND) {
                if (localVault) {
                    await this.storage.delete(localVault);
                }
                this._vaults.delete(id);
                return null;
            } else {
                throw e;
            }
        }

        if (localVault) {
            result = localVault.clone();
            await this.unlockVault(result, group);
            result.merge(remoteVault);
            await result.commit();
        } else {
            result = remoteVault;
        }

        const org = result.org && this.getOrg(result.org.id);
        if (org) {
            const groups = org.getGroupsForVault(result);
            await org.verifyAll(groups);
            await result.updateAccessors(groups);
        }

        if (transform) {
            transform(result);
        }

        try {
            await this.api.updateVault(result);
        } catch (e) {
            if (e.code === ErrorCode.MERGE_CONFLICT) {
                // If there is a merge conflict (probably because somebody else
                // did a push while we were sycing), start over.
                return this._syncVault({ id });
            }
            throw e;
        }

        await this.saveVault(result);
        this._vaults.set(id, result);

        this.dispatch("vault-changed", { vault: result });

        return result;
    }

    // VAULT ITEMS

    getItem(id: string): { item: VaultItem; vault: Vault } | null {
        for (const vault of [this.mainVault!, ...this.vaults]) {
            const item = vault.items.get(id);
            if (item) {
                return { item, vault };
            }
        }

        return null;
    }

    async addItems(items: VaultItem[], vault: Vault = this.mainVault!) {
        vault.items.update(...items);
        this.dispatch("items-added", { vault, items });
        await this.saveVault(vault);
        this.syncVault(vault);
    }

    async createItem(name: string, vault_?: Vault, fields?: Field[], tags?: Tag[]): Promise<VaultItem> {
        const vault = vault_ || this.mainVault!;
        fields = fields || [
            { name: $l("Username"), value: "", type: "username" },
            { name: $l("Password"), value: "", type: "password" },
            { name: $l("URL"), value: "", type: "url" }
        ];
        const item = createVaultItem(name || "", fields, tags);
        if (this.account) {
            item.updatedBy = this.account.id;
        }
        await this.addItems([item], vault);
        this.dispatch("item-created", { vault, item });
        return item;
    }

    async updateItem(vault: Vault, item: VaultItem, upd: { name?: string; fields?: Field[]; tags?: Tag[] }) {
        vault.items.update({ ...item, ...upd, updatedBy: this.account!.id });
        this.dispatch("item-changed", { vault, item });
        this.saveVault(vault);
        await this.syncVault(vault);
    }

    async deleteItems(items: { item: VaultItem; vault: Vault }[]) {
        const attachments = [];
        const grouped = new Map<Vault, VaultItem[]>();
        for (const item of items) {
            if (!grouped.has(item.vault)) {
                grouped.set(item.vault, []);
            }
            grouped.get(item.vault)!.push(item.item);
            attachments.push(...(item.item.attachments || []));
        }

        // await Promise.all(attachments.map(att => this.deleteAttachment(att)));

        for (const [vault, items] of grouped.entries()) {
            vault.items.remove(...items);
            this.saveVault(vault);
            this.dispatch("items-deleted", { vault, items });
            await this.syncVault(vault);
        }
    }

    async moveItems(items: { item: VaultItem; vault: Vault }[], target: Vault) {
        const newItems = items.map(i => ({ ...i.item, id: uuid() }));
        await this.addItems(newItems, target);
        await this.deleteItems(items);
        return newItems;
    }

    // ORGANIZATIONS

    getOrg(id: OrgID) {
        return this._orgs.get(id);
    }

    async createOrg(name: string): Promise<Org> {
        let org = new Org();
        org.name = name;
        await org.initialize(this.account!);
        org = await this.api.createOrg(org);
        await this.fetchAccount();
        await this.loadOrgs(true);
        return this.getOrg(org.id)!;
    }

    async loadOrgs(fetch = false) {
        if (!this.account) {
            return;
        }
        for (const id of this.account.orgs) {
            const org = fetch ? await this.api.getOrg(id) : await this.storage.get(Org, id);
            this._orgs.set(id, org);
            fetch && (await this.storage.save(org));
        }
    }

    async updateOrg(id: OrgID, transform: (org: Org) => Promise<any>) {
        let org = this.getOrg(id)!.clone();
        await transform(org);
        org = await this.api.updateOrg(org);
        this._orgs.set(org.id, org);
        await this.storage.save(org);
        this.dispatch("org-changed", { org });
        return org;
    }

    async createGroup(org: Org, name: string, members: OrgMember[]) {
        let group: Group;
        await this.updateOrg(org.id, async (org: Org) => {
            await org.unlock(this.account!);
            group = await org.createGroup(name, members);
        });
        return group!;
    }

    async updateGroup(org: Org, group: Group, members: OrgMember[], name?: string) {
        // Save admins group for unlocking vaults before updating accessors during sync
        const admins = org.admins.clone();

        await this.updateOrg(org.id, async org => {
            await org.unlock(this.account!);
            await org.updateGroup(group.id, members, name);
        });

        // Update all vaults after rotating group keys
        await Promise.all(group.vaults.map(async vault => this.syncVault(vault, admins)));
    }

    async updateMember(org: Org, member: OrgMember, groups: GroupID[]) {
        // Clone admins group for synching
        const admins = org.admins.clone();

        const updateVaults: { id: VaultID }[] = [];

        await this.updateOrg(org.id, async org => {
            await org.unlock(this.account!);

            const prevGroups = org.getGroupsForMember(member);

            // Remove member from groups that they're no longer supposed to be in
            for (const group of prevGroups) {
                if (!groups.includes(group.id)) {
                    await org.updateGroup(group.id, org.getMembersForGroup(group).filter(m => m.id !== member.id));
                    updateVaults.push(...group.vaults);
                }
            }

            // Add member to new groups
            for (const groupId of groups) {
                if (!prevGroups.some(g => g.id === groupId)) {
                    const group = org.getGroup(groupId)!;
                    await org.updateGroup(group.id, [...org.getMembersForGroup(group), member]);
                    updateVaults.push(...group.vaults);
                }
            }
        });

        // Deduplicate vault ids that need updating;
        const vaultIds = [...new Set(updateVaults.map(v => v.id))];

        // Sync affected vaults, updating accessors in the process
        await Promise.all(vaultIds.map(id => this.syncVault({ id }, admins)));
    }

    async removeMember(org: Org, member: OrgMember) {
        // Clone admins group for synching
        const admins = org.admins.clone();

        const updateVaults: { id: VaultID }[] = [];

        await this.updateOrg(org.id, async org => {
            await org.unlock(this.account!);

            const groups = org.getGroupsForMember(member);

            // Remove member from all groups
            for (const group of groups) {
                await org.updateGroup(group.id, org.getMembersForGroup(group).filter(m => m.id !== member.id));
                updateVaults.push(...group.vaults);
            }

            org.members = org.members.filter(m => m.id !== member.id);
        });

        // Deduplicate vault ids that need updating;
        const vaultIds = [...new Set(updateVaults.map(v => v.id))];

        // Sync affected vaults, updating accessors in the process
        await Promise.all(vaultIds.map(id => this.syncVault({ id }, admins)));
    }

    // INVITES

    async createInvite({ id }: Org, email: string, purpose?: InvitePurpose) {
        const org = this.getOrg(id)!;
        const invite = new Invite(email, purpose);
        await invite.initialize(org, this.account!);
        await this.updateOrg(org.id, async (org: Org) => (org.invites = [...org.invites, invite]));
        this.dispatch("invite-created", { invite });
        return invite;
    }

    async getInvite(orgId: string, id: string) {
        let invite = null;
        try {
            invite = await this.api.getInvite(new GetInviteParams({ org: orgId, id }));
        } catch (e) {}
        return invite;
    }

    async acceptInvite(invite: Invite, secret: string) {
        const success = await invite.accept(this.account!, secret);
        if (success) {
            await this.api.acceptInvite(invite);
        }
        return success;
    }

    async confirmInvite(invite: Invite): Promise<OrgMember> {
        await this.updateOrg(invite.org!.id, async (org: Org) => {
            await org.unlock(this.account!);
            await org.addMember(invite.invitee!);
            org.removeInvite(invite);
            // Update everyone group
            await org.updateGroup(org.everyone.id, org.members);
        });

        await Promise.all(this.getOrg(invite.org!.id)!.everyone.vaults.map(async vault => this.syncVault(vault)));

        return this.getOrg(invite.org!.id)!.getMember({ id: invite.invitee!.id })!;
    }

    async deleteInvite(invite: Invite): Promise<void> {
        await this.updateOrg(
            invite.org!.id,
            async org => (org.invites = org.invites.filter(inv => inv.id !== invite.id))
        );
    }

    // SETTINGS / STATS

    async setStats(obj: Partial<Stats>) {
        Object.assign(this.state.stats, obj);
        this.storage.save(this.state);
        this.dispatch("stats-changed", { stats: this.state.stats });
    }

    async setSettings(obj: Partial<Settings>) {
        Object.assign(this.state.settings, obj);
        this.storage.save(this.state);
        this.dispatch("settings-changed", { settings: this.state.settings });
    }

    // ATTACHMENTS

    getAttachment(attInfo: AttachmentInfo): Attachment {
        let att = this._attachments.get(attInfo.id);

        if (!att) {
            att = new Attachment(attInfo);
            this._attachments.set(`${attInfo.id}`, att);
        }

        return att;
    }

    // async createAttachment(vault: Vault, file: File): Promise<Attachment> {
    //     const att = new Attachment({ id: uuid(), vault: vault.id });
    //     await att.fromFile(file);
    //     this._attachments.set(att.id, att);
    //     this.api.createAttachment(att);
    //     return att;
    // }
    //
    // async downloadAttachment(att: Attachment | AttachmentInfo) {
    //     if (!(att instanceof Attachment)) {
    //         att = this.getAttachment(att);
    //     }
    //     return this.api.getAttachment(att as Attachment);
    // }
    //
    // async deleteAttachment(att: Attachment | AttachmentInfo): Promise<void> {
    //     if (!(att instanceof Attachment)) {
    //         att = this.getAttachment(att);
    //     }
    //     this._attachments.delete(att.id);
    //     await this.api.deleteAttachment(att as Attachment);
    // }

    // MISC
    // async removeMember(vault: Vault, member: VaultMember): Promise<any> {
    //     for (const { id } of vault.vaults) {
    //         const subVault = this.getVault(id)!;
    //         if (subVault.members.get(member.id)) {
    //             await this.removeMember(subVault, member);
    //         }
    //     }
    //     vault.members.remove(member);
    //     await this.syncVault(vault);
    // }

    async synchronize() {
        await this.fetchAccount();
        await this.loadOrgs(true);
        await this.syncVaults();
        await this.storage.save(this.state);
        this.setStats({ lastSync: new Date() });
        this.dispatch("synchronize");
    }

    async _queueSync(obj: { id: string }, fn: (obj: { id: string }) => Promise<any>): Promise<any> {
        let queued = this._queuedSyncPromises.get(obj.id);
        let active = this._activeSyncPromises.get(obj.id);

        if (queued) {
            // There is already a queued sync promise, so just return that one
            return queued;
        }

        if (active) {
            // There is already a synchronization in process. wait for the current sync to finish
            // before starting a new one.
            const next = () => {
                this._queuedSyncPromises.delete(obj.id);
                return this._queueSync(obj, fn);
            };
            queued = active.then(next, next);
            this._queuedSyncPromises.set(obj.id, queued);
            return queued;
        }

        this.dispatch("start-sync", obj);
        active = fn(obj).then(
            (result: any) => {
                this._activeSyncPromises.delete(obj.id);
                this.dispatch("finish-sync", obj);
                return result;
            },
            e => {
                this._activeSyncPromises.delete(obj.id);
                this.dispatch("finish-sync", obj);
                throw e;
            }
        );
        this._activeSyncPromises.set(obj.id, active);
        return active;
    }
}
