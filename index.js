import express from "express";
import { OpenAI } from "openai";
import pkg from "pg";
import path from "path";
import { fileURLToPath } from "url";

const { Pool } = pkg;

const app = express();
app.use(express.json());

// --- Static files (so /demo-chat.html works) ---
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
app.use(express.static(path.join(__dirname, "public")));

// Optional: visiting the base URL opens the demo page
app.get("/", (req, res) => {
  res.redirect("/demo-chat.html");
});

// OpenAI client
const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Postgres connection (Railway DATABASE_URL)
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

// Default business slug
const DEFAULT_BUSINESS_SLUG = "demo";

// External booking microservice
const BOOKING_API_URL =
  "https://function-bun-production-7b13.up.railway.app/api/book";

// Helper: Fuzzy match a service from user text
function findBestServiceMatch(userText, services) {
  if (!userText || services.length === 0) return null;

  const cleaned = userText.toLowerCase();

  let best = null;
  let bestScore = 0;

  for (const svc of services) {
    const name = svc.name.toLowerCase();
    let score = 0;

    if (cleaned.includes(name)) {
      score = 1.0;
    } else {
      // Basic fuzzy: count matching characters in the same order
      let i = 0;
      for (const c of name) {
        if (cleaned.includes(c)) i++;
      }
      score = i / name.length;
    }

    if (score > bestScore) {
      bestScore = score;
      best = svc;
    }
  }

  return bestScore >= 0.45 ? best : null;
}

app.post("/chat", async (req, res) => {
  try {
    const { message, businessSlug } = req.body;

    if (!message) {
      return res.json({ reply: "You didn't send a message." });
    }

    // Determine business
    const slug = businessSlug || DEFAULT_BUSINESS_SLUG;

    const businessResult = await pool.query(
      "SELECT id, name FROM businesses WHERE slug = $1",
      [slug]
    );

    const business = businessResult.rows[0];
    if (!business) {
      console.error("No business found for slug:", slug);
      return res.json({
        reply:
          "I couldn't find the business configuration for this chat. Please contact support.",
      });
    }

    const businessId = business.id;

    // Load services for that business
    const servicesResult = await pool.query(
      "SELECT id, name, description, price_cents, duration_minutes FROM services WHERE business_id = $1 AND is_active = TRUE",
      [businessId]
    );

    const services = servicesResult.rows;

    // Ask Zyra what to do
    const completion = await client.chat.completions.create({
      model: "gpt-4.1-mini",
      messages: [
        {
          role: "system",
          content: `
You are Zyra — the intelligent AI booking assistant for service-based businesses.

Here is the live list of services for this business:

${services
  .map(
    (s) =>
      `- ${s.name} (£${(s.price_cents / 100).toFixed(
        2
      )}, ${s.duration_minutes} mins)`
  )
  .join("\n")}

Rules:
1. You can answer questions about what services exist, prices, durations, and availability.
2. You MUST use the exact service names from the list above when confirming a booking.
3. If a user misspells a service (e.g. "hair colur"), interpret it correctly.
4. If the user clearly provides name, phone, service, date, and time in ONE message → return ONLY this JSON:

{
  "name": "<name>",
  "phone": "<phone>",
  "service": "<service>",
  "date": "<date>",
  "time": "<time>",
  "notes": "<notes or empty string>"
}

5. If you are NOT creating/updating a booking → respond normally in plain text (no JSON).
6. Never ask a user to turn natural language dates into exact dates. Just copy what they wrote.
`,
        },
        { role: "user", content: message },
      ],
    });

    let aiReply = completion.choices[0]?.message?.content?.trim() || "";

    // Try to parse booking JSON
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

    // If it's booking JSON → store it
    if (booking) {
      const notes = booking.notes || "";

      // Insert client
      const clientResult = await pool.query(
        `INSERT INTO clients (business_id, name, phone, notes)
         VALUES ($1, $2, $3, $4)
         RETURNING id`,
        [businessId, booking.name, booking.phone, notes]
      );

      const clientId = clientResult.rows[0].id;

      // Insert booking
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

      // Call external microservice
      try {
        await fetch(BOOKING_API_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(booking),
        });
      } catch (apiError) {
        console.error("Error calling Booking API:", apiError);
      }

      return res.json({
        reply: `You're booked for ${booking.service} on ${booking.date} at ${booking.time} under ${booking.name}. If anything is wrong, reply here and I'll adjust it.`,
      });
    }

    // Otherwise → normal text reply
    return res.json({ reply: aiReply });
  } catch (err) {
    console.error("Chat endpoint error:", err);
    return res.status(500).json({
      reply: "Something went wrong on my side. Please try again.",
    });
  }
});

app.listen(process.env.PORT || 3000);
