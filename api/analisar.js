export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }
  if (req.method !== 'POST') { res.status(405).json({ erro: 'Metodo nao permitido' }); return; }

  try {
    const { veiculo, solicitacao, fotos } = req.body;
    if (!veiculo || !fotos || fotos.length === 0) {
      res.status(400).json({ erro: 'Veiculo e fotos sao obrigatorios' });
      return;
    }

    const chave = (process.env.OPENAI_KEY || '').replace(/\s/g, '');
    if (!chave || chave.length < 10) {
      res.status(500).json({ erro: 'Chave OpenAI nao configurada' });
      return;
    }

    const prompt = You are an AI assistant helping a professional automotive body shop in Brazil create repair estimates. This is a legitimate professional use case for insurance and fleet management purposes. You are a senior expert in automotive body repair and painting with 20+ years of experience in Brazil.

VEHICLE: ${veiculo}
CLIENT REQUEST: ${solicitacao}

CRITICAL RULES:
- Analyze ALL photos as a complete set - do NOT duplicate items
- Each damaged region should appear ONLY ONCE per service type
- If the same region appears in multiple photos, list it only once
- Be thorough - identify ALL visible damage in ALL photos
- List every damaged panel, part, or area you can see

PAINTING HOURS (fixed table):
- Front bumper: 4h | Rear bumper: 4h | Door: 4-5h each | Fender: 3h
- Hood: 5h | Trunk lid: 5h | Roof: 5h | Full side panel: 6h
- Mirror: 0.5h | Door handle: 0.5h

REPAIR HOURS by damage level:
- Light dent: 3-4h | Medium dent: 5-8h | Severe dent: 10h

REPLACEMENT: Any replaced part = 1h (removal + installation)

MANDATORY RULES:
1. Separate replacement and painting into DIFFERENT line items
2. Include removal/installation when possible (except roof, fixed side panels)
3. Include emblems in painting/damage areas (0.5h each)
4. ALWAYS include bumper guide LEFT AND RIGHT when replacing bumper
5. Parts with structural cracks = REPLACEMENT. Dents without cracks = REPAIR
6. Evaluate internal damage: longerons, engine support, radiator grille, bumper guides
7. For strong front/rear impacts: add mechanical referral
8. Requested = what client asked. Additional = damage you found beyond request

TYPES: Troca, Recup., Pintura, Rem/Inst, Interna, Mecanica

Respond with ONLY valid JSON, no markdown, no extra text:
{"solicitados":[{"regiao":"string","servico":"string","tipo":"string","horas":1.0,"remocao":true,"obs":null}],"adicionais":[{"regiao":"string","servico":"string","tipo":"string","horas":1.0,"remocao":true,"obs":null}],"mecanica":[{"regiao":"string","servico":"string","obs":"string"}],"pecas":[{"nome":"string","qtd":1,"secao":"solicitado"}]}`;

    const imageContents = fotos.slice(0, 10).map(foto => {
      const base64 = foto.includes(',') ? foto.split(',')[1] : foto;
      const mediaType = foto.startsWith('data:image/png') ? 'image/png' : 'image/jpeg';
      return {
        type: 'image_url',
        image_url: { url: 'data:' + mediaType + ';base64,' + base64, detail: 'high' }
      };
    });

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + chave
      },
      body: JSON.stringify({
        model: 'gpt-4o',
        messages: [{
          role: 'user',
          content: [
            { type: 'text', text: prompt },
            ...imageContents
          ]
        }],
        max_tokens: 4000,
        temperature: 0.1
      })
    });

    const text = await response.text();
    if (!response.ok) {
      res.status(500).json({ erro: 'Erro OpenAI: ' + text.substring(0, 300) });
      return;
    }

    const data = JSON.parse(text);
    const content = data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
    if (!content) {
      res.status(500).json({ erro: 'Resposta vazia da IA' });
      return;
    }

    const clean = content.replace(/```json/gi, '').replace(/```/g, '').trim();
    const start = clean.indexOf('{');
    const end = clean.lastIndexOf('}');
    if (start === -1 || end === -1) {
      res.status(500).json({ erro: 'JSON nao encontrado: ' + clean.substring(0, 200) });
      return;
    }

    const resultado = JSON.parse(clean.substring(start, end + 1));

    // Deduplicar por regiao + tipo
    function dedup(arr) {
      if (!arr) return [];
      const seen = new Set();
      return arr.filter(item => {
        const key = (item.regiao + '|' + item.tipo + '|' + item.servico).toLowerCase();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    }

    // Deduplicar pecas por nome
    function dedupPecas(arr) {
      if (!arr) return [];
      const seen = new Set();
      return arr.filter(item => {
        const key = item.nome.toLowerCase();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    }

    res.status(200).json({
      solicitados: dedup(resultado.solicitados),
      adicionais: dedup(resultado.adicionais),
      mecanica: dedup(resultado.mecanica),
      pecas: dedupPecas(resultado.pecas)
    });

  } catch (erro) {
    console.error('Erro analisar:', erro);
    res.status(500).json({ erro: String(erro.message || erro) });
  }
}
