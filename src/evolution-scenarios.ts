import { Kind, parse, parseType, print, visit } from 'graphql';
import type { FieldDefinitionNode, ObjectTypeDefinitionNode } from 'graphql';
import { schemaSources } from './schema.ts';
import type { ServiceName } from './schema.ts';

export const evolutionScenarios = [
  { id: 'unchanged', title: 'Unchanged control', change: 'Compose the current subgraphs without modifying them.' },
  { id: 'add-optional-field', title: 'Add a nullable field', change: 'Add Product.subtitle: String to catalog.' },
  { id: 'remove-description', title: 'Remove a selected field', change: 'Remove Product.description from catalog.' },
  { id: 'weaken-name-nullability', title: 'Weaken an output guarantee', change: 'Change Product.name from String! to String.' },
  { id: 'require-region-argument', title: 'Add a required argument', change: 'Require region: String! on Query.products without a default.' },
  { id: 'add-stock-enum-value', title: 'Expand an enum', change: 'Add PREORDER to StockStatus without changing existing values.' },
  { id: 'conflict-entity-key', title: 'Conflict across subgraphs', change: 'Change inventory Product.sku from ID! to Int! while catalog keeps ID!.' },
] as const;

export type EvolutionScenarioId = typeof evolutionScenarios[number]['id'];
type Sources = Record<ServiceName, string>;

function editObject(source: string, name: string, edit: (node: ObjectTypeDefinitionNode) => ObjectTypeDefinitionNode): string {
  let matches = 0;
  const document = visit(parse(source), {
    ObjectTypeDefinition(node) {
      if (node.name.value !== name) return;
      matches++;
      return edit(node);
    },
  });
  if (matches !== 1) throw new Error(`Scenario requires exactly one definition of ${name}; found ${matches}.`);
  return print(document);
}

function editField(source: string, type: string, field: string, edit: (node: FieldDefinitionNode) => FieldDefinitionNode | null): string {
  return editObject(source, type, node => {
    let matches = 0;
    const fields = (node.fields ?? []).flatMap(candidate => {
      if (candidate.name.value !== field) return [candidate];
      matches++;
      const edited = edit(candidate);
      return edited ? [edited] : [];
    });
    if (matches !== 1) throw new Error(`Scenario requires exactly one ${type}.${field}.`);
    return { ...node, fields };
  });
}

/** AST edits return new in-memory SDL. No source or baseline file is ever written. */
export function scenarioSources(id: EvolutionScenarioId, original: Sources = schemaSources): Sources {
  const sources = { ...original };
  switch (id) {
    case 'unchanged': break;
    case 'add-optional-field':
      sources.catalog = editObject(sources.catalog, 'Product', node => {
        if (node.fields?.some(field => field.name.value === 'subtitle')) throw new Error('Scenario fixture already contains Product.subtitle.');
        return { ...node, fields: [...(node.fields ?? []), { kind: Kind.FIELD_DEFINITION, name: { kind: Kind.NAME, value: 'subtitle' }, type: parseType('String') }] };
      });
      break;
    case 'remove-description':
      sources.catalog = editField(sources.catalog, 'Product', 'description', () => null);
      break;
    case 'weaken-name-nullability':
      sources.catalog = editField(sources.catalog, 'Product', 'name', node => {
        if (print(node.type) !== 'String!') throw new Error('Scenario expects Product.name: String!.');
        return { ...node, type: parseType('String') };
      });
      break;
    case 'require-region-argument':
      sources.catalog = editField(sources.catalog, 'Query', 'products', node => {
        if (node.arguments?.some(argument => argument.name.value === 'region')) throw new Error('Scenario fixture already contains Query.products(region:).');
        return { ...node, arguments: [...(node.arguments ?? []), { kind: Kind.INPUT_VALUE_DEFINITION, name: { kind: Kind.NAME, value: 'region' }, type: parseType('String!') }] };
      });
      break;
    case 'add-stock-enum-value': {
      let matches = 0;
      sources.inventory = print(visit(parse(sources.inventory), {
        EnumTypeDefinition(node) {
          if (node.name.value !== 'StockStatus') return;
          matches++;
          if (node.values?.some(value => value.name.value === 'PREORDER')) throw new Error('Scenario fixture already contains StockStatus.PREORDER.');
          return { ...node, values: [...(node.values ?? []), { kind: Kind.ENUM_VALUE_DEFINITION, name: { kind: Kind.NAME, value: 'PREORDER' } }] };
        },
      }));
      if (matches !== 1) throw new Error('Scenario requires exactly one StockStatus enum.');
      break;
    }
    case 'conflict-entity-key':
      sources.inventory = editField(sources.inventory, 'Product', 'sku', node => ({ ...node, type: parseType('Int!') }));
      break;
    default: throw new Error(`Unknown evolution scenario: ${String(id)}`);
  }
  return sources;
}
