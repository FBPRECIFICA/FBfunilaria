export const config = { api: { bodyParser: { sizeLimit: '10mb' } } };

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

    const promptText = 'You are a professional automotive body repair estimator in Brazil. Analyze the vehicle photos.' +
      '\n\nVEHICLE: ' + veiculo +
      '\nCLIENT REQUEST: ' + solicitacao +
      '\n\nANALYZE ALL photos together. Do NOT duplicate items. Each region appears ONLY ONCE per service type.' +
      '\n\nPAINTING HOURS: front bumper=4h, rear bumper=4h, door=4-5h, fender=3h, hood=5h, trunk=5h, roof=5h, side panel=6h, mirror=0.5h, handle=0.5h' +
      '\nREPAIR HOURS: light dent=3-4h, medium dent=5-8h, severe dent=10h' +
      '\nREPLACEMENT: any part=1h' +
      '\n\nRULES:' +
      '\n1. Separate replacement and painting into different lines' +
      '\n2. Include removal/installation when possible' +
      '\n3. Include emblems in painting areas (0.5h each)' +
      '\n4. ALWAYS include bumper guide LEFT AND RIGHT when replacing bumper' +
      '\n5. Structural cracks = REPLACEMENT. Dents without cracks = REPAIR' +
      '\n6. Check internal damage: longerons, engine support, radiator grille' +
      '\n7. Strong front/rear impact = add mechanical referral' +
      '\n8. Requested = what client asked. Additional = other damage found' +
      '\n\nTYPES: Troca, Recup., Pintura, Rem/Inst, Interna, Mecanica' +
      '\n\nRespond ONLY with valid JSON, no markdown, no extra text:' +
      '\n{"solicitados":[{"regiao":"string","servico":"string","tipo":"string","horas":1.0,"remocao":true,"obs":null}],"adicionais":[{"regiao":"string","servico":"string","tipo":"string","horas":1.0,"remocao":true,"obs":null}],"mecanica":[{"regiao":"string","servico":"string","obs":"string"}],"pecas":[{"nome":"string","qtd":1,"secao":"solicitado"}]}';

    const imageContents = fotos.slice(0, 10).map(function(foto) {
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
          content: [{ type: 'text', text: promptText }].concat(imageContents)
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

    function dedup(arr) {
      if (!arr || !arr.length) return [];
      const seen = {};
      return arr.filter(function(item) {
        const key = (item.regiao + '|' + item.tipo + '|' + item.servico).toLowerCase();
        if (seen[key]) return false;
        seen[key] = true;
        return true;
      });
    }

    function dedupPecas(arr) {
      if (!arr || !arr.length) return [];
      const seen = {};
      return arr.filter(function(item) {
        const key = item.nome.toLowerCase();
        if (seen[key]) return false;
        seen[key] = true;
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
    res.status(500).json({ erro: String(erro.message || erro) });
  }
}
