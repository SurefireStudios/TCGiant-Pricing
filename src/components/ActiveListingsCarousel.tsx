"use client";

import React, { useEffect, useState } from "react";
import Image from "next/image";

interface EbayListing {
  itemId: string;
  title: string;
  price: number;
  currency: string;
  itemUrl: string;
  imageUrl?: string;
  seller?: string;
}

interface ActiveListingsCarouselProps {
  cardId: number;
  storeUsername?: string;
}

export default function ActiveListingsCarousel({ cardId, storeUsername }: ActiveListingsCarouselProps) {
  const [listings, setListings] = useState<EbayListing[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;
    setLoading(true);

    const fetchListings = async () => {
      try {
        const url = `/api/v1/ebay/active?cardId=${cardId}${storeUsername ? `&storeUsername=${encodeURIComponent(storeUsername)}` : ""}`;
        const res = await fetch(url);
        if (!res.ok) throw new Error("Failed to fetch listings");
        const data = await res.json();
        if (isMounted && data.success) {
          setListings(data.listings || []);
        }
      } catch (err: any) {
        if (isMounted) setError(err.message);
      } finally {
        if (isMounted) setLoading(false);
      }
    };

    fetchListings();

    return () => {
      isMounted = false;
    };
  }, [cardId, storeUsername]);

  if (loading) {
    return (
      <div style={{ padding: "var(--space-md) 0", borderBottom: "1px solid var(--border-color)" }}>
        <h3 style={{ fontSize: "1.1rem", marginBottom: "var(--space-md)" }}>Live eBay Listings</h3>
        <div style={{ display: "flex", gap: "var(--space-sm)", overflowX: "auto" }}>
          {[1, 2, 3, 4].map((i) => (
            <div key={i} style={{
              flex: "0 0 200px",
              height: "250px",
              backgroundColor: "var(--bg-secondary)",
              borderRadius: "var(--radius-md)",
              animation: "pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite"
            }} />
          ))}
        </div>
      </div>
    );
  }

  if (error || listings.length === 0) {
    return null; // Don't show the section if no live listings or error
  }

  return (
    <div style={{ padding: "var(--space-lg) 0", borderBottom: "1px solid var(--border-color)" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "var(--space-md)" }}>
        <h3 style={{ fontSize: "1.2rem", display: "flex", alignItems: "center", gap: "8px" }}>
          <span style={{ color: "#e53238" }}>eBay</span> Live Inventory
        </h3>
      </div>
      
      <div style={{ 
        display: "flex", 
        gap: "var(--space-md)", 
        overflowX: "auto", 
        paddingBottom: "var(--space-sm)",
        WebkitOverflowScrolling: "touch",
        scrollbarWidth: "thin"
      }}>
        {listings.map((listing) => {
          const isFeatured = storeUsername && listing.seller?.toLowerCase() === storeUsername.toLowerCase();
          
          return (
            <a
              key={listing.itemId}
              href={listing.itemUrl}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                flex: "0 0 220px",
                display: "flex",
                flexDirection: "column",
                backgroundColor: "var(--bg-secondary)",
                borderRadius: "var(--radius-lg)",
                overflow: "hidden",
                textDecoration: "none",
                color: "inherit",
                border: isFeatured ? "2px solid var(--color-primary)" : "1px solid var(--border-color)",
                transition: "transform 0.2s, box-shadow 0.2s",
                position: "relative"
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.transform = "translateY(-4px)";
                e.currentTarget.style.boxShadow = "0 10px 15px -3px rgba(0, 0, 0, 0.1)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.transform = "none";
                e.currentTarget.style.boxShadow = "none";
              }}
            >
              {isFeatured && (
                <div style={{
                  position: "absolute",
                  top: 8,
                  right: 8,
                  backgroundColor: "var(--color-primary)",
                  color: "white",
                  padding: "4px 8px",
                  borderRadius: "20px",
                  fontSize: "0.7rem",
                  fontWeight: "bold",
                  zIndex: 2,
                  boxShadow: "0 2px 4px rgba(0,0,0,0.2)"
                }}>
                  🌟 Direct from TCGiant
                </div>
              )}
              
              <div style={{ height: "200px", width: "100%", position: "relative", backgroundColor: "#fff" }}>
                {listing.imageUrl ? (
                  <Image
                    src={listing.imageUrl}
                    alt={listing.title}
                    fill
                    style={{ objectFit: "contain", padding: "10px" }}
                    unoptimized
                  />
                ) : (
                  <div style={{ height: "100%", display: "flex", alignItems: "center", justifyContent: "center" }}>
                    No Image
                  </div>
                )}
              </div>
              
              <div style={{ padding: "var(--space-sm)", display: "flex", flexDirection: "column", flexGrow: 1 }}>
                <h4 style={{ 
                  fontSize: "0.85rem", 
                  fontWeight: 500,
                  display: "-webkit-box",
                  WebkitLineClamp: 2,
                  WebkitBoxOrient: "vertical",
                  overflow: "hidden",
                  marginBottom: "var(--space-xs)"
                }}>
                  {listing.title}
                </h4>
                
                <div style={{ marginTop: "auto" }}>
                  <div style={{ fontSize: "1.1rem", fontWeight: "bold", color: "var(--color-primary)" }}>
                    ${(listing.price / 100).toFixed(2)}
                  </div>
                  <div style={{ fontSize: "0.7rem", color: "var(--text-muted)", marginTop: "4px" }}>
                    Seller: {listing.seller}
                  </div>
                </div>
              </div>
            </a>
          );
        })}
      </div>
    </div>
  );
}
