export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }

  const { placa } = req.query;
  if (!placa) { res.status(400).json({ erro: 'Placa obrigatoria' }); return; }

  try {
    const token = '41368a96a1a92ae80223685716740c68';
    const url = 'https://wdapi2.com.br/consulta/' + placa + '/' + token;
    const resp = await fetch(url);
    const data = await resp.json();
    res.status(200).json(data);
  } catch (e) {
    res.status(500).json({ erro: 'Erro ao consultar placa' });
  }
}
