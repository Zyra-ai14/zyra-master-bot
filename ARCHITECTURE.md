Zyra Master Bot — System Architecture

This document explains how the Zyra Master Bot system works end-to-end.
It is written so any developer can understand the full pipeline, fix issues, and extend the system.

⸻

	1.	Overview

⸻

Zyra is a multi-business AI booking assistant.
It handles chat messages, extracts booking details using an AI model, saves those bookings into a shared Postgres database, and forwards confirmed bookings to an external Bun microservice.

The system consists of:
	•	The Zyra Master Bot (Node.js/Express)
	•	A shared PostgreSQL database (hosted on Railway)
	•	A Bun-based booking microservice (also on Railway)
	•	OpenAI API for message understanding and booking extraction

⸻

	2.	Data Model

⸻

There are 3 main tables in PostgreSQL:
	1.	businesses
Columns:
	•	id
	•	name
	•	slug
	•	created_at
	2.	clients
Columns:
	•	id
	•	business_id
	•	name
	•	phone
	•	notes
	•	created_at
	3.	bookings
Columns:
	•	id
	•	business_id
	•	client_id
	•	service
	•	date
	•	time
	•	notes
	•	created_at

Each client and booking belongs to one business.
This allows Zyra to scale to hundreds of businesses using a single master bot.

⸻

	3.	System Flow (End-to-End)

⸻

When a message is sent to Zyra, the pipeline works like this:

Step 1 — User sends message
The frontend or WhatsApp/Instagram relay sends a POST request to the endpoint:

POST /chat
Body contains:
{ “message”: “User text…” }

Step 2 — OpenAI interprets message
The Master Bot sends the message to the OpenAI Chat Completions API.
The system prompt instructs the model to:
	•	Gather booking details
	•	Ask follow-up questions only when required
	•	Output a booking JSON only when all required fields are present

Example required fields:
name, phone, service, date, time

Step 3 — Bot decides the output
Two outcomes:

A) If the message is conversational → Zyra replies with normal text
B) If Zyra outputs valid booking JSON → system processes a booking

Step 4 — Booking JSON is parsed
Example booking JSON Zyra produces:

{
“name”: “Jane Doe”,
“phone”: “07123456789”,
“service”: “BIAB infill”,
“date”: “next Wednesday”,
“time”: “11am”,
“notes”: “Optional”
}

The code attempts JSON.parse.
If valid → booking workflow continues.

Step 5 — Save to PostgreSQL
The sequence is:
	1.	Insert client into clients table
	2.	Insert booking into bookings table

Both are tied to a business via business_id.

Currently the Master Bot uses BUSINESS_ID = 1, but this will later be dynamic per business integration.

Step 6 — Forward booking to Bun microservice
After saving to Postgres, the system POSTs the booking object to:

https://function-bun-production-7b13.up.railway.app/api/book

The Bun service stores bookings in its own lightweight JSON storage.

Step 7 — User receives confirmation
The Master Bot replies:

“You’re booked for  on  at  under .”

⸻

	4.	Environment Variables

⸻

The Zyra Master Bot requires:

DATABASE_URL
Database connection string provided automatically by Railway.

OPENAI_API_KEY
Your OpenAI API key.

PORT
Automatically assigned by Railway.

No local Postgres runs — all connections go to Railway’s hosted database.

⸻

	5.	Deployment

⸻

Zyra Master Bot is deployed from your GitHub repo to Railway.
Main deployment flow:
	1.	You push updates to GitHub
	2.	Railway detects commit
	3.	Railway rebuilds and redeploys the service
	4.	Service becomes live at:
https://zyra-master-bot-production.up.railway.app

Common troubleshooting steps:
	•	Check Railway Logs for runtime errors
	•	Ensure DATABASE_URL is set correctly
	•	Ensure SSL is enabled when connecting to PostgreSQL in Node.js

⸻

	6.	Where Data Lives

⸻

Users → communicate with Zyra
Zyra → interprets message via OpenAI
PostgreSQL → stores clients + bookings
Bun microservice → stores its own duplicate record for your internal tools
Railway → hosts both services

⸻

	7.	Scaling for Multiple Businesses

⸻

The foundation is already in place.

Each business will eventually have:
	•	Its own business_id
	•	Its own client list
	•	Its own bookings
	•	Its own chat endpoint (same bot, different identifiers)

Future additions:
	•	Authentication for business dashboard
	•	Settings per business
	•	AI personality and pricing customization
	•	Webhook integration for WhatsApp/Instagram API pipelines

⸻

	8.	How a Developer Should Work With This Project

⸻

If a developer inherits this system, they should:
	1.	Read this Architecture.md
	2.	Review index.js (the API logic)
	3.	Examine the PostgreSQL schema
	4.	Check Railway Environment Variables
	5.	Test the /chat endpoint with cURL
	6.	Understand the integration between the bot and Bun microservice

Most fixes or improvements will be in:
	•	refining AI system prompt
	•	extending the database
	•	adding business-specific logic
	•	improving the booking verification pipeline

⸻

	9.	Current Limitations (Known)

⸻

	•	BUSINESS_ID is hard-coded (to be made dynamic later)
	•	No dashboard yet
	•	No per-business AI customization yet
	•	Bun microservice is simple (JSON storage only)
	•	No webhooks for WhatsApp/Instagram yet

⸻

	10.	Summary

⸻

Zyra Master Bot is now a fully working AI booking system with:
	•	Full end-to-end pipeline
	•	Database persistence
	•	Multi-business architecture
	•	Clean, maintainable code
	•	Clear expansion path

This file allows any developer to understand the system quickly and confidently extend it.

⸻

End of Architecture.md
