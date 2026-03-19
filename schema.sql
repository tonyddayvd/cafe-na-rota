-- Execute este script no SQL Editor do seu Supabase para criar o banco de dados.

-- Limpeza caso rode novamente
DROP TABLE IF EXISTS historico_estoque;
DROP TABLE IF EXISTS estoque_total;
DROP TABLE IF EXISTS produtos;
DROP TABLE IF EXISTS entradas;
DROP TABLE IF EXISTS saidas;
DROP TABLE IF EXISTS configuracoes;

-- Tabela: Produtos (Agora com Unidade de Medida)
CREATE TABLE produtos (
    id SERIAL PRIMARY KEY,
    nome TEXT NOT NULL,
    categoria TEXT DEFAULT 'insumo', -- 'insumo' ou 'ativo'
    unidade_medida TEXT DEFAULT 'un', -- 'un', 'g', 'ml', 'kg'
    capacidade_unidade NUMERIC(15,3) DEFAULT 1, -- Para cálculo de rendimento (ex: 1 copo = 100ml)
    ativo BOOLEAN DEFAULT TRUE,
    criado_em TIMESTAMPTZ DEFAULT NOW()
);

-- Tabela: Estoque Total (Saldo atual de cada produto)
CREATE TABLE estoque_total (
    produto_id INTEGER PRIMARY KEY REFERENCES produtos(id) ON DELETE CASCADE,
    quantidade_total NUMERIC(10,2) DEFAULT 0.00
);

-- Tabela: Histórico de Consumo (Fechamento de turno)
CREATE TABLE historico_estoque (
    id SERIAL PRIMARY KEY,
    data_operacao TIMESTAMP DEFAULT NOW(),
    data_referencia DATE DEFAULT CURRENT_DATE,
    produto_id INTEGER REFERENCES produtos(id) ON DELETE CASCADE,
    estoque_anterior NUMERIC(15,3),
    estoque_restante NUMERIC(15,3),
    consumido NUMERIC(15,3)
);

-- Tabela: Entradas Virtuais (Caixa)
CREATE TABLE entradas (
    id SERIAL PRIMARY KEY,
    data_operacao TIMESTAMP DEFAULT NOW(),
    data_referencia DATE DEFAULT CURRENT_DATE,
    valor_total NUMERIC(15,2) NOT NULL
);

-- 5. Saídas (Despesas diversas)
CREATE TABLE saidas (
    id SERIAL PRIMARY KEY,
    data_operacao TIMESTAMP DEFAULT NOW(),
    data_referencia DATE DEFAULT CURRENT_DATE,
    valor NUMERIC(15,2) NOT NULL,
    justificativa TEXT NOT NULL,
    compra_id INTEGER -- Referência opcional à tabela de compras
);

-- 6. Compras de Estoque (Histórico de entradas de material)
CREATE TABLE compras (
    id SERIAL PRIMARY KEY,
    data_operacao TIMESTAMP DEFAULT NOW(),
    data_referencia DATE DEFAULT CURRENT_DATE,
    produto_id INTEGER REFERENCES produtos(id) ON DELETE CASCADE,
    quantidade NUMERIC(15,3) NOT NULL,
    valor_total NUMERIC(15,2) NOT NULL
);

-- Tabela: Configurações Gerais
CREATE TABLE configuracoes (
    chave TEXT PRIMARY KEY,
    valor TEXT
);

-- INSERÇÕES INICIAIS BASE
INSERT INTO configuracoes (chave, valor) VALUES ('investimento_inicial', '0');

-- PRODUTOS INICIAIS SUGERIDOS
INSERT INTO produtos (nome, categoria, unidade_medida) VALUES 
('Copo Térmico 100ml', 'insumo', 'un'),
('Café em Pó', 'insumo', 'g'),
('Açúcar', 'insumo', 'g'),
('Garrafa Térmica 2L', 'ativo', 'un');

-- Garante que Policies de RLS (Row Level Security) não bloqueiem (Por ser uso interno SPA anônimo)
-- ATENÇÃO: Se desejar segurança reforçada depois, deve-se criar roles e RLS. Para rodar fácil agora, as tabelas são públicas.
