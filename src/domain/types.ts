export interface TypeDefinition {
  name: string;
  promptTemplate: string;
  taskTemplate: string;
}

const VALID_TYPE_NAME = /^[a-z][a-z0-9-]*$/;

export function isValidTypeName(name: string): boolean {
  return VALID_TYPE_NAME.test(name) && name.length <= 40;
}
