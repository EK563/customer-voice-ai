import crypto from "node:crypto";
import { redirect } from "react-router";
import {
  getStoreByDomain,
  saveJudgeMeConnection,
  upsertStore,
} from "../../services/supabase.server";

function verifyState(state) {
  if (!state) {
    throw new Response("Missing OAuth state.", {
      status: 400,
    });
  }

  const [encoded, signature] = state.split(".");

  if (!encoded || !signature) {
    throw new Response("Invalid OAuth state.", {
      status: 400,
    });
  }

  const expectedSignature = crypto
    .createHmac("sha256", process.env.SHOPIFY_API_SECRET || "")
    .update(encoded)
    .digest("base64url");

  if (
    !crypto.timingSafeEqual(
      Buffer.from(signature),
      Buffer.from(expectedSignature),
    )
  ) {
    throw new Response("Invalid OAuth state signature.", {
      status: 400,
    });
  }

  const payload = JSON.parse(
    Buffer.from(encoded, "base64url").toString("utf8"),
  );

  if (
    !payload.shop ||
    !payload.shop.endsWith(".myshopify.com")
  ) {
    throw new Response("Invalid Shopify shop domain.", {
      status: 400,
    });
  }

  return payload;
}

export async function loader({ request }) {
  console.log("=== JUDGEME CALLBACK LOADER START ===");

  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const error = url.searchParams.get("error");
  const state = url.searchParams.get("state");

  if (error) {
    throw new Response(
      "Judge.me authorization failed: " + error,
      { status: 400 },
    );
  }

  if (!code) {
    throw new Response(
      "Missing Judge.me authorization code.",
      { status: 400 },
    );
  }

  const { shop: shopDomain } = verifyState(state);

  const clientId = process.env.JUDGEME_CLIENT_ID;
  const clientSecret = process.env.JUDGEME_CLIENT_SECRET;
  const redirectUri = process.env.JUDGEME_REDIRECT_URI;

  if (!clientId || !clientSecret || !redirectUri) {
    throw new Response(
      "Judge.me OAuth environment variables are missing.",
      { status: 500 },
    );
  }

  const response = await fetch(
    "https:" + "/" + "/" + "judge.me/oauth/token",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        code,
      }),
    },
  );

  const data = await response.json();

  if (!response.ok) {
    console.error("Judge.me token exchange failed:", data);

    throw new Response(
      "Judge.me token exchange failed.",
      { status: 502 },
    );
  }

  console.log(
    "Judge.me OAuth token received successfully.",
  );

  const store = await getStoreByDomain(shopDomain);

  const currentStore =
    store ||
    (await upsertStore({
      shopDomain,
      shopName: shopDomain.replace(".myshopify.com", ""),
    }));

  await saveJudgeMeConnection({
    storeId: currentStore.id,
    accessToken: data.access_token,
    tokenType: data.token_type,
    scope: data.scope,
  });

  console.log(
    "Judge.me connection saved for:",
    shopDomain,
  );

  return redirect("/app");
}
