export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }
  if (req.method !== 'POST') { res.status(405).json({ erro: 'Método não permitido' }); return; }

  try {
    const { veiculo, solicitacao, fotos } = req.body;
    if (!veiculo || !fotos || fotos.length === 0) {
      res.status(400).json({ erro: 'Veículo e fotos são obrigatórios' });
      return;
    }

    const chave = (process.env.OPENAI_KEY || '').replace(/\s/g, '');
    if (!chave || chave.length < 10) {
      res.status(500).json({ erro: 'Chave OpenAI não configurada' });
      return;
    }

    const prompt = `Você é um especialista sênior em funilaria e pintura automotiva com mais de 20 anos de experiência. Analise as fotos do veículo e a solicitação do cliente abaixo.

VEÍCULO: ${veiculo}
SOLICITAÇÃO DO CLIENTE: ${solicitacao}

Sua tarefa é montar um rascunho completo de orçamento de funilaria e pintura seguindo RIGOROSAMENTE as regras abaixo:

## REGRAS DE HORAS — PINTURA (tabela fixa):
- Para-choque dianteiro: 4h
- Para-choque traseiro: 4h
- Porta: 4 a 5h cada
- Para-lama: 3h
- Capô: 5h
- Tampa traseira/porta-malas: 5h
- Teto: 5h
- Lateral completa: 6h cada
- Retrovisor: 0,5h
- Maçaneta: 0,5h

## REGRAS DE HORAS — RECUPERAÇÃO (baseado no grau):
- Amassado leve: 3 a 4h
- Amassado médio: 5 a 8h
- Amassado grave: 10h ou "negociação"

## REGRAS DE HORAS — TROCA:
- Qualquer peça trocada: 1h (remoção e instalação)

## REGRAS OBRIGATÓRIAS:
1. SEMPRE separar troca e pintura em linhas diferentes
2. SEMPRE incluir remoção/instalação quando possível (exceto teto, lateral fixa)
3. SEMPRE incluir emblemas na área de pintura ou avaria (remoção e instalação 0,5h cada)
4. SEMPRE incluir guia de para-choque (esquerdo E direito) quando houver troca de para-choque
5. Avaliar se a peça deve ser recuperada ou trocada baseado no grau visual da avaria
6. Peças com trinca estrutural, deformação severa = TROCA
7. Amassados sem trinca = RECUPERAÇÃO
8. SEMPRE avaliar avarias internas: longarinas, suporte do motor, guias, grade do radiador
9. Para impactos frontais/traseiros fortes: indicar encaminhamento para mecânica
10. Separar em 4 seções: solicitados, adicionais, mecanica, pecas

## TIPOS VÁLIDOS:
- "Troca" — peça a ser substituída
- "Recup." — recuperação por funileiro
- "Pintura" — pintura após recuperação ou troca
- "Rem/Inst" — remoção e instalação sem troca
- "Interna" — avaria interna a confirmar
- "Mecânica" — encaminhamento para mecânica

Responda APENAS com JSON válido:
{
  "solicitados": [
    {
      "regiao": "nome da região",
      "servico": "descrição do serviço",
      "tipo": "Troca|Recup.|Pintura|Rem/Inst|Interna",
      "horas": 1.0,
      "remocao": true,
      "obs": "observação ou null"
    }
  ],
  "adicionais": [
    {
      "regiao": "nome da região",
      "servico": "descrição do serviço",
      "tipo": "Troca|Recup.|Pintura|Rem/Inst|Interna",
      "horas": 1.0,
      "remocao": true,
      "obs": "observação ou null"
    }
  ],
  "mecanica": [
    {
      "regiao": "nome da região",
      "servico": "suspeita mecânica",
      "obs": "confirmar após desmontagem"
    }
  ],
  "pecas": [
    {
      "nome": "nome da peça",
      "qtd": 1,
      "secao": "solicitado|adicional"
    }
  ]
}`;

    const imageContents = fotos.slice(0, 10).map(foto => {
      const base64 = foto.includes(',') ? foto.split(',')[1] : foto;
      const mediaType = foto.startsWith('data:image/png') ? 'image/png' : 'image/jpeg';
      return {
        type: 'image_url',
        image_url: { url: `data:${mediaType};base64,${base64}`, detail: 'high' }
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
        temperature: 0.1,
        response_format: { type: 'json_object' }
      })
    });

    const text = await response.text();
    if (!response.ok) {
      res.status(500).json({ erro: 'Erro OpenAI: ' + text.substring(0, 300) });
      return;
    }

    const data = JSON.parse(text);
    const content = data.choices?.[0]?.message?.content;
    if (!content) {
      res.status(500).json({ erro: 'Resposta vazia da IA' });
      return;
    }

    res.status(200).json(JSON.parse(content));

  } catch (erro) {
    console.error('Erro analisar:', erro);
    res.status(500).json({ erro: String(erro.message || erro) });
  }
}
