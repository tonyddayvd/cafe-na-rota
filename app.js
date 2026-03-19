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
    compras: []             // tabela 'compras'
};

let charts = {
    lucro: null,
    dias: null
};

const formatCurrency = (val) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(val);
const getHojeStr = () => new Date().toISOString().split('T')[0];
const getUnidadeStr = (un) => un === 'un' ? 'unidades' : un;

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
    
    // Mostra as últimas 30 transações (Entradas e Saídas) independente da data
    const transacoes = [
        ...state.entradas.map(e => ({ id: e.id, tipo: 'entrada', valor: parseFloat(e.valor_total), desc: 'Apurado Diário', data: e.data_referencia })),
        ...state.saidas.map(s => ({ id: s.id, tipo: 'saida', valor: parseFloat(s.valor), desc: s.justificativa, data: s.data_referencia }))
    ].sort((a,b) => new Date(b.data) - new Date(a.data)).slice(0,30);
    
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
    list.innerHTML = '';
    
    state.produtos.forEach(p => {
        if (!p.ativo) return;
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
    
    if (!nome) return alert('Insira o nome');

    const btn = document.getElementById('btn-salvar-produto');
    btn.textContent = 'Aguarde...'; btn.disabled = true;

    // Insert no Supabase
    const { data, error } = await supabaseClient.from('produtos').insert([{ 
        nome, 
        categoria: cat, 
        unidade_medida: un,
        capacidade_unidade: cap,
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

        // Atualiza state local
        if (tabela === 'entradas') state.entradas = state.entradas.filter(e => e.id !== id);
        if (tabela === 'saidas') state.saidas = state.saidas.filter(s => s.id !== id);
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
    
    const prodCopo = state.produtos.find(p => p.nome.toLowerCase().includes('copo'));
    const prodCafe = state.produtos.find(p => p.nome.toLowerCase().includes('café') || p.nome.toLowerCase().includes('cafe'));
    
    // 1. Tendência de Vendas de Copo
    if (prodCopo) {
        const consumosCopo = state.historico_estoque
            .filter(h => h.produto_id === prodCopo.id)
            .sort((a,b) => new Date(b.data_referencia) - new Date(a.data_referencia));
        
        if (consumosCopo.length > 0) {
            const histPorData = consumosCopo.reduce((acc, obj) => {
                acc[obj.data_referencia] = (acc[obj.data_referencia] || 0) + obj.consumido; return acc;
            }, {});
            
            const arrayValores = Object.values(histPorData);
            const mediaCopo = arrayValores.reduce((a,b) => a+b, 0) / arrayValores.length;
            const copoEstoque = state.estoque_total[prodCopo.id] || 0;
            const duraDias = mediaCopo > 0 ? (copoEstoque / mediaCopo).toFixed(1) : 0;
            
            alertsList.innerHTML += `<li><strong>📈 Média de vendas:</strong> Você vende ~${Math.round(mediaCopo)} copos por turno/dia.</li>`;
            
            if(duraDias > 0) {
                const cor = duraDias <= 2 ? 'color:var(--danger)' : '';
                alertsList.innerHTML += `<li style="${cor}"><strong>📦 Provisionamento:</strong> Seus ${copoEstoque} copos restantes devem durar cerca de <strong>${duraDias} dias</strong>.</li>`;
            }
        }
    }

    // 2. Rendimento do Pó de Café
    if (prodCopo && prodCafe && state.historico_estoque.length > 0) {
        const totalCoposVendidosSempre = state.historico_estoque.filter(h => h.produto_id === prodCopo.id).reduce((s, h) => s + h.consumido, 0);
        const totalCafeGastoSempre = state.historico_estoque.filter(h => h.produto_id === prodCafe.id).reduce((s, h) => s + h.consumido, 0);
        
        if(totalCoposVendidosSempre > 0 && totalCafeGastoSempre > 0) {
            const gastoPorCopo = (totalCafeGastoSempre / totalCoposVendidosSempre).toFixed(1);
            alertsList.innerHTML += `<li><strong>☕ Rendimento Real:</strong> Você gasta em média <strong>${gastoPorCopo} ${prodCafe.unidade_medida} de ${prodCafe.nome}</strong> para cada Copo vendido. Use isso para gerir sua força de proporção na garrafa.</li>`;
        }
    }

    if (alertsList.innerHTML === '') {
         alertsList.innerHTML = '<li>Venda mais alguns dias e informe as sobras de estoque para o sistema ter base para criar gráficos matemáticos!</li>';
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
    // Agora renderHistorico é acoplado ao período selecionado no Dashboard BI
    updateRelatorios(parseInt(document.querySelector('.filter-bar .active')?.getAttribute('data-period') || 7));
}

function updateRelatorios(dias) {
    const list = document.getElementById('historico-list');
    if (!list) return;
    list.innerHTML = '';
    
    const hoje = new Date();
    const datasNoPeriodo = [];
    for(let i=0; i<dias; i++) {
        const d = new Date(); d.setDate(hoje.getDate() - i);
        datasNoPeriodo.push(d.toISOString().split('T')[0]);
    }
    
    let lucroTotalPeriodo = 0;
    let somaVendasPeriodo = 0;
    let somaGastosPeriodo = 0;
    let diasComVenda = 0;
    
    const dadosGraficoLucro = { labels: [], faturamento: [], despesa: [] };
    const dadosDiasSemana = { 0:0, 1:0, 2:0, 3:0, 4:0, 5:0, 6:0 };

    // --- MOTOR DE RENDIMENTO E BI ---
    let totalConsumoCafe = 0; 
    let mlVendidosTotal = 0;

    // Cálculo do Período
    datasNoPeriodo.reverse().forEach(data => {
        const stats = getEstatisticasDia(data);
        const [ano, mes, dia] = data.split('-');
        const dataFormatada = `${dia}/${mes}`;
        
        dadosGraficoLucro.labels.push(dataFormatada);
        dadosGraficoLucro.faturamento.push(stats.totalCaixaBruto);
        dadosGraficoLucro.despesa.push(stats.totalDespesas);
        
        const diaSemana = new Date(data + 'T12:00:00').getDay();
        dadosDiasSemana[diaSemana] += stats.totalCaixaBruto;

        // Rendimento - 100ml por copo vendido
        mlVendidosTotal += (stats.coposVendidos * 100);

        // Somar consumo de insumos chaves
        const histDia = state.historico_estoque.filter(h => h.data_referencia === data);
        histDia.forEach(h => {
            const prod = state.produtos.find(p => p.id === h.produto_id);
            if (prod) {
                if (prod.nome.toLowerCase().includes('café')) totalConsumoCafe += h.consumido;
            }
        });

        if (stats.totalCaixaBruto > 0 || stats.totalDespesas > 0) {
            lucroTotalPeriodo += stats.lucroLiquido;
            somaVendasPeriodo += stats.totalCaixaBruto;
            somaGastosPeriodo += stats.totalDespesas;
            diasComVenda++;
            
            const li = document.createElement('li');
            li.className = 'historico-item';
            li.innerHTML = `
                <div style="flex:1">
                    <span>${dataFormatada} - ${Math.round(stats.coposVendidos)} cafés</span>
                </div>
                <strong class="${stats.lucroLiquido >= 0 ? 'val-pos' : 'val-neg'}">
                    ${formatCurrency(stats.lucroLiquido)}
                </strong>
                <button class="btn-delete-sm" onclick="deletarHistoricoConsumoPorDia('${data}')" title="Limpar contagem deste dia">
                    <ion-icon name="refresh-outline"></ion-icon>
                </button>
            `;
            list.appendChild(li);
        }
    });

    // Cálculos GLOBAIS (Todo o Histórico)
    const vendasGlobal = state.entradas.reduce((sum, e) => sum + (parseFloat(e.valor_total) || 0), 0);
    const gastosGlobal = state.saidas.reduce((sum, s) => sum + (parseFloat(s.valor) || 0), 0);
    const lucroGlobal = vendasGlobal - gastosGlobal;

    if (diasComVenda === 0) list.innerHTML = '<li>Nenhum movimento no período selecionado.</li>';
    
    // Atualiza KPIs Globais
    const elVendasTotal = document.getElementById('rel-vendas-total');
    const elGastoTotal = document.getElementById('rel-gasto-total');
    const elLucroTotal = document.getElementById('rel-lucro-total');
    
    elVendasTotal.textContent = formatCurrency(vendasGlobal);
    elGastoTotal.textContent = formatCurrency(gastosGlobal);
    elLucroTotal.textContent = formatCurrency(lucroGlobal);
    elLucroTotal.className = lucroGlobal >= 0 ? 'val-pos' : 'val-neg';

    // Atualiza KPIs do Período
    const elVendasSemana = document.getElementById('rel-vendas-semana');
    const elGastoSemana = document.getElementById('rel-gasto-semana');
    const elLucroSemana = document.getElementById('rel-lucro-semana');

    elVendasSemana.textContent = formatCurrency(somaVendasPeriodo);
    elGastoSemana.textContent = formatCurrency(somaGastosPeriodo);
    elLucroSemana.textContent = formatCurrency(lucroTotalPeriodo);
    elLucroSemana.className = lucroTotalPeriodo >= 0 ? 'val-pos' : 'val-neg';
    
    document.getElementById('rel-media-vendas').textContent = formatCurrency(somaVendasPeriodo / (diasComVenda || 1));

    // Cálculo de BI adicional
    let rendCafeLabel = "Pendente dados de contagem.";
    if (totalConsumoCafe > 0 && mlVendidosTotal > 0) {
        const prodCafe = state.produtos.find(p => p.nome.toLowerCase().includes('café'));
        const unit = prodCafe ? prodCafe.unidade_medida : 'g';
        
        if (unit === 'g' || unit === 'kg') {
            const kg = (unit === 'kg' ? totalConsumoCafe : (totalConsumoCafe / 1000));
            const rend = (mlVendidosTotal / 1000) / (kg || 1); // Litros por Kg
            rendCafeLabel = `1kg de pó rendeu ${rend.toFixed(1)}L de café pronto.`;
        } else {
            const rend = (mlVendidosTotal / 1000) / totalConsumoCafe; // Litros por Pacote
            rendCafeLabel = `1 pacote rendeu ${rend.toFixed(1)}L de café pronto.`;
        }
    }

    const ticketMedio = (somaVendasPeriodo / (mlVendidosTotal / 100 || 1)) || 0;
    document.getElementById('rel-ticket-medio').textContent = formatCurrency(ticketMedio);
    
    // Melhor dia da semana
    const nomesDias = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"];
    let melhorDiaIndex = -1; let maxVenda = 0;
    for(let d in dadosDiasSemana) {
        if(dadosDiasSemana[d] > maxVenda) { maxVenda = dadosDiasSemana[d]; melhorDiaIndex = d; }
    }
    document.getElementById('rel-melhor-dia').textContent = melhorDiaIndex !== -1 ? nomesDias[melhorDiaIndex] : '-';

    // Widget ROI
    const divROI = document.createElement('div');
    divROI.className = 'card mt-1';
    const roiPercent = Math.min(100, Math.max(0, (lucroGlobal / (state.investimento_inicial || 1)) * 100));
    divROI.innerHTML = `
        <h3>Inteligência de Operação</h3>
        <p class="text-sm"><strong>ROI Acumulado:</strong> ${roiPercent.toFixed(1)}%</p>
        <div style="background:#eee; height:10px; border-radius:5px; margin:5px 0; overflow:hidden">
            <div style="background:var(--primary-color); height:100%; width:${roiPercent}%; transition: width 1s"></div>
        </div>
        <p class="text-xs mt-1"><strong>Rendimento Prático:</strong> ${rendCafeLabel}</p>
        <p class="text-xs"><strong>Status:</strong> Seu lucro total acumulado é ${formatCurrency(lucroGlobal)}.</p>
    `;
    list.prepend(divROI);

    renderCharts(dadosGraficoLucro, dadosDiasSemana);
}

function renderCharts(lucroData, diasData) {
    const ctxLucro = document.getElementById('chart-lucro')?.getContext('2d');
    const ctxDias = document.getElementById('chart-dias')?.getContext('2d');
    
    if (!ctxLucro || !window.Chart) {
        console.warn("Chart.js ou Canvas não encontrados.");
        return;
    }

    // Destruir gráficos anteriores para evitar sobreposição/erro
    if (charts.lucro) charts.lucro.destroy();
    if (charts.dias) charts.dias.destroy();

    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    const textColor = isDark ? '#fcf8f2' : '#2d1a0d';

    // Gráfico de Tendência (Linha)
    charts.lucro = new Chart(ctxLucro, {
        type: 'line',
        data: {
            labels: lucroData.labels,
            datasets: [
                {
                    label: 'Vendas (R$)',
                    data: lucroData.faturamento,
                    borderColor: '#16a34a',
                    backgroundColor: 'rgba(22, 163, 74, 0.1)',
                    borderWidth: 3,
                    fill: true,
                    tension: 0.4,
                    pointRadius: 4
                },
                {
                    label: 'Gastos (R$)',
                    data: lucroData.despesa,
                    borderColor: '#dc2626',
                    backgroundColor: 'rgba(220, 38, 38, 0.1)',
                    borderWidth: 3,
                    fill: true,
                    tension: 0.4,
                    pointRadius: 4
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                y: { beginAtZero: true, ticks: { color: textColor, font: { family: 'Outfit' } }, grid: { color: isDark ? '#3b2c22' : '#e5dacd' } },
                x: { ticks: { color: textColor, font: { family: 'Outfit' } }, grid: { display: false } }
            },
            plugins: { 
                legend: { labels: { color: textColor, font: { family: 'Outfit', weight: '600' } } }
            }
        }
    });

    // Gráfico de Dias da Semana (Barra)
    charts.dias = new Chart(ctxDias, {
        type: 'bar',
        data: {
            labels: ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"],
            datasets: [{
                label: 'Volume de Vendas (R$)',
                data: [
                    diasData[0] || 0, diasData[1] || 0, diasData[2] || 0, 
                    diasData[3] || 0, diasData[4] || 0, diasData[5] || 0, diasData[6] || 0
                ],
                backgroundColor: '#7b4b31',
                borderRadius: 8,
                hoverBackgroundColor: '#d97736'
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                y: { beginAtZero: true, ticks: { color: textColor, font: { family: 'Outfit' } }, grid: { color: isDark ? '#3b2c22' : '#e5dacd' } },
                x: { ticks: { color: textColor, font: { family: 'Outfit' } }, grid: { display: false } }
            },
            plugins: { 
                legend: { display: false }
            }
        }
    });
}

// Inicia os filtros de período
document.querySelectorAll('.filter-bar button').forEach(btn => {
    btn.addEventListener('click', () => {
        document.querySelectorAll('.filter-bar button').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        updateRelatorios(parseInt(btn.getAttribute('data-period')));
    });
});

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

// Expõe funções para o escopo global (necessário para o onclick no HTML)
window.deletarProduto = deletarProduto;
window.deletarRegistro = deletarRegistro;
window.deletarHistoricoConsumoPorDia = deletarHistoricoConsumoPorDia;

window.addEventListener('DOMContentLoaded', init);
