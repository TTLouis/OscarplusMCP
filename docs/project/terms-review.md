# Publication review

[Back to the project overview](../../README.md)

Reviewed October 14, 2026. This is a limited source review, not legal clearance.

## Sources checked

- [OSCARplus home](https://www.oscarplusmcmaster.ca/home.htm) and [student login](https://www.oscarplusmcmaster.ca/studentLogin.htm): neither displayed a dedicated terms link in the public page text or links inspected. This does not establish that no account-specific terms exist.
- [McMaster OSCARplus information](https://studentsuccess.mcmaster.ca/about/oscarplus/): its Terms & Conditions link redirects to the following policy.
- [McMaster website terms of use](https://www.mcmaster.ca/website-terms-of-use/): reviewed the Reproduction of Contents, Intellectual Property, and System Integrity sections.

## Findings

The general website terms permit limited personal, educational or non-commercial reproduction under conditions including preserving content and notices. Other publication or redistribution requires prior written permission. They also restrict use of protected materials and branding, interference with the website, and unreasonable infrastructure load.

These general terms do not explicitly authorize this adapter's authenticated automated ingestion. Whether they govern every part of OSCARplus, and whether additional student, co-op, employer or Orbis conditions apply, remain unresolved. A login or valid student account does not by itself resolve those questions.

Publishing independently authored source code is a different action from publishing portal content. This repository includes no actual posting captures, application history, attachments, credentials, session state or branding assets. The original project software now uses the [PolyForm Noncommercial License 1.0.0](../../LICENSE), with [required notices](../../NOTICE) and a [project disclaimer](../../DISCLAIMER.md). The licence permits its defined noncommercial purposes and restricts other uses; it is not an assertion of rights to third-party content or authorization for automated portal access. Third-party dependencies retain their own licences.

## Before public release or live use

- Review any terms accepted inside the account and obtain clarification or permission for automated access where needed.
- Keep portal content, cached data and account state private. A software license cannot license third-party postings or grant portal access.
- Use an accurate, unaffiliated description. Changing the name or omitting the integration's behavior does not change the terms.
- Review the staged files as well as `.gitignore`; ignored files can still be force-added or already tracked. This release repository starts with fresh history and contains no copied source Git history.

The live provider and automatic sync are disabled in the example configuration. The HTTP service has no authentication and must remain on a trusted local/private network.
