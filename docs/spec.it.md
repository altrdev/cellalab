> Original specification (first draft, Italian). It describes the intended scope and phases; the code is the source of truth for what exists. Open items are in [TODO.md](TODO.md).

# CellaLab — Specifica di progetto (bozza 1)

Configuratore web per pacchi batteria DIY. App statica nel browser, senza backend. Italiano come lingua UI principale.

## Principi
- Modello dati unico: **geometria** (posizione, tipo, polarità di ogni cella) separata dalla **topologia elettrica** (gruppi in parallelo ordinati in serie). Tutto il resto (3D, holder, lamelle, calcoli) deriva da qui.
- Flusso ibrido: wizard S×P che genera un layout + editor libero con snap.
- Priorità ai maker: tutto fattibile a casa con saldatrice a punti hobby, stampante 3D FDM e taglio a mano; laser/CNC/servizi esterni supportati ma non obbligatori.
- Cataloghi e profili editabili dall'utente; i valori di default sono ipotesi prudenti, non dati garantiti.

## Moduli
1. **Catalogo celle**: 18650, 21700, 26650, 32700, 4680, custom (diametro, altezza, V nom/max/min, capacità, corrente max scarica, peso, prezzo).
2. **Disposizione**: griglia quadrata o hex, spaziatura, snap, polarità per cella, rotazione, undo/redo.
3. **Calcoli live**: tensione, capacità, energia, corrente max, peso, costo, ingombro, perdite sulle lamelle.
4. **Verifiche (DRC)**: gruppi con P diverso, celle a potenziali diversi che si toccano, lamelle sovrapposte/troppo vicine, correnti oltre i limiti.
5. **BMS**: catalogo (S supportate, corrente max, connettore bilanciamento, dimensioni, fori, posizioni B-/P-/P+, NTC) + custom. Verifiche: S pacco = S BMS, corrente, chimica, n+1 fili. Montaggio sul pacco (tasca + distanziali) o esterno (solo uscita fili con fermacavo).
6. **Fili BMS**: linguetta di presa su ogni lamella in serie, fori passanti tra le facce, canali per il filo (AWG scelto), uscita unica, fori maggiori per cavi di potenza, tasca NTC.
7. **Lamelle**: dimensionamento automatico con tre criteri:
   - termico continuo: t·(w+t) = I²·ρ / (2·w·h·ΔT), ΔT default 20–30 K, h = 10 (aria libera) / 25 (ventilato) / 5 (chiuso);
   - picco adiabatico: A_min = I_picco · √(ρ·t_imp / (c_v·ΔT));
   - punti di saldatura: n = ceil((I/P) / I_per_punto).
   Alternative proposte se non fattibile: strato singolo → più larga → più strati → struttura a due livelli (linguette di nichel + barra di rame) → altro materiale/giunzione.
   Evoluzione: rete di resistori (celle = nodi, tratti = resistenze) per correnti e punti caldi reali.
8. **Catalogo materiali lamelle**: nichel puro, acciaio nichelato, rame nichelato, rame, ottone, alluminio (ρ, densità, c, coeff. temperatura, saldabilità, spessori, prezzo). Valori tipici da verificare sul datasheet del fornitore.
9. **Profili**: saldatrice (spessore max, strati max, A per punto, distanza punti; default hobby prudente), taglio (a mano / laser / CNC / servizio: kerf, feature minima, ponticello minimo), stampante (compensazione fori, piano, materiale).
10. **Holder**: generatore unico, due uscite: monolitico (due piastre, split per piano di stampa con giunti) e modulare (tassello per cella con incastri, solo su reticolo). BOM di stampa per tipo di tassello. Avviso PLA (ammorbidimento ~60 °C), consigliati PETG/ASA/ABS. Pezzo di prova per calibrare la tolleranza (giochi 0,1/0,2/0,3 mm).
11. **Export**: STL/3MF, DXF ASCII semplice (layer CUT/MARK/FOLD/TEXT, compensazione kerf, nesting opzionale), SVG/PDF 1:1 con barra di scala, lista di taglio per rotoli, BOM CSV, progetto JSON.

## Stack previsto
TypeScript + Vite, logica pura separata dalla UI, canvas 2D/SVG per l'editor, three.js per il 3D, manifold-3d (WASM) per le booleane, writer DXF proprio.

## Fasi
0. Fondamenta: scaffolding, modello dati, salvataggio JSON, undo/redo, test dei calcoli.
1. Editor 2D, catalogo celle, wizard S×P, barra calcoli.
2. Topologia elettrica, DRC base, verifica S/corrente BMS, anteprima 3D semplice con esplosione.
3. Lamelle: materiali, dimensionamento, profilo saldatrice, export DXF/SVG/lista taglio.
4. Holder: modulare su reticolo + test tolleranza, poi monolitico con split.
5. BMS completo: linguette di presa, fori e canali, alloggio sul pacco.
6. Rifiniture: due livelli, rete di resistori, nesting, link di condivisione, PDF di montaggio.
