import { readFileSync, readdirSync } from 'node:fs';
import { composeServices } from '@apollo/composition';
import { Supergraph } from '@apollo/federation-internals';
import { parse, validate, findBreakingChanges, findDangerousChanges, printSchema } from 'graphql';
import type { GraphQLSchema } from 'graphql';

export const serviceNames = ['catalog', 'inventory', 'merchants'] as const;
export type ServiceName = typeof serviceNames[number];
export const schemaSources = Object.fromEntries(serviceNames.map(name => [
  name, readFileSync(new URL(`../schemas/${name}.graphql`, import.meta.url), 'utf8'),
])) as Record<ServiceName, string>;

export function composeGraph(
  sources: Record<ServiceName, string> = schemaSources,
  urls: Partial<Record<ServiceName, string>> = {},
) {
  const result = composeServices(serviceNames.map(name => ({
    name,
    url: urls[name] ?? `http://127.0.0.1:${4011 + serviceNames.indexOf(name)}/`,
    typeDefs: parse(sources[name]),
  })));
  if (result.errors) throw new Error(`Composition failed:\n${result.errors.map(error => error.message).join('\n')}`);
  return {
    supergraphSdl: result.supergraphSdl,
    apiSchema: Supergraph.build(result.supergraphSdl).apiSchema().toGraphQLJSSchema(),
    hints: result.hints.map(hint => hint.message),
  };
}

export function loadOperations(): Record<string, string> {
  const directory = new URL('../operations/', import.meta.url);
  return Object.fromEntries(readdirSync(directory).filter(file => file.endsWith('.graphql')).sort().map(file => [
    file, readFileSync(new URL(file, directory), 'utf8'),
  ]));
}

export function validateOperations(schema: GraphQLSchema, operations = loadOperations()) {
  return Object.entries(operations).flatMap(([operation, source]) => {
    try { return validate(schema, parse(source)).map(error => ({ operation, message: error.message })); }
    catch (error) { return [{ operation, message: error instanceof Error ? error.message : String(error) }]; }
  });
}

export function compareContract(previous: GraphQLSchema, next: GraphQLSchema) {
  return {
    breaking: findBreakingChanges(previous, next),
    dangerous: findDangerousChanges(previous, next),
    operationErrors: validateOperations(next),
  };
}

export function apiSnapshot(schema: GraphQLSchema) { return `${printSchema(schema)}\n`; }
