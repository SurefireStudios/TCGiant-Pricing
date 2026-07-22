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

export type GradingCompany = 'PSA' | 'CGC' | 'BGS' | 'TAG' | 'UNGRADED';

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
  | 'TAG_10';

export interface GradeResult {
  gradingCompany: GradingCompany;
  gradeValue: number | null;
  condition: CardCondition;
  variant: CardVariant;
  confidence: 'high' | 'medium' | 'low';
}

/**
 * Patterns for each grading company.
 * Each pattern captures the grade number after the company name.
 * We use multiple patterns per company to handle variations.
 */
const GRADING_PATTERNS: {
  company: GradingCompany;
  patterns: RegExp[];
}[] = [
  {
    company: 'PSA',
    patterns: [
      // "PSA 10", "PSA10", "PSA 9.5", "PSA GEM MINT 10", "PSA GEM MT 10"
      /\bPSA\s*(?:GEM\s*(?:MINT|MT)\s*)?(\d+(?:\.\d+)?)\b/i,
      // "PSA AUTHENTIC" or "PSA A" (authenticated but not graded — treat as ungraded)
      /\bPSA\s+(?:AUTHENTIC|AUTH)\b/i,
      // Reverse: "10 PSA"
      /\b(\d+(?:\.\d+)?)\s*PSA\b/i,
    ],
  },
  {
    company: 'BGS',
    patterns: [
      // "BGS 9.5", "BGS10", "BGS PRISTINE 10", "BGS BLACK LABEL 10"
      /\bBGS\s*(?:PRISTINE\s*|BLACK\s*LABEL\s*)?(\d+(?:\.\d+)?)\b/i,
      // "BECKETT BGS 9.5", "Beckett 9"
      /\bBECKETT\s*(?:BGS\s*)?(\d+(?:\.\d+)?)\b/i,
      // Reverse: "9.5 BGS"
      /\b(\d+(?:\.\d+)?)\s*BGS\b/i,
    ],
  },
  {
    company: 'CGC',
    patterns: [
      // "CGC 10", "CGC PERFECT 10", "CGC PRISTINE 10", "CGC9.5"
      /\bCGC\s*(?:PERFECT\s*|PRISTINE\s*)?(\d+(?:\.\d+)?)\b/i,
      // Reverse: "10 CGC"
      /\b(\d+(?:\.\d+)?)\s*CGC\b/i,
    ],
  },
  {
    company: 'TAG',
    patterns: [
      // "TAG 10", "TAG GEM MINT 10", "TAG10"
      /\bTAG\s*(?:GEM\s*(?:MINT|MT)\s*)?(\d+(?:\.\d+)?)\b/i,
      // Reverse: "10 TAG"
      /\b(\d+(?:\.\d+)?)\s*TAG\b/i,
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
  /\bMP\b/i,
  /\bMODERATELY\s*PLAYED\b/i,
  /\bHP\b/i,
  /\bHEAVILY\s*PLAYED\b/i,
  /\bDAMAGED\b/i,
  /\bPOOR\b/i,
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
  
  if (/\b(1st edition|first edition|1st ed)\b/.test(text)) {
    return '1st_edition';
  }
  
  if (/\b(shadowless)\b/.test(text)) {
    return 'shadowless';
  }
  
  if (/\b(reverse holo|reverse foil|rev holo)\b/.test(text)) {
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
  const text = title.trim();
  const fullText = description ? `${text} ${description.trim()}` : text;

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
    'TAG_10',
  ];
}
