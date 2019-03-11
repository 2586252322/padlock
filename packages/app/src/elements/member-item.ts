import { OrgMember } from "@padloc/core/lib/org.js";
import { shared } from "../styles";
import { BaseElement, element, html, property } from "./base.js";
import "./fingerprint.js";

@element("pl-member-item")
export class MemberItem extends BaseElement {
    @property()
    member: OrgMember;

    render() {
        return html`
            ${shared}

            <style>
                :host {
                    display: flex;
                    align-items: center;
                    padding: 8px;
                }

                pl-fingerprint {
                    color: var(--color-secondary);
                    --color-background: var(--color-tertiary);
                    width: 45px;
                    height: 45px;
                    border-radius: 100%;
                    border: solid 1px var(--border-color);
                    margin-right: 8px;
                }

                .member-info {
                    flex: 1;
                    width: 0;
                }

                .member-name {
                    font-weight: bold;
                }

                .member-email {
                    font-size: 90%;
                }
            </style>

            <pl-fingerprint .key=${this.member.publicKey}></pl-fingerprint>

            <div class="member-info">
                <div class="member-name ellipsis">${this.member.name}</div>

                <div class="member-email ellipsis">${this.member.email}</div>
            </div>
        `;
    }
}
