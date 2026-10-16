import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import {
  Kind, Source, TypeInfo, buildSchema, findBreakingChanges, findDangerousChanges,
  getNamedType, isEnumType, isInterfaceType, isNonNullType, isObjectType,
  parse, printSchema, separateOperations, validate, visit, visitWithTypeInfo,
} from 'graphql';
import type { BreakingChange, DangerousChange, DocumentNode, GraphQLSchema } from 'graphql';
import { CompositionError, composeGraph, loadOperations, schemaSources } from './schema.ts';
import type { ServiceName } from './schema.ts';
import { evolutionScenarios, scenarioSources } from './evolution-scenarios.ts';
import type { EvolutionScenarioId } from './evolution-scenarios.ts';

interface Consumer {
  document: string;
  operation: string;
  ast: DocumentNode;
  fields: string[];
  enums: string[];
}
export interface ConsumerId { document: string; operation: string }
export interface SelectedSchemaChange {
  coordinate: string;
  kind: 'field-removed' | 'output-type-changed' | 'required-argument-added' | 'enum-values-changed';
  before: string | null;
  after: string | null;
}
export interface OperationImpact extends ConsumerId {
  validation: 'valid' | 'invalid' | 'not-evaluated';
  errors: { message: string; locations: readonly { line: number; column: number }[] }[];
  selectedSchemaChanges: SelectedSchemaChange[] | null;
}
export interface ScenarioImpact {
  id: EvolutionScenarioId;
  title: string;
  change: string;
  composition: { status: 'composed' | 'failed'; errors: { code: string | null; message: string }[] };
  compatibility: {
    classification: 'compatible' | 'breaking' | 'review-required' | 'not-evaluated';
    breaking: BreakingChange[] | null;
    dangerous: DangerousChange[] | null;
  };
  operations: OperationImpact[];
  invalidatedOperations: ConsumerId[] | null;
  validOperationsWithSchemaChanges: ConsumerId[] | null;
}
export interface ImpactReport {
  version: 1;
  mode: 'in-memory-schema-analysis';
  baseline: { sha256: string; consumers: ConsumerId[] };
  limits: string[];
  scenarios: ScenarioImpact[];
}

const identity = ({ document, operation }: ConsumerId): ConsumerId => ({ document, operation });

function consumersFrom(schema: GraphQLSchema, documents: Record<string, string>): Consumer[] {
  const consumers: Consumer[] = [];
  for (const [document, source] of Object.entries(documents).sort(([a], [b]) => a.localeCompare(b))) {
    const ast = parse(new Source(source, document));
    const errors = validate(schema, ast);
    if (errors.length) throw new Error(`Baseline document ${document} is invalid: ${errors.map(error => error.message).join('; ')}`);
    if (ast.definitions.some(node => node.kind === Kind.OPERATION_DEFINITION && !node.name)) throw new Error(`Baseline document ${document} must use named operations.`);
    const separated = Object.entries(separateOperations(ast));
    if (!separated.length) throw new Error(`Baseline document ${document} contains no named operations.`);
    for (const [operation, operationAst] of separated.sort(([a], [b]) => a.localeCompare(b))) {
      const fields = new Set<string>();
      const enums = new Set<string>();
      const info = new TypeInfo(schema);
      visit(operationAst, visitWithTypeInfo(info, {
        Field(node) {
          const parent = info.getParentType();
          const field = info.getFieldDef();
          if (!parent || !field || parent.name.startsWith('__') || node.name.value.startsWith('__')) return;
          fields.add(`${parent.name}.${node.name.value}`);
          const type = getNamedType(field.type);
          if (isEnumType(type)) enums.add(type.name);
        },
      }));
      consumers.push({ document, operation, ast: operationAst, fields: [...fields].sort(), enums: [...enums].sort() });
    }
  }
  if (!consumers.length) throw new Error('At least one named baseline operation is required.');
  return consumers;
}

function selectedChanges(previous: GraphQLSchema, next: GraphQLSchema, consumer: Consumer): SelectedSchemaChange[] {
  const changes: SelectedSchemaChange[] = [];
  for (const coordinate of consumer.fields) {
    const [typeName, fieldName] = coordinate.split('.') as [string, string];
    const previousType = previous.getType(typeName);
    const nextType = next.getType(typeName);
    const oldField = (isObjectType(previousType) || isInterfaceType(previousType)) ? previousType.getFields()[fieldName] : undefined;
    const nextField = (isObjectType(nextType) || isInterfaceType(nextType)) ? nextType.getFields()[fieldName] : undefined;
    if (!oldField) continue;
    if (!nextField) {
      changes.push({ coordinate, kind: 'field-removed', before: String(oldField.type), after: null });
      continue;
    }
    if (String(oldField.type) !== String(nextField.type)) changes.push({ coordinate, kind: 'output-type-changed', before: String(oldField.type), after: String(nextField.type) });
    for (const argument of nextField.args) {
      if (!oldField.args.some(old => old.name === argument.name) && isNonNullType(argument.type) && argument.defaultValue === undefined) {
        changes.push({ coordinate: `${coordinate}(${argument.name}:)`, kind: 'required-argument-added', before: null, after: String(argument.type) });
      }
    }
  }
  for (const name of consumer.enums) {
    const previousType = previous.getType(name);
    const nextType = next.getType(name);
    if (!isEnumType(previousType) || !isEnumType(nextType)) continue;
    const before = previousType.getValues().map(value => value.name).sort().join(' | ');
    const after = nextType.getValues().map(value => value.name).sort().join(' | ');
    if (before !== after) changes.push({ coordinate: name, kind: 'enum-values-changed', before, after });
  }
  return changes;
}

export function createImpactReport(options: {
  baseline?: GraphQLSchema;
  documents?: Record<string, string>;
  sources?: Record<ServiceName, string>;
  scenarios?: readonly EvolutionScenarioId[];
} = {}): ImpactReport {
  const baseline = options.baseline ?? buildSchema(readFileSync(new URL('../schemas/api-baseline.graphql', import.meta.url), 'utf8'));
  const consumers = consumersFrom(baseline, options.documents ?? loadOperations());
  const ids = options.scenarios ?? evolutionScenarios.map(scenario => scenario.id);
  if (!ids.length) throw new Error('At least one evolution scenario is required.');
  if (new Set(ids).size !== ids.length) throw new Error('Select each scenario at most once.');
  const scenarios = ids.map(id => {
    const definition = evolutionScenarios.find(scenario => scenario.id === id);
    if (!definition) throw new Error(`Unknown evolution scenario: ${String(id)}`);
    // Fixture errors are not mislabeled as a Federation composition finding.
    const sources = scenarioSources(id, options.sources ?? schemaSources);
    let next: GraphQLSchema;
    try { next = composeGraph(sources).apiSchema; }
    catch (error) {
      if (!(error instanceof CompositionError)) throw error;
      return {
        ...definition,
        composition: { status: 'failed', errors: error.issues.map(issue => ({ code: typeof issue.extensions.code === 'string' ? issue.extensions.code : null, message: issue.message })) },
        compatibility: { classification: 'not-evaluated', breaking: null, dangerous: null },
        operations: consumers.map(consumer => ({ ...identity(consumer), validation: 'not-evaluated', errors: [], selectedSchemaChanges: null })),
        invalidatedOperations: null,
        validOperationsWithSchemaChanges: null,
      } satisfies ScenarioImpact;
    }
    const breaking = findBreakingChanges(baseline, next);
    const dangerous = findDangerousChanges(baseline, next);
    const operations = consumers.map(consumer => {
      const errors = validate(next, consumer.ast).map(error => ({ message: error.message, locations: error.locations ?? [] }));
      return {
        ...identity(consumer), validation: errors.length ? 'invalid' : 'valid', errors,
        selectedSchemaChanges: selectedChanges(baseline, next, consumer),
      } satisfies OperationImpact;
    });
    return {
      ...definition,
      composition: { status: 'composed', errors: [] },
      compatibility: { classification: breaking.length ? 'breaking' : dangerous.length ? 'review-required' : 'compatible', breaking, dangerous },
      operations,
      invalidatedOperations: operations.filter(operation => operation.validation === 'invalid').map(identity),
      validOperationsWithSchemaChanges: operations.filter(operation => operation.validation === 'valid' && operation.selectedSchemaChanges.length > 0).map(identity),
    } satisfies ScenarioImpact;
  });
  return {
    version: 1,
    mode: 'in-memory-schema-analysis',
    baseline: { sha256: createHash('sha256').update(printSchema(baseline)).digest('hex'), consumers: consumers.map(identity) },
    limits: [
      'Only the supplied named operations are assessed. This is not a complete consumer registry.',
      'Operation validation checks GraphQL structure, not runtime values, generated client code, authorization or business behavior.',
      'Selected-schema review is a scoped field/type/enum projection for these scenarios, not a general impact analyzer; conditional selections are included conservatively.',
      'No resolvers run and no schema or baseline files are changed. Scenario results are hypothetical, not deployment approval.',
    ],
    scenarios,
  };
}

export function formatImpactText(report: ImpactReport): string {
  const lines = ['SCHEMA EVOLUTION / CONSUMER IMPACT', `Baseline: ${report.baseline.sha256.slice(0, 12)} · ${report.baseline.consumers.length} named consumers`, ''];
  for (const scenario of report.scenarios) {
    lines.push(`${scenario.id}: composition ${scenario.composition.status}; schema ${scenario.compatibility.classification}`);
    for (const issue of scenario.composition.errors) lines.push(`  ${issue.code ?? 'COMPOSITION_ERROR'}: ${issue.message}`);
    for (const change of [...(scenario.compatibility.breaking ?? []), ...(scenario.compatibility.dangerous ?? [])]) lines.push(`  ${change.type}: ${change.description}`);
    for (const operation of scenario.operations) {
      lines.push(`  ${operation.document}#${operation.operation}: ${operation.validation}`);
      for (const error of operation.errors) lines.push(`    validation: ${error.message}`);
      for (const change of operation.selectedSchemaChanges ?? []) lines.push(`    schema review: ${change.coordinate} (${change.before ?? 'absent'} -> ${change.after ?? 'absent'})`);
    }
    lines.push('');
  }
  lines.push('Limits:', ...report.limits.map(limit => `- ${limit}`));
  return `${lines.join('\n')}\n`;
}
