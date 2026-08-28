# Zyra AI — Current Development State

Last updated: 28 August 2026

This document records the exact current development state of Zyra.

It is intentionally different from `README.md` and `ARCHITECTURE.md`.

- `README.md` explains the product and repository.
- `ARCHITECTURE.md` explains how the system is built.
- `CURRENT_STATE.md` explains exactly where development has reached right now.

This file should be updated whenever a meaningful feature is completed, an important bug is discovered, or the immediate development priority changes.

---

# 1. Current Overall Status

Zyra currently has a functioning AI receptionist and booking engine running in production on Railway.

The current development environment uses a salon as the primary test business, but the architecture is intended to remain industry-agnostic.

The core booking engine currently supports:

- New customer bookings
- Existing customer recognition
- Service recognition
- Provider recognition
- Provider/service compatibility
- Automatic provider assignment
- Availability checking
- Double-booking prevention
- Alternative-time suggestions
- Multi-turn booking conversations
- Previous-booking retrieval
- "Same as last time" bookings
- Appointment rescheduling
- PostgreSQL persistence
- Multi-business database structure
- Website chat widget

The system is no longer just a simple OpenAI chat endpoint.

Important booking decisions are increasingly controlled by deterministic backend/database logic rather than allowing the AI model to decide everything.

---

# 2. Current Production Application

Main Railway application:

`https://zyra-master-bot-production.up.railway.app`

Main chat endpoint:

`POST /chat`

Main GitHub repository:

`zyra-master-bot`

Main backend file:

`index.js`

Railway deploys the application from GitHub.

Normal deployment process:

1. Commit changes to GitHub.
2. Railway detects/deploys the commit.
3. Wait until Railway shows the deployment as `Active`.
4. Test the affected functionality.
5. Verify database changes in Beekeeper Studio when appropriate.

---

# 3. Current Database

Zyra uses PostgreSQL hosted on Railway.

The database is currently inspected during development using Beekeeper Studio.

Current important tables:

- `businesses`
- `clients`
- `services`
- `providers`
- `provider_services`
- `bookings`

This is more advanced than the original Zyra architecture, which initially contained only businesses, clients and bookings.

The current database therefore supports service and provider relationships.

---

# 4. Multi-Business Foundation

Zyra is being built as one SaaS platform capable of serving many businesses.

The intended architecture is:

One codebase.

One core booking engine.

Multiple businesses.

Separate business data.

Important database records are associated with a `business_id`.

Business slugs are also supported by the backend.

The current test business uses a default business slug when one is not explicitly supplied.

The long-term goal is NOT to create and maintain a separate source-code repository for every Zyra customer.

Business-specific configuration should eventually come from the database and owner dashboard.

---

# 5. Current Test Environment

The current primary development/test environment is salon based.

Example services currently include:

- Haircut
- Hair Colour
- Blow Dry

Other businesses/services also exist in the shared development database.

Example salon providers include:

- Olivia
- Emma
- Sophia

The provider/service relationships are deliberately different so Zyra can be tested against provider compatibility rules.

For example, Olivia can perform Haircut.

Emma does not currently perform Haircut.

Provider/service eligibility is stored through the `provider_services` table.

---

# 6. Provider/Service Compatibility — WORKING

Zyra checks whether a requested provider actually performs the requested service.

This has been tested successfully.

Example test:

Customer:

`My name is Sarah, I want a Haircut with Emma on Monday at 5pm. My number is 07234567890`

Zyra correctly identified that Emma does not offer Haircut and offered Olivia instead.

The customer then replied:

`Yes, book me with Olivia at 5pm`

Zyra correctly retained the original booking context instead of asking the customer which service they wanted again.

This required storing the original booking information in `pendingBookings` when a provider/service mismatch causes the AI to respond conversationally rather than returning booking JSON.

This bug is FIXED.

---

# 7. Provider Override During Multi-Turn Booking — WORKING

A previous issue existed where a provider stored in a pending booking could override a new provider explicitly selected by the customer.

The provider-selection logic was changed so an explicitly mentioned provider in the current customer message takes priority.

Current intended priority:

1. Provider explicitly mentioned in the current message.
2. Provider stored in pending booking state.
3. Automatic eligible-provider assignment if necessary.

This allows conversations such as:

Customer:

`I want Haircut with Emma`

Zyra:

`Emma doesn't offer Haircut. Olivia does. Would you like Olivia instead?`

Customer:

`Yes, book me with Olivia`

to correctly switch from Emma to Olivia.

This behavior has been tested successfully.

---

# 8. Availability and Double-Booking Prevention — WORKING

Zyra checks existing bookings before creating a new appointment.

Availability checking currently considers:

- `business_id`
- `provider_id`
- Date
- Time
- Booking status

The booking conflict query filters active bookings using:

`status = 'booked'`

Date comparison was changed to use case-insensitive comparison where appropriate:

`LOWER(date) = LOWER($3)`

This fixed an earlier date-matching issue.

If the requested provider/time is occupied, Zyra does not create a conflicting booking.

Instead, it can suggest alternative times.

---

# 9. Alternative-Time Follow-Up — WORKING

The alternative-time conversation flow has been tested successfully.

Example:

A customer attempted to book Olivia at 5pm.

Zyra correctly detected that Olivia was already booked.

Zyra responded with available alternatives:

`4pm or 7pm`

Customer replied:

`4pm please`

Zyra retained:

- Customer
- Service
- Provider
- Date
- Phone

and changed only the time.

The booking was then confirmed for 4pm.

This demonstrates that pending booking context survives an availability conflict.

---

# 10. Automatic Provider Assignment — WORKING

A customer does not have to specify a provider.

Example tested:

Customer:

`My name is Lucy. I want a Haircut on Wednesday at 3pm. My number is 07456789012`

Zyra successfully assigned an eligible provider automatically.

In the test, Olivia was assigned.

The customer was booked without Zyra unnecessarily asking them to choose a provider.

This is the intended behavior.

---

# 11. Returning Customer Recognition — WORKING

Zyra can identify an existing customer using their phone number.

Example tested:

Customer:

`07456789012`

Zyra correctly recognised the stored client as Lucy and responded approximately:

`Welcome back Lucy — would you like to book Haircut with Olivia again?`

This demonstrates that:

- Existing client lookup works
- Previous booking retrieval works
- Customer name retrieval works
- Previous service retrieval works
- Previous provider retrieval works

Known customer information should be reused rather than creating unnecessary duplicate clients.

---

# 12. "Same As Last Time" — WORKING

Returning customers can use shorthand booking language.

Example tested:

Customer identifies themselves using their phone number.

Zyra retrieves the previous booking.

Customer:

`Yes, same again Friday at 4pm`

Zyra successfully reused:

- Haircut
- Olivia

and applied:

- Friday
- 4pm

The new appointment was successfully booked.

This behavior is currently working.

---

# 13. Rescheduling — CURRENT STATUS

Rescheduling has been implemented.

Zyra can locate the latest active booking for a known client and update that booking rather than automatically creating a new booking.

Important backend functionality includes a helper similar to:

`getLatestActiveBookingForClient(...)`

The backend also detects rescheduling intent.

Examples include language such as:

- move my appointment
- reschedule
- change my appointment

The intended behavior is to preserve:

- Client
- Phone
- Service
- Provider

unless the customer explicitly requests a change to one of those fields.

---

# 14. Multi-Turn Rescheduling — WORKING CONVERSATION FLOW

A two-turn rescheduling flow has now been tested.

Existing customer:

Lucy

Existing appointment:

Haircut with Olivia on Friday at 4pm.

Customer asked:

`Can you move my Friday appointment to Saturday?`

Zyra correctly interpreted Saturday as the NEW requested date.

Zyra replied:

`What time would you like for your appointment on Saturday?`

Customer replied:

`5pm please`

Zyra responded:

`You're booked for Haircut with Olivia on Saturday at 5pm under Lucy.`

This demonstrates that the conversational rescheduling flow is now behaving correctly.

---

# 15. Rescheduling Date Extraction Bug — FIXED

A bug previously existed in `extractDateFromText()`.

For a message such as:

`Can you move my Friday appointment to Saturday?`

the old logic returned the first weekday it found in its predefined weekday array rather than understanding which date represented the requested destination.

This caused Zyra to incorrectly ask:

`What time would you like for your appointment on Friday?`

instead of Saturday.

`extractDateFromText()` was updated to choose the relevant/latest date reference from the message.

After deployment, the exact same test correctly produced:

`What time would you like for your appointment on Saturday?`

This bug is FIXED.

---

# 16. Rescheduling Database Verification — NEXT CHECK

The conversational rescheduling flow is working.

However, the latest Lucy rescheduling test still needs to be verified directly in PostgreSQL using Beekeeper Studio.

The exact scenario to verify is:

Original booking:

- Lucy
- Haircut
- Olivia
- Friday
- 4pm

Requested change:

- Saturday
- 5pm

Expected database result:

The existing booking should be UPDATED to Saturday at 5pm.

The system should NOT create an additional duplicate appointment while leaving the Friday booking active.

This database verification is the immediate next development check.

Do not mark the complete rescheduling system fully verified until this database state has been inspected.

---

# 17. Pending Booking State

Zyra currently uses an in-memory JavaScript `Map` named:

`pendingBookings`

This allows booking details to survive across multiple messages.

Examples where this is currently important:

- Provider/service mismatch
- Alternative-time selection
- Multi-turn rescheduling
- Other incomplete booking conversations

Pending booking records can contain information such as:

- Creation timestamp
- Customer name
- Phone
- Service
- Date
- Time
- Notes
- Provider ID
- Reschedule state
- Existing booking ID

Pending state has a TTL/cleanup mechanism.

---

# 18. Session Memory

Zyra also currently uses temporary in-memory session state.

This is used to retain information during conversational interactions.

This architecture is currently useful for development but is NOT the final production session architecture.

Important limitation:

In-memory state disappears if the Railway process restarts.

This must eventually be replaced or supplemented with persistent session storage.

---

# 19. Temporary IP-Based Conversation Key

During development, a bug existed because pending booking state was sometimes stored using a phone-based key but later messages without a phone number attempted to retrieve it using an IP-based key.

This caused context to disappear between messages.

A temporary development fix changed pending booking identification to consistently use the request IP.

This solved the immediate multi-turn problem.

However:

IP address is NOT suitable as the final production conversation identity.

Multiple customers can share the same public IP address.

The production widget should eventually generate a stable unique browser/session ID and send it with every request.

This is known technical debt.

---

# 20. Time Extraction

Zyra contains backend time-normalisation/extraction logic.

An important issue occurred because the widget may preserve or append customer phone information to subsequent backend messages.

For example, the backend could receive something similar to:

`8pm 07123456789`

Passing an entire string like this directly into simple time normalisation can fail.

Time extraction was therefore separated so Zyra can extract the time from conversational text rather than requiring the whole message to contain only a time.

This functionality must be preserved.

---

# 21. Date Extraction

Zyra currently supports conversational date text including weekday names.

Examples:

- Monday
- Tuesday
- Wednesday
- Thursday
- Friday
- Saturday
- Sunday
- next Monday
- tomorrow
- today

Current date handling remains text based in parts of the system.

This works for current development tests but is known technical debt.

A production-grade scheduling engine should eventually resolve customer dates into proper calendar dates while respecting:

- Current date
- Business timezone
- Future/past interpretation
- Opening hours
- Calendar rules

---

# 22. Booking Confirmation

Successful bookings currently generate customer-facing confirmation messages containing:

- Service
- Provider
- Date
- Human-readable time
- Customer name

Example:

`You're booked for Haircut with Olivia on Saturday at 5pm under Lucy.`

Internal provider IDs must never be exposed to customers.

---

# 23. Current Website Widget

Zyra has a functioning website chat widget.

Development testing currently uses:

`widget-test.html`

opened locally in Safari.

The test page simulates a customer website.

The widget currently displays a floating chat interface and communicates with the production Zyra backend.

The current design is functional but is NOT the final premium Zyra interface.

A future design phase should significantly improve:

- Branding
- Typography
- Spacing
- Animation
- Mobile experience
- Business customisation
- Accessibility
- Conversation polish

---

# 24. Widget Architecture

The widget uses an iframe-based architecture.

This is intentional because it helps isolate Zyra's UI and CSS from the host business website.

This architecture should generally be preserved unless there is a strong technical reason to change it.

The production widget should eventually be configurable per business.

Possible future configuration:

- Business slug
- Business name
- Logo
- Accent colour
- Welcome message
- Widget position
- Theme
- Channel/session identifier

---

# 25. Beekeeper Studio

Beekeeper Studio is currently used to inspect the Railway PostgreSQL database.

This is an established part of the Zyra development workflow.

Current database connection points to the Railway PostgreSQL database.

Visible tables include:

- `bookings`
- `businesses`
- `clients`
- `provider_services`
- `providers`
- `services`

Use Beekeeper Studio when verifying whether backend behavior actually changed database records correctly.

Do not assume a successful chat confirmation proves the database operation was correct.

---

# 26. OpenAI's Current Role

OpenAI is used for conversational understanding.

The model helps interpret natural customer language and determine whether more information is needed.

However, business-critical rules should increasingly be handled outside the model.

Backend logic should remain authoritative for:

- Availability
- Provider/service eligibility
- Provider assignment
- Double-booking prevention
- Client matching
- Business separation
- Database updates
- Rescheduling existing bookings

This separation is important for reliability.

---

# 27. Current Booking JSON Pattern

When enough information exists, the OpenAI flow can produce booking data with fields similar to:

{
  "name": "<name>",
  "phone": "<phone>",
  "service": "<service>",
  "date": "<date>",
  "time": "<time>",
  "notes": "<notes or empty string>"
}

The backend parses and validates this information before continuing with the booking workflow.

Not every conversation produces JSON.

Some situations intentionally produce conversational text.

The backend therefore also contains deterministic logic for maintaining state when OpenAI responds conversationally.

---

# 28. Returning Customer Name Protection

A previous problem allowed a returning customer to be treated as:

`New Client`

even when their stored client record was known.

Current backend logic protects against this.

If a known client exists and the booking name is missing or incorrectly represented as `New Client`, Zyra should use the stored client name.

This behavior should be preserved.

---

# 29. Client Reuse

When creating bookings, Zyra checks whether a client already exists for the relevant business and phone number.

Existing customers should reuse their existing client record.

This avoids creating unnecessary duplicate client rows for repeat bookings.

The booking then references the appropriate `client_id`.

---

# 30. Provider Selection Priority

Current provider-selection behavior should follow this principle:

If the customer explicitly names a provider in the current message, that choice takes priority.

If no new provider is mentioned, Zyra may retain the provider from pending context.

If no provider has been requested, Zyra may automatically assign an eligible provider.

This rule is important and should not be accidentally removed during future refactoring.

---

# 31. Current Major Working Regression Scenarios

The following scenarios have recently worked and should be treated as regression tests.

## Test A — Invalid Provider for Service

Customer requests Haircut with Emma.

Expected:

Zyra explains Emma cannot perform Haircut and offers an eligible provider.

## Test B — Accept Alternative Provider

After Zyra offers Olivia:

Customer:

`Yes, book me with Olivia at 5pm`

Expected:

Zyra remembers the original service/date/customer information.

It must NOT ask which service the customer wants again.

## Test C — Requested Provider Unavailable

If Olivia is already booked at the requested time:

Expected:

Zyra does not double-book Olivia.

It offers alternative available times.

## Test D — Accept Alternative Time

Customer:

`4pm please`

Expected:

Zyra retains all previous booking information and books the alternative time.

## Test E — Valid Provider Booking

Customer explicitly requests an eligible provider/service combination.

Expected:

Booking completes normally.

## Test F — No Provider Specified

Customer requests Haircut without naming a provider.

Expected:

Zyra automatically assigns an eligible provider rather than unnecessarily asking the customer to choose one.

## Test G — Returning Customer

Customer sends known phone number.

Expected:

Zyra recognises their stored name and previous booking.

## Test H — Same Again

Returning customer:

`Yes, same again Friday at 4pm`

Expected:

Previous service/provider are reused with the requested new date/time.

## Test I — Reschedule Date Only

Customer:

`Can you move my Friday appointment to Saturday?`

Expected:

Zyra asks for the desired time on SATURDAY.

It must not incorrectly ask for a time on Friday.

## Test J — Complete Reschedule

Customer then:

`5pm please`

Expected:

Zyra confirms the existing service/provider appointment for Saturday at 5pm.

Database must be checked to ensure the original booking was updated rather than duplicated.

---

# 32. Immediate Next Action

The immediate next action is NOT another code change.

Open Beekeeper Studio and inspect Lucy's bookings.

Verify the result of the latest rescheduling test.

Expected:

Lucy should have the relevant Haircut appointment with Olivia on:

Saturday at 5pm.

The previous Friday 4pm appointment that was being rescheduled should NOT remain as a separate active booking.

If the database is correct:

Mark the rescheduling workflow as verified.

If the database contains both appointments:

The next task is to debug the reschedule UPDATE path before continuing to another feature.

---

# 33. Current Development Priority

Current priority remains:

CORE RECEPTIONIST RELIABILITY.

Do not move into retention/growth functionality yet.

The booking engine needs to become extremely reliable first.

Priority areas include:

1. Booking correctness
2. Rescheduling correctness
3. Availability correctness
4. Provider/service correctness
5. Returning-customer behavior
6. Conversation state reliability
7. Cancellation
8. Business hours
9. Proper calendar dates/timezones
10. Production session architecture

Only after the receptionist foundation is strong should Zyra move heavily into retention and growth automation.

---

# 34. Features Not Yet Built

Important functionality still to build includes:

- Production owner dashboard
- Zyra-hosted owner calendar
- Production business onboarding
- Business authentication
- Business opening hours
- Provider working hours
- Provider days off
- Service alias management
- Customer cancellation flow
- Persistent production sessions
- Proper browser/session IDs
- Production-grade date resolution
- Business timezone handling
- SMS confirmations
- SMS reminders
- WhatsApp
- Instagram messaging
- Post-appointment follow-ups
- Rebooking campaigns
- Customer reactivation
- Upselling
- Retention automation
- Payments
- Advanced reporting
- Final premium widget design
- Mobile application

These should not be mistaken for forgotten requirements.

They are future development work.

---

# 35. Important Temporary Architecture

The following should NOT be mistaken for final production architecture.

## IP-Based Conversation Identity

Temporary.

Replace with stable session IDs.

## In-Memory Pending Bookings

Temporary.

Needs durable production strategy.

## In-Memory Session Memory

Temporary.

Lost during process restart.

## Text-Based Dates

Useful for development but not sufficient for production scheduling.

## Development Widget Design

Functional prototype only.

## Beekeeper as Owner Interface

Beekeeper is a developer database tool.

It is NOT the future business-owner booking interface.

---

# 36. Product Direction That Must Be Preserved

Zyra should remain:

- Multi-business
- Multi-provider
- Industry-agnostic
- Mobile-first
- Premium
- Configurable
- Reliable
- Low-friction for business owners

The product should NOT require normal business owners to:

- Edit source code
- Use Beekeeper Studio
- Manage PostgreSQL manually
- Understand provider IDs
- Configure Railway
- Edit GitHub files

Those are development tools only.

The future Zyra dashboard should hide this technical complexity.

---

# 37. Owner Experience Direction

The intended owner experience is a dedicated Zyra interface.

The business owner should eventually be able to open Zyra and:

- See today's appointments
- View future bookings
- View customers
- Manage services
- Change prices
- Add/remove providers
- Set provider services
- Configure hours
- Configure aliases
- Manage business settings

This should feel like a professional application rather than a raw database or browser utility.

---

# 38. Calendar Direction

The current preferred product direction is a Zyra-hosted booking/calendar experience.

Google Calendar should not be required as the primary owner experience.

Optional external calendar integrations may be considered later.

The first goal is to create a clean, purpose-built Zyra booking viewer/calendar.

---

# 39. Business Onboarding Direction

Eventually a new business should be onboarded through configuration rather than source-code duplication.

The business should provide information such as:

- Business name
- Services
- Prices
- Durations
- Providers
- Provider/service relationships
- Opening hours
- Provider hours
- Service aliases
- Contact information
- AI/business preferences

Zyra should store this information and use the same master booking engine.

---

# 40. Service Alias Requirement

Business owners should eventually be able to configure their own service terminology.

Example:

Canonical service:

`Haircut`

Aliases might include:

- trim
- cut
- tidy up

This should be editable from the dashboard without modifying `index.js`.

This requirement must be preserved for future development.

---

# 41. Retention/Growth Direction

After the receptionist engine is reliable, Zyra should evolve beyond booking.

The future retention layer should be capable of:

- Detecting when customers are due to return
- Sending intelligent rebooking messages
- Following up after appointments
- Reactivating inactive customers
- Suggesting relevant services
- Upselling appropriately
- Improving customer retention
- Helping businesses increase revenue

The long-term product is therefore broader than an appointment chatbot.

---

# 42. Documentation as Permanent Project Memory

The GitHub repository should be treated as Zyra's durable project memory.

Important documentation currently includes:

- `README.md`
- `ARCHITECTURE.md`
- `CURRENT_STATE.md`

Planned documentation should include:

- `DECISIONS.md`
- `TESTS.md`
- `NEXT_STEPS.md`

These documents should be maintained alongside the code.

Future developers or AI development sessions should read them before making significant architectural assumptions.

---

# 43. Source-of-Truth Order

If information conflicts, use the following priority:

1. Current production source code in GitHub
2. Current PostgreSQL schema/data
3. Current Railway configuration/logs
4. `ARCHITECTURE.md`
5. `CURRENT_STATE.md`
6. `README.md`
7. Older development notes/conversation history

Documentation should be updated whenever it becomes inconsistent with the implementation.

Do not guess when the repository or database can provide the answer.

---

# 44. Development Safety Rule

Do not perform large blind rewrites of `index.js`.

The file now contains many interconnected working features.

A replacement that is dramatically shorter may accidentally remove:

- Returning customer logic
- Provider compatibility
- Availability checking
- Rescheduling
- Pending booking state
- Session state
- Conflict prevention
- Provider assignment
- Client reuse
- Business isolation

Preferred development method:

One bug.

One understood cause.

One controlled change.

Deploy.

Test.

Verify.

Then continue.

---

# 45. Exact Point Development Has Reached

As of 28 August 2026:

The latest deployed code successfully fixed the rescheduling date-extraction bug.

The test:

`Can you move my Friday appointment to Saturday?`

now correctly produces:

`What time would you like for your appointment on Saturday?`

The follow-up:

`5pm please`

successfully produced a booking confirmation for:

- Lucy
- Haircut
- Olivia
- Saturday
- 5pm

The NEXT thing to do is verify this directly in the PostgreSQL `bookings` table using Beekeeper Studio.

That is the exact current stopping point.

---

# End of CURRENT_STATE.md
