import crypto from "node:crypto";
import { redirect } from "react-router";

function createState(shopDomain) {
  const payload = JSON.stringify({
    shop: shopDomain,
    nonce: crypto.randomBytes(16).toString("hex"),
  });

  const encoded = Buffer.from(payload).toString("base64url");

  const signature = crypto
    .createHmac("sha256", process.env.SHOPIFY_API_SECRET || "")
    .update(encoded)
    .digest("base64url");

  return `${encoded}.${signature}`;
}

export async function loader({ request }) {
  const url = new URL(request.url);

  const shopDomain =
    url.searchParams.get("shop") ||
    "customer-voice-ai-test.myshopify.com";

  if (!shopDomain.endsWith(".myshopify.com")) {
    throw new Response("Invalid Shopify shop domain.", {
      status: 400,
    });
  }

  const clientId = process.env.JUDGEME_CLIENT_ID;
  const redirectUri = process.env.JUDGEME_REDIRECT_URI;

  if (!clientId || !redirectUri) {
    throw new Response(
      "Judge.me OAuth environment variables are missing.",
      { status: 500 },
    );
  }

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: "read_reviews",
    state: createState(shopDomain),
  });

  return redirect(
    "https:" + "/" + "/" + "judge.me/oauth/authorize?" + params.toString(),
  );
}
