# Privacy & Data Security Statement

**Research Lab Hub** · Last updated: November 23, 2026

Research Lab Hub is a free platform where professors manage their research labs (protocols, inventory, lab activity) and keep a private tenure & promotion record. This statement explains what data the platform holds, who can see it, how it's protected, and how you stay in control of it.

The platform is operated by **Jude Okolie** (the "operator"). Questions or concerns: **judebebo32@gmail.com**.

## Our core commitments

1. **Your lab's data belongs to your lab.** Only people your lab invites can see it, according to the roles your lab sets.
2. **The operator does not look at lab data.** The platform admin tools show only what's needed to approve and run labs (listed below). There is no feature for the operator, or anyone outside your lab, to open your protocols, inventory, files, activity or members' work, or any faculty member's tenure record.
3. **You can take your data with you, back it up and delete it at any time.**
4. **We never sell your data, show ads, or use tracking cookies.**

## What the platform stores

- **Account details:** your name and email address. Your password is handled by the sign-in service (Netlify Identity); the platform never sees or stores it.
- **Lab details:** lab name, short name, institution, department, web page, and the note sent with your lab request.
- **Content you add:** protocols (with every saved version and review comments), photos and videos, inventory and usage logs, member roles, and tenure & promotion entries.
- **Activity records:** an activity log inside each lab (for example "edited protocol", "used 2 mL of ethanol"), last sign-in time, and usage counts (storage used, AI imports this month).

## Who can see what

| Who | What they can see |
|---|---|
| **Members of your lab** | What your lab's roles allow: students see their own work and the lab's approved protocols; admins see what the lab owner grants; the lab owner (PI) sees the whole lab. |
| **Your tenure & promotion record** | Only you. Not your students, not co-admins, not other labs, and not the operator through the platform. |
| **Other labs** | Nothing from your lab. Every request is checked on the server, and labs are isolated from each other. |
| **The operator (platform admin page)** | Only: lab name, short name, institution, department and web page; the requester's name, email and note; lab owner email(s); lab status; number of active members; storage used and AI imports this month. Used only to approve labs, contact owners, manage limits and keep the service running. |

### What "the operator does not look at lab data" means in practice

The platform runs on Netlify's cloud infrastructure, and the operator's hosting account could technically reach the underlying database and file storage, as is true of any hosted service. **The operator commits not to access, view, copy or share any lab's content or tenure records**, except:

- when a lab owner asks in writing for help with a specific problem, and only as far as needed to fix it;
- when required by law (for example a court order); or
- to investigate or contain a security incident.

Where the law allows, the affected lab owner will be told about any such access.

**Need a hard technical guarantee?** The platform is open source. You can run your own private copy, which nobody else can access, from [github.com/judebebo32/research-lab-hub](https://github.com/judebebo32/research-lab-hub) in about 10 minutes.

## How your data is protected

- **Encrypted in transit:** all connections use HTTPS.
- **Encrypted at rest:** the database and file storage are encrypted by the hosting provider.
- **Server-side access control:** every request is checked against your lab membership and role. Hiding a button is never the only protection.
- **Private files:** photos and videos are streamed only to signed-in members who are allowed to see them; there are no public links.
- **Invitation-only labs:** people join a lab only when its owner or an authorized admin invites their email address.
- **Reviewed new labs:** new lab spaces are approved by the platform admin to keep out spam and misuse.
- **Version history:** every protocol save is kept, so changes can't silently overwrite earlier work.
- **Open and tested:** the code is public for anyone to inspect, and automated tests check that labs can't reach each other's data.

## AI import (tenure records)

If you use **AI import**, the CV or text you provide is sent to an AI model (Claude, by Anthropic) through Netlify's AI Gateway to draft entries. Netlify's documentation states the gateway does not store prompts or model outputs. The platform deletes your uploaded file once the extraction finishes and keeps only the entries you choose to save. AI import is optional.

## Backups and taking your data with you

- **Download everything, any time:** lab owners can go to **Lab settings → Download full backup** for a complete file of the lab's data (members, protocols with all versions and comments, inventory and usage, activity, file list) plus their own tenure record. Faculty can also export their tenure record as CSV.
- **Automatic weekly backup to your own Google Drive:** lab owners can connect their own Google account under **Lab settings**. The platform can only see the backup folder it creates there, and you can disconnect at any time.

## Deleting data

- **Entries:** delete individual inventory items or tenure entries at any time. Protocols can be archived.
- **Leaving a lab:** a lab owner can mark a member as having left; their past work stays with the lab as part of its research record.
- **Delete your lab:** the lab owner can permanently delete the lab under **Lab settings**. This removes all of its protocols, files, inventory, activity and memberships from the platform immediately.
- **Delete your account:** under **My profile**. This removes your sign-in, your tenure record and your lab memberships. Work you contributed to a lab (such as protocols) stays with that lab under the name "Former member". Lab owners must delete their lab first.
- Copies may remain in the hosting provider's encrypted infrastructure backups for a limited period before they are overwritten.

## Your responsibilities

- **Check your institution's policies.** As a lab owner, you are responsible for making sure that storing your lab's data here meets your institution's rules on research data and student records.
- **Don't store regulated data.** Do not upload protected health information, identifiable human-subject data, export-controlled or classified information, passwords, or financial account numbers.
- Follow the [Code of Conduct](https://github.com/judebebo32/research-lab-hub/blob/main/CODE_OF_CONDUCT.md).

## Cookies

The platform uses only the cookies needed to keep you signed in. It has no advertising or analytics trackers.

## Changes to this statement

If this statement changes in a way that affects how your data is handled, lab owners will be told on the platform before the change takes effect.

## Contact

Privacy questions, data requests or security concerns: **judebebo32@gmail.com**. To report a security vulnerability, please see [SECURITY.md](https://github.com/judebebo32/research-lab-hub/blob/main/SECURITY.md).

*Research Lab Hub is provided free of charge and "as is", without warranties. This statement describes how the platform operates; it is not legal advice. Institutions with specific compliance requirements should review it with their own counsel, or run their own copy.*
