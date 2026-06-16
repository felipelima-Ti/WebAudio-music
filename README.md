#  Sound-Hand-Synth
O Sound-Hand-Synth é uma aplicação web interativa de síntese sonora que combina visão computacional e processamento de áudio em tempo real. Utilizando a detecção de mãos do MediaPipe Hands e a síntese sonora da biblioteca Tone.js (baseada na Web Audio API), o sistema permite que usuários controlem acordes musicais por meio dos movimentos das mãos capturados pela câmera.

O objetivo do projeto é proporcionar uma experiência intuitiva de criação musical sem a necessidade de instrumentos físicos, tornando conceitos de síntese sonora e teoria musical mais acessíveis para estudantes, músicos e desenvolvedores.

O projeto foi desenvolvido com foco educacional e experimental, permitindo explorar conceitos de áudio digital, síntese sonora, teoria musical e interação humano-computador de forma intuitiva e visual.

---

##  Funcionalidades

-  Geração de acordes 
- Controle musical através do rastreamento das mãos
- 8 qualidades de acordes:
   Maior (maj)
   Maior com sétima (maj7)
   Dominante (7)
   Suspenso (sus4)
   Menor (m)
   Menor com sétima (m7)
   Diminuto (dim)
   Aumentado (aug)
-  Filtro Low-Pass ajustável
-  Seleção de formas de onda:
  - Sine
  - Triangle
  - Square
  - Sawtooth
-  Modo Simples (7 notas diatônicas)
-  Modo Completo (12 notas cromáticas)
-  Interface responsiva para desktop e dispositivos móveis
-  Transições suaves entre acordes

---

##  Tecnologias Utilizadas

- React
- TypeScript
- Tone.js
- Web Audio API
- MediaPipe Hands
- HTML5 Canvas
- Webcam API

---

##  Como Funciona
A funcao initAudio Função para inicializar o áudio usando ToneJS, criando os osciladores,filtro necessários para tocar os acordes<br/>
O sintetizador utiliza quatro osciladores simultâneos.Cada oscilador reproduz uma nota do acorde.<br/>
A frequência sintese sonora é calculada na constante midiTofreq a partir do número MIDI utilizando: f=440×212(m−69)​/12<br/>
A funçao drawWhell exibe duas rodas interativas na tela<br/>
A funcão sliceToRootName: Função para converter um índice para o nome da nota correspondente, dependendo do modo simples ou completo, DIATONIC_NAMES | NOTE_NAMES<br/>
Biblioteca utilizada:
MediaPipe Hands,Tonejs,web audio api,Webcam API<br/>
a funçao startApp tenta carrega Mediapipe e todos os scripts pendentes


### Roda de Notas (Esquerda)

Responsável por selecionar a nota fundamental do acorde.

#### Modo Simples

  C,
  D,
 E,
F,
G,
 A,
 B

#### Modo Completo

C,
C#,
 D,
 D#,
 E,
 F,
 F#,
 G,
 G#,
 A,
 A#,
 B

### Roda de Qualidades (Direita)

Permite selecionar o tipo do acorde:

| Tipo | Descrição |
|--------|------------|
| maj | Maior |
| maj7 | Maior com sétima maior |
| 7 | Dominante |
| sus4 | Suspenso |
| m | Menor |
| m7 | Menor com sétima |
| dim | Diminuto |
| aug | Aumentado |

---

##  Controle por Gestos

### Uma Mão

Quando apenas uma mão é detectada, ela controla automaticamente a roda mais próxima.

### Duas Mãos

Quando duas mãos são detectadas:

- Uma controla a nota fundamental.
- A outra controla a qualidade do acorde.

A atribuição é realizada automaticamente de acordo com a proximidade das mãos em relação às rodas.

---

##  Controles do Sintetizador

### Formas de Onda

O usuário pode escolher entre:

- Sine
- Triangle
- Square
- Sawtooth

### Filtro Low-Pass

Permite ajustar a frequência de corte entre:

```text
200 Hz → 8000 Hz
```

Quanto menor a frequência, mais suave será o timbre produzido.

---

## Arquitetura de Áudio

O sintetizador utiliza:

- 4 osciladores simultâneos
- Filtro Low-Pass
- Ganho controlado dinamicamente
- Conversão MIDI para frequência
- Envelope suave para evitar cliques e ruídos

Nota base utilizada:

```text
MIDI 48 (C3)
```

---

##  Instalação

Clone o repositório:

```bash
git clone https://github.com/seu-usuario/sound-hand-synth.git
```

Entre na pasta do projeto:

```bash
cd sound-hand-synth
```

Instale as dependências:

```bash
npm install
```

Execute o projeto:

```bash
npm run dev
```

Abra no navegador:

```text
http://localhost:3000
```

---

## ⚠️ Permissões Necessárias

O aplicativo necessita de acesso à câmera para detectar os movimentos das mãos.

Ao iniciar o sistema, permita o acesso à webcam quando solicitado pelo navegador.

---

##  Demonstração

Adicione aqui imagens, GIFs ou vídeos demonstrando o funcionamento da aplicação.

```md
![Demo](./assets/demo.gif)
```

---

##  Melhorias Futuras

- Controle de volume por gestos
- Controle de oitava
- Arpejador
- Delay
- Reverb
- Chorus
- Gravação de sessões
- Exportação MIDI
- Escalas personalizadas
- Visualizador de espectro em tempo real

---

##  Objetivo Acadêmico

Este projeto foi desenvolvido para explorar conceitos de:

- Processamento de Áudio Digital
- Síntese Sonora
- Visão Computacional
- Interação Humano-Computador
- Desenvolvimento Web em Tempo Real

---


Este projeto está sob a licença MIT.

Sinta-se livre para utilizar, modificar e distribuir o código.

---
