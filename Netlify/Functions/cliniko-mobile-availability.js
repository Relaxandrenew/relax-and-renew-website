// netlify/functions/cliniko-mobile-availability.js

// LIVE n8n webhook URL (Availability)
const TARGET_WEBHOOK_URL =
  "https://primary-production-efcf.up.railway.app/webhook/cliniko-mobile-availability";

exports.handler = async (event) => {
  // Only allow POST from your booking page
  if (event.httpMethod !== "POST") {
    return {
      statusCode: 405,
      body: "POST only",
    };
  }

  try {
    // Forward the body from the browser directly to your n8n workflow
    const res = await fetch(TARGET_WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: event.body,
    });

    const text = await res.text(); // n8n should return JSON text

    return {
      statusCode: res.status,
      headers: {
        "Content-Type": "application/json",
      },
      body: text,
    };
  } catch (err) {
    return {
      statusCode: 500,
      body: JSON.stringify({
        error: "Proxy to n8n failed",
        details: String(err),
      }),
    };
  }
};
