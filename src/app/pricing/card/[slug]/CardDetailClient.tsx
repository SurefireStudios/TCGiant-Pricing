"use client";

import { useState } from "react";
import { getConditionLabel } from "@/lib/grade-parser";
import type { CardCondition } from "@/lib/grade-parser";
import { formatPrice } from "@/lib/pricing-engine";
import PriceChart from "@/components/PriceChart";
import type { PriceDataPoint } from "@/components/PriceChart";
import SalesTable from "@/components/SalesTable";
import type { Sale } from "@/components/SalesTable";
import FallbackImage from "@/components/FallbackImage";

interface CardData {
  id: number;
  name: string;
  cardNumber: string | null;
  setName: string;
  setSlug: string;
  game: string;
  gameSlug: string;
  rarity: string;
  supertype: string;
  hp: string | null;
  artist: string;
  variant?: string;
  imageUrl: string;
  prices: Record<string, number | null>;
  volumes?: Record<string, string | null>;
  saleCount: number;
  lastUpdated: string;
  sales: Sale[];
  priceHistory: (PriceDataPoint & { condition: string })[];
}

const ALL_CONDITIONS: CardCondition[] = [
  "UNGRADED",
  "GRADE_1",
  "GRADE_2",
  "GRADE_3",
  "GRADE_4",
  "GRADE_5",
  "GRADE_6",
  "GRADE_7",
  "GRADE_8",
  "GRADE_9",
  "GRADE_9_5",
  "PSA_10",
  "CGC_10",
  "BGS_10",
  "TAG_10",
];

const QUICK_CONDITIONS: CardCondition[] = [
  "UNGRADED",
  "GRADE_9",
  "GRADE_9_5",
  "PSA_10",
  "CGC_10",
  "BGS_10",
  "TAG_10",
];

function getConditionBadgeClass(condition: CardCondition): string {
  if (condition.startsWith("PSA")) return "badge-psa";
  if (condition.startsWith("CGC")) return "badge-cgc";
  if (condition.startsWith("BGS")) return "badge-bgs";
  if (condition.startsWith("TAG")) return "badge-tag";
  return "badge-ungraded";
}

export default function CardDetailClient({ card }: { card: CardData }) {
  const [selectedCondition, setSelectedCondition] =
    useState<CardCondition>("UNGRADED");
  const [chartTimeRange, setChartTimeRange] = useState("90d");

  const currentPrice = card.prices[selectedCondition];
  const hasPrices = Object.values(card.prices).some((p) => p !== null && p !== undefined);

  return (
    <div
      className="container"
      style={{
        position: "relative",
        zIndex: 1,
        paddingTop: "var(--space-2xl)",
        paddingBottom: "var(--space-3xl)",
      }}
    >
      {/* Breadcrumb */}
      <nav
        style={{
          fontSize: "0.8rem",
          color: "var(--text-muted)",
          marginBottom: "var(--space-lg)",
        }}
      >
        <a href="/pricing" style={{ color: "var(--text-muted)" }}>
          Home
        </a>
        {" / "}
        <a
          href={`/pricing/${card.gameSlug}`}
          style={{ color: "var(--text-muted)" }}
        >
          {card.game}
        </a>
        {" / "}
        <a
          href={`/pricing/${card.gameSlug}/${card.setSlug}`}
          style={{ color: "var(--text-muted)" }}
        >
          {card.setName}
        </a>
        {" / "}
        <span style={{ color: "var(--text-primary)" }}>{card.name}</span>
      </nav>

      {/* Card Header */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "240px 1fr",
          gap: "var(--space-xl)",
          marginBottom: "var(--space-2xl)",
        }}
      >
        {/* Card Image */}
        <div
          className="glass-card"
          style={{
            padding: "var(--space-md)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            aspectRatio: "2.5/3.5",
            background:
              "linear-gradient(135deg, var(--bg-glass), var(--bg-elevated))",
          }}
        >
          {card.imageUrl ? (
            <FallbackImage
              src={card.imageUrl}
              alt={`${card.name} - ${card.setName}`}
              style={{
                width: "100%",
                height: "100%",
                maxWidth: "100%",
                maxHeight: "100%",
                borderRadius: "var(--radius-md)",
                objectFit: "contain",
              }}
            />
          ) : (
            <div style={{ fontSize: "3rem", opacity: 0.3 }}>🃏</div>
          )}
        </div>

        {/* Card Info */}
        <div>
          <div style={{ marginBottom: "var(--space-lg)" }}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: "var(--space-sm)",
                marginBottom: "var(--space-xs)",
              }}
            >
              {(card.name.includes('(Japanese)') || card.setName.includes('(Japanese)')) && (
                <span className="badge" style={{ background: "linear-gradient(135deg, #e11d48 0%, #be123c 100%)", color: "#ffffff", fontWeight: 700, border: "none" }}>
                  JPN
                </span>
              )}
              <span className="badge badge-ungraded">{card.rarity}</span>
              {card.variant && card.variant !== 'unlimited' && (
                <span className="badge badge-ungraded" style={{ textTransform: "capitalize", background: "var(--bg-elevated)", color: "var(--text-secondary)", border: "1px solid var(--border-subtle)" }}>
                  {card.variant.replace("_", " ")}
                </span>
              )}
              {card.cardNumber && (
                <span className="text-xs text-muted">
                  #{card.cardNumber}
                </span>
              )}
            </div>
            <h1 style={{ fontSize: "2rem", marginBottom: "var(--space-xs)" }}>
              {card.name}
            </h1>
            <p style={{ color: "var(--text-secondary)", fontSize: "0.9rem" }}>
              {card.setName} · {card.supertype}
              {card.hp ? ` · HP ${card.hp}` : ""}
              {card.artist !== "Unknown" ? ` · Artist: ${card.artist}` : ""}
            </p>
          </div>

          {/* Price Display */}
          <div
            className="glass-card"
            style={{
              padding: "var(--space-lg)",
              marginBottom: "var(--space-lg)",
              background: hasPrices
                ? "linear-gradient(135deg, rgba(99, 102, 241, 0.08), rgba(99, 102, 241, 0.03))"
                : "var(--bg-elevated)",
              border: hasPrices
                ? "1px solid var(--border-primary)"
                : "1px solid var(--border-subtle)",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                flexWrap: "wrap",
                gap: "var(--space-md)",
              }}
            >
              <div>
                <div
                  style={{
                    fontSize: "0.75rem",
                    color: "var(--text-muted)",
                    textTransform: "uppercase",
                    letterSpacing: "0.05em",
                    fontWeight: 600,
                    marginBottom: "var(--space-xs)",
                  }}
                >
                  Market Price ·{" "}
                  <span
                    className={`badge ${getConditionBadgeClass(selectedCondition)}`}
                  >
                    {getConditionLabel(selectedCondition)}
                  </span>
                </div>
                <div className="price price-large">
                  {typeof currentPrice === "number" ? formatPrice(currentPrice) : "Awaiting data"}
                </div>
              </div>

              {/* Controls: Condition */}
              <div
                style={{
                  display: "flex",
                  gap: "var(--space-md)",
                  flexWrap: "wrap",
                }}
              >
                {/* Condition Selector */}
                <div style={{ flex: "1 1 200px" }}>
                  <label
                    style={{
                      display: "block",
                      fontSize: "0.85rem",
                      color: "var(--text-muted)",
                      marginBottom: "var(--space-xs)",
                    }}
                  >
                    Grade / Condition
                  </label>
                  <select
                    className="input-field"
                    value={selectedCondition}
                    onChange={(e) =>
                      setSelectedCondition(e.target.value as CardCondition)
                    }
                    style={{ width: "100%", cursor: "pointer" }}
                  >
                    {ALL_CONDITIONS.map((cond) => {
                      const price = card.prices[cond];
                      return (
                        <option key={cond} value={cond}>
                          {getConditionLabel(cond)}
                          {price !== undefined && price !== null
                            ? ` — ${formatPrice(price)}`
                            : ""}
                        </option>
                      );
                    })}
                  </select>
                </div>
              </div>
              
              <div style={{ textAlign: "right" }}>
                <div style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginBottom: 4 }}>
                  Total Sales
                </div>
                <div className="font-mono" style={{ fontSize: "1.25rem", fontWeight: 700 }}>
                  {card.saleCount.toLocaleString()}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* All Prices Grid */}
      <section className="section">
        <div className="section-header">
          <h2 className="section-title">All Prices</h2>
        </div>
        <div className="price-grid">
          {ALL_CONDITIONS.map((condition) => {
            const price = card.prices[condition];
            return (
              <button
                key={condition}
                className="price-grid-item"
                style={{
                  cursor: "pointer",
                  border:
                    selectedCondition === condition
                      ? "1px solid var(--color-primary)"
                      : "1px solid var(--border-subtle)",
                  background:
                    selectedCondition === condition
                      ? "var(--bg-hover)"
                      : "var(--bg-elevated)",
                }}
                onClick={() => setSelectedCondition(condition)}
              >
                <div className="price-grid-label">
                  {getConditionLabel(condition)}
                </div>
                <div className={`price-grid-value ${!price ? "no-data" : ""}`}>
                  {price ? formatPrice(price) : "—"}
                </div>
                {card.volumes && card.volumes[condition] && (
                  <div style={{ fontSize: "0.68rem", color: "var(--text-muted)", marginTop: 4, whiteSpace: "nowrap" }}>
                    volume: <span style={{ color: "var(--color-primary-light)", fontWeight: 500 }}>{card.volumes[condition]}</span>
                  </div>
                )}
              </button>
            );
          })}
        </div>
      </section>

      {/* Price Chart */}
      <section className="section">
        <div className="section-header">
          <h2 className="section-title">Price History</h2>
          <div className="filter-tabs" style={{ width: "auto" }}>
            {["7d", "30d", "90d", "1y", "All"].map((range) => (
              <button
                key={range}
                className={`filter-tab ${chartTimeRange === range ? "active" : ""}`}
                onClick={() => setChartTimeRange(range)}
              >
                {range}
              </button>
            ))}
          </div>
        </div>
        <div className="chart-container">
          <PriceChart condition={selectedCondition} timeRange={chartTimeRange} data={card.priceHistory.filter(h => h.condition === selectedCondition)} />
        </div>
      </section>

      {/* Recent Sales */}
      <section className="section">
        <div className="section-header">
          <h2 className="section-title">Recent Sales</h2>
        </div>
        <SalesTable
          sales={card.sales}
          selectedCondition={selectedCondition}
          onConditionChange={setSelectedCondition}
        />
      </section>
    </div>
  );
}
