// netlify/functions/cliniko-mobile-availability.js

const N8N_WEBHOOK_URL =
  "https://primary-production-efcf.up.railway.app/webhook/cliniko-mobile-availability";

exports.handler = async (event) => {
  // Only allow POST from the front-end
  if (event.httpMethod !== "POST") {
    return {
      statusCode: 405,
      body: "Method Not Allowed",
    };
  }

  try {
    const body = event.body ? JSON.parse(event.body) : {};

    // Forward the same JSON body to n8n
    const resp = await fetch(N8N_WEBHOOK_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    const text = await resp.text();
    let data;

    try {
      data = JSON.parse(text);
    } catch {
      // If n8n returns non-JSON, just pass it through as text
      data = { raw: text };
    }

    return {
      statusCode: resp.status,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*", // safe since this is your own origin
      },
      body: JSON.stringify(data),
    };
  } catch (err) {
    console.error("Netlify → n8n error:", err);

    return {
      statusCode: 500,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
      },
      body: JSON.stringify({ error: "Failed to reach booking service" }),
    };
  }
};
