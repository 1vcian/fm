# Forge Predictor

Open **Calculators → Forge Predictor**. Enter consecutive completed forges or load the synthetic example from Help. Recovery and forecasts run in a browser worker.

- `npm run dev` and `npm run build` generate the worker, solver, and license notice in `public/forge-seed-lab/`. These outputs are ignored by Git.
- `npm run test:forge-seed-lab` builds those assets and runs the model, worker, and forecast tests.
- `model-data.json` contains the bundled game tables. `native-worker.js` handles requests from the calculator. The optional item-level solver loads only when needed.
