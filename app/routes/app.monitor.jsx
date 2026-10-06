import { useFetcher, useLoaderData } from "react-router";
import { authenticate } from "../shopify.server";
import {
  listExecutionMonitors,
  verifyExecutionMonitor,
} from "../services/execution-monitor.server.js";

export async function loader({ request }) {
  const { session } = await authenticate.admin(request);

  return {
    shop: session.shop,
    monitors: await listExecutionMonitors(session.shop),
  };
}

export async function action({ request }) {
  const { admin, session } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = String(formData.get("intent") || "");

  if (intent !== "verify_execution") {
    return { error: "Unsupported monitor action." };
  }

  const monitor = await verifyExecutionMonitor({
    admin,
    shopDomain: session.shop,
    monitorId: String(formData.get("monitorId") || ""),
  });

  return {
    monitorVerified: true,
    monitor,
  };
}

function statusTone(status) {
  if (status === "improved") return "success";
  if (status === "declined") return "critical";
  if (status === "monitoring") return "info";
  return "caution";
}

function statusLabel(status) {
  return {
    pending: "Pending",
    monitoring: "Monitoring",
    improved: "Improved",
    no_change: "No change",
    declined: "Declined",
  }[status] || status;
}

function getBusinessEffect(
  baseline,
  followup,
) {
  if (!baseline || !followup) {
    return {
      type: "insufficient_data",
      label: "Insufficient data",
      conclusion:
        "A follow-up snapshot is not available yet.",
    };
  }

  const baselineFeedback =
    Number(baseline.feedback_count || 0);

  const followupFeedback =
    Number(followup.feedback_count || 0);

  const baselineRate =
    Number(baseline.negative_rate || 0);

  const followupRate =
    Number(followup.negative_rate || 0);

  const baselineOrders =
    baseline.order_count == null
      ? null
      : Number(baseline.order_count);

  const followupOrders =
    followup.order_count == null
      ? null
      : Number(followup.order_count);

  const negativeRateChange =
    followupRate - baselineRate;

  const orderChange =
    baselineOrders != null &&
    followupOrders != null
      ? followupOrders - baselineOrders
      : null;

  const orderPercent =
    baselineOrders != null &&
    followupOrders != null &&
    baselineOrders !== 0
      ? (followupOrders - baselineOrders) /
        baselineOrders
      : baselineOrders === 0 &&
          followupOrders === 0
        ? 0
        : null;

  const baselineSales =
    baseline.gross_sales == null
      ? null
      : Number(baseline.gross_sales);

  const followupSales =
    followup.gross_sales == null
      ? null
      : Number(followup.gross_sales);

  const salesPercent =
    baselineSales != null &&
    followupSales != null &&
    baselineSales !== 0
      ? (followupSales - baselineSales) /
        baselineSales
      : baselineSales === 0 &&
          followupSales === 0
        ? 0
        : null;

  if (
    baselineFeedback < 3 ||
    followupFeedback < 3
  ) {
    return {
      type: "insufficient_data",
      label: "Insufficient data",
      negativeRateChange,
      orderChange,
      orderPercent,
      salesPercent,
      conclusion:
        "There is not enough feedback data yet to determine business impact.",
    };
  }

  if (
    negativeRateChange < -0.05 &&
    (orderChange == null || orderChange >= 0)
  ) {
    return {
      type: "positive",
      label: "Positive signal",
      negativeRateChange,
      orderChange,
      orderPercent,
      salesPercent,
      conclusion:
        "Negative feedback decreased materially after the optimization.",
    };
  }

  if (
    negativeRateChange > 0.05 &&
    (orderChange == null || orderChange < 0)
  ) {
    return {
      type: "negative",
      label: "Negative signal",
      negativeRateChange,
      orderChange,
      orderPercent,
      salesPercent,
      conclusion:
        "Negative feedback increased after the optimization.",
    };
  }

  return {
    type: "inconclusive",
    label: "Inconclusive",
    negativeRateChange,
    orderChange,
    conclusion:
      "The available data does not show a clear business-impact signal yet.",
  };
}

export default function MonitorPage() {
  const data = useLoaderData();
  const fetcher = useFetcher();

  const monitors = (data.monitors || []).map((monitor) => {
    const snapshots = monitor.snapshots || {};

    return {
      ...monitor,
      businessEffect: getBusinessEffect(
        snapshots.baseline,
        snapshots.followup,
      ),
    };
  });

  const formatPercent = (value) =>
    `${(Number(value || 0) * 100).toFixed(1)}%`;

  const formatMoney = (value) =>
    value == null
      ? "—"
      : `$${Number(value).toLocaleString(undefined, {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        })}`;

  const formatRelativePercent = (value) => {
    if (value == null) return "—";

    const number = Number(value) * 100;
    const sign = number > 0 ? "+" : "";

    return `${sign}${number.toFixed(1)}%`;
  };

  return (
    <s-page heading="Monitor & Verify">
      <s-link href="/app" slot="breadcrumb-actions">
        Customer Voice AI
      </s-link>

      <s-section heading="Execution outcomes">
        <s-paragraph>
          Track whether applied customer-feedback optimizations remain
          live and whether measurable customer or business outcomes change.
        </s-paragraph>
      </s-section>

      {monitors.length === 0 ? (
        <s-section heading="No monitored changes yet">
          <s-paragraph>
            Applied product optimizations will appear here automatically.
          </s-paragraph>
        </s-section>
      ) : (
        monitors.map((monitor) => {
          const verification = monitor.verification || {};
          const effect = monitor.businessEffect || null;
          const baseline = monitor.snapshots?.baseline || null;
          const followup = monitor.snapshots?.followup || null;

          return (
            <s-section
              key={monitor.id}
              heading={monitor.product_title || monitor.target}
            >
              <s-stack gap="base" direction="block">
                <s-text>
                  <strong>Target:</strong> {monitor.target}
                </s-text>

                <s-text>
                  <strong>Applied:</strong>{" "}
                  {new Date(monitor.applied_at).toLocaleString()}
                </s-text>

                <s-text>
                  <strong>Status:</strong>{" "}
                  <s-badge tone={statusTone(monitor.status)}>
                    {statusLabel(monitor.status)}
                  </s-badge>
                </s-text>

                {monitor.change_summary ? (
                  <s-paragraph>
                    <strong>Change:</strong>{" "}
                    {monitor.change_summary}
                  </s-paragraph>
                ) : null}

                {verification.reason ? (
                  <s-paragraph>
                    {verification.reason}
                  </s-paragraph>
                ) : null}

                {effect ? (
                  <s-section heading="Business effect">
                    <s-stack gap="base" direction="block">
                      <s-text>
                        <strong>Negative feedback:</strong>{" "}
                        {formatPercent(baseline?.negative_rate)} →{" "}
                        {formatPercent(followup?.negative_rate)}{" "}
                        {effect.negativeRateChange < 0
                          ? `↓${Math.abs(
                              effect.negativeRateChange * 100,
                            ).toFixed(1)}pp`
                          : effect.negativeRateChange > 0
                            ? `↑${(
                                effect.negativeRateChange * 100
                              ).toFixed(1)}pp`
                            : "No change"}
                      </s-text>

                      <s-text>
                        <strong>Orders:</strong>{" "}
                        {baseline?.order_count ?? "—"} →{" "}
                        {followup?.order_count ?? "—"}{" "}
                        {formatRelativePercent(effect.orderPercent)}
                      </s-text>

                      <s-text>
                        <strong>Gross sales:</strong>{" "}
                        {formatMoney(baseline?.gross_sales)} →{" "}
                        {formatMoney(followup?.gross_sales)}{" "}
                        {formatRelativePercent(effect.salesPercent)}
                      </s-text>

                      <s-banner tone="info">
                        <s-paragraph>
                          {effect.conclusion}
                        </s-paragraph>
                      </s-banner>
                    </s-stack>
                  </s-section>
                ) : baseline ? (
                  <s-section heading="Business effect">
                    <s-stack gap="base" direction="block">
                      <s-text>
                        Baseline captured. Verify again later to measure
                        the post-change effect.
                      </s-text>

                      <s-text>
                        <strong>Baseline negative feedback:</strong>{" "}
                        {formatPercent(baseline.negative_rate)}
                      </s-text>

                      <s-text>
                        <strong>Baseline orders:</strong>{" "}
                        {baseline.order_count ?? "—"}
                      </s-text>

                      <s-text>
                        <strong>Baseline gross sales:</strong>{" "}
                        {formatMoney(baseline.gross_sales)}
                      </s-text>
                    </s-stack>
                  </s-section>
                ) : null}

                <s-button
                  variant="primary"
                  disabled={
                    fetcher.state !== "idle" &&
                    fetcher.formData?.get("monitorId") === monitor.id
                  }
                  onClick={() =>
                    fetcher.submit(
                      {
                        intent: "verify_execution",
                        monitorId: monitor.id,
                      },
                      { method: "post" },
                    )
                  }
                >
                  Verify Now
                </s-button>

                {monitor.last_verified_at ? (
                  <s-text>
                    <strong>Last verified:</strong>{" "}
                    {new Date(
                      monitor.last_verified_at,
                    ).toLocaleString()}
                  </s-text>
                ) : null}

                {monitor.next_verify_at ? (
                  <s-text>
                    <strong>
                      Next automatic verification:
                    </strong>{" "}
                    {new Date(
                      monitor.next_verify_at,
                    ).toLocaleString()}
                  </s-text>
                ) : null}


                {fetcher.data?.monitorVerified &&
                fetcher.data.monitor?.id === monitor.id ? (
                  <s-banner tone="success">
                    <s-paragraph>
                      Verification complete:{" "}
                      {fetcher.data.monitor.status}
                    </s-paragraph>
                  </s-banner>
                ) : null}
              </s-stack>
            </s-section>
          );
        })
      )}
    </s-page>
  );
}
