import express from "express";
import cors from "cors";
import { OpenAI } from "openai";
import pkg from "pg";
import path from "path";
import { fileURLToPath } from "url";

const { Pool } = pkg;

const app = express();

app.use(cors());
app.use(express.json());

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

app.use(express.static(path.join(__dirname, "public")));
app.use("/public", express.static(path.join(__dirname, "public")));

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

const DEFAULT_BUSINESS_SLUG = "demo";

const BOOKING_API_URL =
  "https://function-bun-production-7b13.up.railway.app/api/book";

// Temporary in-memory pending bookings
// Keyed by business slug + user IP
const pendingBookings = new Map();
const PENDING_BOOKING_TTL_MS = 15 * 60 * 1000;

function getPendingBookingKey(req, slug) {
  const ip =
    req.headers["x-forwarded-for"]?.toString().split(",")[0].trim() ||
    req.ip ||
    "unknown";
  return `${slug}::${ip}`;
}

function cleanupPendingBooking(key) {
  const pending = pendingBookings.get(key);
  if (!pending) return null;

  const age = Date.now() - pending.createdAt;
  if (age > PENDING_BOOKING_TTL_MS) {
    pendingBookings.delete(key);
    return null;
  }

  return pending;
}

function findBestServiceMatch(userText, services) {
  if (!userText || services.length === 0) return null;

  const cleaned = userText.toLowerCase();
  let best = null;
  let bestScore = 0;

  for (const svc of services) {
    const name = (svc.name || "").toLowerCase();
    let score = 0;

    if (cleaned.includes(name)) {
      score = 1.0;
    } else {
      let i = 0;
      for (const c of name) {
        if (cleaned.includes(c)) i++;
      }
      score = i / Math.max(name.length, 1);
    }

    if (score > bestScore) {
      bestScore = score;
      best = svc;
    }
  }

  return bestScore >= 0.45 ? best : null;
}

function findProviderFromText(userText, providers) {
  if (!userText) return null;

  const cleaned = userText.toLowerCase();

  for (const p of providers) {
    if (cleaned.includes(p.name.toLowerCase())) {
      return p;
    }
  }

  return null;
}

function normalizeTimeInput(timeText) {
  if (!timeText || typeof timeText !== "string") return null;

  const raw = timeText.trim().toLowerCase();

  let match = raw.match(/^(\d{1,2}):(\d{2})$/);
  if (match) {
    const hour = Number(match[1]);
    const minute = Number(match[2]);
    if (hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59) {
      return `${String(hour).padStart(2, "0")}:${String(minute).padStart(
        2,
        "0"
      )}`;
    }
  }

  match = raw.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)$/);
  if (match) {
    let hour = Number(match[1]);
    const minute = Number(match[2] || "00");
    const meridiem = match[3];

    if (hour < 1 || hour > 12 || minute < 0 || minute > 59) return null;

    if (meridiem === "am") {
      if (hour === 12) hour = 0;
    } else {
      if (hour !== 12) hour += 12;
    }

    return `${String(hour).padStart(2, "0")}:${String(minute).padStart(
      2,
      "0"
    )}`;
  }

  match = raw.match(/^(\d{2})(\d{2})$/);
  if (match) {
    const hour = Number(match[1]);
    const minute = Number(match[2]);
    if (hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59) {
      return `${String(hour).padStart(2, "0")}:${String(minute).padStart(
        2,
        "0"
      )}`;
    }
  }

  return null;
}

function formatTimeForHumans(normalizedTime) {
  if (!normalizedTime || typeof normalizedTime !== "string") return normalizedTime;

  const match = normalizedTime.match(/^(\d{2}):(\d{2})$/);
  if (!match) return normalizedTime;

  let hour = Number(match[1]);
  const minute = match[2];

  const meridiem = hour >= 12 ? "pm" : "am";
  hour = hour % 12;
  if (hour === 0) hour = 12;

  if (minute === "00") {
    return `${hour}${meridiem}`;
  }

  return `${hour}:${minute}${meridiem}`;
}

function getNextAvailableTimes(bookedTimes, requestedTime) {
  const allSlots = [
    "09:00",
    "10:00",
    "11:00",
    "12:00",
    "13:00",
    "14:00",
    "15:00",
    "16:00",
    "17:00",
    "18:00",
    "19:00",
    "20:00",
  ];

  const requestedIndex = allSlots.indexOf(requestedTime);
  if (requestedIndex === -1) return [];

  const suggestions = [];

  for (let i = requestedIndex - 1; i >= 0; i--) {
    if (!bookedTimes.includes(allSlots[i])) {
      suggestions.push(allSlots[i]);
      break;
    }
  }

  for (let i = requestedIndex + 1; i < allSlots.length; i++) {
    if (!bookedTimes.includes(allSlots[i])) {
      suggestions.push(allSlots[i]);
      break;
    }
  }

  return suggestions;
}

app.post("/chat", async (req, res) => {
  try {
    const { message, businessSlug } = req.body;

    if (!message) {
      return res.json({ reply: "You didn't send a message." });
    }

    const slug = businessSlug || DEFAULT_BUSINESS_SLUG;
    const pendingKey = getPendingBookingKey(req, slug);

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

    const servicesResult = await pool.query(
      "SELECT id, name, description, price_cents, duration_minutes FROM services WHERE business_id = $1 AND is_active = TRUE",
      [businessId]
    );

    const services = servicesResult.rows;

    const providersResult = await pool.query(
      `SELECT 
         p.id,
         p.name,
         ARRAY_REMOVE(ARRAY_AGG(s.name), NULL) AS services
       FROM providers p
       LEFT JOIN provider_services ps ON ps.provider_id = p.id
       LEFT JOIN services s ON s.id = ps.service_id
       WHERE p.business_id = $1 AND p.is_active = TRUE
       GROUP BY p.id, p.name
       ORDER BY p.name`,
      [businessId]
    );

    const providers = providersResult.rows;

    let booking = null;
    let knownClient = null;
    let lastBooking = null;

    // Detect returning customer by phone number in the message
    const phoneMatch = message.match(/\b0\d{10,14}\b/);

    if (phoneMatch) {
      const phoneFromMessage = phoneMatch[0];

      const knownClientResult = await pool.query(
        `SELECT id, name, phone
         FROM clients
         WHERE business_id = $1 AND phone = $2
         LIMIT 1`,
        [businessId, phoneFromMessage]
      );

      if (knownClientResult.rows.length > 0) {
        knownClient = knownClientResult.rows[0];
      }
    }

    if (knownClient) {
      const lastBookingResult = await pool.query(
        `SELECT service, provider_id
         FROM bookings
         WHERE client_id = $1
         ORDER BY id DESC
         LIMIT 1`,
        [knownClient.id]
      );

      if (lastBookingResult.rows.length > 0) {
        lastBooking = lastBookingResult.rows[0];
      }
    }

    const pending = cleanupPendingBooking(pendingKey);
    const possibleTime = normalizeTimeInput(message);

    if (pending && possibleTime) {
      booking = {
        name: pending.name,
        phone: pending.phone,
        service: pending.service,
        date: pending.date,
        time: possibleTime,
        notes: pending.notes || "",
      };
    } else {
      const servicesText = services
        .map(
          (s) =>
            `- ${s.name} (£${(s.price_cents / 100).toFixed(
              2
            )}, ${s.duration_minutes} mins)`
        )
        .join("\n");

      const providersText = providers
        .map(
          (p) =>
            `${p.name} offers: ${
              p.services && p.services.length
                ? p.services.join(", ")
                : "No services assigned"
            }`
        )
        .join("\n");

      const completion = await client.chat.completions.create({
        model: "gpt-4.1-mini",
        messages: [
          {
            role: "system",
            content: `
You are Zyra — the intelligent AI booking assistant for service-based businesses.

Here is the live list of services:

${servicesText || "(No services found yet)"}

Here are the staff members:

${providersText || "(No providers found yet)"}

Known returning client:
${
  knownClient
    ? `Name: ${knownClient.name}, Phone: ${knownClient.phone}`
    : "None"
}

Last booking:
${
  lastBooking
    ? `Service: ${lastBooking.service}, Provider ID: ${lastBooking.provider_id}`
    : "None"
}

Rules:
1. Users may ask for a specific staff member.
2. Users may ask "who does X service".
3. Users may ask "book with Emma".
4. Users may ask for the next available appointment with a specific provider.
5. Users may ask for any provider, any stylist, any barber, or next available.
6. Users may change provider during the conversation, for example "book with Olivia instead".
7. You must respect which provider offers which services.
8. If a user provides enough booking details to create a booking, return ONLY JSON.
9. If the user mentions a provider, put that provider name into the notes field exactly like this: "provider: Emma"
10. If the user asks for any provider or next available without naming someone, leave notes empty unless the user adds other notes.
11. If a known returning client is shown above and the phone number matches, you may use their stored name even if the user does not type their name again.
12. If the user gives phone + service + date + time, that is enough for a booking when the known returning client is available above.
13. If the user does not specify a provider, you may still return booking JSON. Do not ask for a provider unless the user explicitly asks for a specific staff member or asks who does a service.
14. If the user says "same", "same as last time", or similar:
- If a last booking exists, use it.
- If no last booking is available, ask for their phone number to retrieve it.
15. If the user says "same" but does NOT include a new time or date, ask for confirmation before booking.

Return booking JSON like this:

{
  "name": "<name>",
  "phone": "<phone>",
  "service": "<service>",
  "date": "<date>",
  "time": "<time>",
  "notes": "<notes or empty string>"
}

Otherwise respond normally in plain text.
`,
          },
          { role: "user", content: message },
        ],
      });

      const aiReply = completion.choices[0]?.message?.content?.trim() || "";

      try {
        const parsed = JSON.parse(aiReply);
        if (
          parsed &&
          typeof parsed === "object" &&
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

      if (!booking) {
        const isOnlyPhone = /^0\d{10,14}$/.test(message.trim());

        if (isOnlyPhone && knownClient && lastBooking) {
          const providerName =
            providers.find((p) => p.id === lastBooking.provider_id)?.name ||
            "your usual stylist";

          return res.json({
            reply: `Welcome back ${knownClient.name} — would you like to book ${lastBooking.service} with ${providerName} again?`,
          });
        }

        return res.json({ reply: aiReply });
      }
    }

    // Force correct stored name for returning clients
    if (
      knownClient &&
      booking &&
      (!booking.name || booking.name.toLowerCase() === "new client")
    ) {
      booking.name = knownClient.name;
    }

    if (booking && services.length > 0) {
      const match = findBestServiceMatch(booking.service, services);
      if (match) booking.service = match.name;
    }

    if (booking) {
      const notes = booking.notes || "";

      const providerMatch = pending
        ? providers.find((p) => p.id === pending.providerId) || null
        : findProviderFromText(message, providers);

      let providerId = providerMatch ? providerMatch.id : null;

      if (!providerId) {
        const providerResult = await pool.query(
          `SELECT p.id
           FROM providers p
           JOIN provider_services ps ON ps.provider_id = p.id
           JOIN services s ON s.id = ps.service_id
           WHERE p.business_id = $1
           AND p.is_active = TRUE
           AND s.name = $2
           LIMIT 1`,
          [businessId, booking.service]
        );

        providerId = providerResult.rows[0]?.id || null;
      }

      const assignedProvider =
        providers.find((p) => p.id === providerId) || providerMatch || null;

      const normalizedTime = normalizeTimeInput(booking.time);

      if (!normalizedTime) {
        return res.json({
          reply:
            "I couldn't understand that time. Please use something like 3pm or 15:00.",
        });
      }

      if (providerId) {
        const existingBookingResult = await pool.query(
          `SELECT id
           FROM bookings
           WHERE provider_id = $1
           AND date = $2
           AND time = $3
           LIMIT 1`,
          [providerId, booking.date, normalizedTime]
        );

        if (existingBookingResult.rows.length > 0) {
          const bookedTimesResult = await pool.query(
            `SELECT time
             FROM bookings
             WHERE business_id = $1
             AND provider_id = $2
             AND date = $3`,
            [businessId, providerId, booking.date]
          );

          const bookedTimes = bookedTimesResult.rows.map((r) => r.time);
          const suggestions = getNextAvailableTimes(bookedTimes, normalizedTime);

          pendingBookings.set(pendingKey, {
            createdAt: Date.now(),
            name: booking.name,
            phone: booking.phone,
            service: booking.service,
            date: booking.date,
            notes,
            providerId,
          });

          const suggestionText = suggestions.length
            ? `${assignedProvider?.name || "They"}'s available at ${suggestions
                .map(formatTimeForHumans)
                .join(" or ")}.`
            : "No nearby slots available.";

          return res.json({
            reply: `${assignedProvider?.name || "This staff member"} is already booked at ${formatTimeForHumans(
              normalizedTime
            )}. ${suggestionText} Would you like to book one of those?`,
          });
        }
      }

      let clientId;

      const existingClient = await pool.query(
        `SELECT id FROM clients WHERE business_id = $1 AND phone = $2 LIMIT 1`,
        [businessId, booking.phone]
      );

      if (existingClient.rows.length > 0) {
        clientId = existingClient.rows[0].id;
      } else {
        const clientResult = await pool.query(
          `INSERT INTO clients (business_id, name, phone, notes)
           VALUES ($1, $2, $3, $4)
           RETURNING id`,
          [businessId, booking.name, booking.phone, notes]
        );

        clientId = clientResult.rows[0].id;
      }

      await pool.query(
        `INSERT INTO bookings (business_id, client_id, provider_id, service, date, time, notes)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          businessId,
          clientId,
          providerId,
          booking.service,
          booking.date,
          normalizedTime,
          notes,
        ]
      );

      pendingBookings.delete(pendingKey);

      try {
        await fetch(BOOKING_API_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...booking,
            time: normalizedTime,
          }),
        });
      } catch (apiError) {
        console.error("Error calling Booking API:", apiError);
      }

      const providerName = assignedProvider ? assignedProvider.name : null;
      const humanTime = formatTimeForHumans(normalizedTime);

      const dateText =
        booking.date.toLowerCase() === "tomorrow" ||
        booking.date.toLowerCase().startsWith("next ")
          ? `${booking.date} at ${humanTime}`
          : `on ${booking.date} at ${humanTime}`;

      const replyText = providerName
        ? `You're booked for ${booking.service} with ${providerName} ${dateText} under ${booking.name}. Let me know if you'd like to change anything.`
        : `You're booked for ${booking.service} ${dateText} under ${booking.name}. Let me know if you'd like to change anything.`;

      return res.json({
        reply: replyText,
      });
    }

    return res.json({ reply: "Something went wrong on my side. Please try again." });
  } catch (err) {
    console.error("Chat endpoint error:", err);
    return res.status(500).json({
      reply: "Something went wrong on my side. Please try again.",
    });
  }
});

app.listen(process.env.PORT || 3000);
