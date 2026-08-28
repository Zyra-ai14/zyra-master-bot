# Zyra AI — Master Bot

Zyra is an AI receptionist and booking platform for service-based businesses.

The system is being built as a multi-business SaaS platform rather than a single chatbot for one business.

The current salon environment is used for development and testing, but Zyra's architecture is intended to remain industry-agnostic.

---

# What Zyra Does

Zyra communicates naturally with customers and helps businesses manage appointment-based interactions.

Current functionality includes:

- Customer conversations
- Service recognition
- Provider recognition
- Appointment booking
- Provider/service compatibility checking
- Automatic provider assignment
- Availability checking
- Double-booking prevention
- Alternative-time suggestions
- Returning-customer recognition
- Previous-booking retrieval
- "Same as last time" bookings
- Multi-turn booking conversations
- Appointment rescheduling
- Client database management
- Multi-business database architecture
- Website chat widget

Future functionality will include:

- Business owner dashboard
- Zyra-hosted calendar / booking viewer
- Business onboarding interface
- Opening-hours management
- Service aliases and slang
- SMS
- WhatsApp
- Instagram messaging
- Booking reminders
- Post-appointment follow-ups
- Customer retention
- Upselling
- Customer reactivation
- Business reporting
- Growth automation

---

# Product Vision

Zyra is not intended to remain a simple booking chatbot.

The long-term goal is to create an AI operations layer for service businesses.

A customer should eventually be able to message a business naturally and have Zyra handle the interaction from beginning to end.

Example:

Customer:

`Can I get my usual haircut with Olivia Friday afternoon?`

Zyra should be able to:

1. Recognise the customer
2. Retrieve their previous appointment
3. Understand the requested service
4. Understand the requested provider
5. Check whether that provider performs the service
6. Check real availability
7. Offer suitable times
8. Create the booking
9. Send confirmation
10. Send reminders
11. Follow up after the appointment
12. Encourage future bookings

The business owner should need minimal involvement.

---

# Architecture

Zyra currently uses:

- Node.js
- Express
- PostgreSQL
- OpenAI API
- Railway
- GitHub
- Beekeeper Studio
- HTML / JavaScript website widget

A secondary Bun booking microservice also exists from an earlier stage of development.

The long-term role of that microservice should be reviewed as the main PostgreSQL-backed architecture develops.

For detailed technical architecture, read:

`ARCHITECTURE.md`

---

# Repository

Main repository:

`zyra-master-bot`

The most important current backend file is:

`index.js`

This contains the majority of the current:

- API logic
- OpenAI integration
- Booking logic
- Provider logic
- Service logic
- Client recognition
- Availability checking
- Rescheduling
- Pending booking state
- Session state
- PostgreSQL interaction

The `public` directory contains customer-facing static assets including the website widget.

---

# Production Hosting

Zyra is currently hosted on Railway.

Production application:

`https://zyra-master-bot-production.up.railway.app`

Main chat API:

`POST /chat`

Railway also hosts the PostgreSQL database.

GitHub is connected to Railway for deployment.

Typical development flow:

1. Make a controlled code change
2. Save/commit it to GitHub
3. Railway deploys the new version
4. Wait for Railway to show `Active`
5. Test the exact affected Zyra flow
6. Test related existing functionality for regressions
7. Verify database state where necessary

---

# Database

Zyra uses PostgreSQL.

The main current tables are:

- `businesses`
- `clients`
- `services`
- `providers`
- `provider_services`
- `bookings`

Each business has its own data.

This allows one Zyra system to eventually support many businesses without creating a separate codebase for every customer.

---

# Business

The `businesses` table identifies businesses using Zyra.

Business-specific data can then be associated using `business_id`.

The system also supports business slugs.

The goal is:

One Zyra codebase.

Many businesses.

Separate business data.

---

# Clients

The `clients` table stores customers.

Important customer information includes:

- Business
- Name
- Phone number
- Notes

Phone number is currently used as an important returning-customer identifier.

Existing customers should be reused rather than creating duplicate client records for every booking.

---

# Services

Services are stored in the database rather than being permanently hard-coded into the AI.

A service can contain information such as:

- Name
- Description
- Price
- Duration
- Business

This allows different Zyra businesses to offer completely different services.

---

# Providers

Providers represent the people who perform services.

Examples in the current salon test environment include:

- Olivia
- Emma
- Sophia

Providers belong to businesses.

Customers interact with provider names only.

Internal database provider IDs must never be shown to customers.

---

# Provider Services

The `provider_services` table determines which providers can perform which services.

This prevents Zyra from booking a customer with an inappropriate provider.

Example:

A customer requests:

`Haircut with Emma`

If Emma does not offer Haircut, Zyra should not make the booking.

Instead, Zyra can explain the situation and offer an eligible provider such as Olivia.

This logic is already implemented.

---

# Bookings

Bookings are stored in PostgreSQL.

Booking information includes data such as:

- Business
- Client
- Provider
- Service
- Date
- Time
- Notes
- Status

Before creating a booking, Zyra checks provider availability.

Booked appointments are used to prevent conflicting appointments.

---

# Returning Customers

Zyra supports returning-customer recognition.

A customer can provide their phone number and Zyra can retrieve their existing client record and previous booking.

Example:

Customer:

`07456789012`

Zyra may recognise the customer and respond:

`Welcome back Lucy — would you like to book Haircut with Olivia again?`

Returning customers can then use shorthand such as:

`Yes, same again Friday at 4pm`

Zyra can reuse the previous:

- Service
- Provider

while applying the new:

- Date
- Time

---

# Rescheduling

Zyra supports appointment rescheduling.

Example:

Customer:

`Can you move my Friday appointment to Saturday?`

Zyra should understand that:

- Friday refers to the existing appointment
- Saturday is the requested new date

If the customer has not supplied a new time, Zyra asks only for the missing time.

Example:

`What time would you like for your appointment on Saturday?`

The existing booking ID is preserved during multi-turn rescheduling so the original booking can be updated instead of accidentally creating a duplicate booking.

---

# Availability

Zyra checks existing bookings before confirming a new appointment.

Availability checks consider:

- Business
- Provider
- Date
- Time
- Booking status

If a requested time is unavailable, Zyra can suggest alternatives.

Example:

Customer requests:

`5pm`

Zyra may respond:

`Olivia isn't available at 5pm. She is available at 4pm or 7pm.`

The customer can then reply:

`4pm please`

and Zyra carries forward the rest of the booking information.

---

# Conversation State

Zyra currently uses temporary backend memory for multi-turn conversations.

Current mechanisms include:

- `pendingBookings`
- `sessionMemory`

These allow Zyra to carry information between messages.

For example:

Customer:

`I want a Haircut with Emma Monday at 5pm.`

Zyra:

`Emma doesn't offer Haircut. Olivia does. Would you like Olivia instead?`

Customer:

`Yes, book me with Olivia.`

Zyra can retain the original:

- Customer
- Service
- Date
- Time

without forcing the customer to repeat everything.

---

# Temporary Session Limitation

The current development version temporarily identifies conversation state using the user's IP address.

This solved an earlier multi-turn state problem but is NOT the intended production architecture.

Shared networks can cause multiple people to use the same public IP.

Before production-scale deployment, the widget should generate a stable session identifier and send it with every message.

Temporary in-memory state can also be lost when the Railway process restarts.

A more durable session architecture will therefore be required.

---

# Website Widget

Zyra currently has a website chat widget.

The widget is designed to be embedded on a business's website.

Development testing currently uses a local:

`widget-test.html`

page.

The widget uses an iframe-based architecture to isolate Zyra from the website containing it.

The final widget should be:

- Premium
- Minimal
- Modern
- Mobile-first
- Fast
- Professional

The current interface is a development version, not the final product design.

---

# Database Inspection

Beekeeper Studio is the standard development tool currently used to inspect the Railway PostgreSQL database.

Use Beekeeper Studio when directly checking:

- Bookings
- Clients
- Providers
- Services
- Provider/service relationships
- Duplicate bookings
- Rescheduled bookings
- Database IDs
- Booking status

A conversational booking confirmation alone should not be treated as proof that a complicated database operation worked correctly.

For important booking-engine tests, verify the database directly.

---

# OpenAI

OpenAI is used for natural-language understanding and conversational responses.

The AI helps interpret messages such as:

`Same again Friday`

or:

`Can you move my appointment to Saturday?`

However, OpenAI should not be the final authority for business-critical booking rules.

Backend/database logic should control:

- Provider/service compatibility
- Availability
- Double-booking prevention
- Business separation
- Database updates
- Client matching
- Provider assignment

This keeps Zyra reliable rather than depending entirely on probabilistic AI output.

---

# Multi-Business SaaS Direction

Zyra is being designed around a master-system model.

The goal is NOT:

One repository per customer.

The goal is:

One Zyra platform serving many businesses.

Each business should eventually configure:

- Business information
- Services
- Prices
- Providers
- Provider capabilities
- Opening hours
- Availability
- Service aliases
- AI/business settings

This configuration should eventually happen through a business owner dashboard rather than source-code edits.

---

# Business Owner Dashboard — Planned

A business owner should eventually have an app-like Zyra interface.

The dashboard should allow them to:

- View bookings
- Manage services
- Change prices
- Manage providers
- Configure which provider performs each service
- Manage business hours
- View customers
- Configure service aliases
- Manage business settings
- Manage future retention functionality

The dashboard should be designed mobile-first because many target Zyra businesses primarily operate from smartphones.

---

# Calendar Direction

The planned primary booking/calendar experience is a Zyra-hosted interface.

Google Calendar is not intended to be the required core owner experience.

Optional external calendar integrations may be added later.

The goal is for a business owner to open Zyra and see their appointments in a polished, purpose-built interface.

Until that interface exists, Beekeeper Studio is used during development to directly inspect booking records.

---

# Service Aliases — Planned

Businesses should eventually be able to teach Zyra their own terminology.

Example:

Official service:

`Haircut`

Possible aliases:

- trim
- cut
- tidy up

This should be configurable through the owner dashboard without changing code.

---

# Future Communication Channels

The core Zyra booking engine should eventually support multiple customer channels.

Planned channels include:

- Website widget
- WhatsApp
- Instagram
- SMS

The core booking logic should remain channel-independent wherever possible.

---

# Retention Engine — Future

The receptionist and booking engine comes first.

Once that foundation is reliable, Zyra is intended to add a retention and growth layer.

Potential functionality includes:

- Appointment reminders
- Post-service follow-ups
- Rebooking prompts
- Customer reactivation
- Personalised offers
- Upsells
- Service recommendations
- Retention campaigns
- Business performance insights

This turns Zyra from a booking assistant into a broader business operations and growth platform.

---

# Industry-Agnostic Design

The salon environment is currently a test environment.

Zyra should NOT be architected specifically for salons.

Core entities should remain generic:

- Business
- Provider
- Service
- Client
- Booking

This allows the same platform to potentially support:

- Salons
- Barbers
- Beauty businesses
- Clinics
- Therapists
- Pet groomers
- Trades
- Other service businesses

---

# Current Development Priorities

The current priority is making the core receptionist and booking system extremely reliable.

This includes:

- Booking
- Provider selection
- Provider/service validation
- Availability
- Conflict prevention
- Returning customers
- Multi-turn conversations
- Rescheduling
- Database correctness

Do not rush into retention, marketing or advanced growth functionality while fundamental booking behavior still contains known bugs.

Core reliability comes first.

---

# Development Method

Zyra should be developed incrementally.

Preferred workflow:

1. Identify one problem
2. Understand the cause
3. Make one controlled change
4. Deploy
5. Test the exact failing scenario
6. Test nearby functionality for regressions
7. Verify the database where appropriate
8. Continue only after the change is understood

Avoid large speculative rewrites of working backend code.

`index.js` contains substantial working functionality and should not be replaced by drastically shorter versions without carefully confirming that existing features are preserved.

---

# Project Documentation

The repository documentation should become the permanent project memory for Zyra.

Important documents:

## `README.md`

High-level overview of the product and repository.

## `ARCHITECTURE.md`

Detailed technical explanation of how the current system works.

## `CURRENT_STATE.md`

Should record the exact current development status, latest successful tests, known bugs and what is being worked on now.

## `DECISIONS.md`

Should record important technical and product decisions and why they were made.

## `TESTS.md`

Should contain the regression tests that must continue working.

## `NEXT_STEPS.md`

Should record the immediate development sequence.

Not all of these documents necessarily exist yet.

They should be added as the project documentation system is developed.

---

# Source of Truth

When there is uncertainty about Zyra, use this order:

1. Current GitHub production source code
2. Current PostgreSQL schema/data through Beekeeper Studio
3. Railway deployment configuration and logs
4. `ARCHITECTURE.md`
5. `CURRENT_STATE.md` and other current project documentation
6. Previous conversation history

Do not rely on memory or assumptions when the current implementation can be checked directly.

If documentation becomes outdated, update it.

---

# Current Known Technical Debt

Important known unfinished/temporary areas include:

- IP-based conversation identification
- In-memory session state
- In-memory pending booking state
- Text-based date handling
- No production owner dashboard
- No final Zyra calendar interface
- No production business onboarding UI
- No production owner authentication
- No WhatsApp integration
- No Instagram messaging integration
- No SMS reminder system
- No persistent production conversation/session architecture
- No final premium widget UI
- Secondary Bun microservice architecture needs future review

These are known development items, not forgotten requirements.

---

# Roadmap

## Current — Core Receptionist Engine

Make the core system reliable:

- Booking
- Services
- Providers
- Availability
- Conflict prevention
- Returning customers
- Rescheduling
- Multi-turn conversations
- Database correctness

## Next — Business Management

Build:

- Owner dashboard
- Zyra booking/calendar interface
- Business configuration
- Provider management
- Service management
- Pricing
- Hours
- Service aliases
- Business onboarding

## Communications

Add:

- SMS
- WhatsApp
- Instagram
- Confirmations
- Reminders

## Retention and Growth

Add:

- Follow-ups
- Rebooking
- Reactivation
- Upselling
- Retention campaigns
- Reporting

## Later Expansion

Potentially add:

- Payments
- Mobile applications
- External calendar integrations
- Advanced analytics
- Additional industries
- More autonomous business operations

---

# Developer Onboarding

A developer joining the Zyra project should read the following in order:

1. `README.md`
2. `ARCHITECTURE.md`
3. `CURRENT_STATE.md` if present
4. `DECISIONS.md` if present
5. `TESTS.md` if present
6. `NEXT_STEPS.md` if present
7. `index.js`
8. PostgreSQL schema through Beekeeper Studio
9. Railway configuration and deployment history as required

Before making major changes, the developer should understand the existing booking flow and run the established regression tests.

---

# Project Owner

Project owner:

Carl Payne

Product:

Zyra AI

---

# Core Principle

Zyra should become easier to configure as it becomes more powerful.

A new business should eventually be onboarded by entering its information into Zyra — not by duplicating and manually rewriting source code.

The system should remain:

- Multi-business
- Configurable
- Reliable
- Scalable
- Mobile-first
- Industry-agnostic
- Premium in customer experience

---

# End of README.md
