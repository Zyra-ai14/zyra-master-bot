# Zyra Master Bot — System Architecture

Last updated: August 2026

This document is the technical source of truth for the current Zyra system.

Its purpose is to allow a developer — or a future ChatGPT session — to understand how Zyra is built, where its data lives, what functionality already exists, what is temporary, and how the different parts of the system interact.

Do not assume older architectural notes are still correct if they conflict with this document.

---

# 1. What Zyra Is

Zyra is a multi-business AI receptionist and booking system for service-based businesses.

The initial test environment is salon/hair-service based, but the architecture is intended to remain industry-agnostic.

The core entities are:

- Business
- Client
- Service
- Provider
- Booking

Zyra is intended to eventually handle:

- Customer questions
- Service discovery
- Pricing
- Appointment booking
- Provider selection
- Provider availability
- Returning-customer recognition
- Rescheduling
- Booking confirmations
- Reminders
- SMS / WhatsApp communication
- Follow-up and retention campaigns
- Business owner booking management
- Multi-business SaaS operation

The long-term goal is not simply a chatbot.

Zyra is intended to become an AI operations layer capable of performing much of the work normally handled by a front desk.

---

# 2. Current Technology Stack

The current system uses:

- Node.js
- Express
- PostgreSQL
- OpenAI API
- Railway
- GitHub
- Beekeeper Studio
- HTML / JavaScript website widget
- A secondary Bun booking microservice

GitHub contains the Zyra source code.

Railway hosts the production services and PostgreSQL database.

Beekeeper Studio is used to directly inspect and manage the Railway PostgreSQL database during development.

OpenAI is used for natural-language interpretation where deterministic backend logic is not sufficient.

---

# 3. Main GitHub Repository

Main repository:

`zyra-master-bot`

Important files currently include:

`index.js`

Main Express backend.

This contains most of the current Zyra booking, client, provider, service, availability, session and OpenAI logic.

`public/`

Contains files served publicly by Express.

This includes the website chat widget system.

`public/widget.js`

Loads the Zyra website widget.

The current widget uses an iframe-style architecture so the Zyra interface remains isolated from the client website's own CSS and JavaScript.

`ARCHITECTURE.md`

This document.

It describes how the current system is built.

`README.md`

General repository information.

---

# 4. Hosting and Deployment

The Zyra Master Bot is hosted on Railway.

Production backend:

`https://zyra-master-bot-production.up.railway.app`

Main chat endpoint:

`POST /chat`

The project is connected to GitHub.

Typical deployment flow:

1. Edit code in GitHub.
2. Commit the changes.
3. Railway detects or receives the new GitHub commit.
4. Railway builds the application.
5. Railway deploys it.
6. The Railway deployment should show `Active`.
7. Test the change through the Zyra widget.

If a deployment fails, check Railway deployment logs before changing code again.

Common past deployment failures have included JavaScript syntax errors.

---

# 5. Database

Zyra uses PostgreSQL hosted by Railway.

The production database is inspected during development using Beekeeper Studio.

Beekeeper Studio is an established part of the Zyra development workflow.

If a booking needs to be verified directly in the database, use Beekeeper Studio rather than assuming the chat confirmation proves the database state.

The current main tables are:

## businesses

Stores each business using Zyra.

Important fields include:

- id
- name
- slug
- created_at

The business slug allows the same Zyra backend to serve different businesses.

---

## clients

Stores customers belonging to each business.

Important fields include:

- id
- business_id
- name
- phone
- notes
- created_at

Clients are associated with a business.

Phone number is currently one of the main ways returning customers are identified.

A returning customer should reuse the existing client record rather than create a duplicate client every time they book.

---

## services

Stores services offered by a business.

Important fields include fields such as:

- id
- business_id
- name
- description
- price_cents
- duration_minutes

Services are business-specific.

Example salon test services currently include services such as:

- Haircut
- Hair Colour
- Blow Dry

Other test businesses may have completely different services.

---

## providers

Stores members of staff / service providers.

A provider belongs to a business.

Examples in the salon test data include providers such as:

- Olivia
- Emma
- Sophia

Providers must never be exposed to customers using internal database IDs.

Customers should only see human-readable provider names.

---

## provider_services

Join table connecting providers to the services they are allowed to perform.

This is important because not every provider necessarily performs every service.

For example:

A customer may request:

`Haircut with Emma`

If Emma does not perform Haircut but Olivia does, Zyra should not incorrectly book Emma.

Instead Zyra should explain that Emma does not offer that service and offer an appropriate alternative provider.

This provider/service mapping is enforced by backend logic and database data.

---

## bookings

Stores appointments.

Important booking information includes fields such as:

- id
- business_id
- client_id
- provider_id
- service
- date
- time
- notes
- status
- created_at

The exact database schema should always be checked directly if new fields are added.

The `bookings` table is the primary source for determining whether a provider is already booked.

---

# 6. Multi-Business Architecture

Zyra is designed as one master system serving multiple businesses.

It should not become a separate codebase for every salon, barber, clinic or service business.

Incoming chat requests can include a business slug.

The backend resolves the correct business from that slug.

A default test business slug is currently used when a business slug is not supplied.

Business-specific data includes:

- Services
- Prices
- Providers
- Provider/service mappings
- Clients
- Bookings

The long-term onboarding model is:

Master Zyra system
→ create/configure new business
→ enter services
→ enter pricing
→ enter providers
→ enter provider capabilities
→ enter business hours/settings
→ activate Zyra for that business

Business configuration should eventually happen through an owner dashboard rather than by editing code.

---

# 7. Main Chat Endpoint

The main customer-facing backend route is:

`POST /chat`

A request contains information such as:

{
  "message": "I want a haircut Friday at 4pm",
  "businessSlug": "example-business"
}

The backend processes the message using a mixture of:

- deterministic JavaScript logic
- database lookups
- temporary conversation/session state
- OpenAI

The goal is not to let the AI freely control booking logic.

Important booking rules are enforced by the backend.

---

# 8. Booking Flow

A typical first-time booking may contain:

- Name
- Phone number
- Service
- Date
- Time
- Optional provider

Example:

`My name is Sarah. I want a Haircut with Olivia on Monday at 5pm. My number is 07234567890`

Zyra attempts to determine:

- Business
- Client
- Service
- Provider
- Date
- Time
- Availability

If all required information is present and valid, the booking can be processed.

If something is missing, Zyra asks for the missing information.

The system should not ask unnecessary questions.

For example, if a provider is not specified, Zyra can assign an appropriate provider rather than forcing the customer to choose one.

---

# 9. OpenAI's Role

OpenAI is used to understand natural customer language and produce conversational responses or structured booking information.

The OpenAI system prompt includes rules around:

- Services
- Prices
- Booking details
- Provider names
- Returning customers
- Same-as-last-time requests
- Rescheduling
- Missing booking details
- Structured booking JSON

Where enough booking information exists, OpenAI may return booking JSON.

Example structure:

{
  "name": "Jane",
  "phone": "07123456789",
  "service": "Haircut",
  "date": "friday",
  "time": "4pm",
  "notes": ""
}

The backend parses this JSON.

OpenAI is not the final authority on:

- whether a provider performs a service
- whether a provider is available
- whether a booking conflicts
- which database record should be updated

Those checks belong to backend/database logic.

---

# 10. Deterministic Input Extraction

Some important booking information is also extracted directly by JavaScript instead of relying only on OpenAI.

Current helpers include functionality for:

- Phone extraction
- Time extraction
- Time normalization
- Date extraction
- Service matching
- Provider matching

Examples include:

`extractTimeFromText()`

Used to find time expressions even when the customer message contains other information.

This became necessary because a message may contain text such as:

`8pm 07123456789`

Simply attempting to normalize the entire message as a time would fail.

---

`extractDateFromText()`

Extracts date/day expressions such as:

- today
- tomorrow
- monday
- friday
- next monday

The function was updated after discovering a rescheduling bug.

Example problematic message:

`Can you move my Friday appointment to Saturday?`

The old function returned the first weekday it found based on the weekday array and therefore incorrectly selected Friday.

The current version selects the latest relevant weekday mention in the sentence, meaning the example above correctly resolves to Saturday.

This behavior must be preserved.

---

# 11. Provider Matching

Zyra supports customers requesting a specific provider.

Example:

`Book me with Olivia`

The backend checks the current message for provider names.

Current-message provider choices take priority over providers stored in pending conversation state.

This is important during correction flows.

Example:

Customer:

`I want a Haircut with Emma on Monday at 5pm`

Zyra determines Emma does not offer Haircut and proposes Olivia.

Customer:

`Yes, book me with Olivia at 5pm`

The explicit current message choice `Olivia` must override the previously stored provider `Emma`.

This behavior has been implemented and tested.

---

# 12. Provider / Service Compatibility

Before booking a requested provider, Zyra checks whether that provider offers the requested service.

Example:

Customer requests:

`Haircut with Emma`

If Emma does not offer Haircut, Zyra should respond conversationally and offer another valid provider.

The booking must not be incorrectly written under Emma.

A previous bug occurred because the AI correctly explained the mismatch but the backend did not preserve the original booking details.

The backend now stores those booking details in temporary pending state so the customer can answer:

`Yes, book me with Olivia at 5pm`

without having to repeat:

- name
- phone
- service
- date

This flow has been tested successfully.

---

# 13. Automatic Provider Assignment

A customer does not have to choose a provider.

Example:

`My name is Lucy. I want a Haircut on Wednesday at 3pm. My number is 07456789012`

If the requested service is valid and an eligible provider exists, Zyra can assign an appropriate provider automatically.

This flow has been tested successfully.

---

# 14. Availability and Double-Booking Protection

Before confirming a booking, Zyra checks the `bookings` table.

The conflict check considers:

- business_id
- provider_id
- date
- time
- booking status

Current booking conflict logic uses booked appointments only.

Date comparisons have previously been changed to case-insensitive comparisons because dates may currently be stored in text form such as:

`Monday`

or:

`monday`

The current SQL behavior must therefore be preserved unless date storage is later redesigned.

A typical conflict query follows the logic:

SELECT id
FROM bookings
WHERE business_id = $1
  AND provider_id = $2
  AND LOWER(date) = LOWER($3)
  AND time = $4
  AND status = 'booked'
LIMIT 1

If the requested slot is unavailable, Zyra can suggest alternative available times.

Example tested flow:

Customer requests Olivia at 5pm.

Olivia is already booked.

Zyra responds with available alternatives such as:

`4pm or 7pm`

Customer replies:

`4pm please`

Zyra carries forward the pending booking information and completes the booking.

---

# 15. Pending Booking State

Multi-turn booking conversations require temporary state.

The backend currently uses an in-memory `pendingBookings` Map.

Pending information may include:

- createdAt
- name
- phone
- service
- date
- time
- notes
- providerId
- whether the action is a reschedule
- existing booking ID

Pending state is used for flows such as:

- provider correction
- unavailable time suggestions
- multi-turn rescheduling
- missing date/time completion

Pending entries have a TTL / cleanup mechanism so temporary data does not remain indefinitely.

---

# 16. Current Temporary Session Identification

The current pending/session implementation temporarily uses the user's IP address as the conversation key.

The current helper effectively creates a key like:

`business-slug::ip::user-ip`

This was introduced as an MVP fix because phone-based pending keys caused a multi-turn mismatch.

Example of the previous problem:

First message contained phone
→ pending data stored under phone key

Second message did not contain phone
→ backend searched using IP key

Result:
pending context appeared to disappear.

Using IP fixed that immediate problem.

However, IP-based session identification is NOT suitable as the final production design.

People on the same Wi-Fi/network may share an IP address.

The production solution should use a stable browser/session identifier generated by the widget and sent with each message.

This is an important known technical debt item.

---

# 17. Session Memory

The backend also uses an in-memory `sessionMemory` mechanism.

This allows information such as customer phone/client context to survive across conversational turns.

Like `pendingBookings`, this is currently process memory rather than durable database conversation storage.

A Railway restart can therefore clear temporary session state.

Long-term conversation/session handling should use a more robust session architecture.

---

# 18. Returning Customer Recognition

Zyra supports returning customers.

A client can be looked up using their phone number and business.

Example:

Customer sends only:

`07456789012`

If that number already belongs to Lucy, Zyra can respond with something such as:

`Welcome back Lucy — would you like to book Haircut with Olivia again?`

Zyra can retrieve the customer's previous booking and remember information including:

- customer name
- service
- provider

This has been tested successfully.

Stored client data should take priority over placeholder AI names such as:

`New Client`

when the phone number already belongs to a known customer.

---

# 19. Same-As-Last-Time Booking

Returning customers can use shorthand.

Example:

`Yes, same again Friday at 4pm`

Zyra can reuse information from the customer's previous booking, including:

- service
- provider

while applying the new:

- date
- time

This flow has been tested successfully.

---

# 20. Rescheduling

Zyra supports rescheduling existing active bookings.

The backend identifies reschedule intent using dedicated logic.

A helper retrieves the customer's latest active booking.

If the customer provides both a new date and time, Zyra can reschedule directly.

If the customer provides only a new date, Zyra asks only for the missing time.

Example:

Customer:

`Can you move my Friday appointment to Saturday?`

Correct response:

`What time would you like for your appointment on Saturday?`

Customer:

`5pm please`

Zyra then carries forward the existing:

- client
- service
- provider

and changes:

- date
- time

The pending booking stores the original booking ID so the second conversational turn can update the existing booking rather than accidentally inserting a new booking.

A previous duplicate-booking bug existed in this flow and was fixed by preserving `existingBookingId` through pending state.

Database verification should still be used when testing rescheduling to ensure an UPDATE occurred rather than a duplicate INSERT.

---

# 21. Client Database Handling

When a booking is made, Zyra checks whether the phone number already belongs to an existing client for that business.

If yes:

Reuse the existing client.

If no:

Create a new client.

The system should not create a new client record every time an existing customer books again.

Client matching must always include the business so the same phone number can theoretically interact independently with different Zyra businesses.

---

# 22. Widget

Zyra currently has a website chat widget.

Development testing is performed using a local test page:

`widget-test.html`

The local test page simulates a client's website.

It is commonly opened from the Mac using a local `file:///` path.

The production widget code is served through the Zyra backend from the `public` directory.

The widget uses a floating chat launcher/panel.

The widget architecture is designed to be embedded on client websites.

Current visual design is functional but is not the final premium production interface.

The intended final design is:

- modern
- minimal
- high-end
- mobile-first
- suitable for premium service businesses

---

# 23. Static File Serving

Express serves the `public` directory.

This allows resources such as the widget frontend to be loaded from the Railway-hosted Zyra application.

A previous error:

`Cannot GET /demo-chat.html`

was caused by static content not being served correctly.

Static serving was subsequently added/fixed.

Do not remove Express static-file serving when editing `index.js`.

---

# 24. CORS

CORS support exists in the backend.

Because the widget uses an iframe-based approach, much of the widget communication can remain same-origin inside the iframe.

Avoid unnecessarily weakening CORS restrictions in production.

---

# 25. Secondary Bun Booking Microservice

A separate Bun booking microservice was previously created and deployed on Railway.

Known endpoints include:

`POST /api/book`

and:

`GET /api/bookings`

Known deployment URL:

`https://function-bun-production-7b13.up.railway.app`

This service previously stored booking objects in lightweight storage.

The PostgreSQL database used by the main Zyra backend should be treated as the important long-term source of truth.

Before relying on the Bun forwarding behavior, check the current `index.js` implementation because this integration may evolve or eventually be removed.

Do not redesign the main booking system around the Bun service without first checking whether it is still required.

---

# 26. Environment Variables

Important Railway environment variables include:

`DATABASE_URL`

Connection string for Railway PostgreSQL.

`OPENAI_API_KEY`

Server-side OpenAI API key.

`PORT`

Port supplied by Railway.

The OpenAI API key must never be exposed in browser-side JavaScript.

---

# 27. Development Database Tool

Beekeeper Studio is used to connect to the Railway PostgreSQL database.

This is where the developer currently inspects tables including:

- bookings
- businesses
- clients
- provider_services
- providers
- services

When verifying whether a booking was:

- created
- duplicated
- moved
- assigned to the right provider
- associated with the right client

Beekeeper Studio is the preferred direct database inspection tool.

This should be remembered as part of the standard Zyra development workflow.

---

# 28. Current Tested Booking Behaviors

The following behaviors have been successfully tested during development:

- Normal one-message booking
- Explicit provider booking
- Automatic provider assignment
- Provider/service compatibility checking
- Alternative provider suggestion
- Remembering service/date/customer details after a provider mismatch
- Availability checking
- Double-booking detection
- Alternative-time suggestions
- Completing a booking from a short reply such as `4pm please`
- Returning-customer phone recognition
- Retrieving previous service/provider
- `Same as last time` booking
- Multi-turn rescheduling
- Changing a booking date and then supplying the time in a second message
- Correctly understanding `move my Friday appointment to Saturday` as Saturday rather than Friday

These tests should be repeated after major booking-engine changes to detect regressions.

---

# 29. Important Recent Bug Fixes

## Provider mismatch context bug

Problem:

Customer requested a service with an incompatible provider.

Zyra correctly suggested another provider.

Customer accepted the alternative.

Zyra forgot the original service and asked which service they wanted.

Cause:

The first AI response was conversational rather than booking JSON, so no pending booking was created.

Fix:

Backend independently extracts and stores the original:

- name
- phone
- service
- date
- time
- provider

when a provider/service mismatch occurs.

---

## Provider priority bug

Problem:

Pending booking contained the original provider.

Customer explicitly selected a different provider in their follow-up.

Backend could continue forcing the old pending provider.

Fix:

Provider explicitly mentioned in the newest customer message now takes priority over pending provider state.

---

## Pending key mismatch bug

Problem:

First message containing phone stored pending data using phone key.

Next message without phone attempted to retrieve pending data using IP.

Fix:

Temporary IP-based pending/session key.

Future fix:

Stable widget-generated session ID.

---

## Reschedule duplicate bug

Problem:

Two-turn reschedule could create a new booking rather than update the existing one.

Fix:

Existing booking ID is preserved through pending reschedule state and used during the final database write.

---

## Reschedule date extraction bug

Problem:

Message:

`move my Friday appointment to Saturday`

was interpreted as Friday because Friday appeared earlier in the weekday array.

Fix:

`extractDateFromText()` now selects the latest relevant weekday occurrence in the message.

---

# 30. Important Rules When Editing index.js

`index.js` contains a large amount of working functionality.

Do not replace it with a drastically shortened version unless intentionally rebuilding the architecture.

When making changes:

- Preserve existing functionality
- Check surrounding logic before changing a helper
- Do not remove provider logic while fixing booking logic
- Do not remove returning-client logic while fixing rescheduling
- Do not remove static serving or widget support
- Do not remove availability checks
- Do not remove business-specific filtering from SQL queries
- Do not expose internal provider IDs to customers
- Prefer targeted changes followed by regression testing

---

# 31. Current Known Technical Debt

The current system works as an evolving MVP/backend foundation, but several parts are temporary.

Known technical debt includes:

- IP-based session/pending identification
- In-memory pending bookings
- In-memory session memory
- Human-readable/text dates rather than a fully normalized date architecture
- No production owner dashboard yet
- No final business onboarding interface yet
- No production authentication system for business owners yet
- No final customer messaging integrations
- No final WhatsApp integration
- No final Instagram messaging integration
- No SMS reminder system yet
- No production-grade persistent conversation/session store yet
- No final customer-facing premium widget design yet
- The Bun microservice's long-term role should be reviewed

---

# 32. Business Owner Dashboard — Planned

A future Zyra owner dashboard should allow a business to manage:

- Services
- Prices
- Providers
- Provider/service mappings
- Opening hours
- Bookings
- Client information
- Business settings
- Service aliases/slang
- Availability
- Future retention settings

The dashboard should be mobile-first because many target business owners primarily operate from phones rather than desktop computers.

The interface should feel like a polished application rather than a raw database/admin tool.

---

# 33. Service Aliases — Planned

Businesses should eventually be able to configure custom aliases for services.

Example:

Business service:

`Haircut`

Possible customer aliases:

`trim`

`cut`

`tidy up`

The business owner should be able to configure these without editing source code.

This is intended to become part of the owner dashboard/business configuration system.

---

# 34. Calendar / Booking Viewer Direction

The chosen direction is a Zyra-hosted booking/calendar experience rather than making Google Calendar the core owner interface.

Google Calendar may still become an optional integration later.

The business owner should ultimately be able to open a clean Zyra interface and see appointments directly.

During backend development, Beekeeper Studio remains the direct database inspection tool.

---

# 35. Future Customer Channels

Planned channels include:

- Website widget
- WhatsApp
- Instagram
- SMS

The backend should remain channel-independent where possible.

The same core booking engine should eventually support messages arriving from different communication channels.

---

# 36. Retention and Growth Layer — Future

The current priority is the receptionist/front-desk system.

After the booking engine is robust, Zyra is intended to add retention functionality such as:

- Post-appointment follow-ups
- Rebooking reminders
- Customer reactivation
- Upsells
- Service recommendations
- Retention campaigns

This should be layered onto the working booking/customer database rather than built as an unrelated separate system.

---

# 37. Product Architecture Principle

Zyra should remain industry-agnostic.

Do not hard-code the architecture around salons.

The salon is a test environment.

Core concepts should remain generic:

- Business
- Provider
- Service
- Client
- Booking

This makes it possible for the same Zyra system to later support industries such as:

- Barbers
- Beauty businesses
- Clinics
- Therapists
- Pet groomers
- Trades
- Other appointment-based service businesses

---

# 38. Source of Truth Hierarchy

When there is uncertainty about how Zyra currently works, use this order:

1. Current production source code in GitHub
2. Current PostgreSQL data/schema viewed through Beekeeper Studio
3. Railway deployment/environment/logs
4. This `ARCHITECTURE.md`
5. Other documentation and conversation history

Code and database reality take priority over old documentation.

If this document conflicts with the current implementation, update this document after confirming the current implementation.

Do not guess.

---

# 39. Recommended Documentation Going Forward

The repository should gradually contain separate documents for different kinds of knowledge.

`ARCHITECTURE.md`

How Zyra is built.

`CURRENT_STATE.md`

Exactly what is working, what is currently being tested, known bugs and immediate development status.

`DECISIONS.md`

Important product/technical decisions and why they were made.

`TESTS.md`

Regression tests that should be run after major changes.

`NEXT_STEPS.md`

The immediate development sequence.

These files should become Zyra's permanent project memory.

---

# 40. Current Development Principle

Zyra is being built incrementally.

The preferred workflow is:

1. Understand one issue
2. Make one controlled change
3. Deploy it
4. Test the exact failing scenario
5. Test related existing functionality for regressions
6. Verify database state when necessary
7. Then continue

Avoid stacking multiple speculative fixes before testing the previous one.

---

# 41. Long-Term Goal

The finished Zyra system should allow a service business to configure its information once and then allow Zyra to autonomously handle a large portion of customer interaction.

The intended customer experience is:

Customer asks naturally.

Zyra understands.

Zyra knows the business's real services, staff and availability.

Zyra books correctly.

Zyra remembers returning customers.

Zyra manages changes.

Zyra communicates confirmations and reminders.

Later, Zyra helps drive repeat business and growth.

The architecture should continue moving toward that goal without sacrificing reliability in the core booking engine.

---

# End of ARCHITECTURE.md
