

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
      'Voce e um perito especialista em funilaria e pintura automotiva com mais de 20 anos de experiencia em oficinas brasileiras. ' +
      'Analise TODAS as fotos do veiculo e crie um orcamento de reparos.\n\n' +
      'VEICULO: ' + veiculo + '\n' +
      'SOLICITACAO DO CLIENTE: ' + solicitacao + '\n\n' +

      'REGRA MAIS IMPORTANTE - IDIOMA:\n' +
      'TODOS os nomes de regioes, servicos e pecas DEVEM estar em PORTUGUES BRASILEIRO.\n' +
      'Exemplos CORRETOS: "Para-choque dianteiro", "Capo", "Porta dianteira esquerda", "Grade do radiador"\n' +
      'Exemplos ERRADOS: "front bumper", "hood", "front door left", "radiator grille"\n\n' +

      'REGRA CRITICA - SEM DUPLICACAO:\n' +
      '1. Analise TODAS as fotos como um conjunto unico\n' +
      '2. Cada regiao deve aparecer NO MAXIMO UMA VEZ por tipo de servico\n' +
      '3. Se a mesma peca aparecer em multiplas fotos, liste APENAS UMA VEZ\n' +
      '4. Para-choque dianteiro pode ter: 1 linha Troca + 1 linha Pintura. NAO repita.\n' +
      '5. Guia de para-choque: coloque APENAS em solicitados OU adicionais, NUNCA nos dois\n\n' +

      'DECISAO REPARO vs TROCA - SIGA RIGOROSAMENTE:\n' +
      '- Amassado leve ou medio SEM trinca = RECUPERACAO (Recup.) - NUNCA troca\n' +
      '- Peca quebrada, trincada, deformacao estrutural = TROCA\n' +
      '- Peca plastica quebrada = sempre TROCA (nao da para recuperar)\n' +
      '- Em caso de duvida com dano leve = sempre Recup., nunca Troca\n' +
      '- Para uma mesma regiao: escolha Recup. OU Troca. NUNCA os dois.\n\n' +

      'TABELA DE HORAS DE PINTURA (fixo - nao altere):\n' +
      '- Para-choque dianteiro: 4h\n' +
      '- Para-choque traseiro: 4h\n' +
      '- Porta: 4h cada\n' +
      '- Para-lama: 3h\n' +
      '- Capo: 5h\n' +
      '- Tampa traseira: 5h\n' +
      '- Teto: 5h\n' +
      '- Lateral completa: 6h\n' +
      '- Retrovisor: 0.5h\n' +
      '- Maceneta: 0.5h\n\n' +

      'HORAS DE RECUPERACAO por nivel de dano:\n' +
      '- Amassado leve (pequeno, raso): 3h\n' +
      '- Amassado medio (maior, mais profundo): 5h\n' +
      '- Amassado grave (muito grande): 8h\n' +
      '- Dano extremo: 10h\n\n' +

      'HORAS DE TROCA: 1h para qualquer peca substituida\n\n' +

      'NOMES CORRETOS DAS PECAS em portugues:\n' +
      '- Para-choque dianteiro / Para-choque traseiro\n' +
      '- Porta dianteira direita / Porta dianteira esquerda\n' +
      '- Porta traseira direita / Porta traseira esquerda\n' +
      '- Para-lama dianteiro direito / Para-lama dianteiro esquerdo\n' +
      '- Capo / Tampa traseira / Teto\n' +
      '- Retrovisor direito / Retrovisor esquerdo\n' +
      '- Moldura de roda direita / Moldura de roda esquerda\n' +
      '- Guia de para-choque dianteiro direito / esquerdo\n' +
      '- Guia de para-choque traseiro direito / esquerdo\n' +
      '- Emblema dianteiro / Emblema traseiro\n' +
      '- Grade do radiador\n' +
      '- Longarina dianteira direita / esquerda\n' +
      '- Suporte do motor\n' +
      '- Radiador\n' +
      '- Painel traseiro\n\n' +

      'ITENS OBRIGATORIOS:\n' +
      '- Emblemas em areas de pintura: adicione Rem/Inst 0.5h\n' +
      '- Troca de QUALQUER para-choque: adicione guia direita 1h E guia esquerda 1h\n' +
      '- Peca que precisa ser removida para acesso: adicione linha Rem/Inst\n\n' +

      'ENCAMINHAMENTO MECANICA - adicione se houver:\n' +
      '- Impacto frontal forte: suspeita radiador, suporte motor, direcao\n' +
      '- Impacto traseiro forte: suspeita escapamento, suspensao traseira\n' +
      '- Impacto lateral: suspeita alinhamento, suspensao\n\n' +

      'SECOES:\n' +
      '- solicitados: danos que o cliente pediu especificamente\n' +
      '- adicionais: outros danos que voce encontrou alem do solicitado\n' +
      '- mecanica: suspeitas mecanicas para encaminhar ao setor mecanico\n' +
      '- pecas: lista de todas as pecas para COMPRAR (apenas itens Troca)\n\n' +

      'Responda SOMENTE com JSON valido, sem markdown, sem texto extra, sem explicacao:\n' +
      '{"solicitados":[{"regiao":"nome em portugues","servico":"descricao em portugues","tipo":"Recup.|Pintura|Troca|Rem/Inst|Interna","horas":3.0,"remocao":true,"obs":null}],' +
      '"adicionais":[{"regiao":"nome em portugues","servico":"descricao em portugues","tipo":"Recup.|Pintura|Troca|Rem/Inst|Interna","horas":3.0,"remocao":true,"obs":null}],' +
      '"mecanica":[{"regiao":"nome em portugues","servico":"suspeita em portugues","obs":"confirmar apos desmontagem"}],' +
      '"pecas":[{"nome":"nome da peca em portugues","qtd":1,"secao":"solicitado"}]}';

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

    // Remove guias duplicadas entre solicitados e adicionais
    const solicitados = dedup(resultado.solicitados || []);
    const adicionaisRaw = dedup(resultado.adicionais || []);
    const solicitadosKeys = {};
    solicitados.forEach(function(item) {
      solicitadosKeys[(item.regiao + '|' + item.tipo).toLowerCase().trim()] = true;
    });
    const adicionais = adicionaisRaw.filter(function(item
