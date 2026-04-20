// api/review.js — Backend Vercel para o DS Reviewer
// Usando Google Gemini (gratuito) — para migrar pro Claude, veja comentário no final

import { GoogleGenerativeAI } from "@google/generative-ai";

// ─── Design System — Studio Axon ─────────────────────────────────────────────
// Tokens extraídos via Figma MCP do arquivo UI Kit - Axon
// https://www.figma.com/design/gUasvJyU9ZEERhmv00jOIF/UI-Kit---Axon
const DESIGN_SYSTEM = {
  name: "Studio Axon UI Kit",

  colors: {
    // Primária
    "Primária/Axon_Cor_Primária":      "#3a2ee5",
    "Primária/Axon_Cor_Primária-5%":   "#f5f4fe",
    "Axon-Cor_Primária-1":             "#5271ff",

    // Neutras
    "Neutras/Midnight-100%":           "#292d32",
    "Neutras/Midnight-90%":            "#3e4246",
    "Neutras/Midnight-80%":            "#54575b",
    "Neutras/Midnight-50%":            "#949698",
    "Neutras/Midnight-30%":            "#bec0c1",
    "Neutras/Midnight-10%":            "#e9eaea",
    "Neutras/Midnight-5%":             "#f4f4f5",
    "Neutras/Midnight-3%":             "#f8f8f9",
    "Neutras/Branco-100%":             "#ffffff",

    // Alertas / Semânticas
    "Alertas/Error":                   "#e23045",
    "Alertas/Sucesso":                 "#44cc6e",
    "Alertas/Alerta":                  "#f4c70c",

    // Texto
    "text/disabled":                   "#919eab",

    // Gráfico
    "Gráfico/Cor_01":                  "#3a2ee5",
  },

  // Tolerância de cor: distância euclidiana máxima aceitável no espaço RGB
  colorTolerance: 15,

  spacing: {
    // Axon usa grid de 8px com exceções em 4px e 2px
    gridBase: 8,
    allowedValues: [0, 2, 4, 8, 12, 16, 20, 24, 32, 40, 48, 56, 64, 80, 96, 120],
    tolerance: 1,
  },

  typography: {
    // Fonte única: DM Sans
    allowedFamilies: ["DM Sans"],

    // Tamanhos da escala tipográfica do Axon
    allowedSizes: [12, 14, 16, 20, 24, 32, 40, 48],

    // Pesos usados no DS
    allowedWeights: [400, 500, 600, 700],

    // Estilos de texto mapeados do UI Kit
    textStyles: {
      "H2-Título 24px":     { size: 24, weight: 700, lineHeight: 30 },
      "Título 16px":        { size: 16, weight: 600, lineHeight: 16 },
      "Titulo Small 14px":  { size: 14, weight: 700, lineHeight: 16 },
      "Legenda 12px":       { size: 12, weight: 600, lineHeight: 16 },
      "Paragrafo 16pt":     { size: 16, weight: 500, lineHeight: 16 },
    },
  },
};

// ─── Helpers ────────────────────────────────────────────────────────────────

function hexToRgb(hex) {
  const h = hex.replace("#", "");
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16),
  };
}

function colorDistance(hex1, hex2) {
  const a = hexToRgb(hex1);
  const b = hexToRgb(hex2);
  return Math.sqrt((a.r-b.r)**2 + (a.g-b.g)**2 + (a.b-b.b)**2);
}

function nearestColor(hex) {
  let best = null;
  let bestDist = Infinity;
  for (const [name, value] of Object.entries(DESIGN_SYSTEM.colors)) {
    const d = colorDistance(hex, value);
    if (d < bestDist) { bestDist = d; best = { name, value }; }
  }
  return { ...best, distance: bestDist };
}

function isSpacingValid(value) {
  if (value === 0) return true;
  const { allowedValues, tolerance } = DESIGN_SYSTEM.spacing;
  return allowedValues.some((v) => Math.abs(v - value) <= tolerance);
}

// ─── Pré-filtragem local (rápida, antes de chamar o LLM) ────────────────────

function preFilter(nodes) {
  const issues = [];

  for (const node of nodes) {
    // Cor
    if (node.fillColor) {
      const { name, value, distance } = nearestColor(node.fillColor);
      if (distance > DESIGN_SYSTEM.colorTolerance) {
        issues.push({
          nodeId: node.id,
          nodeName: node.name,
          type: "color",
          detail: `fill: ${node.fillColor} — mais próximo no DS: ${name} (${value}), distância ${Math.round(distance)}`,
        });
      }
    }

    // Espaçamento
    if (node.padding) {
      for (const [side, val] of Object.entries(node.padding)) {
        if (val > 0 && !isSpacingValid(val)) {
          issues.push({
            nodeId: node.id,
            nodeName: node.name,
            type: "spacing",
            detail: `padding-${side}: ${val}px — não é múltiplo de ${DESIGN_SYSTEM.spacing.gridBase}px`,
          });
        }
      }
    }
    if (node.gap !== undefined && node.gap > 0 && !isSpacingValid(node.gap)) {
      issues.push({
        nodeId: node.id,
        nodeName: node.name,
        type: "spacing",
        detail: `gap: ${node.gap}px — não é múltiplo de ${DESIGN_SYSTEM.spacing.gridBase}px`,
      });
    }

    // Tipografia
    if (node.fontFamily) {
      if (!DESIGN_SYSTEM.typography.allowedFamilies.includes(node.fontFamily)) {
        issues.push({
          nodeId: node.id,
          nodeName: node.name,
          type: "typography",
          detail: `font-family: "${node.fontFamily}" — não está nas famílias permitidas pelo DS (${DESIGN_SYSTEM.typography.allowedFamilies.join(", ")})`,
        });
      }
    }
    if (node.fontSize) {
      if (!DESIGN_SYSTEM.typography.allowedSizes.includes(node.fontSize)) {
        issues.push({
          nodeId: node.id,
          nodeName: node.name,
          type: "typography",
          detail: `font-size: ${node.fontSize}px — não está na escala tipográfica do DS`,
        });
      }
    }
  }

  return issues;
}

// ─── Prompt para o Gemini ────────────────────────────────────────────────────

function buildPrompt(rawIssues, nodes, checks) {
  return `Você é um especialista em Design Systems fazendo revisão de um projeto Figma.

Design System em uso:
${JSON.stringify(DESIGN_SYSTEM, null, 2)}

Foram detectadas ${rawIssues.length} inconsistências automáticas na pré-análise. 
Revise cada uma, contextualize com o nome do nó e gere uma mensagem clara para o designer.

Inconsistências detectadas:
${JSON.stringify(rawIssues, null, 2)}

Retorne APENAS um JSON válido no formato abaixo, sem texto adicional, sem markdown:
{
  "issues": [
    {
      "nodeId": "id do nó",
      "nodeName": "nome do nó no Figma",
      "type": "color" | "spacing" | "typography",
      "emoji": "🎨" ou "📐" ou "✏️",
      "title": "título curto do problema (máx 6 palavras)",
      "message": "Descrição clara do problema e como corrigir. Máx 2 frases."
    }
  ]
}`;
}

// ─── Handler principal ───────────────────────────────────────────────────────

export default async function handler(req, res) {
  // CORS para o plugin do Figma
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Método não permitido" });

  const body = req.body || {};
  const nodes = body.nodes || [];
  const checks = body.checks || {};
  const dsData = body.dsData || null;

  // Se o plugin enviou um DS customizado, usa ele; senão usa o DS padrão
  if (dsData) Object.assign(DESIGN_SYSTEM, dsData);

  if (!nodes.length) {
    return res.status(400).json({ error: "Nenhum nó enviado" });
  }

  // 1. Pré-filtragem local (sem custo de API)
  let rawIssues = preFilter(nodes);

  // Filtra pelos checks selecionados na UI
  rawIssues = rawIssues.filter((i) => {
    if (i.type === "color"      && checks.color   === false) return false;
    if (i.type === "spacing"    && checks.spacing  === false) return false;
    if (i.type === "typography" && checks.typo     === false) return false;
    return true;
  });

  if (rawIssues.length === 0) {
    return res.json({ issues: [] });
  }

  // 2. Gemini enriquece as mensagens (gratuito)
  try {
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });

    const result = await model.generateContent(buildPrompt(rawIssues, nodes, checks));
    const text = result.response.text();
    const clean = text.replace(/```json|```/g, "").trim();
    const parsed = JSON.parse(clean);

    return res.json({ issues: parsed.issues ? parsed.issues : [] });

    // ── Para migrar pro Claude no futuro, substitua o bloco acima por: ──
    // import Anthropic from "@anthropic-ai/sdk";
    // const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    // const response = await client.messages.create({
    //   model: "claude-sonnet-4-20250514",
    //   max_tokens: 2048,
    //   messages: [{ role: "user", content: buildPrompt(rawIssues, nodes, checks) }],
    // });
    // const text = response.content[0]?.text ?? "";
    // ────────────────────────────────────────────────────────────────────
  } catch (err) {
    console.error("Erro ao chamar Claude:", err);
    // Fallback: retorna issues sem enriquecimento
    const fallback = rawIssues.map((i) => ({
      ...i,
      emoji: i.type === "color" ? "🎨" : i.type === "spacing" ? "📐" : "✏️",
      title: i.type === "color" ? "Cor fora do DS" : i.type === "spacing" ? "Espaçamento incorreto" : "Tipografia incorreta",
      message: i.detail,
    }));
    return res.json({ issues: fallback });
  }
}
