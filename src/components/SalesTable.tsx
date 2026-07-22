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
  cardId?: number;
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
  cardId,
  sales,
  selectedCondition,
  onConditionChange,
}: SalesTableProps) {
  const [filterCondition, setFilterCondition] = useState<string>("all");
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [loadedSales, setLoadedSales] = useState<Sale[]>(sales || []);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [apiPage, setApiPage] = useState<number>(1); // 1 is handled by server init essentially, but we start fetching at 2

  const itemsPerPage = 15;

  const filteredSales =
    filterCondition === "all"
      ? loadedSales
      : loadedSales.filter((s) => s.condition === filterCondition);

  const totalPages = Math.max(1, Math.ceil(filteredSales.length / itemsPerPage));
  const startIndex = (currentPage - 1) * itemsPerPage;
  const paginatedSales = filteredSales.slice(startIndex, startIndex + itemsPerPage);

  const handleFilterChange = (newCond: string) => {
    setFilterCondition(newCond);
    setCurrentPage(1);
  };

  const handleLoadMore = async () => {
    if (!cardId) return;
    setIsLoadingMore(true);
    try {
      const nextPage = apiPage + 1;
      const res = await fetch(`/api/v1/sales?card_id=${cardId}&page=${nextPage}&limit=100`);
      if (res.ok) {
        const data = await res.json();
        if (data.sales && data.sales.length > 0) {
          // Map to match Sale interface
          const newSales: Sale[] = data.sales.map((s: any) => ({
            id: s.id,
            salePrice: s.sale_price,
            saleDate: s.sale_date.split("T")[0],
            condition: s.condition,
            gradingCompany: s.grading_company,
            gradeValue: s.grade_value,
            ebayTitle: s.ebay_title,
            ebayUrl: s.ebay_url,
            isOutlier: s.is_outlier,
          }));
          
          // Deduplicate by ID
          const existingIds = new Set(loadedSales.map(s => s.id));
          const uniqueNewSales = newSales.filter(s => !existingIds.has(s.id));
          
          setLoadedSales([...loadedSales, ...uniqueNewSales]);
          setApiPage(nextPage);
        }
      }
    } catch (err) {
      console.error("Failed to load more sales", err);
    } finally {
      setIsLoadingMore(false);
    }
  };

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
            onClick={() => handleFilterChange("all")}
          >
            All
          </button>
          <button
            className={`filter-tab ${filterCondition === "UNGRADED" ? "active" : ""}`}
            onClick={() => handleFilterChange("UNGRADED")}
          >
            Ungraded
          </button>
          <button
            className={`filter-tab ${filterCondition === "PSA_10" ? "active" : ""}`}
            onClick={() => handleFilterChange("PSA_10")}
          >
            PSA 10
          </button>
          <button
            className={`filter-tab ${filterCondition === "CGC_10" ? "active" : ""}`}
            onClick={() => handleFilterChange("CGC_10")}
          >
            CGC 10
          </button>
          <button
            className={`filter-tab ${filterCondition === "BGS_10" ? "active" : ""}`}
            onClick={() => handleFilterChange("BGS_10")}
          >
            BGS 10
          </button>
          <button
            className={`filter-tab ${filterCondition === "TAG_10" ? "active" : ""}`}
            onClick={() => handleFilterChange("TAG_10")}
          >
            TAG 10
          </button>
          {["GRADE_9", "GRADE_9_5", "GRADE_8", "GRADE_7"].map((cond) => (
            <button
              key={cond}
              className={`filter-tab ${filterCondition === cond ? "active" : ""}`}
              onClick={() => handleFilterChange(cond)}
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
                      {loadedSales.length === 0
                        ? "Sales data will appear once the eBay scraper begins collecting sold listings."
                        : "No sales found for this filter. Try selecting a different condition."}
                    </div>
                  </td>
                </tr>
              )}
              {paginatedSales.map((sale) => (
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

      {/* Pagination Controls */}
      {filteredSales.length > 0 && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginTop: "var(--space-md)",
            padding: "0 var(--space-xs)",
            flexWrap: "wrap",
            gap: "var(--space-sm)",
          }}
        >
          <span style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>
            Showing {startIndex + 1}–{Math.min(startIndex + itemsPerPage, filteredSales.length)} of {filteredSales.length} sales
          </span>

          {totalPages > 1 && (
            <div style={{ display: "flex", alignItems: "center", gap: "var(--space-xs)" }}>
              <button
                className="btn btn-ghost btn-sm"
                disabled={currentPage === 1}
                onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                style={{ fontSize: "0.75rem", opacity: currentPage === 1 ? 0.4 : 1 }}
              >
                ← Previous
              </button>
              <span style={{ fontSize: "0.75rem", color: "var(--text-secondary)", fontWeight: 600, padding: "0 8px" }}>
                Page {currentPage} of {totalPages}
              </span>
              <button
                className="btn btn-ghost btn-sm"
                disabled={currentPage === totalPages}
                onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                style={{ fontSize: "0.75rem", opacity: currentPage === totalPages ? 0.4 : 1 }}
              >
                Next →
              </button>
            </div>
          )}
        </div>
      )}

      {/* Load More Button */}
      {cardId && (
        <div style={{ display: "flex", justifyContent: "center", marginTop: "var(--space-lg)" }}>
          <button
            className="btn btn-secondary"
            onClick={handleLoadMore}
            disabled={isLoadingMore}
            style={{ minWidth: 200 }}
          >
            {isLoadingMore ? "Loading..." : "Load Older Sales"}
          </button>
        </div>
      )}
    </div>
  );
}
