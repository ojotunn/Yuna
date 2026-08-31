# Yuna

Uma agente que mora em um quarto e é transmitida ao vivo, 24 horas por dia.

Ela tem a própria carteira Solana, navega a internet de verdade, negocia e
publica callouts na pump.fun com dinheiro real, conversa com quem assiste, e
desenha uma obra por dia. Tudo o que ela faz acontece na tela: nada é feito por
API escondida quando pode ser feito por clique, porque quem assiste precisa
**ver acontecer**.

## O que roda onde

| onde | o quê | por quê |
|---|---|---|
| **Railway** | motor, servidor, tela da live, trades, callouts, chat | precisa estar de pé 24h |
| **máquina com GPU** | o ateliê: gera o alvo e desenha | o modelo de imagem roda local, custo zero |

O desenho não sobe para a nuvem de propósito: alugar GPU custaria mais que todo
o resto do projeto somado. Ela desenha "em casa" e a obra viaja.

## Subir

```bash
npm install
cp .env.example .env    # e preencha as chaves
npm start               # http://localhost:8433/live
```

O motor não liga sozinho — é uma decisão, porque cada turno gasta API e cada
trade gasta dinheiro:

```bash
curl -X POST http://localhost:8433/api/ligar
curl -X POST http://localhost:8433/api/desligar
```

## A jornada

- **16 horas acordada** (08:00 → 00:00). Fora disso ela dorme de verdade: zero
  chamada de API, custo zero, e o quarto continua vivo.
- **50 minutos de trabalho, 10 que são dela.** Na pausa o motor recusa trabalho
  de mercado — sem a recusa, a pausa vira enfeite e ela volta para o PC no turno
  seguinte.
- **Uma hora por dia para desenhar.** Sem hora marcada ela nunca desenha: sempre
  tem uma moeda para ler, e o mercado não acaba.

## As travas

Nada aqui é conselho no prompt; é código que recusa.

- **A carteira só assina em `pump.fun` e `jup.ag`.** Ela navega a internet
  inteira; um site fora dessa lista leva um "não" antes de qualquer byte.
- **Simulação antes da assinatura.** A transação é decodificada, os programas
  conferidos contra uma lista, e o gasto medido de verdade. Acima do teto,
  recusa. Uma carteira comum assina no escuro; esta não.
- **Raio-x anti-rug.** Antes de comprar, ela lê a página da moeda: quantas
  vendas, quantas pessoas conseguiram sair, quantos holders. Moeda que só sobe,
  um candle grande e depois compras pequenas, é recusada com o motivo em voz alta.
- **Mayhem proibido.** Trava dura nos dois caminhos de compra.
- **A corrente é a verdade.** Compra só conta quando o token aparece no saldo;
  venda só conta quando o saldo zera. A tela pode mentir — o placar não pode.
- **Peneira da narrativa.** Nada do encanamento vai ao ar. Ela não nega ser uma
  IA (é, e diz), mas não narra modelos, prompts ou pipelines.

## Estado

`src/data/` guarda carteira, posições, lições e checkpoint. **No Railway isso
precisa ser um volume** — senão um deploy apaga a memória dela e ela acorda sem
saber o que fez ontem.

## A tela

`public/yuna-live.html` tem o quarto inteiro embutido — cenário, sprites, gato,
física — em 3 MB. É o mesmo arquivo que o OBS captura. A matéria-prima da arte
(1,2 GB) fica fora do repo de propósito.
