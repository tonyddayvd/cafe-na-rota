/* app.js - Lógica principal "Café na Rota" com Supabase - V12 (Offline Resilience) */
console.log("Café na Rota App carregado - Versão 12: Resiliência Offline Ativada");

const SUPABASE_URL = 'https://twabiezyrlbwcsrajkmb.supabase.co';
const SUPABASE_KEY = 'sb_publishable_nfdRYnXOlQr834PF0CzgjA_RfwfoeTe';

// Inicializa o cliente Supabase
let supabaseClient;
try {
    // A biblioteca CDN expõe 'window.supabase'
    if (window.supabase) {
        supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
    } else {
        console.warn("Objeto 'supabase' não encontrado no window.");
    }
} catch(e) {
    console.error("Erro ao inicializar Supabase:", e);
}

let state = {
    theme: 'light',
    investimento_inicial: 0,
    produtos: [],           // da tabela 'produtos'
    estoque_total: {},      // Mapeia id_produto -> qtde total via 'estoque_total'
    compras: [],            // tabela 'compras'
    metas: [],              // tabela 'metas_financeiras'
    lancamentos_meta: []    // tabela 'lancamentos_meta'
};

let charts = {
    lucro: null,
    dias: null,
    meta_participacao: null
};

const formatCurrency = (val) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(val);
const getHojeStr = () => new Date().toISOString().split('T')[0];
const getUnidadeStr = (un) => un === 'un' ? 'unidades' : un;

// --- FUNÇÕES GLOBAIS DE CÁLCULO ---
function calcularProvisionamento(prod) {
    if (!prod) return { mediaDiaria: 0, duraDias: 0, estoqueAtual: 0 };
    
    const consumos = state.historico_estoque
        .filter(h => h.produto_id === prod.id)
        .sort((a,b) => new Date(a.data_referencia) - new Date(b.data_referencia)); // Mais antigo primeiro
        
    const estoqueAtual = state.estoque_total[prod.id] || 0;

    if (consumos.length === 0) return { mediaDiaria: 0, duraDias: 0, estoqueAtual };
    
    const hoje = new Date();
    hoje.setHours(0,0,0,0);
    
    const limite30Dias = new Date(hoje);
    limite30Dias.setDate(limite30Dias.getDate() - 30);
    
    const consumosRecentes = consumos.filter(h => new Date(h.data_referencia) >= limite30Dias);
    const consumosBase = consumosRecentes.length > 0 ? consumosRecentes : consumos;
    
    const primeiraData = new Date(consumosBase[0].data_referencia);
    primeiraData.setHours(0,0,0,0);
    
    const timeDiff = hoje.getTime() - primeiraData.getTime();
    let diffDays = Math.ceil(timeDiff / (1000 * 3600 * 24));
    if (diffDays <= 0) diffDays = 1; 
    
    const totalConsumido = consumosBase.reduce((acc, obj) => acc + obj.consumido, 0);
    const mediaDiaria = totalConsumido / diffDays;
    
    const duraDias = mediaDiaria > 0 ? parseFloat((estoqueAtual / mediaDiaria).toFixed(1)) : 0;
    
    return { mediaDiaria, duraDias, estoqueAtual };
}

// --- BANNER DE STATUS DE CONEXÃO ---
function showConnectionBanner(status, msg) {
    let banner = document.getElementById('connection-banner');
    if (!banner) {
        banner = document.createElement('div');
        banner.id = 'connection-banner';
        banner.style.cssText = `
            position: fixed; top: 0; left: 0; right: 0; z-index: 9999;
            padding: 10px 20px; text-align: center; font-size: 14px; font-weight: 600;
            transition: all 0.4s ease; display: flex; align-items: center; justify-content: center; gap: 8px;
        `;
        document.body.prepend(banner);
    }
    if (status === 'loading') {
        banner.style.background = 'var(--primary-color, #7b4b31)';
        banner.style.color = '#fff';
        banner.innerHTML = `<span style="animation: spin 1s linear infinite; display:inline-block">⏳</span> ${msg}`;
        banner.style.display = 'flex';
    } else if (status === 'offline') {
        banner.style.background = '#dc2626';
        banner.style.color = '#fff';
        banner.innerHTML = `⚠️ ${msg} <button onclick="location.reload()" style="margin-left:12px;background:rgba(255,255,255,0.25);border:none;color:#fff;padding:3px 10px;border-radius:20px;cursor:pointer;font-weight:700">Tentar Novamente</button>`;
        banner.style.display = 'flex';
        document.querySelector('.app-content') && (document.querySelector('.app-content').style.paddingTop = '50px');
        document.querySelector('.top-bar') && (document.querySelector('.top-bar').style.marginTop = '40px');
    } else if (status === 'online') {
        banner.style.background = '#16a34a';
        banner.style.color = '#fff';
        banner.innerHTML = `✅ ${msg}`;
        banner.style.display = 'flex';
        setTimeout(() => { banner.style.display = 'none'; }, 2500);
    }
}

// --- CARREGAMENTO DO BANCO DE DADOS (SUPABASE) ---
async function loadState() {
    showConnectionBanner('loading', 'Conectando ao banco de dados...');
    try {
        if (!supabaseClient) throw new Error("Cliente Supabase Indisponível");

        // Carrega tema do localStorage (não precisa ir pro banco)
        const localTheme = localStorage.getItem('cafeTheme');
        if (localTheme) state.theme = localTheme;
        applyTheme(state.theme);

        // Busca Produtos
        const { data: prods, error: errProds } = await supabaseClient.from('produtos').select('*').eq('ativo', true);
        if (errProds) throw errProds;
        if (prods) state.produtos = prods;

        // Busca Estoque Total
        const { data: estoques } = await supabaseClient.from('estoque_total').select('*');
        if (estoques) {
            estoques.forEach(e => {
                state.estoque_total[e.produto_id] = parseFloat(e.quantidade_total);
            });
        }

        // Busca Entradas
        const { data: ent } = await supabaseClient.from('entradas').select('*');
        if (ent) state.entradas = ent;

        // Busca Saídas
        const { data: sai } = await supabaseClient.from('saidas').select('*');
        if (sai) state.saidas = sai;

        // Busca Histórico de Estoque (Consumos)
        const { data: hist } = await supabaseClient.from('historico_estoque').select('*');
        if (hist) state.historico_estoque = hist.map(h => ({
            ...h,
            consumido: parseFloat(h.consumido)
        }));

        state.produtos.forEach(p => {
            p.capacidade_unidade = parseFloat(p.capacidade_unidade) || 1;
        });

        // Busca Compras
        const { data: comp } = await supabaseClient.from('compras').select('*');
        if (comp) state.compras = comp;

        // Busca Configurações
        const { data: config } = await supabaseClient.from('configuracoes').select('*');
        if (config) {
            const inv = config.find(c => c.chave === 'investimento_inicial');
            if (inv) state.investimento_inicial = parseFloat(inv.valor);
        }

        // Busca Metas
        const { data: metasData } = await supabaseClient.from('metas_financeiras').select('*');
        if (metasData) state.metas = metasData;

        // Busca Lançamentos de Metas
        const { data: lancMetas } = await supabaseClient.from('lancamentos_meta').select('*');
        if (lancMetas) state.lancamentos_meta = lancMetas;

        showConnectionBanner('online', 'Dados atualizados!');

    } catch (err) {
        console.error("Erro ao carregar banco:", err);
        showConnectionBanner('offline', 'Sem conexão com o servidor. Dados podem estar desatualizados.');
    } finally {
        console.log("Renderizando...");
        updateDashboard();
        renderTransactions();
        renderHistorico();
        renderEstoque();
        renderComprasEstoque();
    }
}

// --- NAVEGAÇÃO SPA ---
document.querySelectorAll('.nav-item').forEach(link => {
    link.addEventListener('click', (e) => {
        e.preventDefault();
        document.querySelectorAll('.nav-item').forEach(l => l.classList.remove('active'));
        link.classList.add('active');
        const targetView = link.getAttribute('data-view');
        document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
        const view = document.getElementById(`view-${targetView}`);
        if(view) view.classList.add('active');

        // Garante renderização imediata ao clicar na aba
        if (targetView === 'caixa') renderTransactions();
        if (targetView === 'estoque') {
            console.log("Navegando para estoque, produtos atuais:", state.produtos.length);
            renderEstoque();
            renderComprasEstoque();
        }
        if (targetView === 'relatorios') renderHistorico();
        if (targetView === 'meta') renderMeta();
    });
});

document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        document.querySelectorAll('.form-panel').forEach(f => f.classList.remove('active'));
        document.getElementById(btn.getAttribute('data-target')).classList.add('active');
    });
});

// --- TEMA ---
const themeToggle = document.getElementById('theme-toggle');
function applyTheme(themeName) {
    document.documentElement.setAttribute('data-theme', themeName);
    themeToggle.innerHTML = themeName === 'dark' ? '<ion-icon name="sunny-outline"></ion-icon>' : '<ion-icon name="moon-outline"></ion-icon>';
    state.theme = themeName;
    localStorage.setItem('cafeTheme', themeName);
}
themeToggle.addEventListener('click', () => applyTheme(state.theme === 'dark' ? 'light' : 'dark'));


// --- LÓGICA DE CAIXA (Lançamentos) ---
document.getElementById('form-entrada').addEventListener('submit', async (e) => {
    e.preventDefault();
    const vendas = parseFloat(document.getElementById('entrada-vendas').value) || 0;
    
    // UI Loading state
    const btn = e.target.querySelector('button');
    btn.textContent = 'Salvando na nuvem...';
    btn.disabled = true;

    const dateInput = document.getElementById('entrada-data').value;
    const dataRef = dateInput ? dateInput : getHojeStr();

    const novaEntrada = {
        data_referencia: dataRef,
        valor_total: vendas
    };

    const { data, error } = await supabaseClient.from('entradas').insert([novaEntrada]).select();
    btn.textContent = 'Registrar Entrada';
    btn.disabled = false;

    if (error) return alert('Erro ao salvar no banco!');
    
    state.entradas.push(data[0]);
    document.getElementById('form-entrada').reset();
    updateDashboard();
    renderTransactions();
    renderHistorico();
    alert('Entrada lançada com sucesso no banco!');
});

document.getElementById('form-saida').addEventListener('submit', async (e) => {
    e.preventDefault();
    const valor = parseFloat(document.getElementById('saida-valor').value);
    const justificativa = document.getElementById('saida-justificativa').value.trim();
    const dateInput = document.getElementById('saida-data').value;
    const dataRef = dateInput ? dateInput : getHojeStr();
    
    const btn = e.target.querySelector('button');
    btn.textContent = 'Aguarde...';
    btn.disabled = true;

    const novaSaida = {
        data_referencia: dataRef,
        valor: valor,
        justificativa: justificativa
    };

    const { data, error } = await supabaseClient.from('saidas').insert([novaSaida]).select();
    btn.textContent = 'Registrar Saída';
    btn.disabled = false;

    if (error) return alert('Erro ao salvar no banco!');
    
    state.saidas.push(data[0]);
    document.getElementById('form-saida').reset();
    updateDashboard();
    renderTransactions();
    renderHistorico();
    alert('Saída registrada no banco online!');
});

// Função de exclusão será implementada abaixo no bloco consolidado de BI

function renderTransactions() {
    const list = document.getElementById('transactions-list');
    if(!list) return;
    list.innerHTML = '';
    
    // Mostra as últimas 30 transações (Entradas e Saídas) ordenadas cronologicamente
    const transacoes = [
        ...state.entradas.map(e => ({ id: e.id, tipo: 'entrada', valor: parseFloat(e.valor_total), desc: 'Apurado Diário', data: e.data_referencia, timestamp: e.data_operacao })),
        ...state.saidas.map(s => ({ id: s.id, tipo: 'saida', valor: parseFloat(s.valor), desc: s.justificativa, data: s.data_referencia, timestamp: s.data_operacao }))
    ].sort((a,b) => {
        const timeA = new Date(a.timestamp || a.data).getTime();
        const timeB = new Date(b.timestamp || b.data).getTime();
        return timeB - timeA;
    }).slice(0,30);
    
    if (transacoes.length === 0) return (list.innerHTML = '<li>Nenhuma transação registrada ainda.</li>');
    
    transacoes.forEach(t => {
        const li = document.createElement('li');
        li.className = 'transaction-item';
        li.innerHTML = `
            <div style="display:flex; align-items:center; gap:10px; width:100%">
                <ion-icon name="${t.tipo === 'entrada' ? 'arrow-up-circle' : 'arrow-down-circle'}" class="${t.tipo}"></ion-icon>
                <div style="flex:1">
                    <p>${t.desc}</p>
                    <small>${t.tipo === 'entrada' ? 'Entrada' : 'Saída'}</small>
                </div>
                <strong class="${t.tipo}">${t.tipo === 'entrada' ? '+' : '-'}${formatCurrency(t.valor)}</strong>
                <button class="btn-delete" onclick="deletarRegistro('${t.tipo === 'entrada' ? 'entradas' : 'saidas'}', ${t.id})" aria-label="Deletar">
                    <ion-icon name="trash-outline"></ion-icon>
                </button>
            </div>
            <div class="text-xs var-text-muted" style="margin-left:42px; margin-top:-5px">Data ref: ${t.data.split('-').reverse().join('/')}</div>
        `;
        list.appendChild(li);
    });
}


// --- LÓGICA DE ESTOQUE (Supabase + Unidades de Medida) ---
function renderEstoque() {
    const list = document.getElementById('lista-insumos');
    const containerPrincipais = document.getElementById('estoque-principais-cards');
    
    list.innerHTML = '';
    containerPrincipais.innerHTML = '';
    
    let temPrincipal = false;

    state.produtos.forEach(p => {
        if (!p.ativo) return;
        
        // Renderiza os Itens Principais (Alerta <= 5 dias)
        if (p.is_principal) {
            temPrincipal = true;
            const prov = calcularProvisionamento(p);
            
            const isCritico = prov.duraDias <= 5 || prov.estoqueAtual <= 0;
            const cardClass = isCritico ? "card stat-card alert-danger" : "card stat-card";
            const iconAlert = isCritico ? '<ion-icon name="warning-outline"></ion-icon>' : '<ion-icon name="cube-outline"></ion-icon>';
            
            // Cálculo do Percentual Abastecido (Estoque / Consumo Médio de 30 dias)
            let percAbastecidoHTML = '';
            if (prov.mediaDiaria > 0) {
                const consumoMensal = prov.mediaDiaria * 30;
                let perc = (prov.estoqueAtual / consumoMensal) * 100;
                perc = Math.min(perc, 100); // Trava em 100% se passar
                
                let corPerc = isCritico ? 'var(--danger)' : 'var(--text-muted)';
                percAbastecidoHTML = `
                    <div style="width: 100%; height: 6px; background: rgba(255,255,255,0.1); border-radius: 3px; margin-top: 6px; overflow: hidden;">
                        <div style="width: ${perc}%; height: 100%; background: ${isCritico ? 'var(--danger)' : 'var(--success)'};"></div>
                    </div>
                    <small style="display:block; margin-top:2px; color: ${corPerc};">${perc.toFixed(0)}% de 1 mês abastecido</small>
                `;
            } else if (prov.estoqueAtual > 0) {
                percAbastecidoHTML = `<small style="display:block; margin-top:2px; color: var(--text-muted);">Calculando média...</small>`;
            }

            const div = document.createElement('div');
            div.className = cardClass;
            div.innerHTML = `
                ${iconAlert}
                <div style="flex: 1;">
                    <p style="font-weight: 600;">${p.nome}</p>
                    <h4 style="font-size: 1.2rem;">${prov.estoqueAtual} ${p.unidade_medida}</h4>
                    ${percAbastecidoHTML}
                    ${isCritico ? `<small style="font-size: 0.75rem; display:block; margin-top: 4px;">🚨 Restam ~${prov.duraDias} dias</small>` : ''}
                </div>
            `;
            containerPrincipais.appendChild(div);
        }
        
        const totalStock = state.estoque_total[p.id] || 0;
        
        const div = document.createElement('div');
        div.className = 'estoque-item';
        div.innerHTML = `
            <div class="item-info">
                <h4>${p.nome}</h4>
                <p>O que você tem no total: <strong>${totalStock} ${p.unidade_medida}</strong></p>
            </div>
            <div class="item-actions">
                <div style="display:flex; gap:5px; align-items:center">
                    <button class="btn btn-secondary text-sm btn-comprar-estoque" data-id="${p.id}" data-nome="${p.nome}" data-unid="${p.unidade_medida}">
                        + Comprar
                    </button>
                    <button class="btn-delete" onclick="deletarProduto(${p.id}, '${p.nome}')" title="Excluir Produto">
                        <ion-icon name="trash-outline"></ion-icon>
                    </button>
                </div>
                <button class="btn-clean text-xs btn-ajustar-estoque" data-id="${p.id}" data-nome="${p.nome}" style="margin-top:5px; text-decoration:underline; opacity:0.6">
                    Ajustar Total Manualmente
                </button>
            </div>
        `;
        list.appendChild(div);
    });

    if (temPrincipal) {
        containerPrincipais.style.display = 'grid';
    } else {
        containerPrincipais.style.display = 'none';
    }

    document.querySelectorAll('.btn-comprar-estoque').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const id = e.target.getAttribute('data-id');
            const nome = e.target.getAttribute('data-nome');
            const unid = e.target.getAttribute('data-unid');
            
            document.getElementById('compra-estoque-nome-produto').textContent = `${nome} (em ${getUnidadeStr(unid)})`;
            document.getElementById('compra-estoque-id').value = id;
            document.getElementById('compra-estoque-qtd').value = '';
            document.getElementById('compra-estoque-valor').value = '';
            // Atualiza a label correta da Quantidade, não a da Data!
            document.getElementById('compra-estoque-qtd').parentElement.querySelector('label').textContent = `Quantidade Comprada (+ em ${unid})`;
            document.getElementById('modal-compra-estoque').classList.remove('hidden');
        });
    });

    document.querySelectorAll('.btn-ajustar-estoque').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            const id = parseInt(e.target.getAttribute('data-id'));
            const nome = e.target.getAttribute('data-nome');
            const novoValor = prompt(`Ajuste Manual de ${nome}:\nInforme a quantidade real exata que você tem agora no estoque físico:`);
            
            if (novoValor === null || novoValor === "" || isNaN(parseFloat(novoValor))) return;
            
            const qtd = parseFloat(novoValor);
            const { error } = await supabaseClient.from('estoque_total').upsert({ produto_id: id, quantidade_total: qtd });
            
            if (!error) {
                state.estoque_total[id] = qtd;
                renderEstoque();
                updateDashboard();
                alert('Estoque ajustado com sucesso!');
            } else {
                alert('Erro ao sincronizar ajuste manual.');
            }
        });
    });
}

// Modal Produto Novo
const modalProduto = document.getElementById('modal-produto');
document.getElementById('btn-novo-produto').addEventListener('click', () => modalProduto.classList.remove('hidden'));
document.getElementById('btn-cancelar-produto').addEventListener('click', () => modalProduto.classList.add('hidden'));

document.getElementById('btn-salvar-produto').addEventListener('click', async () => {
    const nome = document.getElementById('novo-produto-nome').value;
    const cat = document.getElementById('novo-produto-cat').value;
    const un = document.getElementById('novo-produto-un').value;
    const cap = parseFloat(document.getElementById('novo-produto-capacidade').value) || 1;
    const isPrincipal = document.getElementById('novo-produto-principal').checked;
    
    if (!nome) return alert('Insira o nome');

    const btn = document.getElementById('btn-salvar-produto');
    btn.textContent = 'Aguarde...'; btn.disabled = true;

    // Insert no Supabase
    const { data, error } = await supabaseClient.from('produtos').insert([{ 
        nome, 
        categoria: cat, 
        unidade_medida: un,
        capacidade_unidade: cap,
        is_principal: isPrincipal,
        ativo: true
    }]).select();

    btn.textContent = 'Salvar'; btn.disabled = false;
    
    if (error) return alert('Erro ao criar produto!');

    state.produtos.push(data[0]);
    document.getElementById('novo-produto-nome').value = '';
    document.getElementById('novo-produto-capacidade').value = '1';
    modalProduto.classList.add('hidden');
    renderEstoque();
});

// --- FUNÇÃO DE EXCLUSÃO DE PRODUTO ---
async function deletarProduto(id, nome) {
    if(!confirm(`Deseja realmente excluir o produto "${nome}"? Isso irá desativá-lo no sistema.`)) return;

    try {
        if (!supabaseClient) throw new Error("Supabase não disponível");

        // Fazemos um update para 'ativo: false' em vez de deletar fisicamente por segurança de histórico
        const { error } = await supabaseClient.from('produtos').update({ ativo: false }).eq('id', id);
        
        if (error) throw error;

        // Atualiza o estado local
        state.produtos = state.produtos.filter(p => p.id !== id);
        
        alert(`Produto "${nome}" excluído com sucesso!`);
        renderEstoque();
        updateDashboard();
    } catch (err) {
        console.error("Erro ao deletar produto:", err);
        alert("Erro ao excluir produto do banco de dados.");
    }
}

// Modal Compra de Estoque
const modalCompra = document.getElementById('modal-compra-estoque');
document.getElementById('btn-cancelar-compra').addEventListener('click', () => modalCompra.classList.add('hidden'));
document.getElementById('btn-salvar-compra').addEventListener('click', async () => {
    const id = parseInt(document.getElementById('compra-estoque-id').value);
    const qtdAdd = parseFloat(document.getElementById('compra-estoque-qtd').value);
    const valorPago = parseFloat(document.getElementById('compra-estoque-valor').value);
    const dateInput = document.getElementById('compra-estoque-data').value;
    const dataRef = dateInput ? dateInput : getHojeStr();
    
    if (isNaN(qtdAdd) || qtdAdd <= 0) return alert('Insira uma quantidade válida de estoque.');
    
    const btn = document.getElementById('btn-salvar-compra');
    btn.textContent = 'Aguarde...'; btn.disabled = true;

    const novoTotal = (state.estoque_total[id] || 0) + qtdAdd;

    // 1. Atualiza Estoque
    const { error: errEstoque } = await supabaseClient.from('estoque_total').upsert({ 
        produto_id: id, 
        quantidade_total: novoTotal 
    });

    if (errEstoque) {
        btn.textContent = 'Adicionar'; btn.disabled = false;
        return alert('Falha ao adicionar estoque ao servidor.');
    }

    state.estoque_total[id] = novoTotal;
    
    // 2. Registra Custo automaticamente (se houver valor pago)
    if (!isNaN(valorPago) && valorPago > 0) {
        // Registra em Compras (para histórico de quantidades por período)
        const novaCompra = {
            data_referencia: dataRef,
            produto_id: id,
            quantidade: qtdAdd,
            valor_total: valorPago
        };
        const { data: dComp, error: eComp } = await supabaseClient.from('compras').insert([novaCompra]).select();
        if(!eComp && dComp) state.compras.push(dComp[0]);

        // Registra em Saídas (Despesa de Caixa) com referência à compra
        const produtoObj = state.produtos.find(p => p.id === id);
        const nomeProd = produtoObj ? produtoObj.nome : 'Produto';
        const unProd = produtoObj ? produtoObj.unidade_medida : '';
        
        const novaSaida = {
            data_referencia: dataRef,
            valor: valorPago,
            justificativa: `Compra Estoque: ${nomeProd} (+${qtdAdd}${unProd})`,
            compra_id: dComp ? dComp[0].id : null // Referência opcional se quisermos deletar em cascata no futuro
        };
        
        const { data: dSaida, error: eSaida } = await supabaseClient.from('saidas').insert([novaSaida]).select();
        if (!eSaida && dSaida) {
            state.saidas.push(dSaida[0]);
        }
    }

    btn.textContent = 'Adicionar'; btn.disabled = false;
    modalCompra.classList.add('hidden');
    
    document.getElementById('compra-estoque-qtd').value = '';
    document.getElementById('compra-estoque-valor').value = '';
    document.getElementById('compra-estoque-data').value = '';
    
    renderEstoque();
    updateDashboard();
    renderHistorico();
    renderTransactions();
    alert('Estoque adicionado com sucesso!');
});

// Fechar Turno (Lógica de Resto)
const modalTurno = document.getElementById('modal-turno');
document.getElementById('btn-fechar-turno').addEventListener('click', () => {
    const list = document.getElementById('turno-items-list');
    list.innerHTML = '';
    
    const temEstoque = Object.keys(state.estoque_total).some(id => state.estoque_total[id] > 0);
    if (!temEstoque) return alert('Você não tem produtos em estoque para fazer fechamento.');

    state.produtos.filter(p => p.categoria === 'insumo').forEach(p => {
        const totalEstoque = state.estoque_total[p.id] || 0;
        if (totalEstoque > 0) {
            const div = document.createElement('div');
            div.className = 'input-group';
            div.innerHTML = `
                <label>${p.nome} (Você tinha ${totalEstoque} ${p.unidade_medida})</label>
                <input type="number" step="0.01" min="0" max="${totalEstoque}" value="${totalEstoque}" class="input-sobra" data-id="${p.id}" data-total="${totalEstoque}" data-un="${p.unidade_medida}" placeholder="Sobra em ${p.unidade_medida} ?">
            `;
            list.appendChild(div);
        }
    });
    modalTurno.classList.remove('hidden');
});

document.getElementById('btn-cancelar-turno').addEventListener('click', () => modalTurno.classList.add('hidden'));

document.getElementById('btn-salvar-turno').addEventListener('click', async () => {
    const inputs = document.querySelectorAll('.input-sobra');
    const dateInput = document.getElementById('turno-data').value;
    const dataRef = dateInput ? dateInput : getHojeStr();
    
    const operacoesHistorico = [];
    const operacoesEstoque = [];
    
    const btn = document.getElementById('btn-salvar-turno');
    btn.textContent = 'Calculando e Salvando...'; btn.disabled = true;

    inputs.forEach(inp => {
        const id = parseInt(inp.getAttribute('data-id'));
        const totalQueTinha = parseFloat(inp.getAttribute('data-total'));
        const sobrou = parseFloat(inp.value);
        if(isNaN(sobrou)) return;

        const consumido = totalQueTinha - sobrou;
        if (consumido > 0) {
            operacoesHistorico.push({
                data_referencia: dataRef,
                produto_id: id,
                estoque_anterior: totalQueTinha,
                estoque_restante: sobrou,
                consumido: consumido
            });
            operacoesEstoque.push({
                produto_id: id,
                quantidade_total: sobrou
            });
            state.estoque_total[id] = sobrou;
        }
    });

    if(operacoesHistorico.length > 0) {
        // Insere o historico
        const { error: errHist } = await supabaseClient.from('historico_estoque').insert(operacoesHistorico);
        // Atualiza a tabela estoque total para bater com a sobra
        const { error: errEst } = await supabaseClient.from('estoque_total').upsert(operacoesEstoque);
        
        if (errHist || errEst) {
            btn.textContent = 'Calcular Vendas'; btn.disabled = false;
            return alert('Erro ao salvar as baixas no servidor.');
        }

        // Adiciona ao state local
        state.historico_estoque.push(...operacoesHistorico);
    }

    btn.textContent = 'Calcular Vendas'; btn.disabled = false;
    modalTurno.classList.add('hidden');
    renderEstoque();
    updateDashboard();
    renderHistorico();
    alert('Vendas calculadas e salvas na nuvem com sucesso!');
});

// Função Global de Exclusão com Estorno
async function deletarRegistro(tabela, id) {
    if(!confirm('Tem certeza que deseja excluir este registro? Essa ação não pode ser desfeita.')) return;

    try {
        if (tabela === 'saidas') {
            const sai = state.saidas.find(s => s.id === id);
            if (sai && sai.compra_id) {
                // Se for uma saída vinculada a uma compra de estoque, precisamos avisar e estornar
                if(confirm('Esta saída está vinculada a uma compra de estoque. Deseja estornar também a quantidade do estoque?')) {
                    const comp = state.compras.find(c => c.id === sai.compra_id);
                    if (comp) {
                        const qtdEstorno = parseFloat(comp.quantidade);
                        const idProd = comp.produto_id;
                        const novoTotal = (state.estoque_total[idProd] || 0) - qtdEstorno;
                        
                        await supabaseClient.from('compras').delete().eq('id', comp.id);
                        await supabaseClient.from('estoque_total').upsert({ produto_id: idProd, quantidade_total: novoTotal });
                        
                        state.estoque_total[idProd] = novoTotal;
                        state.compras = state.compras.filter(c => c.id !== comp.id);
                    }
                }
            }
        }
        
        // Deleta o registro principal
        const { error } = await supabaseClient.from(tabela).delete().eq('id', id);
        if(error) throw error;

        if (tabela === 'entradas') state.entradas = state.entradas.filter(e => e.id !== id);
        if (tabela === 'saidas') state.saidas = state.saidas.filter(s => s.id !== id);
        if (tabela === 'lancamentos_meta') {
            state.lancamentos_meta = state.lancamentos_meta.filter(l => l.id !== id);
            renderMeta();
            alert('Lançamento da meta excluído!');
            return; // Retorna para não chamar as outras funções globais
        }
        if (tabela === 'historico_estoque') {
            const h = state.historico_estoque.find(x => x.id === id);
            if (h && confirm('Deseja devolver a quantidade consumida ao estoque total?')) {
                const novoTotal = (state.estoque_total[h.produto_id] || 0) + parseFloat(h.consumido);
                await supabaseClient.from('estoque_total').upsert({ produto_id: h.produto_id, quantidade_total: novoTotal });
                state.estoque_total[h.produto_id] = novoTotal;
            }
            state.historico_estoque = state.historico_estoque.filter(x => x.id !== id);
        }

        alert('Registro excluído com sucesso!');
        updateDashboard();
        renderTransactions();
        renderHistorico();
        renderEstoque();
    } catch (err) {
        console.error(err);
        alert('Erro ao excluir registro.');
    }
}

function getEstatisticasDia(dataStr) {
    const entradasNoDia = state.entradas.filter(e => e.data_referencia === dataStr);
    const saidasNoDia = state.saidas.filter(s => s.data_referencia === dataStr);
    
    const totalCaixaBruto = entradasNoDia.reduce((sum, e) => sum + parseFloat(e.valor_total), 0);
    const totalDespesas = saidasNoDia.reduce((sum, s) => sum + parseFloat(s.valor), 0);
    const lucroLiquido = totalCaixaBruto - totalDespesas;
    
    // Calcula copos vendidos
    const historicoHoje = state.historico_estoque.filter(h => h.data_referencia === dataStr);
    let coposVendidos = 0;
    const prodCopo = state.produtos.find(p => p.nome.toLowerCase().includes('copo'));
    
    if (prodCopo) {
        const consumosCopoHoje = historicoHoje.filter(h => h.produto_id === prodCopo.id);
        coposVendidos = consumosCopoHoje.reduce((sum, h) => sum + h.consumido, 0);
    }
    
    const ticketMedio = coposVendidos > 0 ? (totalCaixaBruto / coposVendidos) : 0;
    
    return { totalCaixaBruto, totalDespesas, lucroLiquido, coposVendidos, ticketMedio };
}

function getDataAnteriorStr(diasOffset) {
    const d = new Date();
    d.setDate(d.getDate() - diasOffset);
    return d.toISOString().split('T')[0];
}

function updateDashboard() {
    const hojeStr = getHojeStr();
    const statsHoje = getEstatisticasDia(hojeStr);
    
    // Lucro Hoje e Apurado Hoje
    document.getElementById('dash-caixa').textContent = formatCurrency(statsHoje.totalCaixaBruto);
    document.getElementById('dash-lucro-hoje').textContent = `Lucro Hoje: ${formatCurrency(statsHoje.lucroLiquido)}`;
    const lucroBadge = document.getElementById('dash-lucro-hoje');
    lucroBadge.style.background = statsHoje.lucroLiquido >= 0 ? 'rgba(255,255,255,0.2)' : 'rgba(220,38,38,0.3)';
    document.getElementById('dash-copos').textContent = Math.round(statsHoje.coposVendidos);

    // Cálculos Multi-Tempo
    let lucroSemanal = 0;
    let lucroMensal = 0;
    let lucroTotalAcumulado = 0;
    
    const seteDiasAtras = getDataAnteriorStr(7);
    const trintaDiasAtras = getDataAnteriorStr(30);

    const allDatas = [...new Set([...state.entradas.map(e => e.data_referencia), ...state.saidas.map(s => s.data_referencia)])];
    
    allDatas.forEach(d => { 
        const statsDia = getEstatisticasDia(d);
        lucroTotalAcumulado += statsDia.lucroLiquido;
        if (d >= seteDiasAtras && d <= hojeStr) lucroSemanal += statsDia.lucroLiquido;
        if (d >= trintaDiasAtras && d <= hojeStr) lucroMensal += statsDia.lucroLiquido;
    });

    // Saldo Global
    const saldoGlobal = state.entradas.reduce((s, e) => s + parseFloat(e.valor_total),0) - state.saidas.reduce((s, e) => s + parseFloat(e.valor), 0);
    
    const elCaixaGlobal = document.getElementById('dash-caixa-global');
    const elLucroSem = document.getElementById('dash-lucro-sem');
    const elLucroMes = document.getElementById('dash-lucro-mes');

    elCaixaGlobal.textContent = formatCurrency(saldoGlobal);
    elLucroSem.textContent = formatCurrency(lucroSemanal);
    elLucroMes.textContent = formatCurrency(lucroMensal);

    // Colorir dinamicamente via classes
    elCaixaGlobal.className = saldoGlobal >= 0 ? 'val-pos' : 'val-neg';
    elLucroSem.className = lucroSemanal >= 0 ? 'val-pos' : 'val-neg';
    elLucroMes.className = lucroMensal >= 0 ? 'val-pos' : 'val-neg';

    // ROI e Break eaven
    const investimento = state.investimento_inicial;
    const faltaPagar = investimento - lucroTotalAcumulado;
    
    if (investimento > 0) {
        document.querySelector('.break-even-card').style.display = 'block';
        if (faltaPagar > 0) {
            document.getElementById('dash-roi-falta').textContent = formatCurrency(faltaPagar);
            let perc = (lucroTotalAcumulado / investimento) * 100;
            if (perc < 0) perc = 0; if (perc > 100) perc = 100;
            document.getElementById('roi-progress').style.width = `${perc}%`;
            document.getElementById('roi-perc-text').textContent = `${perc.toFixed(1)}% concluído`;
            document.querySelector('.roi-text').innerHTML = `Faltam <strong>${formatCurrency(faltaPagar)}</strong> para cobrir o investimento inicial.`;
        } else {
            document.getElementById('roi-progress').style.width = `100%`;
            document.getElementById('roi-perc-text').textContent = `100% concluído! 🎉`;
            document.querySelector('.roi-text').innerHTML = `<strong>Negócio Pago!</strong> Você já lucrou ${formatCurrency(Math.abs(faltaPagar))} acima do investimento.`;
        }
    } else {
        document.querySelector('.break-even-card').style.display = 'none';
    }

    // --- TENDÊNCIAS, RENDIMENTO E PROVISIONAMENTO ---
    const alertsList = document.getElementById('dash-alerts-list');
    alertsList.innerHTML = '';
    
    // Busca dinamicamente todos os produtos principais
    const principais = state.produtos.filter(p => p.ativo && p.is_principal);
    
    principais.forEach(prod => {
        const prov = calcularProvisionamento(prod);
        if (prov.mediaDiaria === 0 && prov.estoqueAtual === 0) return;
        
        const duraDias = prov.duraDias;
        const estoqueAtual = prov.estoqueAtual;
        
        const isCritico = duraDias <= 3 && estoqueAtual > 0;
        const isZeradaco = estoqueAtual <= 0;
        const styleText = isCritico || isZeradaco ? 'color: var(--danger); font-weight: bold;' : '';
        const iconAlert = isCritico || isZeradaco ? '🚨 ' : '📦 ';
        
        const isCopo = prod.nome.toLowerCase().includes('copo');
        const icone = isCopo ? '🥤' : '☕';
        
        let infoGasto = `Gasto de ~${prov.mediaDiaria.toFixed(1)} ${prod.unidade_medida}/dia`;
        if (isCopo) infoGasto = `Venda de ~${Math.round(prov.mediaDiaria)} copos/dia`;
        
        let infoDura = `Restam ${estoqueAtual} (Dura ~${duraDias} dias)`;
        if(isZeradaco) infoDura = `ESTOQUE ZERADO!`;

        alertsList.innerHTML += `
            <li>
                <strong>${icone} ${prod.nome}:</strong> ${infoGasto}.<br>
                <span style="${styleText}">${iconAlert} ${infoDura}</span>
            </li>
        `;
    });

    const prodCopo = principais.find(p => p.nome.toLowerCase().includes('copo'));
    const prodCafe = principais.find(p => p.nome.toLowerCase().includes('café') || p.nome.toLowerCase().includes('cafe'));

    // 2. Rendimento do Pó de Café
    if (prodCopo && prodCafe && state.historico_estoque.length > 0) {
        const totalCoposVendidosSempre = state.historico_estoque.filter(h => h.produto_id === prodCopo.id).reduce((s, h) => s + h.consumido, 0);
        const totalCafeGastoSempre = state.historico_estoque.filter(h => h.produto_id === prodCafe.id).reduce((s, h) => s + h.consumido, 0);
        
        if(totalCoposVendidosSempre > 0 && totalCafeGastoSempre > 0) {
            const gastoPorCopo = (totalCafeGastoSempre / totalCoposVendidosSempre).toFixed(1);
            alertsList.innerHTML += `<li style="margin-top:10px; border-top: 1px solid var(--border-color); padding-top:10px;"><strong>⚖️ Rendimento Real:</strong> Você gasta <strong>${gastoPorCopo} ${prodCafe.unidade_medida} de café</strong> para cada Copo vendido. Ajuste sua mão na garrafa baseado nisso!</li>`;
        }
    }

    if (alertsList.innerHTML === '') {
         alertsList.innerHTML = '<li>Faça vendas e informe saídas no estoque por alguns dias para o sistema gerar a inteligência e o fôlego do seu negócio!</li>';
    }
}

// --- RELATÓRIOS E SETTINGS ---
document.getElementById('btn-salvar-investimento').addEventListener('click', async () => {
    const val = parseFloat(document.getElementById('config-investimento').value) || 0;
    const btn = document.getElementById('btn-salvar-investimento');
    btn.textContent = '...'; btn.disabled = true;

    const { error } = await supabaseClient.from('configuracoes').upsert({ chave: 'investimento_inicial', valor: val.toString() });
    btn.textContent = 'Atualizar Investimento'; btn.disabled = false;

    if(error) return alert("Erro ao salvar configuração!");
    
    state.investimento_inicial = val;
    updateDashboard();
    renderHistorico();
    alert('Investimento atualizado na nuvem!');
});

document.getElementById('btn-reset-dados').addEventListener('click', async () => {
    if(confirm('🚨 ZERAR BANCO ONLINE: Tem certeza? Isso apagará TODAS as vendas, caixa e histórico na nuvem para APENAS ESTA CONTA do Supabase! As tabelas de produtos serão mantidas. O estoque será zerado.')) {
        
        const btn = document.getElementById('btn-reset-dados');
        btn.innerHTML = 'Apagando...'; btn.disabled = true;

        // Devido as politicas do frontend, o jeito mais bruto de apagar todos
        // Os deletes do supabase exigem uma clausula match:
        await supabaseClient.from('entradas').delete().neq('id', 0);
        await supabaseClient.from('saidas').delete().neq('id', 0);
        await supabaseClient.from('historico_estoque').delete().neq('id', 0);
        await supabaseClient.from('estoque_total').delete().neq('produto_id', 0);
        // await supabaseClient.from('produtos').delete().neq('id', 0); // Decidimos não apagar os produtos para não retrabalhar

        state.entradas = [];
        state.saidas = [];
        state.historico_estoque = [];
        state.estoque_total = {};
        
        btn.innerHTML = '<ion-icon name="warning"></ion-icon> Apagar Todos os Dados do Banco'; 
        btn.disabled = false;
        
        updateDashboard();
        renderEstoque();
        renderTransactions();
        alert('Dados financeiros e históricos apagados do servidor.');
    }
});

function renderHistorico() {
    updateRelatorios();
}

function updateRelatorios() {
    const dataInicioInput = document.getElementById('rel-data-inicio').value;
    const dataFimInput = document.getElementById('rel-data-fim').value;

    const datasNoPeriodo = [];
    const hoje = new Date();
    
    // Configura os inputs caso estejam vazios (padrão: últimos 7 dias)
    if (!dataInicioInput || !dataFimInput) {
        const dFim = new Date();
        const dInicio = new Date(); dInicio.setDate(dFim.getDate() - 6);
        
        const fStr = dFim.toISOString().split('T')[0];
        const iStr = dInicio.toISOString().split('T')[0];
        
        document.getElementById('rel-data-inicio').value = iStr;
        document.getElementById('rel-data-fim').value = fStr;
        
        let dAtual = new Date(iStr + 'T12:00:00');
        const limite = new Date(fStr + 'T12:00:00');
        while (dAtual <= limite) {
            datasNoPeriodo.push(dAtual.toISOString().split('T')[0]);
            dAtual.setDate(dAtual.getDate() + 1);
        }
    } else {
        let dAtual = new Date(dataInicioInput + 'T12:00:00');
        const limite = new Date(dataFimInput + 'T12:00:00');
        
        if (dAtual > limite) {
            alert('A data de início não pode ser maior que a data de fim.');
            return;
        }
        
        while (dAtual <= limite) {
            datasNoPeriodo.push(dAtual.toISOString().split('T')[0]);
            dAtual.setDate(dAtual.getDate() + 1);
        }
    }
    
    let somaVendasPeriodo = 0;
    let coposVendidosPeriodo = 0;
    
    const dadosGrafico = { labels: [], vendas: [], lucros: [], fullDates: [] };

    // Cálculo do Período
    datasNoPeriodo.forEach(data => {
        const stats = getEstatisticasDia(data);
        const [ano, mes, dia] = data.split('-');
        
        dadosGrafico.labels.push(`${dia}/${mes}`);
        dadosGrafico.fullDates.push(data); // Armazena a data original
        dadosGrafico.vendas.push(stats.totalCaixaBruto);
        dadosGrafico.lucros.push(stats.lucroLiquido);
        
        somaVendasPeriodo += stats.totalCaixaBruto;
        coposVendidosPeriodo += stats.coposVendidos;
    });

    // Atualizando o Totalzão
    document.getElementById('uber-total-apurado').textContent = formatCurrency(somaVendasPeriodo);

    // Atualizando as 3 métricas de texto puro (Somando gastos do período)
    let gastosTotais = 0;
    datasNoPeriodo.forEach(data => {
        gastosTotais += getEstatisticasDia(data).totalDespesas;
    });
    const lucroLiquidoPeriodo = somaVendasPeriodo - gastosTotais;

    document.getElementById('uber-lucro-liquido').textContent = formatCurrency(lucroLiquidoPeriodo);

    // Ticket Médio
    const ticketMedio = coposVendidosPeriodo > 0 ? (somaVendasPeriodo / coposVendidosPeriodo) : 0;
    document.getElementById('uber-ticket-medio').textContent = formatCurrency(ticketMedio);

    // Copos Vendidos
    document.getElementById('uber-copos-vendidos').textContent = Math.round(coposVendidosPeriodo).toString();

    renderChartPrincipal(dadosGrafico);
}

function renderChartPrincipal(dados) {
    const ctx = document.getElementById('chart-principal')?.getContext('2d');
    
    if (!ctx || !window.Chart) return;

    if (charts.lucro) charts.lucro.destroy();
    if (charts.dias) charts.dias.destroy();

    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    const textColor = isDark ? '#fcf8f2' : '#2d1a0d';

    // Rótulos formatados com array para quebrar a linha no Chart.js
    const diasSemana = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
    const arrayLabels = dados.labels.map((label, index) => {
        const dataISO = dados.fullDates[index];
        const [dia, mes] = label.split('/');
        // Usar meio-dia para evitar problemas de fuso horário
        const dataReal = new Date(dataISO + 'T12:00:00');
        const diaDaSemana = diasSemana[dataReal.getDay()];
        return [dia, diaDaSemana];
    });

    charts.lucro = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: arrayLabels,
            datasets: [
                {
                    label: 'Faturamento',
                    data: dados.vendas,
                    backgroundColor: '#276ef1', // Azul Uber
                    borderWidth: 0,
                    borderRadius: 2, // Leve arredondamento no topo
                    barPercentage: 0.8,
                    categoryPercentage: 0.9
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                y: { 
                    beginAtZero: true, 
                    ticks: { display: false }, // Oculta os números do eixo Y
                    grid: { display: false }, // Sem linhas de grade
                    border: { display: false } // Sem a linha do eixo Y
                },
                x: { 
                    ticks: { color: textColor, font: { family: 'Outfit', size: 11 } }, 
                    grid: { display: false }, // Sem linhas de grade
                    border: { color: isDark ? '#444' : '#ccc' } // Apenas a linha horizontal base
                }
            },
            plugins: { 
                legend: { display: false }, // Oculta a legenda igual no Uber
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            return formatCurrency(context.raw);
                        }
                    }
                }
            }
        }
    });
}

// Inicia os filtros de período
document.getElementById('rel-data-inicio')?.addEventListener('change', updateRelatorios);
document.getElementById('rel-data-fim')?.addEventListener('change', updateRelatorios);

function renderComprasEstoque() {
    const list = document.getElementById('lista-compras-estoque');
    if (!list) return;
    list.innerHTML = '';

    // Mostra TODO o histórico de compras de estoque para auditoria
    const comprasSorted = [...state.compras].sort((a,b) => new Date(b.data_referencia) - new Date(a.data_referencia));
    
    if (comprasSorted.length === 0) return list.innerHTML = '<li>Nenhum registro de compra (com valor) encontrado.</li>';

    comprasSorted.forEach(c => {
        const prod = state.produtos.find(p => p.id === c.produto_id);
        const nome = prod ? prod.nome : 'Produto Excluído';
        const un = prod ? prod.unidade_medida : '';
        const [ano, mes, dia] = c.data_referencia.split('-');

        const li = document.createElement('li');
        li.className = 'historico-item';
        li.innerHTML = `
            <div style="flex:1">
                <p><strong>${dia}/${mes}</strong> - ${nome}</p>
                <small>${c.quantidade}${un} comprados</small>
            </div>
            <strong>${formatCurrency(c.valor_total)}</strong>
            <button class="btn-delete" onclick="deletarRegistro('compras', ${c.id})" title="Excluir Compra">
                <ion-icon name="trash-outline"></ion-icon>
            </button>
        `;
        list.appendChild(li);
    });
}

// Caso queira limpar o consumo de um dia inteiro (historico_estoque)
async function deletarHistoricoConsumoPorDia(dataRef) {
    if(!confirm('Deseja cancelar o fechamento deste dia? Isso vai somar os itens de volta ao seu estoque total.')) return;
    
    const itens = state.historico_estoque.filter(h => h.data_referencia === dataRef);
    for(const item of itens) {
        const novoTotal = (state.estoque_total[item.produto_id] || 0) + parseFloat(item.consumido);
        await supabaseClient.from('estoque_total').upsert({ produto_id: item.produto_id, quantidade_total: novoTotal });
        state.estoque_total[item.produto_id] = novoTotal;
        await supabaseClient.from('historico_estoque').delete().eq('id', item.id);
    }
    state.historico_estoque = state.historico_estoque.filter(h => h.data_referencia !== dataRef);
    
    alert('Fechamento do dia revertido e itens voltaram ao estoque!');
    updateDashboard();
    renderEstoque();
    renderHistorico();
}

function init() {
    loadState(); 
}

// --- LÓGICA DE META $ ---
function renderMeta() {
    const metaAtiva = state.metas.find(m => m.ativa);
    const panelSetup = document.getElementById('meta-setup-panel');
    const panelActive = document.getElementById('meta-active-panel');

    if (!metaAtiva) {
        panelSetup.style.display = 'block';
        panelActive.style.display = 'none';
        return;
    }

    panelSetup.style.display = 'none';
    panelActive.style.display = 'block';

    const lancamentos = state.lancamentos_meta.filter(l => l.meta_id === metaAtiva.id);
    const totalArrecadado = lancamentos.reduce((acc, l) => acc + parseFloat(l.valor), 0);
    const valorRestante = parseFloat(metaAtiva.valor_total) - totalArrecadado;
    
    // Calcula dias
    const inicioDate = new Date(metaAtiva.data_inicio + "T00:00:00"); // Pega o início à meia-noite da data local
    const hoje = new Date();
    // Zera horas para a diferença ser exata em dias
    inicioDate.setHours(0,0,0,0);
    hoje.setHours(0,0,0,0);
    
    const timeDiff = hoje.getTime() - inicioDate.getTime();
    let diasPassados = Math.floor(timeDiff / (1000 * 3600 * 24));
    if (diasPassados < 0) diasPassados = 0; // Se a meta começa no futuro

    let diasRestantes = parseInt(metaAtiva.dias_esforco) - diasPassados;
    if (diasRestantes <= 0) diasRestantes = 1; // Proteção para não dar infinity se atrasar, exige arrecadar tudo no último dia.

    let metaDiariaGlobal = 0;
    if (valorRestante > 0) {
        metaDiariaGlobal = valorRestante / diasRestantes;
    }
    const metaDiariaIndiv = metaDiariaGlobal / 2;

    const tonyTotal = lancamentos.filter(l => l.responsavel === 'Tony').reduce((acc, l) => acc + parseFloat(l.valor), 0);
    const lysTotal = lancamentos.filter(l => l.responsavel === 'Lys').reduce((acc, l) => acc + parseFloat(l.valor), 0);

    let progresso = (totalArrecadado / parseFloat(metaAtiva.valor_total)) * 100;
    if (progresso > 100) progresso = 100;

    // Atualiza DOM
    document.getElementById('meta-nome-display').textContent = metaAtiva.nome;
    const badge = document.getElementById('meta-recorrente-badge');
    if (badge) badge.style.display = metaAtiva.repetir_mensalmente ? 'inline-block' : 'none';

    document.getElementById('meta-valor-display').textContent = `${formatCurrency(totalArrecadado)} / ${formatCurrency(metaAtiva.valor_total)}`;
    document.getElementById('meta-progress').style.width = `${progresso}%`;
    document.getElementById('meta-perc-text').textContent = `${progresso.toFixed(1)}%`;
    document.getElementById('meta-dias-restantes').textContent = diasRestantes;

    document.getElementById('meta-tony-total').textContent = formatCurrency(tonyTotal);
    document.getElementById('meta-lys-total').textContent = formatCurrency(lysTotal);

    document.getElementById('meta-diaria-individual').innerHTML = `${formatCurrency(metaDiariaIndiv)} <span style="font-size: 1rem; color: var(--text-muted);">cada um</span>`;
    document.getElementById('meta-diaria-global').textContent = formatCurrency(metaDiariaGlobal);

    // Renderiza Gráfico de Participação
    const ctx = document.getElementById('chart-meta-participacao')?.getContext('2d');
    if (ctx && window.Chart) {
        if (charts.meta_participacao) charts.meta_participacao.destroy();
        
        let dataTony = tonyTotal;
        let dataLys = lysTotal;
        
        // Se ambos são 0, mostra um cinza vazio para não ficar em branco
        if(dataTony === 0 && dataLys === 0) {
            dataTony = 0.1;
            dataLys = 0.1;
        }

        const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
        
        charts.meta_participacao = new Chart(ctx, {
            type: 'doughnut',
            data: {
                labels: ['Tony', 'Lys'],
                datasets: [{
                    data: [dataTony, dataLys],
                    backgroundColor: [
                        tonyTotal === 0 && lysTotal === 0 ? '#cccccc' : '#3b82f6', 
                        tonyTotal === 0 && lysTotal === 0 ? '#dddddd' : '#ec4899'
                    ],
                    borderWidth: isDark ? 2 : 3,
                    borderColor: isDark ? '#2d1a0d' : '#ffffff'
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                cutout: '70%',
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        callbacks: {
                            label: function(context) {
                                if (tonyTotal === 0 && lysTotal === 0) return ' Sem arrecadação';
                                const percent = ((context.raw / totalArrecadado) * 100).toFixed(1);
                                return ` ${context.label}: ${percent}% (${formatCurrency(context.raw)})`;
                            }
                        }
                    }
                }
            }
        });
    }

    // Renderiza Lista
    const list = document.getElementById('meta-transactions-list');
    list.innerHTML = '';
    const lancSorted = [...lancamentos].sort((a,b) => new Date(b.criado_em || b.data_lancamento).getTime() - new Date(a.criado_em || a.data_lancamento).getTime());
    
    if (lancSorted.length === 0) {
        list.innerHTML = '<li>Nenhum lançamento feito.</li>';
    } else {
        lancSorted.forEach(l => {
            const li = document.createElement('li');
            li.className = 'historico-item';
            const cor = l.responsavel === 'Tony' ? '#3b82f6' : '#ec4899';
            li.innerHTML = `
                <div style="flex:1">
                    <p style="color: ${cor}"><strong>${l.responsavel}</strong> guardou</p>
                    <small>${l.data_lancamento.split('-').reverse().join('/')}</small>
                </div>
                <strong>+${formatCurrency(l.valor)}</strong>
                <button class="btn-delete" onclick="deletarRegistro('lancamentos_meta', ${l.id})" title="Excluir">
                    <ion-icon name="trash-outline"></ion-icon>
                </button>
            `;
            list.appendChild(li);
        });
    }
}

document.getElementById('form-criar-meta').addEventListener('submit', async (e) => {
    e.preventDefault();
    const nome = document.getElementById('nova-meta-nome').value;
    const valor = parseFloat(document.getElementById('nova-meta-valor').value);
    const dias = parseInt(document.getElementById('nova-meta-dias').value);
    const inicio = document.getElementById('nova-meta-inicio').value;
    const repetir = document.getElementById('nova-meta-repetir').checked;

    const btn = e.target.querySelector('button');
    btn.textContent = 'Iniciando...'; btn.disabled = true;

    const { data, error } = await supabaseClient.from('metas_financeiras').insert([{
        nome,
        valor_total: valor,
        dias_esforco: dias,
        data_inicio: inicio,
        repetir_mensalmente: repetir,
        ativa: true
    }]).select();

    btn.textContent = 'Iniciar Meta'; btn.disabled = false;

    if (error) {
        console.error('Erro detalhado do Supabase:', error);
        return alert('Erro ao criar a meta: ' + error.message);
    }

    state.metas.push(data[0]);
    e.target.reset();
    renderMeta();
});

document.getElementById('form-lancamento-meta').addEventListener('submit', async (e) => {
    e.preventDefault();
    const responsavel = document.getElementById('meta-lanc-responsavel').value;
    const valor = parseFloat(document.getElementById('meta-lanc-valor').value);
    const dataInput = document.getElementById('meta-lanc-data').value;
    const metaAtiva = state.metas.find(m => m.ativa);

    const btn = e.target.querySelector('button');
    btn.textContent = 'Salvando...'; btn.disabled = true;

    const { data, error } = await supabaseClient.from('lancamentos_meta').insert([{
        meta_id: metaAtiva.id,
        valor: valor,
        responsavel: responsavel,
        data_lancamento: dataInput || getHojeStr()
    }]).select();

    btn.textContent = 'Adicionar à Meta'; btn.disabled = false;

    if (error) return alert('Erro ao registrar valor!');

    state.lancamentos_meta.push(data[0]);
    document.getElementById('meta-lanc-valor').value = '';
    renderMeta();
});

document.getElementById('btn-encerrar-meta').addEventListener('click', async () => {
    const metaAtiva = state.metas.find(m => m.ativa);
    if (!metaAtiva) return;

    let criarNova = false;
    let novaDataInicio = "";

    if (metaAtiva.repetir_mensalmente) {
        novaDataInicio = prompt('Esta meta é recorrente! Se você quiser iniciar o próximo ciclo agora, digite a data de início (AAAA-MM-DD).\nExemplo: 2026-06-01\n\nSe quiser apenas encerrar permanentemente, clique em Cancelar.');
        if (novaDataInicio !== null && novaDataInicio.trim() !== "") {
            // Validar formato simples
            if (!/^\d{4}-\d{2}-\d{2}$/.test(novaDataInicio.trim())) {
                alert('Formato de data inválido. A meta atual NÃO será encerrada. Tente novamente usando o formato AAAA-MM-DD.');
                return;
            }
            criarNova = true;
        } else {
            if(!confirm('Você não digitou uma data. Deseja encerrar a meta ATUAL e DESATIVAR a repetição permanente?')) return;
        }
    } else {
        if(!confirm('Tem certeza que deseja encerrar a meta atual? Você poderá iniciar uma nova meta depois.')) return;
    }
    
    // Encerrar a atual
    const { error: errUpdate } = await supabaseClient.from('metas_financeiras').update({ ativa: false }).eq('id', metaAtiva.id);
    if (errUpdate) {
        console.error(errUpdate);
        return alert('Erro ao encerrar meta.');
    }
    metaAtiva.ativa = false;

    // Criar a nova se for o caso
    if (criarNova) {
        const { data: novaMeta, error: errInsert } = await supabaseClient.from('metas_financeiras').insert([{
            nome: metaAtiva.nome,
            valor_total: metaAtiva.valor_total,
            dias_esforco: metaAtiva.dias_esforco,
            data_inicio: novaDataInicio.trim(),
            repetir_mensalmente: true,
            ativa: true
        }]).select();

        if (errInsert) {
            console.error(errInsert);
            alert('A meta anterior foi encerrada, mas houve erro ao criar a do próximo mês!');
        } else {
            state.metas.push(novaMeta[0]);
            alert('Meta do próximo mês iniciada com sucesso!');
        }
    }

    renderMeta();
});

// Expõe funções para o escopo global (necessário para o onclick no HTML)
window.deletarProduto = deletarProduto;
window.deletarRegistro = deletarRegistro;
window.deletarHistoricoConsumoPorDia = deletarHistoricoConsumoPorDia;

window.addEventListener('DOMContentLoaded', init);
