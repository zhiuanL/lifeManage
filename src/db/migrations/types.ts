export interface Migration {
  id: string;
  statements: readonly string[];
}
