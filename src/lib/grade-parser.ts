/**
 * Grade Parser — Detects grading company and grade from eBay listing titles
 *
 * This module parses eBay listing titles to determine:
 * 1. Whether a card is graded or ungraded
 * 2. Which grading company graded it (PSA, CGC, BGS, TAG)
 * 3. What grade it received (1-10, including 9.5)
 *
 * The parser handles many title variations found on eBay:
 * - "PSA 10 Gem Mint Charizard"
 * - "Charizard Base Set PSA10"
 * - "BGS 9.5 Beckett Pikachu"
 * - "CGC Perfect 10 Mewtwo"
 * - "TAG 10 Gem Mint Eevee"
 * - "Charizard Holo #4 Base Set" (ungraded)
 */

import { decodeHtmlEntities } from './html-entities';

export type GradingCompany = 'PSA' | 'CGC' | 'BGS' | 'SGC' | 'TAG' | 'UNGRADED';

export type CardVariant = 'unlimited' | '1st_edition' | 'reverse_holo' | 'shadowless';

export type CardCondition =
  | 'UNGRADED'
  | 'GRADE_1'
  | 'GRADE_2'
  | 'GRADE_3'
  | 'GRADE_4'
  | 'GRADE_5'
  | 'GRADE_6'
  | 'GRADE_7'
  | 'GRADE_8'
  | 'GRADE_9'
  | 'GRADE_9_5'
  | 'PSA_10'
  | 'CGC_10'
  | 'BGS_10'
  | 'SGC_10'
  | 'TAG_10';

export interface GradeResult {
  gradingCompany: GradingCompany;
  gradeValue: number | null;
  condition: CardCondition;
  variant: CardVariant;
  confidence: 'high' | 'medium' | 'low';
}

/**
 * Condition adjectives sellers put between the grading company and the number.
 *
 * This is deliberately a CLOSED set. It's what makes the patterns below safe:
 * because only these specific words may sit between company and grade, a title
 * like "PSA Charizard 4/102" cannot be misread as "PSA grade 4".
 *
 * Derived from the actual title shapes in our sales table — the most common
 * misses were "PSA MINT 9", "CGC GEM MINT 10", "PSA NM-MT 8" and "PSA GRADED 7".
 */
const GRADE_ADJECTIVES = [
  'GEM\\s*MINT',
  'GEM\\s*MT',
  'GEM',
  'PRISTINE',
  'PERFECT',
  'BLACK\\s*LABEL',
  'NEAR\\s*MINT',
  'NM[\\s/-]*MINT',
  'NM[\\s/-]*MT',
  'MINT',
  'MT',
  'NM',
  'EX[\\s/-]*MT',
  'EXMT',
  'EX',
  'VG[\\s/-]*EX',
  'VG',
  'GOOD',
  'GD',
  'FAIR',
  'POOR',
  'PR',
].join('|');

/**
 * Punctuation and whitespace allowed between the parts.
 *
 * Safe to be permissive here: it only matches punctuation and spaces, never
 * letters, so it cannot bridge company and an unrelated word.
 * Covers: "PSA-8", "PSA: NM 7", "PSA. 7", 'CGC "MINT 9"', "(BGS) 7".
 */
const SEPARATOR = '[\\s.:,;\\-–—"\'“”()\\[\\]]*';

/** Optional "GRADE"/"GRADED" filler: "BGS GRADE 9", "PSA GRADED: 7" */
const GRADE_FILLER = `(?:GRADED?${SEPARATOR})?`;

/**
 * A grade number: 1-10, optionally with one decimal place.
 * The trailing \b stops "PSA 1999" matching as grade 19.
 */
const GRADE_NUMBER = '(\\d{1,2}(?:\\.\\d)?)\\b';

/**
 * Build the forward pattern for a company:
 *   <COMPANY> [sep] [GRADED] [adjective] [+/-] <number>
 */
function forwardPattern(companyToken: string): RegExp {
  return new RegExp(
    // Leading \b only. A trailing \b would break the very common no-space
    // forms — "PSA10", "PSA9", "CGC9.5" — because there is no word boundary
    // between a letter and a digit. Safety still holds: what follows must be
    // punctuation, a closed-set adjective, or the grade number itself, so
    // "PSAX" or "PSANDBOX" cannot match.
    `\\b(?:${companyToken})` +
      SEPARATOR +
      GRADE_FILLER +
      // Up to two stacked adjectives: "BGS Black Label Pristine 10"
      `(?:(?:${GRADE_ADJECTIVES})[+\\-]?${SEPARATOR}){0,2}` +
      GRADE_NUMBER,
    'i'
  );
}

/**
 * Patterns for each grading company.
 * Each pattern captures the grade number after the company name.
 *
 * Order matters: the first company whose pattern matches wins, so titles that
 * name two companies ("PSA CGC VG-EX 3") resolve to the first parseable one.
 */
const GRADING_PATTERNS: {
  company: GradingCompany;
  patterns: RegExp[];
}[] = [
  {
    company: 'PSA',
    patterns: [
      // "PSA 10", "PSA10", "PSA 9.5", "PSA GEM MINT 10", "PSA MINT 9",
      // "PSA NM-MT 8", "PSA GRADED 7", "PSA: NM 6", "PSA - EX-MT 5"
      forwardPattern('PSA'),
      // Reverse: "10 PSA"
      new RegExp(`\\b${GRADE_NUMBER}\\s*PSA\\b`, 'i'),
    ],
  },
  {
    company: 'BGS',
    patterns: [
      // "BGS 9.5", "BGS10", "BGS PRISTINE 10", "BGS BLACK LABEL 10",
      // "BGS GRADE 9", "BECKETT BGS 9.5", "Beckett 9"
      forwardPattern('BGS|BECKETT\\s*(?:BGS)?'),
      // Reverse: "9.5 BGS"
      new RegExp(`\\b${GRADE_NUMBER}\\s*BGS\\b`, 'i'),
    ],
  },
  {
    company: 'CGC',
    patterns: [
      // "CGC 10", "CGC PERFECT 10", "CGC GEM MINT 10", "CGC MINT 9",
      // "CGC NM/MINT+ 9", "CGC NEAR MINT 8", "CGC GRADE 7", "CGC9.5"
      forwardPattern('CGC'),
      // Reverse: "10 CGC"
      new RegExp(`\\b${GRADE_NUMBER}\\s*CGC\\b`, 'i'),
    ],
  },
  {
    company: 'SGC',
    patterns: [
      // "SGC 9", "SGC GRADED 8", "SGC MINT 9"
      forwardPattern('SGC'),
      // Reverse: "9 SGC"
      new RegExp(`\\b${GRADE_NUMBER}\\s*SGC\\b`, 'i'),
    ],
  },
  {
    company: 'TAG',
    patterns: [
      // "TAG 10", "TAG GEM MINT 10", "TAG10"
      forwardPattern('TAG'),
      // Reverse: "10 TAG"
      new RegExp(`\\b${GRADE_NUMBER}\\s*TAG\\b`, 'i'),
    ],
  },
];

/**
 * Keywords that strongly suggest a card is graded (even if we can't parse the grade).
 * These are used as a secondary signal.
 */
const GRADED_KEYWORDS = [
  /\bGEM\s*MINT\b/i,
  /\bGRADED\b/i,
  /\bSLABBED\b/i,
  /\bSLAB\b/i,
  /\bAUTHENTICATED\b/i,
  /\bCERT(?:IFIED)?\b/i,
];

/**
 * Keywords that strongly suggest a card is NOT graded.
 * Helps disambiguate when title is ambiguous.
 */
const UNGRADED_KEYWORDS = [
  /\bUNGRADED\b/i,
  /\bRAW\b/i,
  /\bNM\b/i,
  /\bNEAR\s*MINT\b/i,
  /\bLP\b/i,
  /\bLIGHTLY\s*PLAYED\b/i,
  /\bMODERATELY\s*PLAYED\b/i,
  /\bHEAVILY\s*PLAYED\b/i,
  /\bDAMAGED\b/i,
  /\bPOOR\b/i,
  // NOTE: bare \bHP\b and \bMP\b were removed. "HP" is a Pokémon stat that
  // appears in a large share of card titles ("Charizard 120 HP"), so matching
  // it flagged ordinary listings as explicitly-ungraded and skewed confidence.
];

/**
 * Map a grade value to a CardCondition.
 * For grade 10, we need to know the grading company to differentiate PSA 10 vs CGC 10 etc.
 */
function gradeToCondition(
  company: GradingCompany,
  gradeValue: number
): CardCondition {
  if (gradeValue === 10) {
    switch (company) {
      case 'PSA':
        return 'PSA_10';
      case 'CGC':
        return 'CGC_10';
      case 'BGS':
        return 'BGS_10';
      case 'SGC':
        return 'SGC_10';
      case 'TAG':
        return 'TAG_10';
      default:
        return 'PSA_10'; // fallback
    }
  }

  if (gradeValue === 9.5) return 'GRADE_9_5';
  if (gradeValue >= 9) return 'GRADE_9';
  if (gradeValue >= 8) return 'GRADE_8';
  if (gradeValue >= 7) return 'GRADE_7';
  if (gradeValue >= 6) return 'GRADE_6';
  if (gradeValue >= 5) return 'GRADE_5';
  if (gradeValue >= 4) return 'GRADE_4';
  if (gradeValue >= 3) return 'GRADE_3';
  if (gradeValue >= 2) return 'GRADE_2';
  if (gradeValue >= 1) return 'GRADE_1';

  return 'UNGRADED';
}

/**
 * Validate that a parsed grade value is within the valid range.
 */
function isValidGrade(value: number): boolean {
  return value >= 1 && value <= 10;
}

/**
 * Parse a title to detect variant types (1st Edition, Reverse Holo, Shadowless)
 */
function parseVariant(title: string): CardVariant {
  const text = title.toLowerCase();

  if (/\b(1st\s*ed(ition)?|first\s*edition)\b/.test(text)) {
    return '1st_edition';
  }

  if (/\bshadowless\b/.test(text)) {
    return 'shadowless';
  }

  // Sellers abbreviate this heavily: "Reverse Holo", "Reverse Foil",
  // "Rev Holo", "REV.FOIL", "rev-foil", "reverse holofoil". The previous
  // pattern required a literal space, so "REV.FOIL" slipped through — which is
  // exactly how a $28,600 reverse-foil PSA 10 ended up pooled with ~$200
  // non-reverse sales of the same card.
  if (/\brev(erse)?[\s.\-]*(holo(foil)?|foil)\b/.test(text)) {
    return 'reverse_holo';
  }

  return 'unlimited';
}

/**
 * Parse an eBay listing title to determine the card's grade.
 *
 * @param title - The eBay listing title
 * @param description - Optional eBay listing description for additional context
 * @returns GradeResult with grading company, grade value, condition, and confidence
 *
 * @example
 * parseGrade("Charizard Base Set PSA 10 Gem Mint #4")
 * // { gradingCompany: 'PSA', gradeValue: 10, condition: 'PSA_10', confidence: 'high' }
 *
 * @example
 * parseGrade("Pikachu VMAX 044/185 CGC 9.5")
 * // { gradingCompany: 'CGC', gradeValue: 9.5, condition: 'GRADE_9_5', confidence: 'high' }
 *
 * @example
 * parseGrade("Dark Charizard 1st Edition Holo NM")
 * // { gradingCompany: 'UNGRADED', gradeValue: null, condition: 'UNGRADED', confidence: 'high' }
 */
export function parseGrade(title: string, description?: string): GradeResult {
  // Scraped titles arrive with HTML entities intact ("NM-MT&#43;9"), which
  // hides the real characters from every pattern below.
  const text = decodeHtmlEntities(title).trim();
  const fullText = description
    ? `${text} ${decodeHtmlEntities(description).trim()}`
    : text;

  const variant = parseVariant(fullText);

  // Check for explicit ungraded keywords first
  const hasUngradedKeyword = UNGRADED_KEYWORDS.some((pattern) =>
    pattern.test(text)
  );

  // Try each grading company's patterns
  for (const { company, patterns } of GRADING_PATTERNS) {
    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match) {
        // Some patterns don't capture a grade (e.g., "PSA AUTHENTIC")
        const gradeStr = match[1];
        if (!gradeStr) {
          // PSA Authentic = authenticated but not numerically graded
          // Treat as ungraded
          continue;
        }

        const gradeValue = parseFloat(gradeStr);

        if (isValidGrade(gradeValue)) {
          // If we also found ungraded keywords, lower confidence
          // (title might be comparing or listing multiple items)
          const confidence = hasUngradedKeyword ? 'medium' : 'high';

          return {
            gradingCompany: company,
            gradeValue,
            condition: gradeToCondition(company, gradeValue),
            variant,
            confidence,
          };
        }
      }
    }
  }

  // No grading company pattern matched — check description as fallback
  if (description) {
    for (const { company, patterns } of GRADING_PATTERNS) {
      for (const pattern of patterns) {
        const match = fullText.match(pattern);
        if (match && match[1]) {
          const gradeValue = parseFloat(match[1]);
          if (isValidGrade(gradeValue)) {
            return {
              gradingCompany: company,
              gradeValue,
              condition: gradeToCondition(company, gradeValue),
              variant,
              confidence: 'low', // from description only
            };
          }
        }
      }
    }
  }

  // Check if there are generic graded keywords without a specific company
  const hasGradedKeyword = GRADED_KEYWORDS.some((pattern) =>
    pattern.test(text)
  );

  if (hasGradedKeyword && !hasUngradedKeyword) {
    // Card seems graded but we can't determine the company/grade
    return {
      gradingCompany: 'UNGRADED',
      gradeValue: null,
      condition: 'UNGRADED',
      variant,
      confidence: 'low', // Generic graded term found, but couldn't parse the grade
    };
  }

  // If no grade keywords were found, it's highly likely an ungraded raw card
  return {
    gradingCompany: 'UNGRADED',
    gradeValue: null,
    condition: 'UNGRADED',
    variant,
    confidence: hasUngradedKeyword ? 'high' : 'medium',
  };
}

/**
 * Batch parse multiple listing titles.
 * Useful for processing scraper results.
 */
export function parseGrades(
  listings: { title: string; description?: string }[]
): GradeResult[] {
  return listings.map((listing) =>
    parseGrade(listing.title, listing.description)
  );
}

/**
 * Conditions where the grading company is part of the identity of the price.
 * A "PSA 10" and a "CGC 10" are different products that trade at different
 * prices; a "Grade 9" is a grade 9 regardless of who slabbed it.
 */
const COMPANY_SPECIFIC_CONDITIONS = new Set<CardCondition>([
  'PSA_10',
  'CGC_10',
  'BGS_10',
  'SGC_10',
  'TAG_10',
]);

/**
 * Canonical grading company for a PRICE row.
 *
 * PriceCharting's price table — which our condition enum mirrors — has one
 * company-agnostic column per grade ("Grade 9") and separate columns only for
 * the 10s ("PSA 10", "CGC 10", ...). Keying price rows on the company for every
 * condition therefore splits a single logical price into up to five rows, one
 * per grader, each computed from a fraction of the sales. The card page then
 * renders whichever row the query happened to return first.
 *
 * Sales keep their true grading company for provenance; only the aggregated
 * price rows are collapsed.
 */
export function canonicalGradingCompany(
  condition: CardCondition | string,
  company: GradingCompany | string
): GradingCompany {
  return COMPANY_SPECIFIC_CONDITIONS.has(condition as CardCondition)
    ? (company as GradingCompany)
    : 'UNGRADED';
}

/**
 * Get display label for a CardCondition.
 */
export function getConditionLabel(condition: CardCondition): string {
  const labels: Record<CardCondition, string> = {
    UNGRADED: 'Ungraded',
    GRADE_1: 'Grade 1',
    GRADE_2: 'Grade 2',
    GRADE_3: 'Grade 3',
    GRADE_4: 'Grade 4',
    GRADE_5: 'Grade 5',
    GRADE_6: 'Grade 6',
    GRADE_7: 'Grade 7',
    GRADE_8: 'Grade 8',
    GRADE_9: 'Grade 9',
    GRADE_9_5: 'Grade 9.5',
    PSA_10: 'PSA 10',
    CGC_10: 'CGC 10',
    BGS_10: 'BGS 10',
    SGC_10: 'SGC 10',
    TAG_10: 'TAG 10',
  };
  return labels[condition];
}

/**
 * Get all possible conditions in display order.
 */
export function getAllConditions(): CardCondition[] {
  return [
    'UNGRADED',
    'GRADE_1',
    'GRADE_2',
    'GRADE_3',
    'GRADE_4',
    'GRADE_5',
    'GRADE_6',
    'GRADE_7',
    'GRADE_8',
    'GRADE_9',
    'GRADE_9_5',
    'PSA_10',
    'CGC_10',
    'BGS_10',
    'SGC_10',
    'TAG_10',
  ];
}
