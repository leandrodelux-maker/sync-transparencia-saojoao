// Conjuntos de dados copiados do Portal da Transparência (Megasoft). O nome de cada conjunto é o
// `slug` do item no catálogo do site (src/data/transparenciaCatalogo.ts).
//
// Tabelas (lidas da API JSON que alimenta a própria tabela do portal):
//   path     página do portal; o coletor abre a página e reaproveita a chamada "/paginado" que ela faz
//   filtro   como o período entra na consulta: "ano" (ano=AAAA), "datas" (01/01 a 31/12), "meses" (uma
//            leitura por mês do ano: folha), "ultimo-mes" (só o último mês fechado), "dezembro" (posição
//            de fechamento do ano: ações e projetos), "anos" (uma leitura por ano, de `desde` até o ano
//            corrente, um registro por ano com chave = ano: estatísticas do e-SIC) ou "acumulado"
//            (cadastro sem ano: copia tudo e grava no ano corrente)
//   chave    caminho do campo que identifica o registro (ex.: "chave.codigoDaReceita")
//   colunas  [rótulo exibido no site, caminho do campo na API, formato?]; formato "brl" = valor em reais,
//            "json" = guarda o valor como veio (listas e objetos, como os gráficos do e-SIC).
//            As primeiras colunas aparecem na tabela do site; as demais, no detalhe do registro.
//   api      { caminho, metodo?, corpo? }: monta a consulta "/paginado" direto (caminho a partir de /api/),
//            sem depender da chamada que a página faz; em POST o ano vai no corpo.
//   detalhe  { tabela?, ano? }: também copia a tela de detalhe de cada registro (campos, listas como empenhos e
//            itens, e os arquivos anexados da "tabela" de documentos do portal) para o conjunto "<nome>-detalhe";
//            `ano: true` quando a tela de detalhe do portal também exige o exercício (fiscais);
//            `chaveDaLista`: nome do parâmetro que identifica o registro ao reler uma lista longa (padrão "codigo");
//            `consulta(chave, ano)`: parâmetros da tela de detalhe quando não bastam a chave (folha);
//            `somenteArquivos`: só os anexos (listas de documentos, que não têm tela de detalhe);
//            `somente(dados)`: abre só os registros que precisam do detalhe (ex.: os que têm anulação).
// Páginas simples: extrair(markdown, ano) devolve [{ chave, dados }] a partir do texto da página.

const RD = "receitas-e-despesas/";
const OS = "orgaos-e-servidores/";
const PP = "planejamento-e-politicas-publicas/";
const LP = "legislacao-e-publicacoes/";
const CL = "contratos-convenios-e-licitacoes/";
const OE = "ouvidoria-e-e-sic/";
const temValor = (v) => /[1-9]/.test(v ?? "");

// Procedimentos (licitações, dispensas e adesões): mesmas colunas e mesma tela de detalhe do portal.
const COLUNAS_PROCESSO = [
  ["Número/Ano", "numeroAno"],
  ["Modalidade", "modalidade"],
  ["Situação", "situacao"],
  ["Publicação", "dataDePublicacao"],
  ["Julgamento", "dataDeJulgamento"],
  ["Objeto", "historico"],
  ["Valor estimado", "valorEstimadoTotal", "brl"],
  ["Valor vencedor", "valorVencedorTotal", "brl"],
  ["Órgão", "orgao"],
];
const COLUNAS_CONVENIO = [
  ["Convênio", "numeroDoConvenio"],
  ["Início da vigência", "data"],
  ["Fim da vigência", "vigencia"],
  ["Concedente", "nomeDoConcedente"],
  ["Beneficiário", "nomeDoConvenente"],
  ["Objeto", "descricao"],
  ["Valor previsto", "valor", "brl"],
  ["Valor recebido", "valorRecebido", "brl"],
  ["Processo", "processoAdministrativo"],
  ["Tipo", "tipoDeQualificacaoDeConvenio"],
  ["Categoria", "categoriaDoConvenio"],
];
// Documentos publicados por "menu e função" do portal (plano de contratação, sancionados).
const COLUNAS_DOCUMENTO = [
  ["Número", "numeroDoDecreto"],
  ["Ano", "anoDoDecreto"],
  ["Documento", "nomeDoDocumento"],
  ["Descrição", "descricaoDoDocumento"],
  ["Situação", "situacao"],
];
// Parecer prévio do Tribunal de Contas: o acórdão fica nos documentos do processo (RESULTADO_DE_PROCESSO).
const COLUNAS_CONTAS = [
  ["Exercício", "exercicio"],
  ["Modalidade", "nomeDaModalidade"],
  ["Resultado", "descricaoDoStatus"],
  ["Registro", "dataDoRegistro"],
  ["Data do resultado", "dataDoResultado"],
];
// Os arquivos de cada documento ficam no serviço de documentos do portal, pelo código do registro.
const documentos = (path, tipo, local) => ({
  path, filtro: "acumulado", chave: "codigo",
  api: { caminho: `documentos-por-menu-e-funcao/paginado?pagina=1&tamanhoDaPagina=500&tipoDeDocumento=${tipo}&localDaPublicacao=${local}` },
  detalhe: { tabela: "DOCUMENTO_PORTAL_DA_TRANSPARENCIA", somenteArquivos: true },
  colunas: COLUNAS_DOCUMENTO,
});

export const DATASETS = {
  // Totais da página inicial do portal ("Receitas Recebidas 2026" / "Despesas Liquidadas 2026").
  resumo: {
    path: "",
    extrair: (md, ano) => {
      const valor = (rotulo) => md.match(new RegExp(`${rotulo}\\s+${ano}:?[\\s#]*(R\\$\\s*[\\d.]+,\\d{2})`, "i"))?.[1];
      const receitas = valor("Receitas Recebidas"), despesas = valor("Despesas Liquidadas");
      if (!receitas || !despesas) throw new Error(`totais de ${ano} não encontrados na página inicial do portal`);
      return [{ chave: "totais", dados: { receitas_recebidas: receitas, despesas_liquidadas: despesas } }];
    },
  },

  // ---------- Receitas e Despesas ----------
  // Rótulos técnicos: usados pela página própria de Despesas (src/pages/transparency/DespesasPage.tsx).
  despesas: {
    path: RD + "despesa-sintetica", filtro: "ano", chave: "chave.codigoDaDespesa",
    colunas: [
      ["classificacao", "classificacaoOrcamentaria"],
      ["valor_orcado", "valorOrcado", "brl"],
      ["dotacao_atualizada", "valorDaDotacaoAtualizada", "brl"],
      ["valor_empenhado", "valorEmpenhado", "brl"],
      ["valor_liquidado", "valorLiquidado", "brl"],
      ["valor_pago", "valorPago", "brl"],
    ],
  },
  receitas: {
    path: RD + "receita", filtro: "ano", chave: "chave.codigoDaReceita",
    colunas: [
      ["Natureza da receita", "naturezaDaReceita"],
      ["Origem dos recursos", "origemDoRecurso"],
      ["Fonte de recurso", "fonteDaReceita"],
      ["Previsto no ano", "valorOrcado", "brl"],
      ["Arrecadado no mês", "arrecadacao", "brl"],
      ["Arrecadado no ano", "valorAcumulado", "brl"],
      ["Órgão", "orgaoUnidadeGestora"],
      ["Mês de referência", "chave.mes"],
    ],
  },
  pagamentos: {
    path: RD + "ordem-de-pagamento", filtro: "datas", chave: "codigo",
    // Motivo dos estornos: só o detalhe do pagamento informa.
    detalhe: { somente: (d) => temValor(d["Valor anulado"]) },
    colunas: [
      ["Número", "numero"],
      ["Data", "dataPagamento"],
      ["Fornecedor", "nomeDoFornecedor"],
      ["CPF/CNPJ", "cpfOuCnpjDoFornecedor"],
      ["Órgão", "nomeDoOrgao"],
      ["Fase", "fase"],
      ["Valor total", "valorTotal", "brl"],
      ["Valor pago", "valorPago", "brl"],
      ["Valor anulado", "valorAnulacao", "brl"],
      ["Retenções", "valorRetencao", "brl"],
      ["Empenho", "numeroDoEmpenho"],
      ["Liquidação", "numeroDaLiquidacao"],
    ],
  },
  empenhos: {
    path: RD + "empenho", filtro: "datas", chave: "codigo",
    // Motivo das anulações (do empenho, da liquidação e do pagamento): só o detalhe do empenho informa.
    detalhe: { somente: (d) => temValor(d["Valor anulado do empenho"]) || temValor(d["Anulação da liquidação"]) || temValor(d["Anulação do pagamento"]) },
    colunas: [
      ["Número", "numeroDoTcm"],
      ["Data", "data"],
      ["Fornecedor", "nomeDoFornecedor"],
      ["Histórico", "historico"],
      ["Empenhado", "valorTotalDoEmpenho", "brl"],
      ["Liquidado", "valorTotalDaLiquidacao", "brl"],
      ["Pago", "valorTotalDoPagamento", "brl"],
      ["Fornecedor (CPF/CNPJ)", "cnpjENomeDoFornecedor"],
      ["Órgão", "codigoENomeDoOrgao"],
      ["Unidade", "codigoENomeDaUnidade"],
      ["Função", "codigoENomeDaFuncao"],
      ["Subfunção", "codigoENomeDaSubfuncao"],
      ["Programa", "codigoENomeDoPrograma"],
      ["Ação", "codigoENomeDaAcao"],
      ["Natureza da despesa", "codigoENomeDaNaturezaDespesa"],
      ["Classificação orçamentária", "classificacaoOrcamentaria"],
      ["Fonte de recurso", "tituloDaFonte"],
      ["Valor anulado do empenho", "valorDaAnulacaoDoEmpenho", "brl"],
      ["Anulação da liquidação", "valorDaAnulacaoDaLiquidacao", "brl"],
      ["Anulação do pagamento", "valorAnulacaoDoPagamento", "brl"],
    ],
  },
  liquidacao: {
    path: RD + "liquidacao", filtro: "datas", chave: "codigoDaLiquidacao",
    detalhe: { somente: (d) => d["Fase"] !== "Emissão" },
    colunas: [
      ["Número", "numeroDoTcm"],
      ["Data", "data"],
      ["Fornecedor", "nomeDoFornecedor"],
      ["CPF/CNPJ", "cpfOuCnpjDoFornecedor"],
      ["Empenho", "numeroDoEmpenho"],
      ["Fase", "faseDaLiquidacao"],
      ["Valor", "valorDaLiquidacao", "brl"],
      ["Unidade", "codigoDaUnidade"],
      ["Programa", "numeroDoPrograma"],
      ["Elemento", "numeroDoElemento"],
    ],
  },
  repasses: {
    path: RD + "repasse-ou-transferencia-de-recursos", filtro: "ano", chave: "chave.codigoDaExtra",
    colunas: [
      ["Órgão", "orgao"],
      ["Título", "titulo"],
      ["Tipo de repasse", "tipoDeLancamento"],
      ["Mês", "mes"],
      ["Movimento no mês", "valorMovimento", "brl"],
      ["Anulação no mês", "valorAnulacao", "brl"],
      ["Acumulado no ano", "valorAcumulado", "brl"],
    ],
  },
  patrimonio: {
    path: RD + "patrimonio-e-almoxarifado", filtro: "acumulado", chave: "codigoDoPatrimonio",
    colunas: [
      ["Tombamento", "numeroDeTombamento"],
      ["Descrição", "descricao"],
      ["Tipo do bem", "tipoDeBem"],
      ["Categoria", "subCategoria"],
      ["Aquisição", "dataDeAquisicao"],
      ["Valor original", "valorOriginal", "brl"],
      ["Valor atual", "valorAtual", "brl"],
      ["Quantidade", "quantidade"],
      ["Departamento", "nomeDoDepartamento"],
      ["Órgão", "nomeDoOrgao"],
      ["Fornecedor", "fornecedor"],
      ["CPF/CNPJ do fornecedor", "cpfOuCnpj"],
    ],
  },
  "extra-orcamentaria": {
    path: RD + "extra-orcamentaria", filtro: "ano", chave: "chave.codigoDaExtra",
    colunas: [
      ["Órgão", "orgao"],
      ["Título", "titulo"],
      ["Tipo de lançamento", "tipoDoLancamento"],
      ["Movimento no mês", "valorMovimento", "brl"],
      ["Anulação no mês", "valorAnulacao", "brl"],
      ["Acumulado no ano", "valorAcumulado", "brl"],
    ],
  },
  "renuncias-fiscais": {
    path: RD + "renuncia-fiscal", filtro: "ano", chave: "codigoDaRenunciaFiscal",
    colunas: [
      ["Tributo", "tributo"],
      ["Tipo de renúncia", "tipoDeRenuncia"],
      ["Setor, programa ou beneficiário", "setorOuProgramaOuBeneficiario"],
      ["Renúncia prevista", "renunciaDeReceitaPrevista", "brl"],
      ["Compensação", "compensacao"],
      ["Ano", "ano"],
    ],
  },
  "despesas-fixadas": {
    path: RD + "despesas-fixadas", filtro: "ano", chave: "codigo",
    colunas: [
      ["Órgão", "orgao"],
      ["Elemento de despesa", "elemento"],
      ["Fonte de recurso", "fonte"],
      ["Dotação inicial", "valorOrcado", "brl"],
      ["Ação", "codigoDaAcao"],
      ["Programa", "codigoDoPrograma"],
      ["Função", "codigoDaFuncao"],
      ["Subfunção", "codigoDaSubFuncao"],
    ],
  },
  "restos-a-pagar": {
    path: RD + "informacao-consolidada-resto-a-pagar", filtro: "ano", chave: "codigo",
    colunas: [
      ["Empenho", "numeroDoEmpenho"],
      ["Ano do empenho", "ano"],
      ["Fornecedor", "fornecedor"],
      ["Rubrica", "rubricaDespesa"],
      ["Empenhado", "valorEmpenhado", "brl"],
      ["Liquidado", "valorLiquidado", "brl"],
      ["Pago", "valorPago", "brl"],
      ["CPF/CNPJ", "cpfCnpj"],
      ["Fonte de recurso", "fonte"],
      ["Órgão", "orgao"],
    ],
  },
  "informacoes-consolidadas": {
    path: RD + "informacoes-consolidadas", filtro: "ano", chave: "codigoDoEmpenho",
    colunas: [
      ["Empenho", "numeroDoEmpenhoFormatado"],
      ["Órgão", "nomeDoOrgao"],
      ["Fornecedor", "fornecedor"],
      ["Rubrica", "rubricaFormatada"],
      ["Empenhado", "valorEmpenhado", "brl"],
      ["Liquidado", "valorLiquidado", "brl"],
      ["Pago", "valorPago", "brl"],
      ["Fonte de recurso", "fonteFormatada"],
    ],
  },
  "transferencias-recebidas": {
    path: RD + "transferencias-recebidas", filtro: "ano", chave: "chave.codigoDaReceita",
    colunas: [
      ["Data do repasse", "dataDoRepasse"],
      ["Receita", "receita"],
      ["Origem", "origemDoRecurso"],
      ["Fonte", "fonteDaReceita"],
      ["Valor recebido", "valorRecebido", "brl"],
      ["Objeto", "objeto"],
      ["Natureza da receita", "naturezaDaReceita"],
    ],
  },
  "transferencias-realizadas": {
    path: RD + "transferencia-voluntaria-realizada", filtro: "acumulado", chave: "codigoDoEmpenho",
    colunas: [
      ["Data do repasse", "dataDoRepasse"],
      ["Beneficiário", "beneficiario"],
      ["CPF/CNPJ", "cpfCnpjDoBeneficiario"],
      ["Valor concedido", "valorConcedido", "brl"],
    ],
  },
  "divida-ativa": {
    path: RD + "lista-inscritos-divida-ativa", filtro: "acumulado",
    chave: (r) => `${r.nomeDoContribuinte}|${r.anoDaDividaAtiva}`,
    colunas: [
      ["Contribuinte", "nomeDoContribuinte"],
      ["Ano de inscrição", "anoDaDividaAtiva"],
      ["Total da dívida", "valorTotalDaDividaAtiva", "brl"],
    ],
  },

  // ---------- Licitações, Contratos e Obras ----------
  // Rótulos lidos pelas páginas próprias (src/pages/transparency/{Licitacoes,Contratos,Obras}Page.tsx).
  // A página do portal só filtra o ano no corpo do POST, então a consulta é montada direto (`api`).
  licitacoes: {
    path: CL + "procedimentos-licitatorios?tipoDeConsultaDeModalidade=1", filtro: "ano", chave: "codigo",
    api: { caminho: CL + "procedimento-licitatorio/paginado", metodo: "POST", corpo: { tipoDeConsultaDeModalidade: 1 } },
    detalhe: { tabela: "LICITACAO" },
    colunas: COLUNAS_PROCESSO,
  },
  contratos: {
    path: CL + "contrato", filtro: "ano", chave: "codigo",
    api: { caminho: CL + "contrato/paginado", metodo: "POST" },
    detalhe: { tabela: "CONTRATO" },
    colunas: [
      ["Número", "numero"],
      ["Ano", "exercicioAno"],
      ["Modalidade", "modalidade"],
      ["Situação", "situacao"],
      ["Início", "data"],
      ["Fim da vigência", "vigencia"],
      ["Fornecedor", "nomeDoFornecedor"],
      ["Objeto", "objeto"],
      ["Valor", "valor", "brl"],
      ["CPF/CNPJ", "cpfOuCnpjDoFornecedor"],
      ["Órgão", "nomeDoOrgao"],
      ["Fiscal", "nomeDoFiscalDoContrato"],
      ["Finalidade", "finalidade"],
    ],
  },
  obras: {
    path: CL + "obra", filtro: "acumulado", chave: "codigoDaObra",
    api: { caminho: CL + "obra/paginado?pagina=1&tamanhoDaPagina=500" },
    detalhe: { tabela: "OBRA" },
    colunas: [
      ["Título", "titulo"],
      ["Objeto", "objeto"],
      ["Bairro", "bairro"],
      ["Endereço", "endereco"],
      ["Valor", "valor", "brl"],
      ["Início", "dataInicial"],
      ["Previsão de término", "dataFinal"],
      ["Órgão", "nomeOrgao"],
    ],
  },
  dispensas: {
    path: CL + "dispensas-inexigibilidades", filtro: "ano", chave: "codigo",
    api: { caminho: CL + "procedimento-licitatorio/paginado", metodo: "POST", corpo: { tipoDeConsultaDeModalidade: 2 } },
    detalhe: { tabela: "LICITACAO" },
    colunas: COLUNAS_PROCESSO,
  },
  "atas-de-adesao": {
    path: CL + "procedimentos-licitatorios?tipoDeConsultaDeModalidade=1&codigosDasModalidades=%5B20%5D", filtro: "ano", chave: "codigo",
    api: { caminho: CL + "procedimento-licitatorio/paginado", metodo: "POST", corpo: { tipoDeConsultaDeModalidade: 1, codigosDasModalidades: [20] } },
    detalhe: { tabela: "LICITACAO" },
    colunas: COLUNAS_PROCESSO,
  },
  "ordem-de-fornecimento": {
    path: CL + "ordem-de-fornecimento", filtro: "datas", chave: "codigoDaCompra",
    api: { caminho: CL + "ordem-de-fornecimento/paginado", metodo: "POST" },
    detalhe: { tabela: "COMPRA" },
    colunas: [
      ["Compra", "codigoDaCompra"],
      ["Modalidade", "modalidade"],
      ["Licitação", "licitacao"],
      ["Data", "data"],
      ["Fornecedor", "fornecedor"],
      ["Valor", "valorTotalGeral", "brl"],
      ["Situação", "situacao"],
    ],
  },
  // A chave do fiscal vem como objeto ({ chavePrimaria }) e o detalhe do portal exige o exercício.
  fiscais: {
    path: CL + "fiscais-de-contratos", filtro: "ano", chave: "codigoDoFiscal.chavePrimaria",
    api: { caminho: CL + "fiscais-de-contratos/paginado", metodo: "POST" },
    detalhe: { ano: true, chaveDaLista: "chavePrimaria" },
    colunas: [["Fiscal", "nomeDoFiscal"]],
  },
  "obras-paralisadas": {
    path: CL + "movimentos-de-obras-paralisadas", filtro: "acumulado", chave: "codigo",
    api: { caminho: CL + "movimentos-de-obras-paralisadas/paginado?pagina=1&tamanhoDaPagina=500" },
    colunas: [
      ["Obra", "tituloDaObra"],
      ["Data da paralisação", "dataDaParalisacao"],
      ["Motivo", "justificativa"],
      ["Previsão de retorno", "dataDePrevisaoDeRetorno"],
      ["Responsável pela obra", "nomeDoResponsavelPelaObra"],
      ["Órgão", "nomeDoOrgao"],
    ],
  },
  // Convênios, transferências concedidas e acordos usam a mesma consulta do portal, com filtros fixos.
  convenios: {
    path: CL + "convenio", filtro: "acumulado", chave: "codigoDoConvenio",
    api: { caminho: CL + "convenio/paginado?pagina=1&tamanhoDaPagina=500" },
    colunas: COLUNAS_CONVENIO,
  },
  "convenios-concedidos": {
    path: CL + "transferencias-concedidas-de-convenio", filtro: "acumulado", chave: "codigoDoConvenio",
    api: { caminho: CL + "convenio/paginado?pagina=1&tamanhoDaPagina=500&tipo=3" },
    colunas: [...COLUNAS_CONVENIO, ["Valor do repasse", "valorLiberado", "brl"]],
  },
  acordos: {
    path: CL + "acordos-firmados-sem-transferencia-de-recursos", filtro: "acumulado", chave: "codigoDoConvenio",
    api: { caminho: CL + "convenio/paginado?pagina=1&tamanhoDaPagina=500&acordoFirmado=true" },
    colunas: COLUNAS_CONVENIO,
  },
  // Documentos por "menu e função" (local 6 = Contratos, Convênios e Licitações; tipos 49 e 20).
  "plano-de-contratacao": documentos(CL + "plano-de-contratacao-anual", 49, 6),
  sancionados: documentos(CL + "relacao-dos-licitantes-e-ou-contratados-sancionados-admnistrativamente", 20, 6),

  // ---------- Órgãos e Servidores ----------
  // Folha mês a mês: a chave junta competência e matrícula ("09/2026-565"); o detalhe do portal pede
  // matrícula, mês e ano. Lida também pela página de Servidores (src/pages/transparency/ServidoresPage.tsx).
  folha: {
    path: OS + "servidor", filtro: "meses", chave: (r) => `${r.mesAno}-${r.matricula}`,
    api: { caminho: OS + "servidor/paginado?pagina=1&tamanhoDaPagina=500" },
    detalhe: {
      consulta: (chave, ano) => {
        const [mes] = chave.split("/");
        return `matricula=${chave.split("-").pop()}&mes=${mes}&ano=${ano}&mesInteger=${Number(mes)}`;
      },
    },
    colunas: [
      ["Competência", "mesAno"],
      ["Matrícula", "matricula"],
      ["Nome", "nome"],
      ["Cargo", "cargo"],
      ["Departamento", "departamento"],
      ["Vínculo", "tipoDeVinculo"],
      ["Situação", "situacao"],
      ["Proventos", "proventos", "brl"],
      ["Descontos", "descontos", "brl"],
      ["Líquido", "totalLiquido", "brl"],
      ["Pagamento", "situacaoPagamento"],
      ["Admissão", "dataAdmissao"],
      ["Exoneração", "dataExoneracao"],
      ["Carga horária", "cargaHoraria"],
      ["CPF", "cpf"],
    ],
  },
  diarias: {
    path: OS + "diaria", filtro: "datas", chave: "codigoDaViagem",
    api: { caminho: OS + "diaria/paginado?pagina=1&tamanhoDaPagina=500" },
    detalhe: {},
    colunas: [
      ["Servidor", "nomeDoFuncionario"],
      ["Matrícula", "matriculaDoFuncionario"],
      ["Cargo", "cargoDoFuncionario"],
      ["Destino", "destino"],
      ["Saída", "dataDaSaida"],
      ["Chegada", "dataDaChegada"],
      ["Diárias", "numeroDeDiarias"],
      ["Valor", "valorDaDiaria", "brl"],
      ["Motivo", "motivoDaViagem"],
      ["Liquidação", "numeroDaLiquidacao"],
    ],
  },
  // O portal só consulta a estrutura por competência: copia o último mês fechado.
  remuneracao: {
    path: OS + "estrutura-de-remuneracao", filtro: "ultimo-mes", chave: "chave.codigoDoNivel",
    api: { caminho: OS + "estrutura-de-remuneracao/paginado?pagina=1&tamanhoDaPagina=500" },
    colunas: [
      ["Cargo", "cargo"],
      ["Nível", "nivel"],
      ["Salário", "salario", "brl"],
      ["Vagas", "vagas"],
      ["Vagas providas", "vagasProvidas"],
      ["Vagas não providas", "vagasNaoProvidas"],
      ["Situação", "situacao"],
      ["CBO", "cbo"],
      ["Código", "codigo"],
      ["Lei", "lei"],
      ["Data da lei", "dataDaLei"],
    ],
  },
  "tabela-diarias": documentos(OS + "tabela-explicativa-diarias", 12, 1),
  terceirizados: documentos(OS + "lista-de-terceirizados-que-prestam-de-servicos-a-instituicao", 19, 5),
  estagiarios: documentos(OS + "lista-de-estagiarios-da-instituicao", 18, 5),
  concursos: {
    path: OS + "situacao-do-concurso-publico", filtro: "acumulado", chave: (r) => `${r.tipoDeProcesso}|${r.numeroDoEdital}`,
    api: { caminho: OS + "situacao-do-concurso-publico/paginado?pagina=1&tamanhoDaPagina=500" },
    colunas: [
      ["Tipo de processo", "tipoDeProcesso"],
      ["Edital", "numeroDoEdital"],
      ["Situação", "situacaoDoConcurso"],
      ["Publicação", "dataDePublicacao"],
      ["Início das inscrições", "dataDoInicioDasInscricoes"],
      ["Homologação", "dataDeHomologacao"],
      ["Validade", "dataDeValidade"],
      ["Vagas disponíveis", "vagasDisponiveis"],
      ["Vagas preenchidas", "vagasPreenchidas"],
      ["Cadastro de reserva", "cadastroDeReserva"],
      ["Veículo de publicação", "veiculoDePublicacao"],
    ],
  },
  aprovados: {
    path: OS + "lista-de-aprovados-em-concursos-e-processos-seletivos", filtro: "acumulado",
    chave: (r) => `${r.numeroDoEdital}|${r.inscricao}|${r.nomeDaPessoa}`,
    api: { caminho: OS + "lista-de-aprovados-em-concursos-e-processos-seletivos/paginado?pagina=1&tamanhoDaPagina=500" },
    colunas: [
      ["Nome", "nomeDaPessoa"],
      ["Cargo", "nomeDoCargo"],
      ["Classificação", "classificacao"],
      ["Situação", "descricaoDaSituacao"],
      ["Edital", "numeroDoEdital"],
      ["Inscrição", "inscricao"],
      ["Publicação", "dataDePublicacao"],
    ],
  },
  "servidores-licenca": {
    path: OS + "servidores-de-licenca", filtro: "acumulado", chave: "codigo",
    api: { caminho: OS + "servidores-de-licenca/paginado?pagina=1&tamanhoDaPagina=500" },
    colunas: [
      ["Servidor", "nomeDoFuncionario"],
      ["Matrícula", "matricula"],
      ["Cargo", "nomeDoCargo"],
      ["Tipo de licença", "tipoDeLicenca"],
      ["Afastamento", "dataDeAfastamento"],
      ["Retorno", "dataDeRetorno"],
      ["Vínculo", "tipoDeVinculo"],
      ["Ato", "numeroEAnoDoAto"],
      ["Publicação do ato", "dataDePublicacao"],
    ],
  },
  "servidores-ferias": {
    path: OS + "servidores-de-ferias", filtro: "acumulado", chave: "codigo",
    api: { caminho: OS + "servidores-de-ferias/paginado?pagina=1&tamanhoDaPagina=500" },
    colunas: [
      ["Servidor", "nomeDoFuncionario"],
      ["Matrícula", "matricula"],
      ["Cargo", "nomeDoCargo"],
      ["Gozo (início)", "dataDeGozoInicial"],
      ["Gozo (fim)", "dataDeGozoFinal"],
      ["Aquisição (início)", "dataDeAquisicaoInicial"],
      ["Aquisição (fim)", "dataDeAquisicaoFinal"],
      ["Vínculo", "tipoDeVinculo"],
    ],
  },
  "servidores-cedidos": {
    path: OS + "servidores-a-disposicao-de-outro-municipio", filtro: "acumulado", chave: "codigo",
    api: { caminho: OS + "servidores-a-disposicao-de-outro-municipio/paginado?pagina=1&tamanhoDaPagina=500" },
    colunas: [
      ["Servidor", "nomeDoFuncionario"],
      ["Matrícula", "matriculaDoFuncionario"],
      ["Cargo", "nomeDoCargo"],
      ["Entidade de destino", "nomeDaEntidadeDeDestino"],
      ["Ente", "tipoDeEnteFederado"],
      ["Início", "dataDeInicioDaDisposicao"],
      ["Fim", "dataFinalDaDisposicao"],
    ],
  },
  "servidores-recebidos": {
    path: OS + "servidores-cedidos-para-o-municipio", filtro: "acumulado", chave: "matriculaDoFuncionario",
    api: { caminho: OS + "servidores-cedidos-para-o-municipio/paginado?pagina=1&tamanhoDaPagina=500" },
    colunas: [
      ["Servidor", "nomeDoFuncionario"],
      ["Matrícula", "matriculaDoFuncionario"],
      ["Cargo", "nomeDoCargo"],
      ["Vínculo", "tipoDeVinculo"],
      ["Órgão de destino", "orgaoDeDestino"],
      ["Município de origem", "nomeMunicipioDeOrigem"],
      ["Início", "dataDeInicioDaDisposicao"],
      ["Fim", "dataFinalDaDisposicao"],
      ["Ato", "numeroEAnoDoAto"],
      ["Publicação", "dataDaPublicacao"],
    ],
  },

  // ---------- Planejamento e Políticas Públicas ----------
  // PPA, LDO, LOA e Metas e Riscos Fiscais não são copiados: a página consulta o portal pela função
  // portal-documento (lei de cada ano e anexos gerados na hora).
  programas: {
    path: PP + "programa", filtro: "ano", chave: "chave.codigoDoPrograma",
    api: { caminho: PP + "programa/paginado?pagina=1&tamanhoDaPagina=500" },
    detalhe: { consulta: (chave, ano) => `codigoDoPrograma=${chave}&ano=${ano}` },
    colunas: [
      ["Código", "codigoDoPrograma"],
      ["Programa", "titulo"],
      ["Previsto", "valorPrevisto", "brl"],
      ["Executado", "valorExecutado", "brl"],
      ["Ano", "ano"],
    ],
  },
  // O portal publica o acompanhamento das ações na posição de dezembro (fechamento do ano).
  "acoes-projetos": {
    path: PP + "projeto", filtro: "dezembro", chave: "codigoDoProjeto.acaoCodigo",
    api: { caminho: PP + "projeto/paginado?pagina=1&tamanhoDaPagina=500" },
    detalhe: { consulta: (chave, ano) => `acaoCodigo=${encodeURIComponent(chave)}&ano=${ano}&mes=12` },
    colunas: [
      ["Código", "codigoDaAcao"],
      ["Ação", "tituloDaAcao"],
      ["Previsto", "valorPrevisto", "brl"],
      ["Executado", "valorExecutado", "brl"],
      ["Competência", "mesAno"],
    ],
  },
  "parecer-previo": {
    path: PP + "parecer-previo", filtro: "acumulado", chave: "codigoDoProcesso",
    api: { caminho: PP + "parecer-previo/paginado?pagina=1&tamanhoDaPagina=500" },
    detalhe: { tabela: "RESULTADO_DE_PROCESSO" },
    colunas: COLUNAS_CONTAS,
  },
  "julgamento-contas": {
    path: PP + "julgamento-das-contas-pelo-poder-legislativo", filtro: "acumulado", chave: "codigoDoProcesso",
    api: { caminho: PP + "julgamento-das-contas-pelo-poder-legislativo/paginado?pagina=1&tamanhoDaPagina=500" },
    detalhe: { tabela: "RESULTADO_DE_PROCESSO" },
    colunas: [
      ["Processo", "numeroEAnoDoProcesso"],
      ["Exercício", "exercicio"],
      ["Resultado", "status"],
      ["Data do resultado", "dataDoResultado"],
      ["Descrição", "nome"],
    ],
  },
  planos: {
    path: PP + "planos", filtro: "acumulado", chave: "codigo",
    api: { caminho: PP + "planos/paginado?pagina=1&tamanhoDaPagina=500" },
    detalhe: { tabela: "DOCUMENTO_PORTAL_DA_TRANSPARENCIA", somenteArquivos: true },
    colunas: [
      ["Número", "numero"],
      ["Ano", "ano"],
      ["Documento", "nome"],
      ["Descrição", "descricao"],
      ["Tipo", "tipo"],
    ],
  },
  // Documentos por "menu e função": local 7 planejamento, 8 saúde, 9 educação.
  "relatorio-gestao-atividades": documentos(PP + "relatorio-de-gestao-ou-atividades", 21, 7),
  "plano-saude": documentos(PP + "plano-de-saude", 22, 8),
  "programacao-anual-saude": documentos(PP + "programacao-anual", 23, 8),
  "relatorio-gestao-saude": documentos(PP + "relatorio-de-gestao", 24, 8),
  "servicos-saude": documentos(PP + "lista-dos-servicos-de-saude-prestados", 25, 8),
  medicamentos: documentos(PP + "lista-de-medicamentos-fornecidos-pelo-sus", 26, 8),
  "plano-educacao": documentos(PP + "plano-de-educacao-e-seus-resultados", 27, 9),
  creche: documentos(PP + "lista-de-espera-na-creche", 28, 9),

  // Relação de incentivos a projetos culturais: documentos publicados no portal.
  "incentivos-culturais": documentos(RD + "relacao-de-incentivos-relacionados-a-projetos-culturais", 40, 12),

  // ---------- Legislação e Publicações ----------
  // Leis, decretos e portarias do município, com os arquivos de cada ato.
  "legislacao-municipal": {
    path: LP + "legislacao-municipal", filtro: "acumulado", chave: "codigoDoDocumento",
    api: { caminho: LP + "legislacao-municipal/paginado?pagina=1&tamanhoDaPagina=500" },
    detalhe: { tabela: "DOCUMENTO_PORTAL_DA_TRANSPARENCIA", somenteArquivos: true },
    colunas: [
      ["Tipo", "tipoDoDocumento"],
      ["Número", "numeroDoDocumento"],
      ["Ano", "ano"],
      ["Documento", "nomeDoDocumento"],
      ["Descrição", "descricao"],
      ["Publicação", "dataDaPublicacao"],
      ["Situação", "situacao"],
    ],
  },
  "outras-publicacoes": {
    path: LP + "outras-publicacoes", filtro: "acumulado", chave: "codigoDoDocumento",
    api: { caminho: LP + "outras-publicacoes/paginado?pagina=1&tamanhoDaPagina=500" },
    detalhe: { tabela: "DOCUMENTO_PORTAL_DA_TRANSPARENCIA", somenteArquivos: true },
    colunas: [
      ["Tipo", "tipoDoDocumento"],
      ["Número", "numeroDoDocumento"],
      ["Ano", "ano"],
      ["Documento", "nomeDoDocumento"],
      ["Descrição", "descricao"],
      ["Publicação", "dataDaPublicacao"],
      ["Órgão", "orgao"],
    ],
  },
  videos: {
    path: LP + "videos", filtro: "acumulado", chave: "codigo",
    api: { caminho: LP + "video/?pagina=1&tamanhoDaPagina=500" },
    colunas: [
      ["Título", "titulo"],
      ["Publicação", "dataDePublicacao"],
      ["YouTube", "youtubeId"],
      ["Link", "url"],
    ],
  },

  // ---------- Ouvidoria e e-SIC ----------
  // Números do e-SIC ano a ano desde o primeiro pedido (o portal devolve um objeto por ano: totais e as séries
  // dos gráficos). A série inteira é relida todo dia, porque pedidos antigos ainda mudam de situação.
  "estatisticas-esic": {
    path: OE + "estatistica-do-e-sic", filtro: "anos", desde: 2016, chave: () => "estatisticas",
    api: { caminho: "e-sic/estatistica-do-e-sic/?opcaoRelatorioNumerosESic=formaRecebimentoResposta&opcaoRelatorioPerfilSolicitanteESic=faixaEtaria" },
    colunas: [
      ["Solicitados", "totalSolicitado"],
      ["Atendidos", "totalAtendido"],
      ["Em aberto", "totalEmAberto"],
      ["Indeferidos", "totalIndeferido"],
      ["Números", "numeros", "json"],
      ["Perfil", "perfilSolicitante", "json"],
    ],
  },
  // Rol de informações classificadas e desclassificadas (LAI, art. 30), com o arquivo de cada declaração.
  "rol-informacoes": {
    path: OE + "rol-de-informacoes", filtro: "acumulado", chave: "codigoDoDocumento",
    api: { caminho: "e-sic/rol-de-informacoes/paginado?pagina=1&tamanhoDaPagina=500" },
    detalhe: { tabela: "DOCUMENTO_PORTAL_DA_TRANSPARENCIA", somenteArquivos: true },
    colunas: [
      ["Tipo", "tipoDoDocumento"],
      ["Número", "numeroDoDocumento"],
      ["Ano", "ano"],
      ["Documento", "nomeDoDocumento"],
      ["Descrição", "descricao"],
      ["Publicação", "dataDaPublicacao"],
    ],
  },
  "relatorios-ouvidoria": {
    path: OE + "ouvidoria/relatorios-da-ouvidoria", filtro: "acumulado", chave: "codigoDoDocumento",
    api: { caminho: "e-sic/ouvidoria/relatorios-da-ouvidoria/paginado?pagina=1&tamanhoDaPagina=500" },
    detalhe: { tabela: "DOCUMENTO_PORTAL_DA_TRANSPARENCIA", somenteArquivos: true },
    colunas: [
      ["Tipo", "tipoDoDocumento"],
      ["Número", "numeroDoDocumento"],
      ["Ano", "ano"],
      ["Documento", "nomeDoDocumento"],
      ["Descrição", "descricao"],
      ["Publicação", "dataDaPublicacao"],
    ],
  },
  "pesquisa-satisfacao": documentos(OE + "pesquisa-de-satisfacao", 42, 13),
  // Locais de atendimento presencial: SIC físico e Ouvidoria (endereço, telefones, responsável e horários).
  "sic-fisico": {
    path: OE + "informacao-do-sic-fisico", filtro: "acumulado", chave: "codigo",
    api: { caminho: "e-sic/informacao-do-sic-fisico/" },
    colunas: [
      ["Local", "sede"],
      ["Endereço", "endereco"],
      ["Telefone", "primeiroTelefone"],
      ["Telefone 2", "segundoTelefone"],
      ["E-mail", "email"],
      ["Responsável", "servidoresResponsaveis"],
      ["Horários", "horariosDeAtendimento", "json"],
    ],
  },
  "informacoes-ouvidoria": {
    path: OE + "informacoes-da-ouvidoria", filtro: "acumulado", chave: "codigo",
    api: { caminho: "e-sic/informacoes-da-ouvidoria/" },
    colunas: [
      ["Local", "sede"],
      ["Endereço", "endereco"],
      ["Telefone", "primeiroTelefone"],
      ["Telefone 2", "segundoTelefone"],
      ["E-mail", "email"],
      ["Responsável", "servidoresResponsaveis"],
      ["Horários", "horariosDeAtendimento", "json"],
    ],
  },
};
