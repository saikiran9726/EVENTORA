# Eventora — UI Route Family Inventory

**Specification Source:** `Eventora_20x_Master_Blueprint_Antigravity.pdf` (Appendix B, Pages 27–28)

---

## Complete Route Family to Screen Mapping

| Role / Domain | Route URL | Target View / Screen Component | Mapped Workflow & Blueprint Requirements | Status |
| :--- | :--- | :--- | :--- | :--- |
| **Public** | `/` | `DiscoveryPage` | Landing, featured campus events, search & category navigation, participating colleges | Verified (Phase 1) |
| **Public** | `/events/:id` | `EventDetailsPage` | Event details, schedule, venue navigator, ticket tiers, test mode disclaimer, share | Verified (Phase 1) |
| **Public** | `/colleges` | Planned (`CollegesDirectoryPage`) | Opt-in participating institutions, public college profile, verified organizer badges | Planned (Phase 10) |
| **Public / Auth** | `/login`, `/register` | Planned (`AuthPage`) | Session sign-in, college identity verification, Argon2id passwords | Planned (Phase 2) |
| **Student** | `/me/events` | Planned (`StudentRegistrationsPage`)| Upcoming registered events, QR ticket display, cancel booking | Planned (Phase 4/6) |
| **Student** | `/me/passport` | Planned (`EventPassportPage`) | Verified attendance records, volunteer hours, certificates, public sharing controls | Planned (Phase 10) |
| **Student** | `/p/:username` | Planned (`PublicPassportPage`) | Publicly shareable student event portfolio (only verified records, toggleable) | Planned (Phase 10) |
| **Student** | `/teams` | Planned (`TeamsHubPage`) | Create team, manage members, send invitations, review join requests, project submissions| Planned (Phase 4) |
| **Student** | `/checkout/:id` | Planned (`TestCheckoutPage`) | Test-mode simulated payment simulator, server-calculated totals in paise, receipts | Planned (Phase 5) |
| **Student** | `/me/notifications`| Planned (`NotificationCenterPage`)| In-app alerts, read/unread states, urgent event changes, waitlist offers | Planned (Phase 9) |
| **Organizer** | `/organizer/dashboard`| `OrganizerDashboardPage` | Overview metrics, registrations, attendance %, simulated gross sales, waitlist queue | Verified (Phase 1) |
| **Organizer** | `/organizer/events/new`| Planned (`EventProposalFormPage`)| Event creation wizard, ticket tier definition, capacity, date/time, venue request | Planned (Phase 3) |
| **Organizer** | `/organizer/events/:id/roster`| `OrganizerDashboardPage` (Table) | Attendee roster, check-in timestamps, search & CSV export | Verified (Phase 1) |
| **Organizer** | `/organizer/events/:id/volunteers`| Planned (`VolunteerManagePage`)| Volunteer role creation, shifts, applicant approvals, assignment capacities | Planned (Phase 8) |
| **Organizer** | `/organizer/events/:id/insights`| Planned (`OrganizerInsightsPage`)| Analytics breakdown, conversion rates, feedback ratings with response count | Planned (Phase 7) |
| **Faculty Reviewer**| `/reviewer/queue` | `App` (Reviewer View) | Proposal approval queue, venue conflict pre-check, approve / request changes / reject | Verified (Phase 1) |
| **Check-in Staff**| `/scanner` | `App` (Scanner View) | Digital QR ticket scanner, rapid validation, sound feedback, duplicate alerts | Verified (Phase 1) |
| **Check-in Staff**| `/scanner/offline` | Planned (`OfflineScannerPage`)| Offline manifest cache, local indexedDB persistence, reconnection batch sync | Planned (Phase 9) |
| **Administrator** | `/admin/hub` | `App` (Admin View) | Global policy governance, organizer verification, audit logs, health metrics | Verified (Phase 1) |
| **System** | `/ui-tokens` | `ComponentGalleryPage` | Interactive design system token showcase, form validation, modals, skeletons, dark mode | Verified (Phase 1) |
