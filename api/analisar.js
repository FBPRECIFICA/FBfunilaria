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

    const prompt = `You are a senior expert in automotive body repair and painting with 20+ years of experience in Brazil. Analyze the vehicle photos and the client request below.

VEHICLE: ${veiculo}
CLIENT REQUEST: ${solicitacao}

Your task is to create a complete repair estimate draft following these rules STRICTLY:

PAINTING HOURS (fixed table):
- Front bumper: 4h
- Rear bumper: 4h
- Door: 4-5h each
- Fender: 3h
- Hood: 5h
- Trunk lid: 5h
- Roof: 5h
- Full side panel: 6h each
- Mirror: 0.5h
- Door handle: 0.5h

REPAIR HOURS (based on damage level):
- Light dent: 3-4h
- Medium dent: 5-8h
- Severe dent: 10h or negotiation

REPLACEMENT HOURS:
- Any replaced part: 1h (removal and installation)

MANDATORY RULES:
1. ALWAYS separate replacement and painting into different line items
2. ALWAYS include removal/installation when possible (except roof, fixed side panels)
3. ALWAYS include emblems in painting or damage areas (removal/installation 0.5h each)
4. ALWAYS include bumper guide (left AND right) when replacing a bumper
5. Evaluate if part should be repaired or replaced based on visual damage
6. Parts with structural cracks, severe deformation = REPLACEMENT
7. Dents without cracks = REPAIR
8. ALWAYS evaluate internal damage: longerons, engine support, guides, radiator grille
9. For strong front/rear impacts: indicate referral to mechanics department
10. Separate into 4 sections: requested, additional, mechanical, parts

VALID TYPES: Troca, Recup., Pintura, Rem/Inst, Interna, Mecanica

You MUST respond with ONLY valid JSON, no extra text, no markdown, no code blocks:
{"solicitados":[{"regiao":"region name","servico":"service description","tipo":"Troca|Recup.|Pintura|Rem/Inst|Interna","horas":1.0,"remocao":true,"obs":"observation or null"}],"adicionais":[{"regiao":"region name","servico":"service description","tipo":"Troca|Recup.|Pintura|Rem/Inst|Interna","horas":1.0,"remocao":true,"obs":"observation or null"}],"mecanica":[{"regiao":"region name","servico":"mechanical suspicion","obs":"confirm after disassembly"}],"pecas":[{"nome":"part name","qtd":1,"secao":"solicitado|adicional"}]}`;

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

    const clean = content
      .replace(/```json/gi, '')
      .replace(/```/g, '')
      .trim();

    const start = clean.indexOf('{');
    const end = clean.lastIndexOf('}');

    if (start === -1 || end === -1) {
      res.status(500).json({ erro: 'JSON nao encontrado na resposta: ' + clean.substring(0, 200) });
      return;
    }

    const jsonStr = clean.substring(start, end + 1);
    const resultado = JSON.parse(jsonStr);
    res.status(200).json(resultado);

  } catch (erro) {
    console.error('Erro analisar:', erro);
    res.status(500).json({ erro: String(erro.message || erro) });
  }
}
