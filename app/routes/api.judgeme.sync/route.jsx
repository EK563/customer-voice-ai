import { syncJudgeMeReviews } from "../../services/judgeme.server";

export async function action({ request }) {
  try {
    const url = new URL(request.url);
    const shopDomain =
      url.searchParams.get("shop") ||
      "customer-voice-ai-test.myshopify.com";

    const result = await syncJudgeMeReviews(shopDomain);

    return Response.json({
      ok: true,
      fetched: result.fetched,
      synced: result.synced,
    });
  } catch (error) {
    console.error("Judge.me sync failed:", error);

    return Response.json(
      {
        ok: false,
        error: error.message,
      },
      { status: 500 },
    );
  }
}
