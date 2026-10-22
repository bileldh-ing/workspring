# Admin guide

Staff demo accounts (synthetic, password `demo-password-2026`): `admin@` (superadmin), `support@`, `moderator@`, `finance@demo.workspring.test`. Console: `/admin` (also linked from the workspace nav for staff). Non-staff get a 404.

| Page | Permission | Use |
|---|---|---|
| Overview `/admin` | any staff | queue counts, payment provider mode |
| Users `/admin/users` | users.read (suspend: users.suspend, roles: roles.grant) | search; suspend/reinstate with a reason (signs the user out everywhere); grant/revoke staff roles |
| Service moderation `/admin/moderation` | moderation.services | approve and publish, or request changes with a note (the seller is notified) |
| Reviews `/admin/reviews` | moderation.reviews | hide/unhide with a note; ratings are never edited |
| Reports `/admin/reports` | reports.handle | move to reviewing, actioned or dismissed with a resolution note (reporter notified) |
| Support queue `/admin/support` | support.handle | open tickets (viewing is audited), reply as support, resolve/close/reopen |
| Payments & webhooks `/admin/payments` | payments.read | read-only intents and provider webhook log; in test mode, simulate a pending refund's webhook |
| Disputes `/admin/disputes` | disputes.resolve | resolve by allowing release or by provider refund (refunded only after the verified webhook) |
| Audit log `/admin/audit` | audit.read | append-only record of staff and sensitive actions |

Rules: every action requires a reason/note where it affects a user; staff can't change their own status; superadmins can't be suspended from the console; the console never shows passwords, tokens or card data.
