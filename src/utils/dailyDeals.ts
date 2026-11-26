/**
 * The shop's Daily Deals rows (DailyDealLibrary.json). Only the config's contents are shown; the app
 * deliberately does not predict which deals the shop offers on a given day.
 */

export interface DailyDealRow { DailyDealType: string; Size: { SizeId: number; Rewards: any[] }[] }
