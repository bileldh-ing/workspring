# Time tracking privacy

- Time is tracked with a **web timer** and (if the client allows it on the offer) **manual entries**. There is no desktop companion app, no screenshots, no keystroke/mouse activity monitoring and no webcam capture.
- The timer only runs while the freelancer has explicitly started it; the workroom shows the running timer and elapsed time. Stopping records whole minutes; a timer that would exceed the weekly limit is trimmed (and the freelancer is told).
- Manual entries are labelled "manual" to both parties.
- Clients see entries (date, minutes, memo) on their own contracts only. Entries are locked once a week's timesheet is submitted; disputes reopen the week for correction with a reason.
- Every change to an entry (memo edit, delete) is recorded in `time_entry_events` for auditability.
- Retention: time entries and timesheets are kept with the contract for accounting; deleted entries are soft-deleted so the audit trail stays intact.
