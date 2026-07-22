"use client";

import { useState, useRef, useEffect, useCallback } from "react";

interface SearchResult {
  id: string;
  name: string;
  slug: string;
  card_number: string;
  rarity: string;
  image_url: string;
  set_name: string;
  set_slug: string;
}

export default function SearchAutocomplete() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<NodeJS.Timeout | null>(null);

  // Fetch suggestions from API
  const fetchSuggestions = useCallback(async (searchQuery: string) => {
    if (searchQuery.length < 2) {
      setResults([]);
      setIsOpen(false);
      return;
    }

    setIsLoading(true);
    try {
      const res = await fetch(
        `/api/v1/cards?key=tcg_internal_dev_key_change_in_production&q=${encodeURIComponent(searchQuery)}&limit=8`
      );
      const data = await res.json();

      if (data.status === "success" && data.products) {
        setResults(data.products);
        setIsOpen(data.products.length > 0);
        setSelectedIndex(-1);
      }
    } catch (err) {
      console.error("Search error:", err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Debounced input handler
  const handleInputChange = (value: string) => {
    setQuery(value);

    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }

    debounceRef.current = setTimeout(() => {
      fetchSuggestions(value);
    }, 200);
  };

  // Navigate to a card
  const navigateToCard = (slug: string) => {
    setIsOpen(false);
    setQuery("");
    window.location.href = `/pricing/card/${slug}`;
  };

  // Navigate to search results page
  const navigateToSearch = () => {
    if (selectedIndex >= 0 && results[selectedIndex]) {
      navigateToCard(results[selectedIndex].slug);
    } else if (results.length > 0) {
      navigateToCard(results[0].slug);
    }
  };

  // Keyboard navigation
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!isOpen) {
      if (e.key === "Enter" && query.length >= 2) {
        fetchSuggestions(query);
      }
      return;
    }

    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        setSelectedIndex((prev) =>
          prev < results.length - 1 ? prev + 1 : 0
        );
        break;
      case "ArrowUp":
        e.preventDefault();
        setSelectedIndex((prev) =>
          prev > 0 ? prev - 1 : results.length - 1
        );
        break;
      case "Enter":
        e.preventDefault();
        navigateToSearch();
        break;
      case "Escape":
        setIsOpen(false);
        setSelectedIndex(-1);
        break;
    }
  };

  // Close dropdown on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(e.target as Node) &&
        inputRef.current &&
        !inputRef.current.contains(e.target as Node)
      ) {
        setIsOpen(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Cleanup debounce on unmount
  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  return (
    <div style={{ position: "relative", width: "100%", zIndex: 9999 }}>
      {/* Search Input */}
      <div className="search-wrapper">
        <span className="search-icon">
          {isLoading ? (
            <span
              style={{
                display: "inline-block",
                width: 16,
                height: 16,
                border: "2px solid var(--text-muted)",
                borderTopColor: "var(--color-primary)",
                borderRadius: "50%",
                animation: "spin 0.6s linear infinite",
              }}
            />
          ) : (
            "🔍"
          )}
        </span>
        <input
          ref={inputRef}
          type="search"
          className="search-input"
          placeholder="Search cards... (e.g., Charizard, Pikachu)"
          value={query}
          onChange={(e) => handleInputChange(e.target.value)}
          onKeyDown={handleKeyDown}
          onFocus={() => {
            if (results.length > 0) setIsOpen(true);
          }}
          autoComplete="off"
          role="combobox"
          aria-expanded={isOpen}
          aria-haspopup="listbox"
          aria-autocomplete="list"
        />
      </div>

      {/* Autocomplete Dropdown */}
      {isOpen && (
        <div
          ref={dropdownRef}
          role="listbox"
          style={{
            position: "absolute",
            top: "calc(100% + 4px)",
            left: 0,
            right: 0,
            background: "#0d0d14",
            border: "1px solid rgba(255,255,255,0.12)",
            borderRadius: "var(--radius-lg)",
            boxShadow: "0 12px 48px rgba(0, 0, 0, 0.8), 0 0 0 1px rgba(255,255,255,0.06)",
            zIndex: 99999,
            maxHeight: 420,
            overflowY: "auto",
            isolation: "isolate",
          }}
        >
          {results.map((result, index) => (
            <button
              key={result.id}
              role="option"
              aria-selected={index === selectedIndex}
              onClick={() => navigateToCard(result.slug)}
              onMouseEnter={() => setSelectedIndex(index)}
              style={{
                width: "100%",
                display: "flex",
                alignItems: "center",
                gap: "var(--space-md)",
                padding: "10px 16px",
                border: "none",
                borderBottom:
                  index < results.length - 1
                    ? "1px solid var(--border-subtle)"
                    : "none",
                background:
                  index === selectedIndex
                    ? "var(--bg-hover)"
                    : "transparent",
                cursor: "pointer",
                textAlign: "left",
                transition: "background 0.15s ease",
              }}
            >
              {/* Card Thumbnail */}
              <div
                style={{
                  width: 36,
                  height: 50,
                  borderRadius: 4,
                  overflow: "hidden",
                  flexShrink: 0,
                  background: "var(--bg-elevated)",
                }}
              >
                {result.image_url && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={result.image_url}
                    alt={result.name}
                    style={{
                      width: "100%",
                      height: "100%",
                      objectFit: "cover",
                    }}
                    loading="lazy"
                  />
                )}
              </div>

              {/* Card Details */}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div
                  style={{
                    color: "var(--text-primary)",
                    fontWeight: 600,
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}
                >
                  {result.slug.startsWith("ja-") ? "🇯🇵 " : "🇺🇸 "}
                  {result.name}
                </div>
                <div
                  style={{
                    fontSize: "0.8rem",
                    color: "var(--text-muted)",
                    display: "flex",
                    gap: "var(--space-sm)",
                    alignItems: "center",
                  }}
                >
                  <span
                    style={{
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                    }}
                  >
                    {result.set_name}
                  </span>
                  <span>•</span>
                  <span>#{result.card_number}</span>
                </div>
              </div>

              {/* Rarity Badge */}
              <span
                className="badge badge-ungraded"
                style={{ fontSize: "0.65rem", flexShrink: 0 }}
              >
                {result.rarity}
              </span>

              {/* Arrow */}
              <span
                style={{
                  color: "var(--text-muted)",
                  fontSize: "0.8rem",
                  flexShrink: 0,
                  opacity: index === selectedIndex ? 1 : 0,
                  transition: "opacity 0.15s",
                }}
              >
                →
              </span>
            </button>
          ))}

          {/* Footer hint */}
          <div
            style={{
              padding: "8px 16px",
              fontSize: "0.7rem",
              color: "var(--text-muted)",
              borderTop: "1px solid var(--border-subtle)",
              display: "flex",
              justifyContent: "space-between",
            }}
          >
            <span>
              <kbd style={{ background: "var(--bg-elevated)", padding: "1px 5px", borderRadius: 3, fontSize: "0.65rem" }}>↑↓</kbd> Navigate
              {" · "}
              <kbd style={{ background: "var(--bg-elevated)", padding: "1px 5px", borderRadius: 3, fontSize: "0.65rem" }}>Enter</kbd> Select
              {" · "}
              <kbd style={{ background: "var(--bg-elevated)", padding: "1px 5px", borderRadius: 3, fontSize: "0.65rem" }}>Esc</kbd> Close
            </span>
            <span>{results.length} results</span>
          </div>
        </div>
      )}

      {/* Spinner animation */}
      <style jsx>{`
        @keyframes spin {
          to {
            transform: rotate(360deg);
          }
        }
      `}</style>
    </div>
  );
}
