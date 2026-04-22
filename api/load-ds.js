// api/load-ds.js — Processa o Design System enviado pelo plugin
// Aceita: PDF (base64), URL ou Figma file key via MCP

import { GoogleGenerativeAI } from "@google/generative-ai";

// DS Axon embutido — usado como fallback ou quando PDF do Axon é detectado
const AXON_DS_FALLBACK = {
  name: "Studio Axon UI Kit",
  colors: {
    "Primária/Axon_Cor_Primária":      "#3a2ee5",
    "Primária/Axon_Cor_Primária-5%":   "#f5f4fe",
    "Axon-Cor_Primária-1":             "#5271ff",
    "Neutras/Midnight-100%":           "#292d32",
    "Neutras/Midnight-90%":            "#3e4246",
    "Neutras/Midnight-80%":            "#54575b",
    "Neutras/Midnight-50%":            "#949698",
    "Neutras/Midnight-30%":            "#bec0c1",
    "Neutras/Midnight-10%":            "#e9eaea",
    "Neutras/Midnight-5%":             "#f4f4f5",
    "Neutras/Midnight-3%":             "#f8f8f9",
    "Neutras/Branco-100%":             "#ffffff",
    "Alertas/Error":                   "#e23045",
    "Alertas/Sucesso":                 "#44cc6e",
    "Alertas/Alerta":                  "#f4c70c",
    "text/disabled":                   "#919eab",
  },
  colorTolerance: 15,
  spacing: {
    gridBase: 8,
    allowedValues: [0, 2, 4, 8, 12, 16, 20, 24, 32, 40, 48, 56, 64, 80, 96, 120],
    tolerance: 1,
  },
  typography: {
    allowedFamilies: ["DM Sans"],
    allowedSizes: [12, 14, 16, 20, 24, 32, 40, 48],
    allowedWeights: [400, 500, 600, 700],
    textStyles: {
      "H2-Título 24px":     { size: 24, weight: 700 },
      "Título 16px":        { size: 16, weight: 600 },
      "Titulo Small 14px":  { size: 14, weight: 700 },
      "Legenda 12px":       { size: 12, weight: 600 },
      "Parágrafo 16pt":     { size: 16, weight: 500 },
    },
  },
};

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Método não permitido" });

  const { source, pdfBase64, url, figmaFileKey, figmaToken } = req.body ?? {};

  if (!source) return res.status(400).json({ error: "Campo 'source' obrigatório" });

  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash-lite" });

  let rawContent = "";

  try {
    // ── PDF ──────────────────────────────────────────────────────────────────
    if (source === "pdf") {
      if (!pdfBase64) return res.status(400).json({ error: "PDF não enviado" });

      const result = await model.generateContent([
        {
          inlineData: {
            mimeType: "application/pdf",
            data: pdfBase64,
          },
        },
        `Você é um especialista em Design Systems. Analise este PDF e extraia:
1. Nome do Design System
2. Todas as cores (nome e valor hex)
3. Tipografia: famílias de fonte, tamanhos permitidos, pesos
4. Espaçamentos: base do grid, valores permitidos
5. Quaisquer regras adicionais de consistência

Retorne APENAS um JSON válido neste formato exato, sem texto adicional:
{
  "name": "Nome do DS",
  "colors": { "nome-token": "#hexvalue" },
  "colorTolerance": 15,
  "spacing": {
    "gridBase": 8,
    "allowedValues": [0, 4, 8, 16, 24, 32, 48, 64],
    "tolerance": 1
  },
  "typography": {
    "allowedFamilies": ["NomeDaFonte"],
    "allowedSizes": [12, 14, 16, 20, 24, 32],
    "allowedWeights": [400, 500, 600, 700],
    "textStyles": {}
  }
}`,
      ]);

      rawContent = result.response.text();

    // ── URL ──────────────────────────────────────────────────────────────────
    } else if (source === "url") {
      if (!url) return res.status(400).json({ error: "URL não informada" });

      // Busca o conteúdo da página
      const pageRes = await fetch(url, {
        headers: { "User-Agent": "Mozilla/5.0 DS-Reviewer-Bot" },
      });
      const html = await pageRes.text();
      // Remove tags HTML para reduzir tokens
      const text = html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").slice(0, 15000);

      const result = await model.generateContent(
        `Você é um especialista em Design Systems. Analise o conteúdo desta documentação e extraia:
1. Nome do Design System
2. Todas as cores (nome e valor hex)
3. Tipografia: famílias de fonte, tamanhos permitidos, pesos
4. Espaçamentos: base do grid, valores permitidos

Conteúdo da página:
${text}

Retorne APENAS um JSON válido neste formato, sem texto adicional:
{
  "name": "Nome do DS",
  "colors": { "nome-token": "#hexvalue" },
  "colorTolerance": 15,
  "spacing": {
    "gridBase": 8,
    "allowedValues": [0, 4, 8, 16, 24, 32, 48, 64],
    "tolerance": 1
  },
  "typography": {
    "allowedFamilies": ["NomeDaFonte"],
    "allowedSizes": [12, 14, 16, 20, 24, 32],
    "allowedWeights": [400, 500, 600, 700],
    "textStyles": {}
  }
}`
      );
      rawContent = result.response.text();

    // ── MCP Figma ─────────────────────────────────────────────────────────────
    } else if (source === "mcp") {
      if (!figmaFileKey) return res.status(400).json({ error: "Figma file key não informado" });

      // Usa o token do usuário se enviado; caso contrário usa o token do servidor (fallback)
      const tokenToUse = figmaToken || process.env.FIGMA_TOKEN;
      if (!tokenToUse) return res.status(400).json({ error: "Figma Token não configurado. Acesse Config no plugin e adicione seu token." });

      // Busca styles e variables via Figma REST API
      const [stylesRes, varsRes] = await Promise.all([
        fetch(`https://api.figma.com/v1/files/${figmaFileKey}/styles`, {
          headers: { "X-Figma-Token": tokenToUse },
        }),
        fetch(`https://api.figma.com/v1/files/${figmaFileKey}/variables/local`, {
          headers: { "X-Figma-Token": tokenToUse },
        }),
      ]);

      const stylesData = await stylesRes.json();
      const varsData   = await varsRes.json();

      const figmaContent = JSON.stringify({ styles: stylesData, variables: varsData }).slice(0, 20000);

      const result = await model.generateContent(
        `Você é um especialista em Design Systems Figma. Analise estes dados de estilos e variáveis do Figma e extraia os tokens de design.

Dados do arquivo Figma:
${figmaContent}

Retorne APENAS um JSON válido neste formato, sem texto adicional:
{
  "name": "Nome do DS",
  "colors": { "nome-token": "#hexvalue" },
  "colorTolerance": 15,
  "spacing": {
    "gridBase": 8,
    "allowedValues": [0, 4, 8, 16, 24, 32, 48, 64],
    "tolerance": 1
  },
  "typography": {
    "allowedFamilies": ["NomeDaFonte"],
    "allowedSizes": [12, 14, 16, 20, 24, 32],
    "allowedWeights": [400, 500, 600, 700],
    "textStyles": {}
  }
}`
      );
      rawContent = result.response.text();

    } else {
      return res.status(400).json({ error: "Source inválido: use 'pdf', 'url' ou 'mcp'" });
    }

    // Parse do JSON retornado pelo Gemini
    const clean = rawContent.replace(/```json|```/g, "").trim();
    const designSystem = JSON.parse(clean);

    return res.json({ designSystem });

  } catch (err) {
    console.error("Erro ao processar DS:", err);

    // Se for erro de quota (429), retorna o DS Axon embutido como fallback
    if (err.message && (err.message.includes("429") || err.message.includes("quota") || err.message.includes("Too Many Requests"))) {
      console.log("Quota excedida — retornando DS Axon fallback");
      return res.json({ designSystem: AXON_DS_FALLBACK, fallback: true });
    }

    return res.status(500).json({ error: "Erro ao processar Design System: " + err.message });
  }
}
