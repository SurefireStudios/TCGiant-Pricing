"use client";

import { useState } from "react";
import { getConditionLabel } from "@/lib/grade-parser";
import type { CardCondition } from "@/lib/grade-parser";
import { formatPrice } from "@/lib/pricing-engine";

export interface Sale {
  id: string;
  salePrice: number;
  saleDate: string;
  condition: CardCondition;
  gradingCompany: string;
  gradeValue: number | null;
  ebayTitle: string;
  ebayUrl: string | null;
  isOutlier: boolean;
}

interface SalesTableProps {
  sales: Sale[];
  selectedCondition: CardCondition;
  onConditionChange: (condition: CardCondition) => void;
}

function getCompanyBadgeClass(company: string): string {
  switch (company) {
    case "PSA":
      return "badge-psa";
    case "CGC":
      return "badge-cgc";
    case "BGS":
      return "badge-bgs";
    case "TAG":
      return "badge-tag";
    default:
      return "badge-ungraded";
  }
}

export default function SalesTable({
  sales,
  selectedCondition,
  onConditionChange,
}: SalesTableProps) {
  const [filterCondition, setFilterCondition] = useState<string>("all");

  const safeSales = sales || [];
  const filteredSales =
    filterCondition === "all"
      ? safeSales
      : safeSales.filter((s) => s.condition === filterCondition);

  return (
    <div>
      {/* Filter Bar */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "var(--space-sm)",
          marginBottom: "var(--space-md)",
          overflowX: "auto",
        }}
      >
        <span
          style={{
            fontSize: "0.75rem",
            color: "var(--text-muted)",
            fontWeight: 600,
            flexShrink: 0,
          }}
        >
          Filter:
        </span>
        <div className="filter-tabs">
          <button
            className={`filter-tab ${filterCondition === "all" ? "active" : ""}`}
            onClick={() => setFilterCondition("all")}
          >
            All
          </button>
          <button
            className={`filter-tab ${filterCondition === "UNGRADED" ? "active" : ""}`}
            onClick={() => setFilterCondition("UNGRADED")}
          >
            Ungraded
          </button>
          <button
            className={`filter-tab ${filterCondition === "PSA_10" ? "active" : ""}`}
            onClick={() => setFilterCondition("PSA_10")}
          >
            PSA 10
          </button>
          <button
            className={`filter-tab ${filterCondition === "CGC_10" ? "active" : ""}`}
            onClick={() => setFilterCondition("CGC_10")}
          >
            CGC 10
          </button>
          <button
            className={`filter-tab ${filterCondition === "BGS_10" ? "active" : ""}`}
            onClick={() => setFilterCondition("BGS_10")}
          >
            BGS 10
          </button>
          <button
            className={`filter-tab ${filterCondition === "TAG_10" ? "active" : ""}`}
            onClick={() => setFilterCondition("TAG_10")}
          >
            TAG 10
          </button>
          {["GRADE_9", "GRADE_9_5", "GRADE_8", "GRADE_7"].map((cond) => (
            <button
              key={cond}
              className={`filter-tab ${filterCondition === cond ? "active" : ""}`}
              onClick={() => setFilterCondition(cond)}
            >
              {getConditionLabel(cond as CardCondition)}
            </button>
          ))}
        </div>
      </div>

      {/* Table */}
      <div
        className="glass-card"
        style={{
          overflow: "hidden",
          border: "1px solid var(--border-subtle)",
        }}
      >
        <div style={{ overflowX: "auto" }}>
          <table className="data-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Price</th>
                <th>Grade</th>
                <th>Company</th>
                <th>eBay Title</th>
                <th>Link</th>
              </tr>
            </thead>
            <tbody>
              {filteredSales.length === 0 && (
                <tr>
                  <td
                    colSpan={6}
                    style={{
                      textAlign: "center",
                      padding: "var(--space-2xl) var(--space-xl)",
                      color: "var(--text-muted)",
                    }}
                  >
                    <div style={{ fontSize: "2rem", marginBottom: "var(--space-sm)" }}>📊</div>
                    <div style={{ fontWeight: 600, marginBottom: "var(--space-xs)" }}>
                      No sales data yet
                    </div>
                    <div style={{ fontSize: "0.8rem" }}>
                      {safeSales.length === 0
                        ? "Sales data will appear once the eBay scraper begins collecting sold listings."
                        : "No sales found for this filter. Try selecting a different condition."}
                    </div>
                  </td>
                </tr>
              )}
              {filteredSales.map((sale) => (
                <tr
                  key={sale.id}
                  style={
                    sale.isOutlier
                      ? { opacity: 0.6 }
                      : undefined
                  }
                >
                  <td style={{ whiteSpace: "nowrap" }}>{sale.saleDate}</td>
                  <td>
                    <span
                      className="price font-mono"
                      style={{ fontWeight: 600, color: "var(--text-primary)" }}
                    >
                      {formatPrice(sale.salePrice)}
                    </span>
                    {sale.isOutlier && (
                      <span
                        className="badge badge-outlier"
                        style={{ marginLeft: 8 }}
                      >
                        Outlier
                      </span>
                    )}
                  </td>
                  <td>
                    <span className="font-mono">
                      {sale.gradeValue !== null ? sale.gradeValue : "—"}
                    </span>
                  </td>
                  <td>
                    <span
                      className={`badge ${getCompanyBadgeClass(sale.gradingCompany)}`}
                    >
                      {sale.gradingCompany === "UNGRADED"
                        ? "Raw"
                        : sale.gradingCompany}
                    </span>
                  </td>
                  <td
                    style={{
                      maxWidth: 300,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                      fontSize: "0.8rem",
                    }}
                    title={sale.ebayTitle}
                  >
                    {sale.ebayTitle}
                  </td>
                  <td>
                    {sale.ebayUrl ? (
                      <a
                        href={sale.ebayUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="btn btn-ghost btn-sm"
                        style={{ fontSize: "0.7rem" }}
                      >
                        eBay →
                      </a>
                    ) : (
                      <span style={{ fontSize: "0.7rem", color: "var(--text-muted)" }}>—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {safeSales.length > 0 && (
        <div
          style={{
            display: "flex",
            justifyContent: "center",
            marginTop: "var(--space-md)",
          }}
        >
          <span style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>
            Showing {filteredSales.length} of {safeSales.length} sales ·
            Outliers are included but visually marked
          </span>
        </div>
      )}
    </div>
  );
}
