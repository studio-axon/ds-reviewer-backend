// api/clear-comments.js — Remove comentários do DS Reviewer via Figma REST API

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Método não permitido" });

  const { fileKey, figmaToken } = req.body || {};
  const token = figmaToken || process.env.FIGMA_TOKEN;

  if (!fileKey || !token) {
    return res.status(400).json({ error: "fileKey e figmaToken são obrigatórios" });
  }

  try {
    // Busca todos os comentários do arquivo
    const listRes = await fetch(`https://api.figma.com/v1/files/${fileKey}/comments`, {
      headers: { "X-Figma-Token": token },
    });

    if (!listRes.ok) {
      const err = await listRes.text();
      return res.status(400).json({ error: "Erro ao listar comentários: " + err });
    }

    const data = await listRes.json();
    const comments = data.comments || [];

    // Filtra apenas os do DS Reviewer
    const toDelete = comments.filter(c =>
      c.message && c.message.startsWith("[DS Reviewer]")
    );

    let removed = 0;
    for (const comment of toDelete) {
      try {
        const delRes = await fetch(
          `https://api.figma.com/v1/files/${fileKey}/comments/${comment.id}`,
          {
            method: "DELETE",
            headers: { "X-Figma-Token": token },
          }
        );
        if (delRes.ok) removed++;
        await new Promise(r => setTimeout(r, 200));
      } catch (err) {
        console.warn("Erro ao deletar comentário", comment.id, err.message);
      }
    }

    return res.json({ removed, total: toDelete.length });
  } catch (err) {
    return res.status(500).json({ error: "Erro: " + err.message });
  }
}
