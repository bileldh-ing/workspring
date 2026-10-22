# Client guide

All payments in this build are **TEST MODE**: checkout pages are simulated and no money moves. Demo account: `client-olive@demo.workspring.test` / `demo-password-2026` (synthetic).

1. **Join** at `/join` (choose "hire"), verify your email (in development the link is in `/dev/outbox`).
2. **Post a job**: Workspace → *Post a job* (`/app/jobs/new`). Pick fixed price or hourly, skills, budget, optional screening questions. Save draft, then **Publish** on the job page.
3. **Find and invite talent**: `/talent`, open a profile, use **Invite to a job** (you need an open job).
4. **Review proposals** on your job page: shortlist, decline with a reason, read screening answers and attachments, **Message freelancer**, **Propose interview** (download the `.ics`).
5. **Send an offer** from the proposal: fixed (milestones) or hourly (rate, weekly limit, optional manual time). The freelancer accepts to start the contract.
6. **Fixed price**: in the contract workroom click **Fund … (test)** → simulated provider page → *Simulate: payment succeeded*. The milestone is funded only when the provider webhook is verified. Review deliveries, **Request revision** or **Approve and release payment**. If something goes wrong, **Open dispute** on a funded/submitted milestone.
7. **Hourly**: see time entries and weekly timesheets; **Approve and pay** or **Dispute this week** with a reason.
8. **Services**: browse `/services`, choose a package and add-ons, **Continue to payment**; after payment answer the seller's requirements, then approve or request revisions (`/app/orders`).
9. **Reviews**: after completion leave a review; it appears when the other side reviews too, or after 14 days.
10. **Notifications** (bell in the header), **Support** (`/app/support`), **Settings** (notification preferences, blocked members).
