# Forge Predictor

Open **Calculators → Forge Predictor**. Enter consecutive completed forges or load the synthetic example from Help. Recovery and forecasts run in a browser worker.

- `npm run dev` and `npm run build` generate the worker, solver, and license notice in `public/forge-seed-lab/`. These outputs are ignored by Git.
- `npm run test:forge-seed-lab` builds those assets and runs the model, worker, and forecast tests.
- The calculator builds its game tables from `public/parsed_configs` for the version selected in the app (`src/components/ForgePredictor/buildModel.ts`), the same files the rest of the app reads, and sends them to the worker with each request.
- `model-data.json` is only the embedded copy used by the worker tests. `npm run update:forge-seed-lab-data` regenerates it from `public/parsed_configs`, and `test-app-model.mts` fails when it drifts.
- `native-worker.js` handles requests from the calculator. The optional item-level solver loads only when needed.
