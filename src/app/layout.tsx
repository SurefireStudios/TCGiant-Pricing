import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "TCGiant Pricing — Trading Card Price Guide",
    template: "%s | TCGiant Pricing",
  },
  description:
    "Free trading card price guide for Pokemon, YuGiOh, Magic, Lorcana, and more. Track ungraded and graded (PSA, CGC, BGS, TAG) card prices from real eBay sales data.",
  keywords: [
    "trading card prices",
    "pokemon card prices",
    "PSA 10 prices",
    "card price guide",
    "TCG pricing",
    "graded card prices",
    "eBay sold prices",
  ],
  openGraph: {
    title: "TCGiant Pricing — Trading Card Price Guide",
    description:
      "Track real market prices for trading cards. Powered by eBay sold data.",
    siteName: "TCGiant Pricing",
    type: "website",
  },
  manifest: "/manifest.json",
};

export const viewport = {
  themeColor: "#0f172a",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body suppressHydrationWarning>
        <header className="site-header">
          <div className="header-inner">
            <a href="/pricing" className="logo" style={{ display: "flex", alignItems: "center", gap: "10px" }}>
              <img src="/monster-logo.png" alt="TCGiant Mascot" style={{ height: "38px", width: "auto", objectFit: "contain" }} />
              TCGiant Pricing
            </a>
            <nav>
              <ul className="nav-links">
                <li>
                  <a href="/pricing" className="active">
                    Home
                  </a>
                </li>
                <li>
                  <a href="/pricing/pokemon">Pokémon</a>
                </li>
                <li>
                  <a href="/pricing/docs">API Docs</a>
                </li>
              </ul>
            </nav>
            <div className="header-actions">
              <a href="https://tcgiant.com" className="btn btn-secondary" style={{ padding: "8px 18px", fontSize: "0.85rem" }}>
                Main Site
              </a>
              <a href="/pricing/docs" className="btn btn-primary" style={{ padding: "8px 18px", fontSize: "0.85rem", color: "white" }}>
                API Docs
              </a>
            </div>
          </div>
        </header>
        <main>{children}</main>
        <footer className="fat-footer">
          <div className="container">
            <div className="footer-grid">
              <div className="footer-col">
                <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "20px" }}>
                  <img src="/monster-logo.png" alt="TCGiant Mascot" style={{ height: "32px", width: "auto" }} />
                  <span style={{ fontSize: "1.2rem", fontWeight: 700, color: "#fff" }}>TCGiant Pricing</span>
                </div>
                <p style={{ color: "var(--text-muted)", fontSize: "0.95rem", lineHeight: 1.6, maxWidth: "280px" }}>
                  Building a cleaner, smarter software stack for multi-channel e-commerce sellers.
                </p>
              </div>
              <div className="footer-col">
                <h4>Pricing</h4>
                <a href="/pricing">Home</a>
                <a href="/pricing/pokemon">Pokémon</a>
              </div>
              <div className="footer-col">
                <h4>Developers</h4>
                <a href="/pricing/docs">API Documentation</a>
                <a href="mailto:hello@tcgiant.com">Support</a>
              </div>
              <div className="footer-col">
                <h4>Legal</h4>
                <a href="#">Privacy Policy</a>
                <a href="#">Terms of Service</a>
              </div>
            </div>
            <div className="footer-bottom">
              <div>© {new Date().getFullYear()} TCGiant. All rights reserved.</div>
              <div>Designed and developed by <a href="https://www.surefirestudios.io" target="_blank" rel="noreferrer" style={{ color: "var(--color-primary)" }}>Surefire Studios</a></div>
            </div>
          </div>
        </footer>
      </body>
    </html>
  );
}
