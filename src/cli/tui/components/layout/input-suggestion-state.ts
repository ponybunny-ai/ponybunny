import {
  buildCommandCatalogRows,
  getCommandCatalogCommandRows,
  type CommandCatalogMode,
  type CommandCatalogCommandRow,
  type CommandCatalogRow,
} from '../../commands/command-catalog.js';

export type SuggestionSortMode = CommandCatalogMode;
export type SuggestionRow = CommandCatalogRow;
export type SuggestionCommandRow = CommandCatalogCommandRow;

export function buildSuggestionRows(
  sourceCommands: unknown,
  query: string,
  mode: SuggestionSortMode
): SuggestionRow[] {
  void sourceCommands;
  return buildCommandCatalogRows(query, mode);
}

export function getCommandRows(rows: SuggestionRow[]): SuggestionCommandRow[] {
  return getCommandCatalogCommandRows(rows);
}
