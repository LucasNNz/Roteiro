# CORVOQUIZ V0.6.53 + BRIDGE V0.6.36 — GERADOR POR IDs LÓGICOS A/B

## V0.6.53

O Gerador agora recebe comparações no contrato validado manualmente: 4 IDs lógicos podem produzir 8 assets físicos A/B. Internamente o app continua controlando os 8 slots do Forma, mas a conversa do Gerador agrupa A+B dentro do ID lógico, com proibição explícita de colagem e nomes físicos _A/_B. O Checkpoint V5 reabre jobs de Gerador A/B ainda pendentes criados pelo contrato antigo.


Corrige a entrega física do preset QUAL_VOCE_PREFERE. Comparações passam a ser dois slots A/B, roteiros legados são migrados e o Bridge infere a geometria real de contact sheets antes de recortar. A consolidação bloqueia ZIPs cujo ROTEIRO.txt cite imagens ausentes.