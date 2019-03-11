import {
    bytesToBase64,
    base64ToBytes,
    bytesToString,
    stringToBytes,
    Serializable,
    unmarshal,
    marshal
} from "./encoding";
import { getProvider, RSAPrivateKey, RSAPublicKey, RSAKeyParams, HMACKeyParams, RSASigningParams } from "./crypto";
import { uuid } from "./util";
import { SharedContainer } from "./container";
import { Err, ErrorCode } from "./error";
import { Storable } from "./storage";
import { Vault, VaultID } from "./vault";
import { Group, GroupID } from "./group";
import { Account, AccountID } from "./account";
import { Invite, InviteID } from "./invite";

export class OrgMember extends Serializable {
    id: AccountID = "";
    name = "";
    email = "";
    publicKey!: RSAPublicKey;
    signedPublicKey!: Uint8Array;

    constructor({ id, name, email, publicKey, signedPublicKey }: Partial<OrgMember> = {}) {
        super();
        Object.assign(this, { id, name, email, publicKey, signedPublicKey });
    }

    toRaw(): any {
        return {
            ...super.toRaw(["privateKey"]),
            publicKey: bytesToBase64(this.publicKey),
            signedPublicKey: bytesToBase64(this.signedPublicKey)
        };
    }

    validate() {
        return (
            typeof this.id === "string" &&
            typeof this.name === "string" &&
            typeof this.email === "string" &&
            this.publicKey instanceof Uint8Array &&
            this.signedPublicKey instanceof Uint8Array
        );
    }

    fromRaw({ id, name, publicKey, signedPublicKey, ...rest }: any) {
        Object.assign(this, {
            id,
            name,
            publicKey: base64ToBytes(publicKey),
            signedPublicKey: base64ToBytes(signedPublicKey)
        });

        return super.fromRaw(rest);
    }
}

export type OrgID = string;
export type OrgRole = "admin" | "member";

export class Org extends SharedContainer implements Storable {
    id: OrgID = "";
    name: string = "";
    owner: AccountID = "";
    publicKey!: RSAPublicKey;
    privateKey!: RSAPrivateKey;
    invitesKey!: Uint8Array;
    signingParams = new RSASigningParams();
    members: OrgMember[] = [];
    groups: Group[] = [];
    vaults: {
        id: VaultID;
        name: string;
    }[] = [];
    invites: Invite[] = [];
    admins: Group = new Group();
    everyone: Group = new Group();

    toRaw() {
        return {
            ...super.toRaw(),
            publicKey: bytesToBase64(this.publicKey)
        };
    }

    validate() {
        return (
            typeof this.name === "string" &&
            typeof this.id === "string" &&
            typeof this.owner === "string" &&
            this.publicKey instanceof Uint8Array &&
            this.vaults.every(({ id, name }: any) => typeof id === "string" && typeof name === "string")
        );
    }

    fromRaw({
        id,
        name,
        owner,
        publicKey,
        members,
        groups,
        vaults,
        invites,
        admins,
        everyone,
        signingParams,
        ...rest
    }: any) {
        this.signingParams.fromRaw(signingParams);
        this.admins.fromRaw(admins);
        this.everyone.fromRaw(everyone);

        Object.assign(this, {
            id,
            name,
            owner,
            publicKey: base64ToBytes(publicKey),
            members: members.map((m: any) => new OrgMember().fromRaw(m)),
            groups: groups.map((g: any) => new Group().fromRaw(g)),
            invites: invites.map((g: any) => new Invite().fromRaw(g)),
            vaults
        });

        return super.fromRaw(rest);
    }

    isOwner({ id }: { id: string }) {
        return id === this.owner;
    }

    isAdmin(m: { id: string }) {
        return !!this.admins.isMember(m);
    }

    getMember({ id }: { id: AccountID }) {
        return this.members.find(m => m.id === id);
    }

    isMember(acc: { id: AccountID }) {
        return !!this.getMember(acc);
    }

    getGroup(id: GroupID) {
        return [...this.groups, this.admins, this.everyone].find(g => g.id === id);
    }

    getMembersForGroup(group: Group): OrgMember[] {
        return group.accessors
            .map(a => this.getMember(a))
            // Filter out undefined members
            .filter(m => !!m) as OrgMember[];
    }

    getGroupsForMember({ id }: OrgMember | Account) {
        return [this.admins, this.everyone, ...this.groups].filter(g => g.accessors.some(a => a.id === id));
    }

    getGroupsForVault({ id }: Vault): Group[] {
        return [this.admins, this.everyone, ...this.groups].filter(group => group.vaults.some(v => v.id === id));
    }

    getUnlockingGroupForVault({ id }: { id: VaultID }, account: OrgMember | Account) {
        const availableGroups = this.getGroupsForMember(account);
        return availableGroups.find(group => group.vaults.some(v => v.id === id));
    }

    getVaultsForMember(acc: OrgMember | Account) {
        const results: { id: VaultID; name: string; group: Group }[] = [];

        for (const vault of this.vaults) {
            const group = this.getUnlockingGroupForVault(vault, acc);
            if (group) {
                results.push(Object.assign({ group }, vault));
            }
        }

        return results;
    }

    getInvite(id: InviteID) {
        return this.invites.find(inv => inv.id === id);
    }

    removeInvite({ id }: Invite) {
        this.invites = this.invites.filter(inv => inv.id !== id);
    }

    async initialize({ id, name, email, publicKey }: Account) {
        this.admins.id = uuid();
        this.admins.name = "Admins";
        this.everyone.id = uuid();
        this.everyone.name = "Everyone";

        // Add account to admin group
        await this.admins.updateAccessors([{ id, publicKey }]);

        // Generate admin group keys
        await this.admins.generateKeys();

        // Grant admin group access to
        await this.updateAccessors([this.admins]);

        await this.generateKeys();

        const member = await this.sign(new OrgMember({ id, name, email, publicKey }));
        this.members.push(member);
        await this.everyone.updateAccessors([this.admins, member]);
        await this.everyone.generateKeys();

        await this.sign(this.admins);
        await this.sign(this.everyone);
    }

    async generateKeys() {
        this.invitesKey = await getProvider().generateKey(new HMACKeyParams());
        const { privateKey, publicKey } = await getProvider().generateKey(new RSAKeyParams());
        this.privateKey = privateKey;
        this.publicKey = publicKey;
        await this.setData(
            stringToBytes(
                marshal({ privateKey: bytesToBase64(privateKey), invitesKey: bytesToBase64(this.invitesKey) })
            )
        );
    }

    async rotateKeys(force = false) {
        if (!force) {
            // Verify members and groups with current public key
            await this.verifyAll();
        }

        // Rotate all group keys
        await Promise.all(
            [this.admins, this.everyone, ...this.groups].map(async group => {
                delete group.encryptedData;
                await group.updateAccessors(this.getMembersForGroup(group));
                await group.generateKeys();
            })
        );

        // Rotate org encryption key
        delete this.encryptedData;
        await this.updateAccessors([this.admins]);

        // Rotate Org key pair
        await this.generateKeys();

        // Resign groups and members
        await Promise.all([this.admins, this.everyone, ...this.groups, ...this.members].map(each => this.sign(each)));
    }

    async unlock(account: Account) {
        await this.admins.unlock(account);
        await super.unlock(this.admins);
        if (this.encryptedData) {
            const { privateKey, invitesKey } = unmarshal(bytesToString(await this.getData()));
            this.privateKey = base64ToBytes(privateKey);
            this.invitesKey = base64ToBytes(invitesKey);
            await this.verifySelf();
        }
    }

    async verifySelf() {
        if (!this.privateKey) {
            throw "Organisation needs to be unlocked first.";
        }

        const val = await getProvider().randomBytes(16);
        const sig = await getProvider().sign(this.privateKey, val, this.signingParams);
        const verified = await getProvider().verify(this.publicKey, sig, val, this.signingParams);

        if (!verified) {
            throw new Err(ErrorCode.PUBLIC_KEY_MISMATCH, "Failed to verify own public key.");
        }
    }

    async sign<T extends { publicKey: Uint8Array; signedPublicKey?: Uint8Array }>(obj: T): Promise<T> {
        if (!this.privateKey) {
            throw "Organisation needs to be unlocked first.";
        }

        obj.signedPublicKey = await getProvider().sign(this.privateKey, obj.publicKey, this.signingParams);
        return obj;
    }

    async verify(obj: OrgMember | Group): Promise<void> {
        if (!obj.signedPublicKey) {
            throw new Err(ErrorCode.PUBLIC_KEY_MISMATCH, "No signed public key provided!");
        }

        const verified = await getProvider().verify(
            this.publicKey,
            obj.signedPublicKey,
            obj.publicKey,
            this.signingParams
        );

        if (!verified) {
            throw new Err(ErrorCode.PUBLIC_KEY_MISMATCH, `Failed to verify public key of ${obj.name}!`);
        }
    }

    async verifyAll(
        subjects: Array<OrgMember | Group> = [this.admins, this.everyone, ...this.groups, ...this.members]
    ) {
        // Verify public keys for members and groups
        await Promise.all(subjects.map(async obj => this.verify(obj)));
    }

    async addMember({
        id,
        name,
        email,
        publicKey
    }: {
        id: string;
        name: string;
        email: string;
        publicKey: Uint8Array;
    }) {
        if (!this.privateKey) {
            throw "Organisation needs to be unlocked first.";
        }

        const member = await this.sign(new OrgMember({ id, name, email, publicKey }));
        this.members.push(member);
    }

    async createGroup(name: string, members: OrgMember[] = []) {
        if (!this.privateKey) {
            throw "Organisation needs to be unlocked first.";
        }

        const group = new Group();
        group.id = uuid();
        group.name = name;

        // Verify public keys first
        await this.verifyAll(members);
        await group.updateAccessors(members);
        await group.generateKeys();
        this.groups.push(await this.sign(group));
        return group;
    }

    async updateGroup(id: GroupID, members: OrgMember[] = [], name?: string) {
        if (!this.privateKey) {
            throw "Organisation needs to be unlocked first.";
        }

        const group = this.getGroup(id);

        if (!group) {
            throw "Group does not exist!";
        }

        if (name) {
            group.name = name;
        }

        // Make sure org owner is in admin group
        if (group === this.admins && !members.some(m => m.id === this.owner)) {
            members.push(this.getMember({ id: this.owner })!);
        }

        await this.verifyAll(members);

        // Update group accessors
        delete group.encryptedData;
        await group.updateAccessors(members);

        // Rotate key pair
        await group.generateKeys();

        // Re-sign group
        await this.sign(group);

        if (group === this.admins) {
            // Rotate org encryption key
            await this.updateAccessors([this.admins]);
        }
    }
}
