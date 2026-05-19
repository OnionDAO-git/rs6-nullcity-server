import { cropReady, growthStage, unixGrowthTick } from './farming-clock';
import { farmingCrops } from './farming-config';

describe('farming clock', () => {
    it('computes growth stages from elapsed ticks', () => {
        const crop = farmingCrops[0];

        expect(growthStage(crop, 100, 100)).toBe(0);
        expect(growthStage(crop, 100, 105)).toBe(1);
        expect(cropReady(crop, 100, 115)).toBe(true);
    });

    it('converts wall-clock time to growth ticks', () => {
        expect(unixGrowthTick(new Date(1200), 600)).toBe(2);
    });
});
