import { unauthenticated } from "../shopify.server";
import {
  listDueExecutionMonitors,
  verifyExecutionMonitor,
  scheduleNextExecutionMonitor,
} from "../services/execution-monitor.server.js";

function isAuthorized(request) {
  const configuredSecret =
    String(process.env.MONITOR_CRON_SECRET || "").trim();

  if (!configuredSecret) {
    return false;
  }

  const suppliedSecret =
    request.headers.get(
      "x-customer-voice-cron-secret",
    ) || "";

  return suppliedSecret === configuredSecret;
}

export async function action({ request }) {
  if (!isAuthorized(request)) {
    return new Response(
      JSON.stringify({
        error: "Unauthorized.",
      }),
      {
        status: 401,
        headers: {
          "Content-Type": "application/json",
        },
      },
    );
  }

  const dueMonitors =
    await listDueExecutionMonitors();

  const results = [];

  for (const monitor of dueMonitors) {
    try {
      const { admin } =
        await unauthenticated.admin(
          monitor.shop_domain,
        );

      const verified =
        await verifyExecutionMonitor({
          admin,
          shopDomain: monitor.shop_domain,
          monitorId: monitor.id,
        });

      await scheduleNextExecutionMonitor({
        monitorId: monitor.id,
        shopDomain: monitor.shop_domain,
        intervalDays:
          monitor.monitoring_interval_days || 7,
        verifiedAt:
          verified.last_verified_at ||
          new Date().toISOString(),
      });

      results.push({
        monitorId: monitor.id,
        shopDomain: monitor.shop_domain,
        status: verified.status,
        success: true,
      });
    } catch (error) {
      console.error(
        "Automatic monitor verification failed:",
        monitor.id,
        error,
      );

      results.push({
        monitorId: monitor.id,
        shopDomain: monitor.shop_domain,
        success: false,
        error:
          error instanceof Error
            ? error.message
            : String(error),
      });
    }
  }

  return new Response(
    JSON.stringify({
      ok: true,
      checked: dueMonitors.length,
      results,
    }),
    {
      status: 200,
      headers: {
        "Content-Type": "application/json",
      },
    },
  );
}

export async function loader() {
  return new Response(
    JSON.stringify({
      ok: true,
      service:
        "Customer Voice AI automatic monitoring",
    }),
    {
      status: 200,
      headers: {
        "Content-Type": "application/json",
      },
    },
  );
}
