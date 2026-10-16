/** Entirely invented fixtures. No production identifiers, measurements or policies. */
export const products = [
  { sku: 'demo-ceramic', name: 'Orbit Ceramic Cup', description: 'A fictional wheel-thrown cup.', amountMinor: 2400, currency: 'USD', merchantId: 'merchant-north' },
  { sku: 'demo-notebook', name: 'Field Notes Journal', description: 'A fictional clothbound notebook.', amountMinor: 1800, currency: 'USD', merchantId: 'merchant-north' },
  { sku: 'demo-lamp', name: 'Arc Desk Lamp', description: 'A fictional adjustable desk lamp.', amountMinor: 6900, currency: 'USD', merchantId: 'merchant-east' },
] as const;

export const merchants = [
  { id: 'merchant-north', name: 'North Studio', city: 'Example City' },
  { id: 'merchant-east', name: 'East Workshop', city: 'Sample Town' },
] as const;

export const quantities: Readonly<Record<string, number>> = {
  'demo-ceramic': 8,
  'demo-notebook': 0,
  'demo-lamp': 3,
};

export const sampleSkus = products.map(product => product.sku);
export type ProductRecord = typeof products[number];
export type MerchantRecord = typeof merchants[number];
export interface Availability { status: 'IN_STOCK' | 'SOLD_OUT'; quantity: number }
