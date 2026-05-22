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

    const promptText = 'Professional automotive body shop damage assessment in Brazil. ' +
      'Analyze these vehicle damage photos and create a detailed repair estimate.\n\n' +
      'VEHICLE: ' + veiculo + '\n' +
      'CLIENT REQUEST: ' + solicitacao + '\n\n' +
      'LANGUAGE: All region names, service descriptions and part names MUST be in Brazilian Portuguese.\n' +
      'Examples: Para-choque dianteiro, Capo, Porta dianteira esquerda, Para-lama, Grade do radiador\n\n' +
      'RULES:\n' +
      '1. NO DUPLICATES - each damaged region appears only once per service type\n' +
      '2. For each region choose ONLY Recup. OR Troca - never both\n' +
      '3. Dents without cracks = Recup. Broken/cracked parts = Troca\n' +
      '4. Add separate Pintura line after each Recup. or Troca\n' +
      '5. Replacing any bumper = add guia direito + guia esquerdo\n' +
      '6. Emblems in paint area = add Rem/Inst 0.5h\n\n' +
      'PAINTING HOURS: para-choque=4h, porta=4h, para-lama=3h, capo=5h, tampa traseira=5h, teto=5h, lateral=6h, retrovisor=0.5h\n' +
      'REPAIR HOURS: leve=3h, medio=5h, grave=8h\n' +
      'REPLACEMENT HOURS: 1h per part\n\n' +
      'OUTPUT: valid JSON only, no markdown:\n' +
      '{"solicitados":[{"regiao":"PT name","servico":"PT description","tipo":"Recup.|Pintura|Troca|Rem/Inst|Interna","horas":3.0,"remocao":true,"obs":null}],' +
      '"adicionais":[{"regiao":"PT name","servico":"PT description","tipo":"Recup.|Pintura|Troca|Rem/Inst|Interna","horas":3.0,"remocao":true,"obs":null}],' +
      '"mecanica":[{"regiao":"PT name","servico":"PT description","obs":"confirmar apos desmontagem"}],' +
      '"pecas":[{"nome":"PT name","qtd":1,"secao":"solicitado"}]}';

    const msgContent = [{ type: 'text', text: promptText }];

    fotos.slice(0, 10).forEach(function(foto) {
      const b64 = foto.includes(',') ? foto.split(',')[1] : foto;
      msgContent.push({
        type: 'image_url',
        image_url: {
          url: 'data:image/jpeg;base64,' + b64,
          detail: 'high'
        }
      });
    });

    const resp = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + chave
      },
      body: JSON.stringify({
        model: 'gpt-4o',
        messages: [{ role: 'user', content: msgContent }],
        max_tokens: 4000,
        temperature: 0.1
      })
    });

    const txt = await resp.text();

    if (!resp.ok) {
      res.status(500).json({ erro: 'Erro OpenAI: ' + txt.substring(0, 300) });
      return;
    }

    const data = JSON.parse(txt);
    const content = data.choices &&
      data.choices[0] &&
      data.choices[0].message &&
      data.choices[0].message.content;

    if (!content) {
      res.status(500).json({ erro: 'Resposta vazia da IA' });
      return;
    }

    const clean = content.replace(/```json/gi, '').replace(/```/g, '').trim();
    const s = clean.indexOf('{');
    const e = clean.lastIndexOf('}');

    if (s === -1 || e === -1) {
      res.status(500).json({ erro: 'JSON nao encontrado: ' + clean.substring(0, 200) });
      return;
    }

    const r = JSON.parse(clean.substring(s, e + 1));

    function dedup(arr) {
      if (!arr || !arr.length) return [];
      const seen = {};
      return arr.filter(function(item) {
        const k = ((item.regiao || '') + '|' + (item.tipo || '')).toLowerCase().trim();
        if (seen[k]) return false;
        seen[k] = true;
        return true;
      });
    }

    function dedupPecas(arr) {
      if (!arr || !arr.length) return [];
      const seen = {};
      return arr.filter(function(item) {
        const k = (item.nome || '').toLowerCase().trim();
        if (seen[k]) return false;
        seen[k] = true;
        return true;
      });
    }

    const sol = dedup(r.solicitados || []);
    const solKeys = {};
    sol.forEach(function(i) {
      solKeys[((i.regiao || '') + '|' + (i.tipo || '')).toLowerCase().trim()] = true;
    });
    const adic = dedup(r.adicionais || []).filter(function(i) {
      return !solKeys[((i.regiao || '') + '|' + (i.tipo || '')).toLowerCase().trim()];
    });

    res.status(200).json({
      solicitados: sol,
      adicionais: adic,
      mecanica: dedup(r.mecanica || []),
      pecas: dedupPecas(r.pecas || [])
    });

  } catch (e) {
    res.status(500).json({ erro: String(e.message || e) });
  }
}
