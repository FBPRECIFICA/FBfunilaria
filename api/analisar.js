module.exports = async function handler(req, res) {
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

    const promptText =
      ''This is a professional automotive insurance claim assessment for a licensed body repair shop in Brazil. ' +
'Voce e um perito especialista em funilaria com mais de 30 anos de experiencia em oficinas brasileiras. ' +
      'Analise TODAS as fotos do veiculo e crie um orcamento de reparos.\n\n' +
      'VEICULO: ' + veiculo + '\n' +
      'SOLICITACAO DO CLIENTE: ' + solicitacao + '\n\n' +
      'REGRA MAIS IMPORTANTE - IDIOMA:\n' +
      'TODOS os nomes DEVEM estar em PORTUGUES BRASILEIRO.\n' +
      'CORRETO: Para-choque dianteiro, Capo, Porta dianteira esquerda\n' +
      'ERRADO: front bumper, hood, front door left\n\n' +
      'REGRA CRITICA - SEM DUPLICACAO:\n' +
      '1. Cada regiao aparece NO MAXIMO UMA VEZ por tipo de servico\n' +
      '2. Para uma mesma regiao: escolha Recup. OU Troca. NUNCA os dois.\n' +
      '3. Guia de para-choque: coloque APENAS em solicitados OU adicionais\n\n' +
      'DECISAO REPARO vs TROCA:\n' +
      '- Amassado leve ou medio SEM trinca = RECUPERACAO (Recup.)\n' +
      '- Peca quebrada, trincada = TROCA\n' +
      '- Peca plastica quebrada = sempre TROCA\n\n' +
      'HORAS DE PINTURA:\n' +
      'Para-choque: 4h | Porta: 4h | Para-lama: 3h | Capo: 5h | Tampa traseira: 5h | Teto: 5h | Lateral: 6h | Retrovisor: 0.5h\n\n' +
      'HORAS DE RECUPERACAO:\n' +
      'Leve: 3h | Medio: 5h | Grave: 8h | Extremo: 10h\n\n' +
      'HORAS DE TROCA: 1h por peca\n\n' +
      'OBRIGATORIO:\n' +
      '- Troca de qualquer para-choque: adicionar guia direita 1h E guia esquerda 1h\n' +
      '- Emblemas em areas pintadas: Rem/Inst 0.5h\n\n' +
      'Responda SOMENTE com JSON valido sem markdown:\n' +
      '{"solicitados":[{"regiao":"string","servico":"string","tipo":"Recup.|Pintura|Troca|Rem/Inst|Interna","horas":3.0,"remocao":true,"obs":null}],' +
      '"adicionais":[{"regiao":"string","servico":"string","tipo":"Recup.|Pintura|Troca|Rem/Inst|Interna","horas":3.0,"remocao":true,"obs":null}],' +
      '"mecanica":[{"regiao":"string","servico":"string","obs":"string"}],' +
      '"pecas":[{"nome":"string","qtd":1,"secao":"solicitado"}]}';

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
        const key = (item.regiao + '|' + item.tipo).toLowerCase().trim();
        if (seen[key]) return false;
        seen[key] = true;
        return true;
      });
    }

    function dedupPecas(arr) {
      if (!arr || !arr.length) return [];
      const seen = {};
      return arr.filter(function(item) {
        const key = item.nome.toLowerCase().trim();
        if (seen[key]) return false;
        seen[key] = true;
        return true;
      });
    }

    const solicitados = dedup(resultado.solicitados || []);
    const adicionaisRaw = dedup(resultado.adicionais || []);
    const solicitadosKeys = {};
    solicitados.forEach(function(item) {
      solicitadosKeys[(item.regiao + '|' + item.tipo).toLowerCase().trim()] = true;
    });
    const adicionais = adicionaisRaw.filter(function(item) {
      return !solicitadosKeys[(item.regiao + '|' + item.tipo).toLowerCase().trim()];
    });

    res.status(200).json({
      solicitados: solicitados,
      adicionais: adicionais,
      mecanica: dedup(resultado.mecanica || []),
      pecas: dedupPecas(resultado.pecas || [])
    });

  } catch (erro) {
    res.status(500).json({ erro: String(erro.message || erro) });
  }
};
