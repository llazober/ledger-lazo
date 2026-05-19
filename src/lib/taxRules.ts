export interface DocumentRequirement {
  name: string;
  categories: string[]; // Document must belong to one of these categories to satisfy this requirement
}

export interface TaxRule {
  taxType: string;
  requirements: DocumentRequirement[];
}

/**
 * Configure required documents per tax type here.
 * Easy to add, edit, or customize.
 */
export const TAX_RULES: Record<string, TaxRule> = {
  // 1040: Individual Tax Return
  "1040": {
    taxType: "1040",
    requirements: [
      { 
        name: "Tax Income Form", 
        categories: ["W2", "1099-NEC", "1099"] 
      }
    ]
  },
  
  // 1120S: S-Corporation Tax Return
  "1120S": {
    taxType: "1120S",
    requirements: [
      { 
        name: "Corporate Bank Statement", 
        categories: ["Bank_Statement"] 
      },
      { 
        name: "W-2 / 1099 Information", 
        categories: ["W2", "1099-NEC", "1099"] 
      }
    ]
  },
  
  // 1065: Partnership Tax Return
  "1065": {
    taxType: "1065",
    requirements: [
      { 
        name: "Partnership Bank Statement", 
        categories: ["Bank_Statement"] 
      },
      { 
        name: "Partner Information Forms", 
        categories: ["W2", "1099-NEC", "1099"] 
      }
    ]
  },

  // 1120: C-Corporation Tax Return
  "1120": {
    taxType: "1120",
    requirements: [
      { 
        name: "Corporate Bank Statement", 
        categories: ["Bank_Statement"] 
      },
      { 
        name: "W-2 / 1099 Information", 
        categories: ["W2", "1099-NEC", "1099"] 
      }
    ]
  }
};

/**
 * Fallback rule if the client's taxType doesn't match any of the above keys
 */
export const DEFAULT_TAX_RULE: TaxRule = {
  taxType: "default",
  requirements: [
    { 
      name: "Tax Income Form", 
      categories: ["W2", "1099-NEC", "1099"] 
    },
    { 
      name: "Bank Statement", 
      categories: ["Bank_Statement"] 
    }
  ]
};

/**
 * Helper to audit a list of client documents against their tax rules
 * Returns { isComplete: boolean, missingRequirements: string[] }
 */
export function auditClientDocuments(taxType: string, documents: { category: string }[]) {
  const rule = TAX_RULES[taxType] || DEFAULT_TAX_RULE;
  const missingRequirements: string[] = [];

  for (const req of rule.requirements) {
    // Check if at least one document satisfies this requirement group
    const hasDoc = documents.some(doc => req.categories.includes(doc.category));
    if (!hasDoc) {
      missingRequirements.push(req.name);
    }
  }

  return {
    isComplete: missingRequirements.length === 0,
    missingRequirements,
    ruleName: rule.taxType
  };
}
