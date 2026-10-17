import type { CatalogOnlyQuery } from './CatalogOnly.generated.js';

type Product = NonNullable<CatalogOnlyQuery['products'][number]>;

export function productHeading(product: Product): string {
  return product.name.toUpperCase();
}
