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
                }

                pl-fingerprint {
                    color: var(--color-secondary);
                    --color-background: var(--color-tertiary);
                    width: 40px;
                    height: 40px;
                    border-radius: 100%;
                    border: solid 1px var(--border-color);
                    margin: 10px;
                }

                .member-info {
                    flex: 1;
                    width: 0;
                }

                .member-name {
                    font-weight: bold;
                    margin-bottom: -2px;
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
