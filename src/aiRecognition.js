const AI_PRODUCT_CATALOG = [
  {
    id: "nike-air-jordan-1-mid",
    productName: "Air Jordan 1 Mid",
    brand: "Nike",
    category: "Sneakers",
    color: "White / Black / Red",
    gender: "Men",
    releaseDate: "2020-01-01",
    msrp: 170,
    styleCode: "554724-161",
    description: "Classic AJ1 mid-top sneaker with a clean court-inspired profile and premium leather build.",
    images: [
      "https://images.unsplash.com/photo-1542291026-7eec264c27ff?auto=format&fit=crop&w=900&q=80",
      "https://images.unsplash.com/photo-1525966222134-fcfa99b8ae77?auto=format&fit=crop&w=900&q=80",
    ],
  },
  {
    id: "adidas-yeezy-350-v2",
    productName: "Yeezy 350 V2",
    brand: "Adidas",
    category: "Sneakers",
    color: "Slate / Red",
    gender: "Men",
    releaseDate: "2017-01-01",
    msrp: 220,
    styleCode: "F3692",
    description: "Signature runner with a sculpted Primeknit upper and cushioned midsole for a modern streetwear look.",
    images: [
      "https://images.unsplash.com/photo-1517841905240-472988babdf9?auto=format&fit=crop&w=900&q=80",
      "https://images.unsplash.com/photo-1549298916-b41d501d3772?auto=format&fit=crop&w=900&q=80",
    ],
  },
  {
    id: "new-balance-550",
    productName: "New Balance 550",
    brand: "New Balance",
    category: "Sneakers",
    color: "White / Green",
    gender: "Men",
    releaseDate: "2024-01-01",
    msrp: 120,
    styleCode: "BB550LA",
    description: "Retro basketball-inspired trainer with a plush midsole and layered suede detailing.",
    images: [
      "https://images.unsplash.com/photo-1542291026-7eec264c27ff?auto=format&fit=crop&w=900&q=80",
      "https://images.unsplash.com/photo-1491553895911-0055eca6402d?auto=format&fit=crop&w=900&q=80",
    ],
  },
  {
    id: "gucci-gg-marmont-mini",
    productName: "GG Marmont Mini Bag",
    brand: "Gucci",
    category: "Handbags",
    color: "Brown",
    gender: "Women",
    releaseDate: "2023-01-01",
    msrp: 890,
    styleCode: "663078-1A",
    description: "Structured mini shoulder bag with the iconic GG Marmont web and polished hardware.",
    images: [
      "https://images.unsplash.com/photo-1584917865442-de89df76afd3?auto=format&fit=crop&w=900&q=80",
      "https://images.unsplash.com/photo-1594223274512-ad4803739b7c?auto=format&fit=crop&w=900&q=80",
    ],
  },
  {
    id: "supreme-box-logo-tee",
    productName: "Box Logo Tee",
    brand: "Supreme",
    category: "Apparel",
    color: "Black",
    gender: "Men",
    releaseDate: "2010-01-01",
    msrp: 68,
    styleCode: "SUP-BOX-01",
    description: "Classic streetwear graphic tee with the iconic Supreme box logo on a heavyweight cotton base.",
    images: [
      "https://images.unsplash.com/photo-1521572267360-ee0c2909d518?auto=format&fit=crop&w=900&q=80",
      "https://images.unsplash.com/photo-1512436991641-6745cdb1723f?auto=format&fit=crop&w=900&q=80",
    ],
  },
  {
    id: "jordan-4-retro",
    productName: "Jordan 4 Retro",
    brand: "Nike",
    category: "Sneakers",
    color: "White / Cement Grey",
    gender: "Men",
    releaseDate: "2021-01-01",
    msrp: 210,
    styleCode: "CT8527-100",
    description: "Legendary retro basketball sneaker featuring the signature mesh panel and durable outsole.",
    images: [
      "https://images.unsplash.com/photo-1542291026-7eec264c27ff?auto=format&fit=crop&w=900&q=80",
      "https://images.unsplash.com/photo-1511556532299-8f662fc26c06?auto=format&fit=crop&w=900&q=80",
    ],
  },
];

function normalizeText(value) {
  return String(value || "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, " ");
}

function hasMatch(value, candidateValue) {
  const a = normalizeText(value);
  const b = normalizeText(candidateValue);
  if (!a || !b) return false;
  return a.includes(b) || b.includes(a);
}

function getConfidenceLabel(score) {
  if (score >= 70) return "High";
  if (score >= 40) return "Medium";
  return "Low";
}

function buildCandidateSignal(input) {
  const signal = {
    productName: normalizeText(input.productName),
    brand: normalizeText(input.brand),
    sku: normalizeText(input.sku || input.styleCode || input.upc || input.barcode || input.style || ""),
    styleCode: normalizeText(input.styleCode || input.sku || input.upc || input.barcode || ""),
    color: normalizeText(input.color),
    size: normalizeText(input.size),
    category: normalizeText(input.category),
    gender: normalizeText(input.gender),
  };

  return signal;
}

function scoreCandidate(candidate, input, signal) {
  let score = 0;

  if (signal.productName && (hasMatch(signal.productName, candidate.productName) || hasMatch(signal.productName, candidate.brand))) {
    score += 45;
  }

  if (signal.brand && hasMatch(signal.brand, candidate.brand)) {
    score += 20;
  }

  if (signal.sku && (hasMatch(signal.sku, candidate.styleCode) || hasMatch(signal.sku, candidate.productName))) {
    score += 25;
  }

  if (signal.styleCode && hasMatch(signal.styleCode, candidate.styleCode)) {
    score += 25;
  }

  if (signal.color && hasMatch(signal.color, candidate.color)) {
    score += 12;
  }

  if (signal.category && hasMatch(signal.category, candidate.category)) {
    score += 8;
  }

  if (signal.gender && hasMatch(signal.gender, candidate.gender)) {
    score += 6;
  }

  if (input.barcode && signal.sku && hasMatch(input.barcode, candidate.styleCode)) {
    score += 12;
  }

  if (input.productName && /jordan|yeezy|gucci|supreme|new balance|air jordan/i.test(input.productName)) {
    score += 4;
  }

  return score;
}

export async function recognizeProduct(input = {}) {
  const signal = buildCandidateSignal(input);
  const scored = AI_PRODUCT_CATALOG.map((candidate) => ({
    ...candidate,
    score: scoreCandidate(candidate, input, signal),
    confidence: getConfidenceLabel(scoreCandidate(candidate, input, signal)),
  }))
    .filter((candidate) => candidate.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);

  if (!scored.length) {
    return {
      candidates: [],
      selectedCandidate: null,
      confidence: "Low",
    };
  }

  const topCandidate = scored[0];
  return {
    candidates: scored.map((candidate) => ({
      ...candidate,
      confidence: getConfidenceLabel(candidate.score),
    })),
    selectedCandidate: topCandidate,
    confidence: topCandidate.confidence,
  };
}

export function mergeRecognitionIntoItem(baseItem = {}, recognition = {}, selectedIndex = 0) {
  const candidate = recognition?.candidates?.[selectedIndex] || recognition?.selectedCandidate || null;

  if (!candidate) {
    return {
      ...baseItem,
      aiRecognition: {
        confidence: "Low",
        candidates: [],
        selectedCandidate: null,
      },
    };
  }

  const merged = {
    ...baseItem,
    productName: baseItem.productName || candidate.productName || "",
    brand: baseItem.brand || candidate.brand || "",
    category: baseItem.category || candidate.category || "",
    color: baseItem.color || candidate.color || "",
    gender: baseItem.gender || candidate.gender || "",
    styleCode: baseItem.styleCode || candidate.styleCode || "",
    description: baseItem.description || candidate.description || "",
    releaseDate: baseItem.releaseDate || candidate.releaseDate || "",
    msrp: baseItem.msrp || candidate.msrp || 0,
    photo: baseItem.photo || candidate.images?.[0] || "",
    photos: Array.from(new Set([...(baseItem.photos || []), ...(candidate.images || [])]))
      .filter(Boolean),
    notes: [baseItem.notes, candidate.description].filter(Boolean).join("\n") || baseItem.notes || "",
    aiRecognition: {
      confidence: candidate.confidence || recognition.confidence || "Low",
      candidates: recognition.candidates || [candidate],
      selectedCandidate: candidate,
      selectedImage: candidate.images?.[0] || "",
    },
  };

  return merged;
}
