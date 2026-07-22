"use client";

import {
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  Area,
  AreaChart,
} from "recharts";
import { getConditionLabel } from "@/lib/grade-parser";
import type { CardCondition } from "@/lib/grade-parser";

export interface PriceDataPoint {
  date: string;
  fullDate: string;
  price: number;
  sales: number;
}

interface PriceChartProps {
  condition: CardCondition;
  timeRange: string;
  data: PriceDataPoint[];
}

function formatDollar(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

// Custom tooltip component
function CustomTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: Array<{ value: number; payload: { fullDate: string; sales: number } }>;
  label?: string;
}) {
  if (!active || !payload || !payload.length) return null;

  return (
    <div
      style={{
        background: "#0d0d14",
        border: "1px solid rgba(255,255,255,0.12)",
        borderRadius: "var(--radius-md)",
        padding: "12px 16px",
        boxShadow: "0 8px 32px rgba(0,0,0,0.6)",
      }}
    >
      <div
        style={{
          fontSize: "0.7rem",
          color: "var(--text-muted)",
          marginBottom: 4,
        }}
      >
        {payload[0].payload.fullDate}
      </div>
      <div
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: "1rem",
          fontWeight: 700,
          color: "var(--text-primary)",
        }}
      >
        {formatDollar(payload[0].value)}
      </div>
      <div
        style={{
          fontSize: "0.7rem",
          color: "var(--text-muted)",
          marginTop: 4,
        }}
      >
        {payload[0].payload.sales} sale{payload[0].payload.sales !== 1 ? "s" : ""}
      </div>
    </div>
  );
}

export default function PriceChart({ condition, timeRange, data }: PriceChartProps) {
  if (!data || data.length === 0) {
    return (
      <div
        style={{
          height: 320,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          color: "var(--text-muted)",
          gap: "var(--space-sm)",
        }}
      >
        <div style={{ fontSize: "2.5rem", opacity: 0.4 }}>📈</div>
        <div style={{ fontWeight: 600 }}>No price history yet</div>
        <div style={{ fontSize: "0.8rem", maxWidth: 320, textAlign: "center" }}>
          Price history will be charted once the eBay scraper collects enough sold listing data.
        </div>
      </div>
    );
  }

  // Calculate price range for Y-axis
  const prices = data.map((d) => d.price);
  const minPrice = Math.min(...prices);
  const maxPrice = Math.max(...prices);
  const padding = (maxPrice - minPrice) * 0.1;

  return (
    <div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: "var(--space-md)",
        }}
      >
        <span
          className="badge"
          style={{
            background: "rgba(99, 102, 241, 0.15)",
            color: "var(--color-primary-light)",
            border: "1px solid rgba(99, 102, 241, 0.2)",
          }}
        >
          {getConditionLabel(condition)}
        </span>
        <span style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>
          {data.length} data points
        </span>
      </div>

      <ResponsiveContainer width="100%" height={320}>
        <AreaChart
          data={data}
          margin={{ top: 5, right: 10, left: 10, bottom: 5 }}
        >
          <defs>
            <linearGradient id="priceGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#6366f1" stopOpacity={0.3} />
              <stop offset="100%" stopColor="#6366f1" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid
            strokeDasharray="3 3"
            stroke="rgba(255,255,255,0.05)"
            vertical={false}
          />
          <XAxis
            dataKey="date"
            tick={{ fill: "#64748b", fontSize: 11 }}
            axisLine={{ stroke: "rgba(255,255,255,0.1)" }}
            tickLine={false}
            interval="preserveStartEnd"
          />
          <YAxis
            tickFormatter={(val) => `$${(val / 100).toFixed(0)}`}
            tick={{ fill: "#64748b", fontSize: 11 }}
            axisLine={false}
            tickLine={false}
            domain={[minPrice - padding, maxPrice + padding]}
            width={65}
          />
          <Tooltip content={<CustomTooltip />} />
          <Area
            type="monotone"
            dataKey="price"
            stroke="#6366f1"
            strokeWidth={2}
            fill="url(#priceGradient)"
            dot={false}
            activeDot={{
              r: 5,
              fill: "#6366f1",
              stroke: "#fff",
              strokeWidth: 2,
            }}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
