export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }
  if (req.method !== 'POST') { res.status(405).json({ erro: 'Metodo nao permitido' }); return; }

  try {
    const body = req.body || {};
    const veiculo = body.veiculo || '';
    const solicitacao = body.solicitacao || '';
    const fotos = body.fotos || [];

    if (!veiculo || fotos.length === 0) {
      res.status(400).json({ erro: 'Veiculo e fotos sao obrigatorios' });
      return;
    }

    const chave = (process.env.OPENAI_KEY || '').replace(/\s/g, '');
    if (!chave || chave.length < 10) {
      res.status(500).json({ erro: 'Chave OpenAI nao configurada' });
      return;
    }

    const p1 = 'This is a professional automotive insurance damage assessment for a licensed body shop in Brazil. ';
    const p2 = 'You are an expert estimator. Analyze the vehicle damage photos and create a repair estimate.\n\n';
    const p3 = 'VEHICLE: ' + veiculo + '\nCLIENT REQUEST: ' + solicitacao + '\n\n';
    const p4 = 'IMPORTANT - USE PORTUGUESE BRAZILIAN for ALL names:\n';
    const p5 = 'Para-choque dianteiro, Para-choque traseiro, Capo, Tampa traseira, Porta dianteira direita/esquerda, ';
    const p6 = 'Para-lama dianteiro direito/esquerdo, Retrovisor, Teto, Grade do radiador, Longarina, Emblema, ';
    const p7 = 'Guia de para-choque dianteiro direito/esquerdo, Guia de para-choque traseiro direito/esquerdo\n\n';
    const p8 = 'RULES:\n';
    const p9 = '1. NO DUPLICATES - each region appears max once per service type\n';
    const p10 = '2. For same region: choose Recup. OR Troca - NEVER both\n';
    const p11 = '3. Light/medium dent without crack = Recup. Never replace dented parts\n';
    const p12 = '4. Broken/cracked plastic = Troca\n';
    const p13 = '5. After Recup. or Troca, add separate Pintura line\n';
    const p14 = '6. When replacing ANY bumper: add guia direito AND guia esquerdo\n';
    const p15 = '7. Add emblems removal/installation in painted areas\n\n';
    const p16 = 'HOURS: bumper paint=4h, door paint=4h, fender paint=3h, hood paint=5h, trunk paint=5h, ';
    const p17 = 'roof paint=5h, side panel=6h, mirror=0.5h, handle=0.5h\n';
    const p18 = 'Repair: light=3h, medium=5h, severe=8h. Replacement: 1h any part\n\n';
    const p19 = 'Respond ONLY with valid JSON no markdown:\n';
    const p20 = '{"solicitados":[{"regiao":"nome PT","servico":"descricao PT","tipo":"Recup.|Pintura|Troca|Rem/Inst|Interna","horas":3.0,"remocao":true,"obs":null}],';
    const p21 = '"adicionais":[{"regiao":"nome PT","servico":"descricao PT","tipo":"Recup.|Pintura|Troca|Rem/Inst|Interna","horas":3.0,"remocao":true,"obs":null}],';
    const p22 = '"mecanica":[{"regiao":"nome PT","servico":"suspeita PT","obs":"confirmar apos desmontagem"}],';
    const p23 = '"pecas":[{"nome":"nome PT","qtd":1,"secao":"solicitado"}]}';

    const promptText = p1+p2+p3+p4+p5+p6+p7+p8+p9+p10+p11+p12+p13+p14+p15+p16+p17+p18+p19+p20+p21+p22+p23;

    const imgs = fotos.slice(0, 10).map(function(foto) {
      const b64 = foto.includes(',') ? foto.split(',')[1] : foto;
      const mt = foto.startsWith('data:image/png') ? 'image/png' : 'image/jpeg';
      return { type: 'image_url', image_url: { url: 'data:' + mt + ';base64,' + b64, detail: 'high' } };
    });

    const resp = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + chave },
      body: JSON.stringify({
        model: 'gpt-4o',
        messages: [{ role: 'user', content: [{ type: 'text', text: promptText }].concat(imgs) }],
        max_tokens: 4000,
        temperature: 0.1
      })
    });

    const txt = await resp.text();
    if (!resp.ok) { res.status(500).json({ erro: 'Erro OpenAI: ' + txt.substring(0, 200) }); return; }

    const data = JSON.parse(txt);
    const content = data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
    if (!content) { res.status(500).json({ erro: 'Resposta vazia' }); return; }

    const clean = content.replace(/```json/gi, '').replace(/```/g, '').trim();
    const s = clean.indexOf('{');
    const e = clean.lastIndexOf('}');
    if (s === -1 || e === -1) { res.status(500).json({ erro: 'JSON nao encontrado: ' + clean.substring(0, 150) }); return; }

    const r = JSON.parse(clean.substring(s, e + 1));

    function dedup(arr) {
      if (!arr || !arr.length) return [];
      const seen = {};
      return arr.filter(function(item) {
        const k = ((item.regiao||'') + '|' + (item.tipo||'')).toLowerCase().trim();
        if (seen[k]) return false;
        seen[k] = true;
        return true;
      });
    }

    function dedupP(arr) {
      if (!arr || !arr.length) return [];
      const seen = {};
      return arr.filter(function(item) {
        const k = (item.nome||'').toLowerCase().trim();
        if (seen[k]) return false;
        seen[k] = true;
        return true;
      });
    }

    const sol = dedup(r.solicitados || []);
    const solKeys = {};
    sol.forEach(function(i) { solKeys[((i.regiao||'')+'|'+(i.tipo||'')).toLowerCase().trim()] = true; });
    const adic = dedup(r.adicionais || []).filter(function(i) {
      return !solKeys[((i.regiao||'')+'|'+(i.tipo||'')).toLowerCase().trim()];
    });

    res.status(200).json({
      solicitados: sol,
      adicionais: adic,
      mecanica: dedup(r.mecanica || []),
      pecas: dedupP(r.pecas || [])
    });

  } catch (e) {
    res.status(500).json({ erro: String(e.message || e) });
  }
}
