# Blabee — Policies & privacy.

DRAFT · UPDATED SEPTEMBER 18, 2026

> Published for review · Not yet in effect. The effective date, legal operator, provider-specific transfer details and active-account retention process are being finalized. App consent, deletion and billing flows must be verified before these policies take effect.

## Website referral measurement

This section describes website measurement added on October 17, 2026. The app policy drafts below remain separate.

We measure landing-page views by referral source and the number of new beta requests from each source. We use four campaign labels (UTM source, medium, campaign and content), the referring website’s hostname when available, and the UTC date. Visits are stored as daily totals without a visitor identifier or an individual browsing history. A page reload can count as another view.

Referral data is kept in tab-scoped session storage. If you return from the policy page within 30 minutes, the landing page can reuse it; expired data is discarded the next time the landing page checks it. An open landing page keeps its assigned source for that page’s beta request. When you request beta access, the source is stored with your email and first request time in Supabase. Repeating the request does not replace that first source. Browser Global Privacy Control or Do Not Track disables this measurement and source attachment; beta requests still work.

These measurement tables do not store full referring URLs, unrelated query values, IP addresses or user-agent strings. Hosting and API providers may keep their own request logs. Missing referral information is marked as direct or unknown. Contact biadone.official@gmail.com about your beta request or its source information.

---

## Privacy Notice

This notice describes our planned handling of account information, optional usage statistics, diagnostics and feedback. The practices below are drafts for the future release, not a verification of the current app or website. The effective date, legal operator, business address and privacy officer are still to be confirmed.

### 1. Why information is used

Account information supports login, identification and account-based service delivery. Optional usage statistics help us understand onboarding, return visits, usability, performance and compatibility. Separately consented diagnostics help investigate errors and improve stability. Feedback is used to review the example or issue you submit and respond where needed.

Login and acceptance of the Terms do not constitute consent to optional collection. The legal basis and necessary scope of account processing, and the notice and basis for general feedback, will be finalized before these practices take effect.

### 2. Data and collection conditions

| Category | Data | Collection condition |
|---|---|---|
| Account information | User ID, email address, account creation timestamp | Login |
| Usage history | Usage count, number of active days, first-use date, last-use date, days since last use | Optional usage-statistics consent |
| Return visits | Daily active users, active users over the past 7 and 30 days, return rate seven days after first use | Calculated from usage statistics collected with consent |
| Onboarding progress | Account readiness, app-service connection, first card received, first feature used | Optional usage-statistics consent |
| Feature use and performance | Selection, approval and skip attempts and outcomes; button and shortcut use; response-time ranges | Optional usage-statistics consent |
| Suggestion and approval card interactions | Card display counts; selection, skip, approval and rejection; response rate; ranges of time until a response | Optional usage-statistics consent |
| Environment | App version and build, major macOS version, display language, Codex version, installation method and version compatibility observed during a Codex recheck | Optional usage-statistics consent |
| Updates | Update offers, installation attempts, success, failure, cancellation and target version | Optional usage-statistics consent |
| Diagnostics | Error categories for connection, account refresh, selection requests and service startup; occurrence timestamp; app and macOS versions | Separate optional diagnostics consent |
| Directly submitted feedback | Helpfulness, rating reasons, intended use and comments; separately, questions, answers and Blabee suggestions selected by the user | General feedback is submitted directly; original content requires a preview and separate consent for that submission |

### 3. Actions and original content are different

Statistics about a selection, approval, rejection or skip describe an action and its outcome. They do not include permission to collect the original questions, answers or suggestions, source code, work files, screen content or complete conversation history. The statistics and diagnostics in this plan are to exclude that content.

An error category is not a raw error message, complete log or stack trace. Any additional diagnostic material needs its own explanation of the contents and purpose, and any required separate selection and consent. Original-content filtering remains to be verified in the release build.

Return-visit metrics, active-day counts, response rates and elapsed-day values are derived from consented statistics. Account data or other logs must not be used to bypass refusal of optional analytics. Statistics that remain linked to a person are still subject to these consent and retention rules; the actual account-linking identifiers remain to be confirmed.

### 4. Separate optional choices

Usage statistics and diagnostics are planned as **two separate, optional choices, initially unselected**. Refusing either will not prevent core features, and agreeing to one will not enable the other.

For original content attached to feedback, the planned flow is: select the content, review a preview, then separately consent to sending it with that submission. General feedback does not require original content. One submission does not authorize future conversations to be sent automatically or transfer ownership of your work. Please exclude passwords, API keys, full card numbers and third-party information you are not entitled to share.

These choices do not authorize advertising, selling personal data, general-purpose AI training or publishing customer case studies. Any additional use needs its own defined purpose, scope, lawful basis and any necessary separate consent.

### 5. Up to one year, with earlier deletion

**The ordinary retention maximum in this plan is one year from collection, or from submission for feedback.** Information should be deleted sooner when its purpose ends or a valid consent withdrawal, account closure or deletion request makes it unnecessary, unless a separate lawful retention duty applies.

| Information | Ordinary maximum | Earlier deletion |
|---|---|---|
| Account ID, email and signup time | Provisionally one year from collection; active-account handling is pending | Account closure or the end of the account purpose |
| Personally linked statistics, including derived metrics | One year from collection | Statistics-consent withdrawal, purpose completion or valid deletion request |
| Diagnostics | One year from collection | Diagnostics-consent withdrawal, purpose completion or valid deletion request |
| General feedback and selected original content | One year from submission | Completion of review or resolution, or valid withdrawal/deletion request |

> **Account retention is still being finalized.** A one-year period from collection also reaches its limit for an account that is still active. The expiry and account-continuity process, or a separately justified rule for necessary account information, must be settled before this notice takes effect. This draft does not authorize arbitrarily ending paid access.

Recalculation, copying or migration does not restart the original retention period. Backup and queued-transmission handling remain to be verified. This plan does not add indefinite retention for anonymous statistics.

Where Korean ecommerce record-keeping duties apply to the operator and the records it holds, contract/withdrawal and payment/supply records are retained for five years, complaint/dispute records for three years, and advertising/display records for six months. These limited exceptions do not extend retention for all statistics or conversation originals. Mandatory records are to be segregated and restricted to their legal purpose. The applicable records and starting dates must be confirmed for the actual operation.

These record periods are described in [Article 6 of Korea's Ecommerce Act Enforcement Decree](https://www.law.go.kr/LSW/lsLinkCommonInfo.do?chrClsCd=010202&lspttninfSeq=63460).

### 6. Korea and the United States

**The planned storage countries are the Republic of Korea and the United States.** This does not mean every field is copied to both countries. Provider-specific entities and contacts, locations, remote access, backups, subprocessors and transfer routes are still being finalized.

Before any international transfer, the necessary notice and legal basis must be established. Where separate transfer consent is required, its notice must explain the data, country, timing, method, recipient and contact, purpose, period, and how refusing affects the service. Optional usage-statistics consent does not substitute for required international-transfer or third-party-disclosure consent.

The account-storage and analytics providers have not yet been named. The actual Gmail and Paddle contracting entities, processing locations, roles and exchanged fields also remain to be confirmed. The Korea/US plan is not a statement that these providers process all information only in those countries. Paddle's independently held records follow its own notice and legal obligations.

### 7. Connected tools, the website and support

Sending a command or selection to the connected Codex conversation is part of the product workflow and is separate from sending usage statistics or feedback to us. Connected tools have their own terms and privacy practices. Actual transferred fields, recipients, triggers and locally retained information need to be checked against the release build.

The app collection table does not fully describe website cookies, access logs, analytics, payment/access verification, additional login-provider fields or support email. Those flows and any additional IP addresses, identifiers, file paths or authentication information require their own accurate disclosure before this notice takes effect. Their absence from the table does not mean they are never processed.

Ordinary support inquiries are planned to be deleted when resolved, within one year, subject to applicable statutory dispute-record duties. Independent third-party disclosure and outsourced processing will be identified separately.

### 8. Your requests and withdrawal

Contact **biadone.official@gmail.com** to request access, correction, deletion, consent withdrawal or restriction of processing, as applicable. Requests require proportionate identity verification and must be handled within the applicable period. The responsible team and in-app privacy-settings route will be specified before these practices take effect.

Under this plan, withdrawal stops the relevant optional collection and transmission. Related personal data should be deleted without undue delay unless a separate lawful retention ground applies. Statistics and diagnostics can be withdrawn independently; feedback and its selected original content can also be requested for deletion.

Privacy requests, local-file deletion and subscription cancellation are separate actions. Uninstalling Blabee or withdrawing optional consent does not itself cancel billing. Billing-management guidance should accompany relevant privacy requests. Deletion jobs, replicas, backups and completion records remain to be verified.

### 9. Children, safeguards and contact

Where applicable law requires verified parental or guardian consent, that process must be completed before the relevant processing. Age and guardian-consent arrangements, access controls, data protection, content filtering and incident/deletion procedures will be described after verification; this draft does not certify those safeguards as implemented.

Privacy and support: **biadone.official@gmail.com** · **+82-10-2491-7742**. Support is available in English and Korean. Korean privacy complaint information is available from the [Privacy Portal](https://www.privacy.go.kr/).

### 10. Changes

Changes to collection, purposes, retention, recipients or consent conditions require an updated notice and any necessary consent before the new processing begins. September 18, 2026 is the draft's revision date, not its effective date.


---

## Terms of Service

> Draft · Not yet in effect. Proposed terms for the future paid beta; operator details and billing flows are still being finalized.

**Effective date:** To be confirmed  
**Product provider:** To be confirmed  
**Business address:** To be confirmed


### 1. About these terms

These terms cover your use of Blabee, a macOS application provided under the Biadone brand by the product provider identified above (“we”, “us”). Purchases made through Paddle are also subject to Paddle’s applicable buyer terms. These terms govern the product relationship with us and do not replace your separate purchase agreement with Paddle.

### 2. Eligibility and supported environment

You must be permitted to use Blabee and the connected external services under applicable law and their respective terms. Minors may use and purchase Blabee where permitted, with any legally required parent or legal-guardian consent. Where a verified parental-consent process is required for personal-data processing, it must be completed before that processing begins.

The current beta is intended for Macs with Apple M3 or later running a supported macOS version (minimum version to be confirmed). Supported tool versions and any additional requirements will be stated before paid access opens. Windows is not part of the current beta. You are responsible for checking compatibility before use.

### 3. Permission to use Blabee

During a valid trial or paid-access period, we grant you a limited, non-exclusive, non-transferable permission to use Blabee on your own supported devices. The subscription is for your use and is not a right to resell or redistribute Blabee or supply access to other people. No numerical device limit is specified in this draft.

Blabee does not impose a separate metered usage cap on the current plan. External service fees, eligibility requirements, rate limits and your device’s capabilities remain relevant.

### 4. External tools

You use your own eligible Codex or Claude Code account, installation and subscription where required. Those products and their charges are not included in your Blabee subscription. You remain bound by their terms. Changes made by external providers may affect compatibility. Review the permissions and results of work performed with external tools and maintain appropriate backups.

### 5. Free trial and the first paid subscription

The free trial lasts 14 days from successful trial activation. The trial-end time will be shown when activation is completed. A card must be registered through the payment flow, but registration alone does not authorize automatic paid conversion under this offer.

The trial does not automatically turn into a paid subscription. You must separately choose and confirm the paid plan before the first subscription payment is taken. Without that choice, paid access does not begin when the trial expires. This does not itself instruct deletion of your local files.

### 6. Price and recurring payments

The current monthly subscription price is US$5.99, including applicable sales taxes, and billing is in USD. When you explicitly start the paid subscription, you authorize the initial payment and subsequent monthly renewal payments until you cancel. The payment-confirmation screen will show the applicable amount and renewal terms.

A subscription provides access during the paid period; it is not a perpetual software license. The initial trial-conversion choice is separate from the recurring-payment authorization you give when starting a paid subscription.

### 7. Cancellation, billing issues and refunds

You may manage and cancel your subscription through Paddle. Cancellation before the next renewal stops future renewal charges, while access continues through the period already paid for. Deleting Blabee from a device does not cancel billing. Contact us if you cannot use the cancellation route.

Our Refund & Cancellation Policy provides a full refund of a payment when you request it within 14 calendar days of that payment, including a renewal payment. Refunds and any statutory remedies remain available as described in that policy and applicable law.

### 8. Beta status and product changes

These draft terms describe the proposed paid beta. Bugs, interruptions and compatibility issues may occur, and its interface and features may evolve. We will describe material limitations honestly and will not treat a future roadmap item as a feature already included in your purchase. Announcing a future feature or platform is not a guaranteed delivery commitment.

A beta label does not waive mandatory quality obligations, refund rights or other non-waivable consumer protections.

### 9. Responsible use and rights

Use Blabee lawfully and do not use it to compromise others’ systems, misuse payment credentials, infringe rights, evade legitimate access controls, or resell access without authorization. Restrictions do not remove activities that applicable law expressly allows. We retain the rights we hold in Blabee; nothing here claims ownership of your independent projects or materials.

We may restrict access where reasonably necessary to address unlawful use or a serious security threat. We will provide an explanation when lawful and practicable. Any action must respect applicable refund rights and non-waivable protections.

### 10. Accounts, privacy and optional consent

User ID, email and account creation time are processed at login. Purposes, grounds and periods are described in the accompanying Privacy Notice. Logging in or accepting these Terms does not constitute consent to optional statistics or diagnostics.

Usage statistics and diagnostics are separate choices. Refusal does not prevent core features, and consent may be withdrawn through the routes in the Privacy Notice. Consent to events such as card selection, approval or rejection is not consent to collect the original text of questions, answers or suggestions.

Feedback is submitted directly by the customer. Original questions, answers or Blabee suggestions may be attached only after a preview and separate consent for that submission, limited to the selected content. Original content is not required for general feedback. Submission does not transfer ownership of work or authorize collection of all future conversations. Process feedback only for the disclosed review and problem-resolution purposes.

The planned storage countries are the Republic of Korea and the United States, with an ordinary retention maximum of one year. The Privacy Notice explains fields, the drafting assumption about the start of retention, earlier deletion, statutory exceptions and the account-retention issue still to be resolved. Paddle and connected tools may have their own independent processing notices.

Consent withdrawal, account closure, personal-data deletion, local-file removal and subscription cancellation are separate actions. Provide billing-management guidance alongside privacy-request routes; uninstalling the app or withdrawing analytics consent does not by itself cancel billing.

### 11. Changes to price or terms

Material changes will be communicated before they apply where required by law. Any necessary agreement or cancellation opportunity will be provided. An updated price will not retroactively change a completed payment. The terms applicable to an existing transaction and any mandatory consumer rights continue to be respected.

### 12. Legal protections and contact

The proposed governing law for the product relationship is the law of the Republic of Korea, without depriving consumers of protections that mandatory law in their place of residence provides. No exclusive foreign forum or waiver of mandatory claims is created by this clause. Paddle’s purchase relationship is governed by its own applicable agreement.

For support, complaints, cancellation assistance or privacy inquiries, contact biadone.official@gmail.com or +82-10-2491-7742. We support English and Korean. We aim to reply promptly but do not promise a fixed response or resolution time.

---

---

## Refund & Cancellation Policy

> Draft · Not yet in effect. Proposed terms for the future paid beta; operator details and billing flows are still being finalized.

**Effective date:** To be confirmed  
**Product provider:** To be confirmed


### 1. Our 14-day refund offer

You may request a full refund of a Blabee subscription payment within 14 calendar days of that payment. The offer applies to the initial payment and to renewal payments, considered separately. The window starts from the payment concerned, not from the start of the free trial.

You do not need to prove a software defect to use this offer. A refund of one payment does not automatically refund unrelated earlier payments.

### 2. How to request a refund

Email biadone.official@gmail.com with the email used for the purchase and, if available, the transaction reference. Tell us which payment you want refunded. We do not require your full card number, security code, password or identity-document image for an ordinary refund request.

You may also use the buyer-support route identified by Paddle in your receipt. We will help identify the transaction and apply this policy with Paddle. Your statutory rights do not depend on supplying a transaction reference that you cannot find.

### 3. Processing and access

Paddle handles the payment refund. Funds are returned through the original payment route where available, subject to payment-provider processing. The date when a refund appears on a statement can differ from the approval date.

When the applicable subscription payment is fully refunded, the access covered by that refund ends and future renewals for that subscription will be canceled. We will communicate the resulting access status. This does not cancel your separate Codex or Claude Code subscriptions.

### 4. Canceling without a refund

You may cancel through Paddle before the next renewal. Future renewals stop, and access continues through the period already paid for. Cancellation alone does not submit a refund request. Uninstalling the app does not cancel your subscription.

### 5. The free trial

No subscription fee is charged during the 14-day free trial. The end of the trial does not by itself authorize a paid subscription. A paid plan begins only after your separate confirmation. Once it begins, monthly renewal continues until canceled.

### 6. Requests outside 14 days and legal protections

This voluntary 14-day offer does not itself promise a refund after its window ends. However, applicable statutory remedies, product-defect rights, and any more protective rights available through Paddle remain unaffected. We do not use a blanket “no refunds” rule to deny rights that cannot lawfully be waived.

---
