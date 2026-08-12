"use client";

import { useState } from "react";
import {
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  Area,
  AreaChart,
} from "recharts";

export interface PricePoint {
  date: string;
  label: string;
  price: number;
}

export interface FinishSeries {
  subType: string;
  points: PricePoint[];
}

function money(cents: number): string {
  return `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function Tip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: Array<{ value: number; payload: { label: string } }>;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div
      style={{
        background: "var(--bg-elevated)",
        border: "1px solid var(--border-subtle)",
        borderRadius: "var(--radius-sm)",
        padding: "8px 12px",
        fontSize: "0.8rem",
      }}
    >
      <div style={{ color: "var(--text-muted)" }}>{payload[0].payload.label}</div>
      <div className="font-mono" style={{ color: "var(--text-primary)", fontWeight: 700 }}>
        {money(payload[0].value)}
      </div>
    </div>
  );
}

/**
 * Price history for one product, per finish.
 *
 * The series comes from daily snapshots recorded as they happen. There is no
 * backfill — tcgcsv publishes no archive — so a newly tracked card genuinely
 * has one point, and the component says so rather than drawing a flat line
 * that implies a stable price. The previous chart fabricated history by
 * backdating one computed value across every past date; showing "history
 * starts here" is the honest version of that.
 */
export default function ProductPriceChart({ series }: { series: FinishSeries[] }) {
  const [active, setActive] = useState(series[0]?.subType ?? "");
  const current = series.find((s) => s.subType === active) ?? series[0];

  if (!current || current.points.length === 0) {
    return (
      <div className="glass-card" style={{ padding: "var(--space-xl)", textAlign: "center" }}>
        <p style={{ color: "var(--text-muted)", fontSize: "0.9rem" }}>
          No price history yet.
        </p>
      </div>
    );
  }

  const singlePoint = current.points.length < 2;

  return (
    <div>
      {series.length > 1 && (
        <div className="filter-tabs" style={{ marginBottom: "var(--space-md)" }}>
          {series.map((s) => (
            <button
              key={s.subType}
              onClick={() => setActive(s.subType)}
              className={`filter-tab${s.subType === active ? " active" : ""}`}
            >
              {s.subType}
            </button>
          ))}
        </div>
      )}

      {singlePoint ? (
        <div
          className="glass-card"
          style={{ padding: "var(--space-xl)", textAlign: "center" }}
        >
          <div
            className="font-mono"
            style={{ fontSize: "1.75rem", fontWeight: 800, color: "var(--text-primary)" }}
          >
            {money(current.points[0].price)}
          </div>
          <p
            style={{
              color: "var(--text-muted)",
              fontSize: "0.8rem",
              marginTop: "var(--space-sm)",
            }}
          >
            Price history starts {current.points[0].label} — we record one snapshot per day,
            so the trend line fills in from here.
          </p>
        </div>
      ) : (
        <div className="chart-container" style={{ height: 280 }}>
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={current.points} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="priceFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--color-primary-light)" stopOpacity={0.35} />
                  <stop offset="100%" stopColor="var(--color-primary-light)" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border-subtle)" vertical={false} />
              <XAxis
                dataKey="label"
                tick={{ fill: "var(--text-muted)", fontSize: 11 }}
                tickLine={false}
                axisLine={false}
                minTickGap={24}
              />
              <YAxis
                tick={{ fill: "var(--text-muted)", fontSize: 11 }}
                tickLine={false}
                axisLine={false}
                width={64}
                tickFormatter={(v: number) => `$${Math.round(v / 100)}`}
              />
              <Tooltip content={<Tip />} />
              <Area
                type="monotone"
                dataKey="price"
                stroke="var(--color-primary-light)"
                strokeWidth={2}
                fill="url(#priceFill)"
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}
