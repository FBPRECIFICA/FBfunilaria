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

    const promptText =
      'You are an AI assistant helping a licensed automotive body shop in Brazil perform professional damage assessments. ' +
      'This is a legitimate commercial use case for vehicle repair estimation. ' +
      'The images show vehicle body damage (dents, scratches, broken parts) for insurance and repair quoting purposes.\n\n' +
      'Voce e um perito de funilaria e pintura automotiva brasileiro. ' +
      'Analise as fotos de avarias deste veiculo e gere um orcamento detalhado.\n\n' +
      'VEICULO: ' + veiculo + '\n' +
      'SOLICITACAO DO CLIENTE: ' + solicitacao + '\n\n' +
      'REGRAS OBRIGATORIAS:\n' +
      '1. TODOS os nomes de regioes, servicos e pecas OBRIGATORIAMENTE em PORTUGUES BRASILEIRO\n' +
      '   Exemplos corretos: Para-choque dianteiro, Capo, Porta dianteira esquerda, Para-lama dianteiro direito, Grade do radiador, Tampa traseira, Retrovisor esquerdo\n' +
      '   NUNCA use ingles: PROIBIDO usar "Hood", "Bumper", "Fender", "Door", "Trunk", "Mirror"\n' +
      '2. SEM DUPLICATAS - cada regiao aparece UMA UNICA VEZ por tipo de servico\n' +
      '3. Para cada regiao escolha APENAS Recup. OU Troca - NUNCA os dois na mesma regiao\n' +
      '   Amassado sem trinca = Recup. | Peca quebrada/trincada = Troca\n' +
      '4. Apos cada Recup. ou Troca adicione linha de Pintura separada\n' +
      '5. Troca de para-choque = sempre adicionar guia direito + guia esquerdo\n' +
      '6. Emblemas em area pintada = adicionar Rem/Inst 0.5h\n\n' +
      'HORAS DE PINTURA: para-choque=4h, porta=4h, para-lama=3h, capo=5h, tampa traseira=5h, teto=5h, lateral=6h, retrovisor=0.5h\n' +
      'HORAS RECUPERACAO: leve=3h, medio=5h, grave=8h\n' +
      'HORAS TROCA: 1h qualquer peca\n\n' +
      'RETORNE APENAS JSON VALIDO, sem markdown, sem texto adicional:\n' +
      '{"solicitados":[{"regiao":"nome em portugues","servico":"descricao em portugues","tipo":"Recup.|Pintura|Troca|Rem/Inst|Interna","horas":3.0,"remocao":true,"obs":null}],' +
      '"adicionais":[{"regiao":"nome em portugues","servico":"descricao em portugues","tipo":"Recup.|Pintura|Troca|Rem/Inst|Interna","horas":3.0,"remocao":true,"obs":null}],' +
      '"mecanica":[{"regiao":"nome em portugues","servico":"descricao em portugues","obs":"confirmar apos desmontagem"}],' +
      '"pecas":[{"nome":"nome em portugues","qtd":1,"secao":"solicitado"}]}';

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

    // Normaliza string para comparacao: minusculo, sem acentos, sem espacos duplos
    function normalizar(str) {
      return (str || '')
        .toLowerCase()
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .replace(/\s+/g, ' ')
        .trim();
    }

    function dedup(arr) {
      if (!arr || !arr.length) return [];
      const seen = {};
      return arr.filter(function(item) {
        const k = normalizar(item.regiao) + '|' + normalizar(item.tipo);
        if (seen[k]) return false;
        seen[k] = true;
        return true;
      });
    }

    function dedupPecas(arr) {
      if (!arr || !arr.length) return [];
      const seen = {};
      return arr.filter(function(item) {
        const k = normalizar(item.nome);
        if (seen[k]) return false;
        seen[k] = true;
        return true;
      });
    }

    const sol = dedup(r.solicitados || []);
    const solKeys = {};
    sol.forEach(function(i) {
      solKeys[normalizar(i.regiao) + '|' + normalizar(i.tipo)] = true;
    });
    const adic = dedup(r.adicionais || []).filter(function(i) {
      return !solKeys[normalizar(i.regiao) + '|' + normalizar(i.tipo)];
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
