import { GameAssetIcon } from '../../components/UI/GameAssetIcon';

export default function ForgePredictor() {
    const source = `${import.meta.env.BASE_URL}forge-seed-lab/index.html?embed=1`;

    return (
        <div className="space-y-4">
            <div className="flex items-center gap-3">
                <GameAssetIcon asset={{ icon: 'Anvil' }} size={28} />
                <div>
                    <h1 className="text-2xl font-bold text-text-primary">Forge Predictor</h1>
                    <p className="text-sm text-text-secondary">Recover your forge seed, find future gear and estimate hammer value.</p>
                </div>
            </div>
            <iframe
                title="Forge Predictor"
                src={source}
                className="w-full border-0 rounded-xl"
                style={{ height: 'calc(100dvh - 170px)', minHeight: 600 }}
            />
        </div>
    );
}
