import type { CatalogCardsQuery } from './CatalogCards.generated.js';

type Product = NonNullable<CatalogCardsQuery['products'][number]>;
type Status = NonNullable<Product['availability']>['status'];

function assertNever(value: never): never {
  throw new Error(`Unhandled stock status: ${value}`);
}

export function stockLabel(status: Status): string {
  switch (status) {
    case 'IN_STOCK': return 'Available';
    case 'SOLD_OUT': return 'Sold out';
    default: return assertNever(status);
  }
}
