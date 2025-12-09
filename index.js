import express from "express";
import { OpenAI } from "openai";
import pkg from "pg";

const { Pool } = pkg;

const app = express();
app.use(express.json());

// OpenAI client
const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Postgres connection (Railway DATABASE_URL)
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

// Default business slug for now (later: one per salon/gym/barber etc)
const DEFAULT_BUSINESS_SLUG = "demo";

// Your existing Bun booking microservice
const BOOKING_API_URL =
  "https://function-bun-production-7b13.up.railway.app/api/book";

// --- Helper functions --------------------------------------------------------

async function getBusinessIdFromSlug(slug) {
  const result = await pool.query(
    "SELECT id FROM businesses WHERE slug = $1",
    [slug]
  );
  return result.rows[0]?.id || null;
}

async function getServicesForBusiness(businessId) {
  const result = await pool.query(
    `SELECT id, name, description, price_cents, duration_minutes
     FROM services
     WHERE business_id = $1
       AND is_active = true`,
    [businessId]
  );
  return result.rows;
}

// --- Chat endpoint -----------------------------------------------------------

app.post("/chat", async (req, res) => {
  try {
    const { message, businessSlug } = req.body;

    if (!message) {
      return res.json({ reply: "You didn't send a message." });
    }

    // 1) Figure out which business this chat belongs to (by slug)
    const slug = businessSlug || DEFAULT_BUSINESS_SLUG;

    const businessId = await getBusinessIdFromSlug(slug);

    if (!businessId) {
      console.error("No business found for slug:", slug);
      return res.json({
        reply:
          "I couldn't find the business configuration for this chat. Please contact support.",
      });
    }

    // 2) Load available services for this business
    const services = await getServicesForBusiness(businessId);

    const serviceText =
      services.length > 0
        ? services
            .map(
              (s) =>
                `${s.name} — £${(s.price_cents / 100).toFixed(
                  2
                )}, ${s.duration_minutes} mins. ${s.description || ""}`
            )
            .join("\n")
        : "No services configured yet.";

    // 3) Ask Zyra what to do
    const completion = await client.chat.completions.create({
      model: "gpt-4.1-mini",
      messages: [
        {
          role: "system",
          content: `You are Zyra — an intelligent, friendly AI booking assistant used by service-based businesses.

CONTEXT ABOUT THIS BUSINESS
- The current business slug is: "${slug}".
- These are the services available for this business (name — price, duration, description):

${serviceText}

You must always try to match the user's request to ONE of the available service names above.
- If the user is clearly asking for something that matches one of the names (even if they type it slightly differently, e.g. "biab refill" vs "BIAB Infill"), treat it as that service.
- If the user asks for something that does NOT exist in the list, ask them to choose the closest option from the list.
- Do not invent new services that are not listed.

Your core responsibilities:
1. Help clients understand available services, prices, and booking options.
2. Guide first-time clients through a step-by-step booking flow (gather name, service, date, time, phone number).
3. For returning clients, allow fast, shorthand booking. If a user says something like "gel nails next Tuesday at 2pm, Sarah, 07123…", understand and process it.
4. Always confirm missing REQUIRED details (name, service, date, time, phone). Do NOT block on optional notes.

Important booking rules:
- If the user has already clearly provided name, phone, service, date, and time in a SINGLE message, DO NOT ask any extra follow-up questions about preferences or notes. Assume notes can be an empty string ("") unless the user explicitly includes them.
- If the date or time is written in natural language (for example: "next Tuesday", "tomorrow at 2pm", "this Friday morning"), DO NOT ask the user to clarify it into an exact calendar date. Just copy the phrase exactly as they wrote it into the "date" and "time" fields.

When a booking is ready and fully confirmed:
- Reply with ONLY a single JSON object.
- No backticks, no code fences, no extra text before or after.
- The JSON must look like this, with the placeholders replaced by real values:

{
  "name": "<name>",
  "phone": "<phone>",
  "service": "<service>",
  "date": "<date>",
  "time": "<time>",
  "notes": "<notes or empty string>"
}

If you are NOT creating or updating a booking, answer normally in plain text (no JSON).`,
        },
        { role: "user", content: message },
      ],
    });

    const aiReply = completion.choices[0]?.message?.content?.trim() || "";

    // 4) Try to interpret the reply as booking JSON
    let booking = null;

    try {
      const parsed = JSON.parse(aiReply);
      if (
        parsed &&
        typeof parsed === "object" &&
        parsed.name &&
        parsed.phone &&
        parsed.service &&
        parsed.date &&
        parsed.time
      ) {
        booking = parsed;
      }
    } catch {
      booking = null;
    }

    // 5) If Zyra returned booking JSON, save to DB + send to booking API
    if (booking) {
      const notes = booking.notes || "";

      try {
        // Insert client row
        const clientResult = await pool.query(
          `INSERT INTO clients (business_id, name, phone, notes)
           VALUES ($1, $2, $3, $4)
           RETURNING id`,
          [businessId, booking.name, booking.phone, notes]
        );

        const clientId = clientResult.rows[0].id;

        // Insert booking row
        await pool.query(
          `INSERT INTO bookings (business_id, client_id, service, date, time, notes)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [
            businessId,
            clientId,
            booking.service,
            booking.date,
            booking.time,
            notes,
          ]
        );
      } catch (dbError) {
        console.error("Error saving booking to Postgres:", dbError);
        // We still continue and try to hit the booking API
      }

      // Send booking to your Bun microservice
      try {
        await fetch(BOOKING_API_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(booking),
        });
      } catch (apiError) {
        console.error("Error calling booking API:", apiError);
      }

      // Friendly confirmation back to the user
      return res.json({
        reply: `You're booked for ${booking.service} on ${booking.date} at ${booking.time} under ${booking.name}. If anything is wrong, reply here and I'll adjust it.`,
      });
    }

    // 6) If it's not booking JSON, just send Zyra's text reply straight back
    return res.json({ reply: aiReply });
  } catch (error) {
    console.error("Chat endpoint error:", error);
    return res.status(500).json({
      reply: "Something went wrong on my side. Please try again in a moment.",
    });
  }
});

app.listen(process.env.PORT || 3000);
