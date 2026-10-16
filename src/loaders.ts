import DataLoader from 'dataloader';
import { GraphQLError } from 'graphql';
import { setTimeout as delay } from 'node:timers/promises';
import { products, merchants, quantities } from './data.ts';
import type { ProductRecord, MerchantRecord, Availability } from './data.ts';
import type { Scenario } from './scenarios.ts';

export interface BatchRecord { source: string; keys: readonly string[] }
export interface SubgraphContext {
  scenario: Scenario;
  batches: BatchRecord[];
  product: DataLoader<string, ProductRecord | null>;
  merchant: DataLoader<string, MerchantRecord | null>;
  inventory: DataLoader<string, Availability | null>;
}

/** New loaders for every HTTP operation. No cache survives the request boundary. */
export function createContext(scenario: Scenario = 'healthy', delayMs = 450): SubgraphContext {
  const batches: BatchRecord[] = [];
  return {
    scenario,
    batches,
    product: new DataLoader(async keys => {
      batches.push({ source: 'catalog', keys: [...keys] });
      const found = new Map(products.filter(product => keys.includes(product.sku)).map(product => [product.sku as string, product]));
      // Return one result per key, preserving order even when a record is absent.
      return keys.map(key => found.get(key) ?? null);
    }),
    merchant: new DataLoader(async keys => {
      batches.push({ source: 'merchants', keys: [...keys] });
      const found = new Map(merchants.filter(merchant => keys.includes(merchant.id)).map(merchant => [merchant.id as string, merchant]));
      return keys.map(key => found.get(key) ?? null);
    }),
    inventory: new DataLoader(async keys => {
      batches.push({ source: 'inventory', keys: [...keys] });
      if (scenario === 'inventory-timeout') await delay(delayMs);
      if (scenario === 'inventory-error') {
        throw new GraphQLError('Synthetic inventory dependency is unavailable.', { extensions: { code: 'INVENTORY_UNAVAILABLE' } });
      }
      return keys.map(key => {
        if (scenario === 'missing-inventory' && key === 'demo-lamp') return null;
        const quantity = Object.hasOwn(quantities, key) ? quantities[key] : undefined;
        return quantity === undefined ? null : { status: quantity > 0 ? 'IN_STOCK' : 'SOLD_OUT', quantity };
      });
    }),
  };
}
