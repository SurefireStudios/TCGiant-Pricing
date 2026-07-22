import type { Metadata } from "next";
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { eq, desc, asc } from "drizzle-orm";
import { notFound } from "next/navigation";
import * as schema from "@/db/schema";
import CardDetailClient from "./CardDetailClient";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const sqlClient = neon(process.env.DATABASE_URL!);
  const db = drizzle(sqlClient, { schema });

  const cards = await db
    .select({
      name: schema.cards.name,
      setName: schema.sets.name,
    })
    .from(schema.cards)
    .innerJoin(schema.sets, eq(schema.cards.setId, schema.sets.id))
    .where(eq(schema.cards.slug, slug))
    .limit(1);

  if (cards.length === 0) {
    return { title: "Card Not Found | TCGiant" };
  }

  return {
    title: `${cards[0].name} - ${cards[0].setName} Price | TCGiant`,
    description: `Market prices for ${cards[0].name} from ${cards[0].setName}. View ungraded and graded (PSA, CGC, BGS, TAG) prices, price history, and recent eBay sales.`,
  };
}

export default async function CardDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;

  const sqlClient = neon(process.env.DATABASE_URL!);
  const db = drizzle(sqlClient, { schema });

  // Fetch card with set and game joins
  const results = await db
    .select({
      id: schema.cards.id,
      name: schema.cards.name,
      slug: schema.cards.slug,
      cardNumber: schema.cards.cardNumber,
      rarity: schema.cards.rarity,
      supertype: schema.cards.supertype,
      subtypes: schema.cards.subtypes,
      hp: schema.cards.hp,
      imageUrl: schema.cards.imageUrl,
      imageLargeUrl: schema.cards.imageLargeUrl,
      artist: schema.cards.artist,
      variant: schema.cards.variant,
      setName: schema.sets.name,
      setSlug: schema.sets.slug,
      gameName: schema.games.name,
      gameSlug: schema.games.slug,
    })
    .from(schema.cards)
    .innerJoin(schema.sets, eq(schema.cards.setId, schema.sets.id))
    .innerJoin(schema.games, eq(schema.sets.gameId, schema.games.id))
    .where(eq(schema.cards.slug, slug))
    .limit(1);

  if (results.length === 0) {
    notFound();
  }

  const card = results[0];

  // Fetch current prices
  const prices = await db
    .select()
    .from(schema.currentPrices)
    .where(eq(schema.currentPrices.cardId, card.id));

  const priceMap: Record<string, number | null> = {};
  for (const p of prices) {
    priceMap[p.condition] = p.marketPrice;
  }

  // Fetch recent sales
  const salesData = await db
    .select()
    .from(schema.sales)
    .where(eq(schema.sales.cardId, card.id))
    .orderBy(desc(schema.sales.saleDate))
    .limit(100);

  const formattedSales = salesData.map(s => ({
    id: s.id.toString(),
    salePrice: s.salePrice,
    saleDate: s.saleDate.toISOString().split("T")[0],
    condition: s.condition,
    gradingCompany: s.gradingCompany,
    gradeValue: s.gradeValue !== null ? Number(s.gradeValue) : null,
    ebayTitle: s.ebayTitle || "",
    ebayUrl: s.ebayUrl,
    isOutlier: s.isOutlier
  }));

  // Fetch all historical sales for rich price history timeline
  const allSalesForHistory = await db
    .select({
      salePrice: schema.sales.salePrice,
      saleDate: schema.sales.saleDate,
      condition: schema.sales.condition,
      isOutlier: schema.sales.isOutlier,
    })
    .from(schema.sales)
    .where(eq(schema.sales.cardId, card.id))
    .orderBy(asc(schema.sales.saleDate));

  // Build price history timeline grouped by date & condition
  const dateMap: Record<string, Record<string, { totalCents: number; count: number }>> = {};

  for (const s of allSalesForHistory) {
    if (s.isOutlier) continue;
    const dateStr = s.saleDate.toISOString().split("T")[0];
    if (!dateMap[dateStr]) dateMap[dateStr] = {};
    if (!dateMap[dateStr][s.condition]) dateMap[dateStr][s.condition] = { totalCents: 0, count: 0 };
    dateMap[dateStr][s.condition].totalCents += s.salePrice;
    dateMap[dateStr][s.condition].count += 1;
  }

  const salesHistoryPoints: any[] = [];
  for (const dateStr of Object.keys(dateMap).sort()) {
    for (const cond of Object.keys(dateMap[dateStr])) {
      const avgPrice = Math.round(dateMap[dateStr][cond].totalCents / dateMap[dateStr][cond].count);
      const dateObj = new Date(dateStr);
      salesHistoryPoints.push({
        date: dateObj.toLocaleDateString("en-US", { month: "short", day: "numeric" }),
        fullDate: dateObj.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }),
        price: avgPrice,
        sales: dateMap[dateStr][cond].count,
        condition: cond,
        rawDate: dateStr,
      });
    }
  }

  let formattedHistory = salesHistoryPoints;

  if (formattedHistory.length === 0) {
    const historyData = await db
      .select()
      .from(schema.priceSnapshots)
      .where(eq(schema.priceSnapshots.cardId, card.id))
      .orderBy(asc(schema.priceSnapshots.snapshotDate));

    formattedHistory = historyData.map(h => {
      const dateObj = new Date(h.snapshotDate);
      return {
        date: dateObj.toLocaleDateString("en-US", { month: "short", day: "numeric" }),
        fullDate: dateObj.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }),
        price: h.marketPrice || 0,
        sales: h.saleCount,
        condition: h.condition,
        rawDate: h.snapshotDate,
      };
    });
  }

  // Serialize card data for client component
  const cardData = {
    id: card.id,
    name: card.name,
    cardNumber: card.cardNumber,
    setName: card.setName,
    setSlug: card.setSlug,
    game: card.gameName,
    gameSlug: card.gameSlug,
    variant: card.variant,
    rarity: card.rarity || "Unknown",
    supertype: card.supertype || "Pokémon",
    hp: card.hp || null,
    artist: card.artist || "Unknown",
    imageUrl: card.imageLargeUrl || card.imageUrl || "",
    prices: priceMap,
    saleCount: formattedSales.length,
    lastUpdated: new Date().toISOString().split("T")[0],
    sales: formattedSales,
    priceHistory: formattedHistory,
  };

  return <CardDetailClient card={cardData} />;
}
