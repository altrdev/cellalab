# CellaLab

**Configuratore per pacchi batteria fai-da-te, nel browser.** Disegni il pacco (o lo generi da serie e parallelo), lo guardi in 3D e ne esporti il portacelle da stampare e le lamelle da tagliare.

[🇬🇧 English](README.md) · Italiano

## Cosa fa

- **Pacco:** generazione automatica S×P (disposizione esagonale o quadrata) oppure disegno libero cella per cella; serie a pennello, gruppi in parallelo, polarità, annulla/ripristina. Calcola tensione, capacità, energia, corrente, peso, costo e ingombro.
- **Celle:** catalogo con profili generici e 14 modelli 18650/21700 (BAK, Samsung, Molicel, Murata, LG) con prezzi indicativi; si possono duplicare e modificare.
- **Corrente e BMS:** la corrente del pacco è la più bassa tra quella delle celle e il limite del BMS; le lamelle si dimensionano su quel valore.
- **Verifiche:** celle sovrapposte, spazio minimo per il portacelle, gruppi sbilanciati, polarità, limite sopra ciò che reggono le celle.
- **Anteprima 3D** (three.js): disegno e 3D affiancati, esplosione, viste isometrica/alto/frontale/laterale.
- **Lamelle:** generate dalla topologia, dimensionate su materiale, spessore e corrente (nichel, rame, ecc.), con punti di saldatura consigliati. Esportazione **DXF** per laser/CNC (con compensazione del taglio), dima **SVG** 1:1 e lista di taglio.
- **Portacelle stampabile in 3D:** due piastre su misura con tasche, fondo che trattiene le celle, raccordi e smusso a rampa liscia. Esportazione **STL** in posizione di stampa.
- **Progetto:** salvataggio automatico nel browser; salva e apri file `.cellalab.json` (include le impostazioni di lamelle e portacelle).

Interfaccia in italiano e in inglese (segue la lingua del browser); lunghezze in mm o pollici, temperature in °C o °F, pesi in g/kg o oz/lb, prezzi in €, $ o £: le impostazioni sono nell'ingranaggio accanto al titolo. I file da tagliare seguono l'unità di lunghezza (DXF, dima SVG); l'STL è sempre in mm.

## Avvio rapido

Serve Node 22 o più recente.

```bash
npm install
npm run dev      # sviluppo, di solito su http://localhost:5173
npm test         # test (Vitest)
npm run check    # controllo dei tipi (svelte-check)
npm run build    # versione di produzione in dist/
```

## Come si usa

1. **Pacco:** scegli «Genera automaticamente» (imposti S, P, cella e spazio tra le celle) oppure «Disegna a mano».
2. **Lamelle:** scegli materiale, spessore e saldatrice; la scheda mostra l'esito e gli avvisi.
3. **Portacelle:** regola pareti, gioco, fondo e smusso.
4. **Esporta:** DXF, dima, lista di taglio, STL e salvataggio del progetto.

## Stato e limiti

Progetto hobby in sviluppo.

- L'STL del portacelle **non è ancora stato provato con uno slicer reale**: controlla sempre l'anteprima nello slicer prima di stampare.
- Il dimensionamento termico delle lamelle è una stima a regime stazionario: ignora il calore verso le celle e la resistenza dei punti di saldatura.
- Le lamelle sono a un solo livello e di spessore unico.
- Prezzi e correnti delle celle sono indicativi (da nkon.nl, novembre 2026) e vanno verificati sulla scheda tecnica.
- Il 3D è stato provato con rendering software, non su GPU reale.

## Sicurezza

Un pacco di celle al litio può incendiarsi o esplodere se progettato o costruito male. CellaLab è un aiuto al progetto, **non una certificazione**: i risultati sono stime. Usa un BMS adatto, fusibili e protezioni, conosci i limiti delle tue celle e costruisci sotto la tua responsabilità.

## Struttura

```
src/core   logica pura (modello, calcoli, verifiche, lamelle, portacelle, DXF/STL), con i test
src/ui     interfaccia Svelte, editor 2D, scena 3D, esportazioni
```

Stack: Svelte 5, TypeScript, Vite, Vitest, three.js, clipper-lib.

## Licenza

[MIT](LICENSE) © 2026 Alessandro Travi
